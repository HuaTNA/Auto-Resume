import { expect, test } from "@playwright/test";

const running = { id: "generation-test", status: "running", progress: 10, stalled: false };
const completed = { ...running, status: "completed", progress: 100, result: {
  jd_analysis: { job_title: "Engineer", company: "Example" }, filtered_profile: { experiences: [], projects: [] },
  resume_tex: "Generated resume", cover_letter: "", record_id: 123, optimization_rounds: [],
  ats_result: { keyword_match: { score: 90, matched: 9, total_keywords: 10, missing: [] }, semantic: { overall_score: 90, relevance_score: 90, impact_score: 90, strength: "Relevant", suggestions: [], missing_critical: [] } },
} };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { id: 7, email: "test@example.test" } }));
  await page.route("**/api/profile/completeness", (route) => route.fulfill({ json: { ready: true, blocking: [], warnings: [] } }));
  await page.route("**/api/generation-jobs", (route) => route.fulfill({ json: { job: route.request().method() === "POST" ? running : null } }));
  await page.route("**/api/generation-jobs/generation-test/advance", (route) => route.fulfill({ json: { job: running } }));
  await page.route("**/api/generation-jobs/generation-test", (route) => route.fulfill({ json: { job: running } }));
});

test("preserves an accepted generation across reload without creating it again", async ({ page }) => {
  let creates = 0;
  await page.route("**/api/generation-jobs", (route) => {
    if (route.request().method() === "POST") creates += 1;
    return route.fulfill({ json: { job: route.request().method() === "POST" ? running : null } });
  });
  await page.goto("/generate");
  await page.locator("textarea").fill("An engineering job description with enough detail to prepare a tailored resume.");
  await page.getByRole("button", { name: /生成定制简历|Generate tailored resume/ }).click();
  await expect(page).toHaveURL(/job=generation-test/);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("10%");
  await expect(page.getByRole("button", { name: /生成定制简历|Generate tailored resume/ })).toHaveCount(0);
  expect(creates).toBe(1);
});

test("recovers an existing server job when its URL was lost", async ({ page }) => {
  await page.route("**/api/generation-jobs", (route) => route.fulfill({ json: { job: running } }));
  await page.goto("/generate");
  await expect(page).toHaveURL(/job=generation-test/);
  await expect(page.getByRole("status")).toContainText("10%");
});

test("keeps a stalled job and reports the uncertainty instead of offering duplicate generation", async ({ page }) => {
  await page.route("**/api/generation-jobs/generation-test", (route) => route.fulfill({ json: { job: { ...running, stalled: true } } }));
  await page.goto("/generate?job=generation-test");
  await expect(page.getByRole("status")).toContainText(/恢复|Resuming/);
  await expect(page.getByRole("button", { name: /生成定制简历|Generate tailored resume/ })).toHaveCount(0);
});

test("recovers from a polling outage and renders the original result", async ({ page }) => {
  let failing = true;
  await page.route("**/api/generation-jobs/generation-test", (route) => {
    return failing ? route.fulfill({ status: 503, json: { detail: "Temporary outage" } }) : route.fulfill({ json: { job: completed } });
  });
  await page.goto("/generate?job=generation-test");
  const retry = page.getByRole("button", { name: /重新查询进度|Retry status check/ });
  await expect(retry).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/job=generation-test/);
  failing = false;
  await retry.click();
  await page.getByText(/高级选项：查看 LaTeX 源码|Advanced: View LaTeX source/).click();
  await expect(page.getByText("Generated resume", { exact: true })).toBeVisible();
});

test("advances a queued checkpoint and displays the completed result", async ({ page }) => {
  let advances = 0;
  await page.route("**/api/generation-jobs/generation-test", (route) => route.fulfill({ json: { job: advances ? completed : { ...running, status: "queued", step: "save", progress: 95 } } }));
  await page.route("**/api/generation-jobs/generation-test/advance", (route) => {
    advances += 1;
    return route.fulfill({ json: { job: completed } });
  });
  await page.goto("/generate?job=generation-test");
  await page.getByText(/高级选项：查看 LaTeX 源码|Advanced: view LaTeX source/).click();
  await expect(page.getByText("Generated resume", { exact: true })).toBeVisible();
  expect(advances).toBe(1);
});
