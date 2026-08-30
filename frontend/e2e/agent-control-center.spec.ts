import { expect, test } from "@playwright/test";

const REAL_RECRUITING_HOSTS = ["greenhouse.io", "greenhouse.com", "lever.co", "indeed.com", "linkedin.com"];
let contactedRecruitingHosts = new Set<string>();

test.beforeEach(async ({ page }) => {
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
    await page.route("**/api/mock-agent/career/applications", (route) => route.fulfill(scenario));
    await page.reload();
    const alert = page.getByRole("alert").filter({ hasText: "HTTP" });
    await expect(alert).toContainText(`GET /career/applications — HTTP ${scenario.status}`);
    await expect(alert).toContainText(scenario.expected);
    await expect(alert).not.toContainText("PRIVATE_INPUT_MUST_NOT_APPEAR");
    await page.unroute("**/api/mock-agent/career/applications");
    await alert.getByRole("button", { name: /重试|Retry/ }).click();
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
