import { expect, test } from "@playwright/test";

test("binds a numeric Discord ID, persists after reload, and disconnects on mobile", async ({ page }) => {
  let integration: Record<string, unknown> | undefined;
  let writes = 0;
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { id: 7, email: "tester@example.test" } }));
  await page.route("**/api/integrations", (route) => route.fulfill({ json: { integrations: integration ? [integration] : [], providers: [] } }));
  await page.route("**/api/integrations/discord", async (route) => {
    if (route.request().method() === "PUT") {
      writes++;
      const body = route.request().postDataJSON();
      expect(body).toEqual({ external_account: "123456789012345678", scopes: ["agent:read", "agent:write"], state: "connected" });
      integration = { id: "binding-1", provider: "discord", updated_at: new Date().toISOString(), ...body };
      await route.fulfill({ json: { integration } });
    } else {
      expect(route.request().method()).toBe("DELETE");
      integration = undefined;
      await route.fulfill({ json: { ok: true } });
    }
  });
  await page.goto("/integrations");
  const card = page.getByTestId("discord-binding");
  await expect(page.getByTestId("discord-connect")).toBeEnabled();
  await page.getByTestId("discord-user-id").fill("tanner2147");
  await page.getByTestId("discord-connect").click();
  await expect(card.getByRole("alert")).toContainText(/15–22/);
  expect(writes).toBe(0);
  await page.getByTestId("discord-user-id").fill("123456789012345678");
  await page.getByTestId("discord-connect").click();
  await expect(page.getByTestId("discord-bound-id")).toContainText("123456789012345678");
  await expect(page.getByTestId("discord-user-id")).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("discord-bound-id")).toContainText("123456789012345678");
  await expect(page.getByTestId("discord-user-id")).toHaveValue("123456789012345678");
  const bounds = await card.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByTestId("discord-disconnect").click();
  await expect(page.getByTestId("discord-connect")).toBeEnabled();
  await expect(page.getByTestId("discord-user-id")).toHaveValue("");
  await page.reload();
  await expect(page.getByTestId("discord-connect")).toBeEnabled();
  expect(writes).toBe(1);
});

test("does not claim a binding was saved when the API rejects it", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { id: 7, email: "tester@example.test" } }));
  await page.route("**/api/integrations", (route) => route.fulfill({ json: { integrations: [], providers: [] } }));
  await page.route("**/api/integrations/discord", (route) => route.fulfill({ status: 409, json: { detail: "This Discord user ID is already bound to another account." } }));
  await page.goto("/integrations");
  await expect(page.getByTestId("discord-connect")).toBeEnabled();
  await page.getByTestId("discord-user-id").fill("123456789012345678");
  await page.getByTestId("discord-connect").click();
  await expect(page.getByTestId("discord-binding").getByRole("alert")).toContainText("already bound");
  await expect(page.getByTestId("discord-connect")).toBeEnabled();
  await expect(page.getByTestId("discord-bound-id")).toHaveCount(0);
});

test("keeps binding disabled until the current account state has loaded", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { id: 7, email: "tester@example.test" } }));
  await page.route("**/api/integrations", (route) => route.fulfill({ status: 503, json: { detail: "Temporarily unavailable" } }));
  await page.goto("/integrations");
  await expect(page.getByText("Temporarily unavailable")).toBeVisible();
  await expect(page.getByTestId("discord-connect")).toBeDisabled();
});
