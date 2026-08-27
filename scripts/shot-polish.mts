// Screenshots every screen for the #33 polish pass at 1440×900 and 390×844, before or after.
// Run against the dev server on 3111: npx tsx scripts/shot-polish.mts before|after [projectId]
// Without a project id it creates one through the landing page, joins as a second member, fills
// the board, approves, confirms the room, adds two search results, and places them.
import { chromium, type Page } from "@playwright/test";
import { addBoardNotesByEditor, addBoardSwatch, createThroughLanding, joinThroughLanding } from "../tests/helpers";

const BASE = "http://localhost:3111";
const suffix = process.argv[2] ?? "before";
const DIR = "docs/progress";
const file = (screen: string, width: number) => `${DIR}/2026-08-28-polish-${screen}${width === 390 ? "-390" : ""}-${suffix}.png`;
const overflow: string[] = [];

async function shot(page: Page, screen: string, width: number) {
  await page.waitForTimeout(600);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  if (sw > width) overflow.push(`${screen}@${width}: scrollWidth ${sw}`);
  await page.screenshot({ path: file(screen, width), fullPage: false });
  console.log(`shot ${file(screen, width)}`);
}

const browser = await chromium.launch();
const desk = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const zach = await desk.newPage();
let projectId = process.argv[3];

if (!projectId) {
  await zach.goto(`${BASE}/`);
  await shot(zach, "landing", 1440);
  const created = await createThroughLanding(zach, { name: "Polish flat", budgetUsd: 2500, requiredBy: "2026-10-15" }, "Zach", "Zach");
  projectId = created.projectId;
  const ben = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })).newPage();
  await joinThroughLanding(ben, created.code, "Ben", "Ben");
  await zach.waitForTimeout(6000);
  await addBoardNotesByEditor(zach, [
    { text: "12 x 18 living room", x: 100, y: 100 },
    { text: "reading chair", x: 400, y: 100 },
    { text: "floor lamp", x: 700, y: 100 },
    { text: "lamp next to the chair", x: 100, y: 400 },
    { text: "$2500 max", x: 400, y: 400 },
    { text: "by October 15", x: 700, y: 400 }
  ]);
  await addBoardSwatch(zach, "orange", { x: 1000, y: 100 });
  await addBoardSwatch(zach, "blue", { x: 1000, y: 400 });
  await zach.getByTestId("create-plan").click();
  await zach.getByTestId("spec-form").waitFor({ timeout: 40000 });
  await shot(zach, "board", 1440);
  await zach.getByTestId("approve-plan").click();
  await zach.waitForURL(/\/room/, { timeout: 20000 });
  await zach.waitForLoadState("networkidle");
  await shot(zach, "room", 1440);
  await zach.getByTestId("confirm-room").click();
  await zach.waitForURL(/\/place/, { timeout: 20000 });
  await zach.waitForLoadState("networkidle");
  // Two search results with dimensions, added from the panel.
  for (const item of ["reading chair", "floor lamp"]) {
    await zach.locator("#search-cat").selectOption({ label: item }).catch(() => {});
    await zach.getByRole("button", { name: /^Search$/ }).click();
    await zach.locator('[data-testid="product-search"] .card').first().waitFor({ timeout: 30000 }).catch(() => {});
    const cards = zach.locator('[data-testid="product-search"] .card');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      if ((await c.innerText()).includes("dimensions unknown")) continue;
      await c.getByRole("button", { name: "Add to project" }).click();
      await c.getByRole("button", { name: "Added" }).waitFor({ timeout: 20000 }).catch(() => {});
      break;
    }
  }
  await zach.waitForTimeout(1500);
  const placeButtons = zach.getByRole("button", { name: "Place in room" });
  while ((await placeButtons.count()) > 0) {
    await placeButtons.first().click();
    await zach.waitForTimeout(1200);
  }
  await ben.context().close();
}

const state = await desk.storageState();
const phone = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, storageState: state });
const benPhone = await phone.newPage();

async function itemsScreens(page: Page, width: number) {
  await page.goto(`${BASE}/projects/${projectId}/place`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const g = page.locator('[data-testid="plan-view"] svg g[tabindex="0"]').first();
  if (await g.count()) await g.focus();
  await page.getByTestId("item-panel").waitFor({ timeout: 5000 }).catch(() => {});
  await shot(page, "items-2d", width);
  await page.getByTestId("view-toggle-3d").click();
  await page.waitForTimeout(4000);
  await shot(page, "items-3d", width);
}

async function rest(page: Page, width: number) {
  if (width === 390 || process.argv[3]) {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await shot(page, "landing", width);
    await page.goto(`${BASE}/projects/${projectId}/board`, { waitUntil: "networkidle" });
    await page.getByTestId("create-plan").click().catch(() => {});
    await page.getByTestId("spec-form").waitFor({ timeout: 40000 }).catch(() => {});
    await shot(page, "board", width);
    await page.goto(`${BASE}/projects/${projectId}/room`, { waitUntil: "networkidle" });
    await shot(page, "room", width);
  }
  await itemsScreens(page, width);
  await page.goto(`${BASE}/projects/${projectId}/catalog`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await shot(page, "catalog", width);
  await page.getByTestId("trace-toggle").click();
  await page.waitForTimeout(3500);
  const row = page.getByTestId("trace-row").first();
  if (await row.count()) await row.click();
  await shot(page, "trace", width);
}

await rest(zach, 1440);
await rest(benPhone, 390);
await browser.close();
console.log(`project ${projectId}`);
console.log(overflow.length ? `HORIZONTAL OVERFLOW:\n${overflow.join("\n")}` : "no horizontal overflow");
