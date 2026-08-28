/**
 * The scripted demo (PRD 21, 22) as a viewer watches it: Zach and Ben in two browser contexts, one
 * video each under tests/videos (script-zach-*.webm, script-ben-*.webm). Every step goes through
 * the visible interface at a human pace: typed text, clicked stage links, artifacts read off the
 * chat, and the rail read off the screen. Nothing is checked through the API, so a scene passes
 * only when its result shows on the recording. A caption at the bottom of each page names the
 * scene, so the recording cuts by scene.
 *
 * The suite needs the dev server on 3111 with OPENAI_API_KEY and (for Scene 10b's model) a Modal
 * endpoint; it has one path per scene and no fallback, because a demo has one script. The
 * regression form of the same flow, with its API assertions and fallbacks, is tests/demo.spec.ts.
 */
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { addBoardSwatch, boardText, PASTED_URL, POLYFILL } from "./helpers";

test.describe.configure({ mode: "serial" });

const PROJECT = { name: "Zach + Ben Living Room", budgetUsd: 2500, requiredBy: "2026-09-15" };
/**
 * Note positions on the canvas: two rows of four, 240 px apart for tldraw's 200 px notes. The
 * empty-board hint covers the top-left corner until the first note exists, so the first note
 * goes in the third column.
 */
const ZACH_NOTES = [
  { text: "12 × 18 living room", x: 600, y: 120 },
  { text: "$2500 max", x: 840, y: 120 },
  { text: "big rug underneath everything", x: 120, y: 120 },
  { text: "Need Sept 15", x: 360, y: 120 }
];
const ZACH_ITEMS = ["Deep couch", "Round coffee table"];
const BEN_ITEMS = ["Leather ottoman"];
const BEN_WISH = "would love a wool one if the budget allows";
const BOARD_ITEMS = ["big rug", ...ZACH_ITEMS, ...BEN_ITEMS];
const REPLACED_ITEM = "round coffee table";
const NEW_ITEM = "floor lamp";

const AGENT_WAIT_MS = 180_000;
const SOURCE_WAIT_MS = 300_000;
const SYNC_MS = 15_000;
/** Typing speed for text a viewer reads as it appears. */
const KEY_DELAY_MS = 40;
/** How long the recording rests on a surface after it changes, so a viewer takes it in. */
const READ_MS = 2_500;

let browserRef: Browser;
let zachContext: BrowserContext;
let benContext: BrowserContext;
let zach: Page;
let ben: Page;
let roomCode: string;

/* ---- Pacing and the on-screen caption ---- */

async function rest(page: Page, ms = READ_MS) {
  await page.waitForTimeout(ms);
}

/**
 * Writes the scene caption into a fixed strip at the foot of both pages, so either recording cuts
 * by scene; the strip survives navigation because it is re-added on every call.
 */
async function caption(_page: Page, text: string) {
  for (const page of [zach, ben]) await captionOn(page, text);
}

async function captionOn(page: Page, text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText =
        "position:fixed;left:50%;transform:translateX(-50%);bottom:14px;max-width:70vw;z-index:9999;padding:8px 14px;border-radius:8px;background:#1C2B36;color:#fff;font:500 14px/1.4 Aeonik,'Helvetica Neue',Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function scene(page: Page, text: string) {
  await caption(page, text);
  await rest(page, 1_200);
}

async function typeInto(page: Page, locator: Locator, text: string) {
  await locator.click();
  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
}

/** Types a chat message and sends it; the log shows the text once the server has it. */
async function say(page: Page, text: string) {
  await typeInto(page, page.getByTestId("chat-input"), text);
  await rest(page, 600);
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-log")).toContainText(text, { timeout: 30_000 });
}

/** Moves to a stage by clicking its link in the top bar, as a person does. */
async function go(page: Page, stage: "Preferences" | "Room" | "Items" | "Catalog") {
  await page.getByTestId("stage-nav").getByRole("link", { name: new RegExp(`${stage}$`) }).click();
  await expect(page.getByTestId("stage-nav")).toBeVisible();
  await rest(page, 1_000);
}

