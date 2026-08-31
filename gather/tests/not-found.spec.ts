/** #144: an unknown invite code renders the app's own branded not-found, not Next's default 404. */
import { expect, test } from "@playwright/test";

test("an unknown invite code renders the branded not-found", async ({ page }) => {
  await page.goto("/i/ZZZZZZ");
  await expect(page.getByTestId("not-found-title")).toHaveText("Page not found");
  await expect(page.getByTestId("not-found-home")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("This page could not be found");
});
