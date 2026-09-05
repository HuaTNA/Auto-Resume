import { expect, test } from "@playwright/test";

const REAL_RECRUITING_HOSTS = ["greenhouse.io", "greenhouse.com", "lever.co", "indeed.com", "linkedin.com"];
let contactedRecruitingHosts = new Set<string>();

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/mock-agent/reset");
  contactedRecruitingHosts = new Set<string>();
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname.toLowerCase();
    if (REAL_RECRUITING_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) contactedRecruitingHosts.add(host);
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: 7, email: "mobile-tester@example.test", created_at: "2026-08-27T12:00:00Z" }),
  }));
  await page.goto("/career/applications");
  await expect(page.getByTestId("agent-control-center")).toBeVisible();
});

test.afterEach(() => { expect([...contactedRecruitingHosts]).toEqual([]); });

test("stores newly discovered roles in a dedicated tab", async ({ page }) => {
  const newJobsTab = page.getByRole("tab", { name: /新岗位|New jobs/ });
  await expect(newJobsTab).toContainText("1");
  await newJobsTab.click();
  await expect(page.getByRole("button", { name: /Product Operations Manager/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Senior Product Analyst/ })).toHaveCount(0);
  await expect(page.getByTestId("application-state")).toContainText(/已发现|Discovered/);

  await page.getByRole("tab", { name: /^申请|^Applications/ }).click();
  await expect(page.getByRole("button", { name: /Product Operations Manager/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Senior Product Analyst/ })).toBeVisible();
});

test("answers, requests approval, and records the human decision", async ({ page }) => {
  const writes: Array<{ path: string; contentType: string; idempotencyKey: string }> = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/mock-agent/") && ["POST", "PUT"].includes(request.method())) {
      writes.push({ path: new URL(request.url()).pathname, contentType: request.headers()["content-type"], idempotencyKey: request.headers()["idempotency-key"] });
    }
  });
  await expect(page.getByTestId("application-state")).toContainText(/待回答|Needs answers/);
  await expect(page.getByTestId("material-pipeline-summary")).toContainText("target_reached");
  await page.getByTestId("answer-input").fill("Yes, I am legally authorized to work in Canada.");
  await page.getByTestId("save-answer").click();
  await expect(page.getByTestId("request-approval")).toBeVisible();
  await page.getByTestId("request-approval").click();
  await expect(page.getByTestId("application-state")).toContainText(/待审批|Needs approval/);
  await expect(page.getByTestId("approval-snapshot")).toContainText("Northstar Labs");
  await expect(page.getByTestId("approval-snapshot")).toContainText("v2");
  await expect(page.getByTestId("approval-snapshot")).toContainText("86");
  await expect(page.getByTestId("approval-snapshot")).toContainText("boards.greenhouse.io");
  await expect(page.getByText("Yes, I am legally authorized to work in Canada.")).toBeVisible();
  await page.getByTestId("approve-application").click();
  await expect(page.getByTestId("submission-receipt")).toContainText("queued");
  await expect(page.getByTestId("application-state")).toContainText(/提交中|Submitting/);
  expect(writes).toHaveLength(4);
  for (const write of writes) {
    expect(write.contentType).toBe("application/json");
    expect(write.idempotencyKey).toBeTruthy();
  }
  expect(writes.map((write) => write.path.split("/").at(-1))).toEqual(["work_authorization.ca", "transitions", "decision", "submissions"]);
});

for (const scenario of [
  { name: "FastAPI validation array", status: 422, contentType: "application/json", body: JSON.stringify({ detail: [{ loc: ["body", "expected_version"], msg: "Field required", input: "PRIVATE_INPUT_MUST_NOT_APPEAR" }] }), expected: "body.expected_version: Field required" },
  { name: "structured domain error", status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "agent.approval_stale", message: "Approval changed; review again", context: { secret: "PRIVATE_INPUT_MUST_NOT_APPEAR" } } }), expected: "agent.approval_stale: Approval changed; review again" },
  { name: "non-JSON server error", status: 503, contentType: "text/html", body: "<html>PRIVATE_INPUT_MUST_NOT_APPEAR</html>", expected: "HTTP 503" },
]) {
  test(`shows actionable ${scenario.name} without exposing raw input`, async ({ page }) => {
    await page.route("**/api/mock-agent/agent/applications?*", (route) => route.fulfill(scenario));
    await page.reload();
    const alert = page.getByRole("alert").filter({ hasText: "HTTP" });
    await expect(alert).toContainText(`GET /agent/applications?view=applications&offset=0&limit=25 — HTTP ${scenario.status}`);
    await expect(alert).toContainText(scenario.expected);
    await expect(alert).not.toContainText("PRIVATE_INPUT_MUST_NOT_APPEAR");
    await page.unroute("**/api/mock-agent/agent/applications?*");
    await alert.getByRole("button", { name: /刷新状态|Refresh status/ }).click();
    await expect(alert).toHaveCount(0);
  });
}