/** Adds a sticky note by hand: the note tool, a click on the board, typed text. */
async function note(page: Page, text: string, at: { x: number; y: number }) {
  const canvas = page.getByTestId("board-canvas");
  await expect(canvas).toBeVisible();
  // The board zooms to fit on load, so the camera goes back to the origin at 100% before the
  // click; the positions above are then canvas pixels from the top-left of the board.
  await page.evaluate(() => {
    (window as Window & { __tldraw_editor?: { setCamera: (p: { x: number; y: number; z: number }) => unknown } }).__tldraw_editor?.setCamera({ x: 0, y: 0, z: 1 });
  });
  const box = (await canvas.boundingBox())!;
  const hint = page.getByTestId("board-empty");
  if (await hint.isVisible()) {
    // The empty board shows a hint over its top-left corner; its button selects the note tool.
    await hint.getByRole("button", { name: "Add a note" }).click();
    await rest(page, 500);
  } else {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press("Escape");
    await page.keyboard.press("n");
  }
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect(canvas.locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(boardText(page, text)).toBeVisible();
  await rest(page, 700);
}

/** The agent's plain replies in the chat log (artifacts render as cards, not messages). */
function agentReplies(page: Page): Locator {
  return page.getByTestId("chat-log").locator(".msg.agent");
}

function railLines(page: Page): Locator {
  return page.getByTestId("bom-rail").locator(".rail-line");
}

/* ---- Setup ---- */

async function newPerson(): Promise<[BrowserContext, Page]> {
  const context = await browserRef.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  return [context, page];
}

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  [zachContext, zach] = await newPerson();
  [benContext, ben] = await newPerson();
});

test.afterAll(async () => {
  const videos = [zach.video(), ben.video()];
  await zachContext.close();
  await benContext.close();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await videos[0]?.saveAs(`tests/videos/script-zach-${stamp}.webm`);
  await videos[1]?.saveAs(`tests/videos/script-ben-${stamp}.webm`);
  await Promise.all(videos.map((v) => v?.delete()));
});

/* ---- Scenes ---- */

test("Scene 1: Zach creates the project and writes the room, the rug rule, the budget, and the date on the board", async () => {
  test.setTimeout(240_000);
  await zach.goto(`/${POLYFILL}`);
  await scene(zach, "Scene 1. Zach creates the project");
  await typeInto(zach, zach.getByTestId("create-name"), PROJECT.name);
  await typeInto(zach, zach.getByTestId("create-budget"), String(PROJECT.budgetUsd));
  await zach.getByTestId("create-date").fill(PROJECT.requiredBy);
  await rest(zach, 800);
  await zach.getByTestId("create-submit").click();
  const codeEl = zach.getByTestId("project-code");
  await expect(codeEl).toBeVisible();
  roomCode = (await codeEl.innerText()).trim();
  expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
  await rest(zach);
  await typeInto(zach, zach.getByTestId("create-name"), "Zach");
  await typeInto(zach, zach.getByTestId("create-role"), "Zach");
  await zach.getByTestId("create-enter").click();
  await zach.waitForURL(/\/projects\/[^/]+\/board/);
  await expect(zach.getByTestId("stage-nav")).toBeVisible();
  await expect(zach.getByTestId("project-code")).toContainText(roomCode);
  await expect(zach.getByTestId("presence-member")).toHaveCount(1);

  await scene(zach, "Scene 1. The board starts empty; Zach writes the room, the rule, the budget, and the date");
  for (const n of ZACH_NOTES) await note(zach, n.text, n);
  await rest(zach);
  await zach.reload();
  await caption(zach, "Scene 1. After a reload the board is still there");
  for (const n of ZACH_NOTES) await expect(boardText(zach, n.text)).toBeVisible({ timeout: 20_000 });
  await rest(zach);
});

test("Scene 2: Ben joins with the code; each adds items and a swatch and sees the other's without a reload", async () => {
  test.setTimeout(240_000);
  await ben.goto(`/${POLYFILL}`);
  await scene(ben, `Scene 2. Ben joins with the code ${roomCode}`);
  await typeInto(ben, ben.getByTestId("join-code"), roomCode);
  await typeInto(ben, ben.getByTestId("join-name"), "Ben");
  await typeInto(ben, ben.getByTestId("join-role"), "Ben");
  await ben.getByTestId("join-submit").click();
  await ben.waitForURL(/\/projects\/[^/]+\/board/);
  await expect(ben.getByTestId("stage-nav")).toBeVisible();
  for (const n of ZACH_NOTES) await expect(boardText(ben, n.text)).toBeVisible({ timeout: 20_000 });
  await rest(ben);

  await scene(zach, "Scene 2. Zach adds two items and an orange swatch");
  await note(zach, ZACH_ITEMS[0], { x: 120, y: 380 });
  await note(zach, ZACH_ITEMS[1], { x: 360, y: 380 });
  await addBoardSwatch(zach, "orange", { x: 140, y: 640 });
  await scene(ben, "Scene 2. Ben adds the ottoman, a wish about the rug, and a blue swatch");
  await note(ben, BEN_ITEMS[0], { x: 600, y: 380 });
  await note(ben, BEN_WISH, { x: 840, y: 380 });
  await addBoardSwatch(ben, "blue", { x: 400, y: 640 });

  await caption(zach, "Scene 2. Ben's notes arrive on Zach's board without a reload");
  await caption(ben, "Scene 2. Zach's notes arrive on Ben's board without a reload");
  for (const item of BEN_ITEMS) await expect(boardText(zach, item)).toBeVisible({ timeout: SYNC_MS });
  await expect(boardText(zach, BEN_WISH)).toBeVisible({ timeout: SYNC_MS });
  for (const item of ZACH_ITEMS) await expect(boardText(ben, item)).toBeVisible({ timeout: SYNC_MS });
  await rest(zach);
});

