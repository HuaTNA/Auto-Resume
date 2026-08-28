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
});

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
