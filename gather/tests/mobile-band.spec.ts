/** #141: the band's right cluster wraps at narrow widths so no /events/:id tab scrolls the body sideways at 390. */
import { expect, test } from "@playwright/test";

test("neither Overview nor Experience scrolls the body sideways at 390", async ({ page, request }) => {
  const created = await request.post("/api/events", { data: { title: "Mobile band event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/events/${id}`);
  await expect(page.getByTestId("copy-invite")).toBeVisible();
  const overviewOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overviewOverflow).toBeLessThanOrEqual(0);

  await page.getByTestId("tab-experience").click();
  const experienceOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(experienceOverflow).toBeLessThanOrEqual(0);
});