test("Scene 2b: each person sees the other in the top bar", async () => {
  await caption(zach, "Scene 2b. Both people show in the top bar");
  await caption(ben, "Scene 2b. Both people show in the top bar");
  await expect(zach.getByTestId("presence-member")).toHaveCount(2, { timeout: 10_000 });
  await expect(ben.getByTestId("presence-member")).toHaveCount(2, { timeout: 10_000 });
  await rest(zach, 1_500);
});

test("Scene 3: the plan is read off the board; both approve; Zach confirms the room", async () => {
  test.setTimeout(300_000);
  await scene(zach, "Scene 3. Zach creates the plan from the board");
  await zach.getByTestId("create-plan").click();
  const form = zach.getByTestId("spec-form");
  await expect(form).toBeVisible({ timeout: AGENT_WAIT_MS });
  await caption(zach, "Scene 3. Every row is a phrase from the board: items, swatches, the rule, the budget, the date");
  await expect(form.locator("#budget")).toHaveValue("2500");
  await expect(form.locator("#required_by")).toHaveValue(PROJECT.requiredBy);
  await expect(form.getByTestId("item-row")).toHaveCount(BOARD_ITEMS.length);
  await expect(form.getByTestId("swatch-row")).toHaveCount(2);
  await expect(form.getByTestId("rule-row")).toHaveValue("big rug underneath everything");
  await rest(zach, 4_000);
  await zach.getByTestId("approve-plan").click();
  await zach.waitForURL(/\/room/);

  await scene(ben, "Scene 3. Ben reads the same plan and approves it");
  await ben.getByTestId("create-plan").click();
  await expect(ben.getByTestId("spec-form")).toBeVisible({ timeout: AGENT_WAIT_MS });
  await expect(ben.getByTestId("spec-form").getByTestId("item-row")).toHaveCount(BOARD_ITEMS.length);
  await rest(ben, 3_000);
  await ben.getByTestId("approve-plan").click();
  await ben.waitForURL(/\/room/);

  await scene(zach, "Scene 3. The room stage carries the board's 12 by 18 as an estimate; Zach confirms it");
  await expect(zach.getByLabel("Width, feet")).toHaveValue("12");
  await expect(zach.getByLabel("Length, feet")).toHaveValue("18");
  await expect(zach.getByText("3658 mm")).toBeVisible();
  await expect(zach.getByText("5486 mm")).toBeVisible();
  await rest(zach, 3_000);
  await zach.getByTestId("confirm-room").click();
  await zach.waitForURL(/\/place/);
  await expect(zach.getByTestId("plan-view")).toBeVisible();
  await caption(zach, "Scene 3. The items stage opens with the empty plan");
  await rest(zach);
});

test("Scene 4: Zach asks for a set; the sourcing artifact appears in the chat", async () => {
  test.setTimeout(240_000);
  await scene(zach, "Scene 4. Zach asks the planner for a set");
  await say(zach, "Find a set that works for us and make sure everything can arrive by September 15.");
  await expect(zach.getByTestId("chat-tool-event").first()).toBeVisible({ timeout: AGENT_WAIT_MS });
  await expect(zach.getByTestId("artifact-sourcing")).toBeVisible({ timeout: AGENT_WAIT_MS });
  await zach.getByTestId("artifact-sourcing").scrollIntoViewIfNeeded();
  await caption(zach, "Scene 4. The sourcing card lists the board's items and what the planner is doing for each");
  await rest(zach);
});