test("renders an execution blocker without bypassing CAPTCHA", async ({ page }) => {
  await page.getByRole("button", { name: /Business Systems Analyst/ }).click();
  await expect(page.getByTestId("execution-blocker")).toContainText(/CAPTCHA/);
  await expect(page.getByTestId("application-state")).toContainText(/需处理|Needs attention/);
});

test("shows an append-only simulated submission receipt", async ({ page }) => {
  await page.getByRole("button", { name: /Operations Analyst/ }).click();
  await expect(page.getByTestId("submission-receipt")).toContainText("SIMULATED-00042");
  await expect(page.getByTestId("submission-receipt")).toContainText("succeeded");
  await expect(page.getByTestId("application-detail")).toContainText(/No real employer was contacted|未联系/);
});

test("persists device-only safety preferences", async ({ page }) => {
  await page.getByRole("tab", { name: /Agent 设置|Agent settings/ }).click();
  const pause = page.getByTestId("setting-pauseAll");
  await pause.check();
  await page.reload();
  await page.getByRole("tab", { name: /Agent 设置|Agent settings/ }).click();
  await expect(pause).toBeChecked();
});


test("prepares a discovered role without submitting it", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") writes.push(new URL(request.url()).pathname); });
  await page.getByRole("tab", { name: /新岗位|New jobs/ }).click();
  await page.getByTestId("prepare-materials").click();
  await expect(page.getByRole("tab", { name: /^申请|^Applications/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("application-detail")).toContainText("Product Operations Manager");
  await expect(page.getByTestId("request-approval")).toBeVisible();
  expect(writes.map((path) => path.split("/").at(-1))).toEqual(["transitions", "materials"]);
});

test("pause blocks device writes and resuming enables them", async ({ page }) => {
  await page.getByRole("tab", { name: /Agent 设置|Agent settings/ }).click();
  await page.getByTestId("setting-pauseAll").check();
  await page.getByRole("tab", { name: /^申请|^Applications/ }).click();
  await page.getByTestId("answer-input").fill("Only for this application");
  await expect(page.getByTestId("save-answer")).toBeDisabled();
  await page.getByRole("tab", { name: /Agent 设置|Agent settings/ }).click();
  await page.getByTestId("setting-pauseAll").uncheck();
  await page.getByRole("tab", { name: /^申请|^Applications/ }).click();
  await expect(page.getByTestId("save-answer")).toBeEnabled();
});

test("isolates drafts for identical questions across applications", async ({ page }) => {
  const { MOCK_AGENT_APPLICATIONS } = await import("../src/lib/agent-mock-data");
  const first = MOCK_AGENT_APPLICATIONS.find((item) => item.state === "awaiting_answers")!;
  const second = MOCK_AGENT_APPLICATIONS.find((item) => item.job.title === "Operations Analyst")!;
  await page.route(`**/api/mock-agent/agent/applications/${second.id}`, (route) => route.fulfill({ json: { ...second, state: "awaiting_answers", answers: first.answers } }));
  await page.getByTestId("answer-input").fill("Private draft for first employer");
  await page.getByRole("button", { name: /Operations Analyst/ }).click();
  await expect(page.getByTestId("answer-input")).toHaveValue("");
  await page.getByTestId("answer-input").fill("Different second draft");
  await page.getByRole("button", { name: /Senior Product Analyst/ }).click();
  await expect(page.getByTestId("answer-input")).toHaveValue("Private draft for first employer");
});

test("keeps list usable when a detail fails and fetches details on demand", async ({ page }) => {
  const { MOCK_AGENT_APPLICATIONS } = await import("../src/lib/agent-mock-data");
  const item = MOCK_AGENT_APPLICATIONS.find((row) => row.job.title === "Operations Analyst")!;
  let calls = 0;
  await page.route(`**/api/mock-agent/agent/applications/${item.id}`, (route) => { calls += 1; return route.fulfill({ status: 503, json: { detail: "Detail unavailable" } }); });
  await page.reload();
  await expect(page.getByTestId("answer-input")).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: /Operations Analyst/ }).click();
  await expect(page.getByTestId("agent-control-center").getByRole("alert")).toContainText("Detail unavailable");
  await page.getByRole("button", { name: /Senior Product Analyst/ }).click();
  await expect(page.getByTestId("answer-input")).toBeVisible();
});

