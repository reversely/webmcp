// Screenshots a project's catalog with the trace open at three widths. Run: npx tsx scripts/shot-widths.mts <projectId>
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3111"; const pid = process.argv[2];
const browser = await chromium.launch();
for (const [w, h] of [[1440, 900], [1024, 800], [390, 844]] as const) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await page.goto(`${BASE}/projects/${pid}/catalog`, { waitUntil: "networkidle" });
  const t = page.getByTestId("trace-toggle"); if (await t.count()) await t.click();
  await page.waitForTimeout(3500);
  const row = page.getByTestId("trace-row").first(); if (await row.count()) await row.click();
  await page.waitForTimeout(500);
  const bodyW = await page.evaluate(() => document.documentElement.scrollWidth); const clipped = bodyW > w;
  await page.screenshot({ path: `docs/progress/2026-08-28-widths-${w}.png`, fullPage: false });
  console.log(`${w}px: scrollWidth ${bodyW} ${clipped ? "HORIZONTAL OVERFLOW" : "ok"}`);
}
await browser.close();