test("Scene 5: the planner asks for a delivery address; Zach answers with a ZIP code", async () => {
  test.setTimeout(240_000);
  const question = zach.getByTestId("artifact-question");
  await expect(question).toBeVisible({ timeout: AGENT_WAIT_MS });
  await question.scrollIntoViewIfNeeded();
  await expect(question).toContainText(/address|zip|postal/i);
  await scene(zach, "Scene 5. The planner needs a delivery address before it can check dates");
  await say(zach, "10003");
  await expect(agentReplies(zach).last()).toContainText(/New York|NY/, { timeout: 30_000 });
  await caption(zach, "Scene 5. 10003 resolves to New York, NY; the run continues on its own");
  await expect(zach.getByTestId("artifact-sourcing")).not.toContainText(/No item has started yet/, { timeout: AGENT_WAIT_MS });
  await rest(zach);
});

test("Scene 6: the sourcing card fills with live products, one row per board phrase", async () => {
  test.setTimeout(400_000);
  const artifact = zach.getByTestId("artifact-sourcing");
  await caption(zach, "Scene 6. Each row is a board phrase; the tag is where its search stands");
  for (const item of BOARD_ITEMS) await expect(artifact.locator(`[data-category="${item}"]`)).toHaveCount(1, { timeout: AGENT_WAIT_MS });
  await expect(artifact.locator(`[data-category] .tag`).filter({ hasText: "selected" })).toHaveCount(BOARD_ITEMS.length, { timeout: SOURCE_WAIT_MS });
  await rest(zach);
});

test("Scene 7: the bill of materials shows one line per item under the budget, on both screens", async () => {
  test.setTimeout(300_000);
  await caption(zach, "Scene 7. The rail shows one line per item and the total against $2,500");
  await expect(railLines(zach)).toHaveCount(BOARD_ITEMS.length, { timeout: SOURCE_WAIT_MS });
  await expect(zach.getByTestId("budget-stat")).not.toHaveAttribute("data-state", "over");
  await rest(zach);
  await scene(ben, "Scene 7. Ben opens the items stage; his rail shows the same lines");
  await go(ben, "Items");
  await expect(railLines(ben)).toHaveCount(BOARD_ITEMS.length, { timeout: 20_000 });
  await rest(ben);
});

test("Scene 8: Zach places every item in the plan and opens the 3D room", async () => {
  test.setTimeout(240_000);
  await scene(zach, "Scene 8. Zach places each item; the plan draws it at the merchant's dimensions");
  const placeButtons = zach.getByRole("button", { name: "Place in room" });
  while ((await placeButtons.count()) > 0) {
    await placeButtons.first().click();
    await rest(zach, 1_200);
  }
  await expect(zach.getByTestId("plan-view").locator("svg g[aria-label]").first()).toBeVisible();
  await rest(zach);
  await scene(zach, "Scene 8. The 3D room: generated models where the pipeline made one, colour proxies elsewhere");
  await zach.getByTestId("view-toggle-3d").click();
  const canvas = zach.locator("main canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await rest(zach, 3_000);
  const box = (await canvas.boundingBox())!;
  await zach.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await zach.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await zach.mouse.move(box.x + box.width / 2 + i * 6, box.y + box.height / 2 - i, { steps: 2 });
  }
  await zach.mouse.up();
  await rest(zach, 3_000);
  await zach.locator('[role="group"][aria-label="View"] button', { hasText: "2D" }).click();
  await rest(zach, 1_000);
});

test("Scene 9: Zach asks whether the layout meets the agreement", async () => {
  test.setTimeout(240_000);
  await caption(zach, "Scene 9. The status row checks the rug rule after every drop");
  const status = zach.getByTestId("rule-result");
  await expect(status).toHaveCount(1);
  await expect(status).toContainText(/big rug under/i);
  await rest(zach);
  await scene(zach, "Scene 9. Zach asks the planner the same question");
  const before = await agentReplies(zach).count();
  await say(zach, "Does this layout meet what we agreed on?");
  await expect(agentReplies(zach).nth(before)).toContainText(/rug|under|inside|collision|clearance|fits|overlap/i, { timeout: AGENT_WAIT_MS });
  await rest(zach, 4_000);
});

test("Scene 10: Zach pastes a side-table link; the line appears under his phrase and the budget moves", async () => {
  test.setTimeout(240_000);
  await scene(zach, "Scene 10. Zach pastes a product link from another store");
  const lines = await railLines(zach).count();
  await say(zach, `Add this side table: ${PASTED_URL}`);
  await expect(railLines(zach)).toHaveCount(lines + 1, { timeout: AGENT_WAIT_MS });
  await expect(zach.getByTestId("bom-rail")).toContainText(/side table/i);
  await caption(zach, "Scene 10. The side table joins the rail under Zach's phrase; the budget updates on both screens");
  await expect(railLines(ben)).toHaveCount(lines + 1, { timeout: 20_000 });
  await rest(zach, 3_500);
});