test("polls a pending submission and displays its completed receipt", async ({ page }) => {
  const { MOCK_AGENT_APPLICATIONS } = await import("../src/lib/agent-mock-data");
  const item = MOCK_AGENT_APPLICATIONS.find((row) => row.job.title === "Operations Analyst")!;
  let complete = false;
  await page.route(`**/api/mock-agent/agent/applications/${item.id}`, (route) => route.fulfill({ json: { ...item, state: complete ? "submitted" : "submitting", latest_receipt: { ...item.latest_receipt, status: complete ? "succeeded" : "queued" } } }));
  await page.getByRole("button", { name: /Operations Analyst/ }).click();
  await expect(page.getByTestId("submission-receipt")).toContainText("queued");
  complete = true;
  await expect(page.getByTestId("submission-receipt")).toContainText("succeeded", { timeout: 15000 });
});

test("retries material generation after failure without restarting the application", async ({ page }) => {
  let attempts = 0;
  const keys: string[] = [];
  await page.route("**/api/mock-agent/agent/applications/*/materials", (route) => {
    attempts += 1; keys.push(route.request().headers()["idempotency-key"]);
    return attempts === 1 ? route.fulfill({ status: 503, json: { detail: "Generation temporarily unavailable" } }) : route.continue();
  });
  await page.getByRole("tab", { name: /新岗位|New jobs/ }).click();
  await page.getByTestId("prepare-materials").click();
  await expect(page.getByTestId("agent-control-center").getByRole("alert")).toContainText("Generation temporarily unavailable");
  await expect(page.getByTestId("prepare-materials")).toBeEnabled();
  await page.getByTestId("prepare-materials").click();
  await expect(page.getByTestId("request-approval")).toBeVisible();
  expect(attempts).toBe(2);
  expect(keys[0]).toBe(keys[1]);
});

test("pages summaries without preloading other application details", async ({ page }) => {
  const { MOCK_AGENT_APPLICATIONS } = await import("../src/lib/agent-mock-data");
  const first = MOCK_AGENT_APPLICATIONS.find((item) => item.state === "awaiting_answers")!;
  const last = MOCK_AGENT_APPLICATIONS.find((item) => item.job.title === "Operations Analyst")!;
  await page.route("**/api/mock-agent/agent/applications?*", (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    const items = offset === 0 ? [first, ...Array.from({ length: 24 }, (_, index) => ({ ...first, id: `page-item-${index}`, job: { ...first.job, title: `Paged role ${index}` } }))] : [last];
    return route.fulfill({ json: { applications: items, total: 26, offset, limit: 25, counts: { applications: 26, new_jobs: 0, inbox: 0 } } });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: /Paged role 23/ })).toBeVisible();
  await page.getByRole("button", { name: /^(下一页|Next)$/ }).click();
  await expect(page.getByTestId("application-detail")).toContainText("Operations Analyst");
  await expect(page.getByRole("button", { name: /Paged role 23/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(下一页|Next)$/ })).toBeDisabled();
  await page.getByRole("button", { name: /上一页|Previous/ }).click();
  await expect(page.getByTestId("answer-input")).toBeVisible();
});

test("does not offer approval for an unscored resume", async ({ page }) => {
  const { MOCK_AGENT_APPLICATIONS } = await import("../src/lib/agent-mock-data");
  const item = MOCK_AGENT_APPLICATIONS.find((row) => row.state === "awaiting_answers")!;
  await page.route(`**/api/mock-agent/agent/applications/${item.id}`, (route) => route.fulfill({ json: { ...item, state: "preparing", ats_score: null, answers: [] } }));
  await page.reload();
  await expect(page.getByTestId("application-state")).toContainText(/准备中|Preparing/);
  await expect(page.getByTestId("request-approval")).toHaveCount(0);
});


test("opens a linked discovered role and preserves it when its active tab is clicked", async ({ page }) => {
  const { MOCK_AGENT_APPLICATIONS } = await import("../src/lib/agent-mock-data");
  const item = MOCK_AGENT_APPLICATIONS.find((row) => row.state === "discovered")!;
  await page.goto(`/career/applications?agent=${item.id}`);
  await expect(page.getByTestId("application-detail")).toContainText(item.job.title);
  const tab = page.getByRole("tab", { name: /新岗位|New jobs/ });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await tab.click();
  await expect(page.getByTestId("prepare-materials")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(item.job.title) })).toBeVisible();
});

test("preserves typing that happens while an earlier answer is saving", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/mock-agent/agent/applications/*/answers/*", async (route) => { await pending; await route.continue(); });
  await page.getByTestId("answer-input").fill("First saved answer");
  const saving = page.waitForRequest((request) => request.method() === "PUT");
  await page.getByTestId("save-answer").click();
  await saving;
  await page.getByTestId("answer-input").fill("Newer unsaved answer");
  release();
  await expect(page.getByTestId("save-answer")).toBeEnabled();
  await expect(page.getByTestId("answer-input")).toHaveValue("Newer unsaved answer");
});