test("Scene 10b: Ben adds a floor lamp beside the couch and watches its model generate", async () => {
  test.setTimeout(700_000);
  await scene(ben, "Scene 10b. Ben adds one more item, with where it goes");
  const replies = await agentReplies(ben).count();
  await say(ben, `Add one more thing to what we agreed: a ${NEW_ITEM} beside the ${ZACH_ITEMS[0]}.`);
  await expect(agentReplies(ben).nth(replies)).toContainText(new RegExp(NEW_ITEM, "i"), { timeout: AGENT_WAIT_MS });
  await rest(ben);
  await scene(ben, "Scene 10b. Ben asks the planner to source it");
  const lines = await railLines(ben).count();
  await say(ben, `Source the ${NEW_ITEM}.`);
  await expect(railLines(ben)).toHaveCount(lines + 1, { timeout: SOURCE_WAIT_MS });
  await expect(ben.getByTestId("bom-rail")).toContainText(new RegExp(NEW_ITEM, "i"));
  await caption(ben, "Scene 10b. The lamp is sourced and placed beside the couch; its 3D model is generating");
  const footprints = ben.getByTestId("plan-view").locator("svg g[aria-label]");
  await expect(footprints.last()).toBeVisible({ timeout: 20_000 });
  await footprints.last().click();
  const stages = ben.getByTestId("model-stages");
  await expect(stages.first()).toBeVisible({ timeout: 20_000 });
  await expect(stages.first()).toHaveAttribute("data-stage", /ready|proxy/, { timeout: 180_000 });
  await caption(ben, "Scene 10b. The model is ready; Ben opens the 3D room to see it in place");
  await rest(ben, 1_500);
  await ben.getByTestId("view-toggle-3d").click();
  await expect(ben.locator("main canvas")).toBeVisible({ timeout: 20_000 });
  await rest(ben, 5_000);
});

test("Scene 11: Zach asks for a cheaper coffee table; the ranking card appears under the board's phrase", async () => {
  test.setTimeout(240_000);
  await scene(zach, "Scene 11. The budget is tight; Zach asks for a cheaper coffee table");
  await say(zach, `Find a cheaper ${REPLACED_ITEM} that still matches everything we agreed on.`);
  const ranking = zach.getByTestId("artifact-ranking");
  await expect(ranking.first()).toBeVisible({ timeout: AGENT_WAIT_MS });
  await ranking.first().scrollIntoViewIfNeeded();
  await expect(ranking.first()).toContainText(new RegExp(REPLACED_ITEM, "i"));
  await caption(zach, "Scene 11. The ranking card names the board's phrase and evaluates live candidates");
  await rest(zach);
});

test("Scene 12: candidates evaluate against the room, the palette, the date, and the savings needed; one is selected", async () => {
  test.setTimeout(400_000);
  await caption(zach, "Scene 12. Each candidate is checked for fit, colour, delivery, and savings");
  const selected = zach.locator('[data-testid="artifact-ranking"] tbody tr[data-status="selected"]').first();
  await expect(selected).toBeVisible({ timeout: 2 * AGENT_WAIT_MS });
  await selected.scrollIntoViewIfNeeded();
  await rest(zach, 4_000);
});

test("Scene 13: Zach approves the replacement; the rail, the room, and the budget update on both screens", async () => {
  test.setTimeout(240_000);
  const approve = zach.locator('button[data-testid="approve-replacement"]:not([disabled])');
  await expect(approve.first()).toBeVisible({ timeout: 60_000 });
  await approve.last().scrollIntoViewIfNeeded();
  await scene(zach, "Scene 13. Zach approves the replacement");
  const budgetBefore = await zach.getByTestId("budget-stat").innerText();
  await approve.last().click();
  await expect(zach.getByTestId("budget-stat")).not.toHaveText(budgetBefore, { timeout: 30_000 });
  await expect(zach.getByTestId("budget-stat")).not.toHaveAttribute("data-state", "over");
  await caption(zach, "Scene 13. The rail carries the new line, the plan moved with it, and the total is back under $2,500");
  await caption(ben, "Scene 13. Ben's rail and budget follow");
  await expect(ben.getByTestId("budget-stat")).not.toHaveAttribute("data-state", "over", { timeout: 20_000 });
  await rest(zach, 4_000);
  await rest(ben, 1_000);
});
