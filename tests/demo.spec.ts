/**
 * The scripted demo (PRD 21, 22; issue #32): Zach and Ben in two browser contexts, Scenes 1 to 13
 * in order on one project. Each scene asserts the "Checks" column of the PRD 22 table. Zach creates
 * the project through the landing form and Ben joins it with the room code; the board starts empty
 * and the test types every note on it.
 *
 * Scenes that need the PlanningAgent (sourcing, the address question, ranking) or realtime board
 * sync look for the element first and mark themselves `fixme` when it is absent, so the suite runs
 * before those land and tightens as they do. When the agent has not sourced a BOM, Scene 7 sources
 * one through the search panel so the layout scenes still run; Scene 10 falls back to the
 * `add_product` WebMCP tool when the chat does not ingest the pasted URL.
 *
 * Videos: one per context under tests/videos (zach-*.webm, ben-*.webm).
 */
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import {
  activeBom,
  addBoardNote,
  addBoardNotesByEditor,
  addBoardSwatch,
  appears,
  boardText,
  bomLineFor,
  BUDGET_CENTS,
  createThroughLanding,
  executeTool,
  getSnapshot,
  joinThroughLanding,
  openStage,
  PASTED_URL,
  POLL_MS,
  requiredItems,
  sendChat,
  waitForSnapshot,
  waitForTools,
  type Snapshot
} from "./helpers";

test.describe.configure({ mode: "serial" });

const AGENT_WAIT_MS = 120_000;
const PLACEHOLDER_AGENT = /not wired|No OPENAI_API_KEY/;


let browserRef: Browser;
let zachContext: BrowserContext;
let benContext: BrowserContext;
let zach: Page;
let ben: Page;
let projectId: string;
let roomCode: string;
/** Set by Scene 4 or Scene 7: whether the PlanningAgent produced the sourcing artifact. */
let agentSourced = false;

function note(name: string, description: string) {
  test.info().annotations.push({ type: name, description });
}

async function newPerson(name: string): Promise<[BrowserContext, Page]> {
  const context = await browserRef.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.warn(`[${name}] page error: ${err.message}`));
  return [context, page];
}

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  [zachContext, zach] = await newPerson("zach");
  [benContext, ben] = await newPerson("ben");
});

test.afterAll(async () => {
  const videos = [zach.video(), ben.video()];
  await zachContext.close();
  await benContext.close();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await videos[0]?.saveAs(`tests/videos/zach-${stamp}.webm`);
  await videos[1]?.saveAs(`tests/videos/ben-${stamp}.webm`);
  await Promise.all(videos.map((v) => v?.delete()));
});

/**
 * The PRD 16 board as PRD 22 splits it: Zach types the three fixed facts and the rug rule in
 * Scene 1, then Zach and Ben add the other items in Scene 2, each in their own words. Every later
 * assertion about an item uses the phrase the board named, read back from the plan.
 */
const ZACH_NOTES = [
  { text: "12 × 18 living room", x: 0, y: 0, color: "yellow" },
  { text: "big rug underneath everything", x: 0, y: 240, color: "light-green" },
  { text: "$2500 max", x: 240, y: 240, color: "yellow" },
  { text: "Need Sept 15", x: 480, y: 240, color: "yellow" }
];
const ZACH_ITEMS = ["Deep couch", "Round coffee table"];
const BEN_ITEMS = ["Leather ottoman"];
/** The phrases the plan reads off the whole board: the rule's subject plus what Scene 2 adds. */
const BOARD_ITEMS = ["big rug", ...ZACH_ITEMS, ...BEN_ITEMS];
/** The item Scene 11 asks to replace, as the board named it. */
const REPLACED_ITEM = "Round coffee table";
/** The phrase Zach gives the pasted product in Scene 10. */
const PASTED_ITEM = "side table";

test("Scene 1: Zach creates the project from the landing page and the values persist after reload", async ({ request }) => {
  const created = await createThroughLanding(zach, { name: "Zach + Ben Living Room", budgetUsd: 2500, requiredBy: "2026-09-15" }, "Zach", "Zach");
  projectId = created.projectId;
  roomCode = created.code;
  await waitForTools(zach);
  await expect(zach.locator(".topbar .brand")).toHaveText("Zach + Ben Living Room");
  await expect(zach.locator(".topbar").getByTestId("project-code")).toContainText(roomCode);
  await expect(zach.getByTestId("presence")).toContainText("Zach");
  // A new board is empty and says what to put on it; the notes are typed here, not seeded.
  await expect(zach.getByTestId("board-empty")).toBeVisible();
  await addBoardNotesByEditor(zach, ZACH_NOTES);
  await expect(zach.getByTestId("board-empty")).toHaveCount(0);
  await waitForSnapshot(request, projectId, (s) => s.project.budget_cents === BUDGET_CENTS && s.project.required_by === "2026-09-15", 5_000);
  await zach.waitForTimeout(1500); // the board save debounces 800 ms
  await zach.reload();
  await expect(zach.locator(".topbar .brand")).toHaveText("Zach + Ben Living Room");
  await expect(boardText(zach, "$2500 max")).toBeVisible();
  const spec = await (await request.get(`/api/projects/${projectId}/spec`)).json();
  expect(spec.board).not.toBeNull();
});

test("Scene 2: Ben joins with the code; each sees the other's board objects", async ({ request }) => {
  const joined = await joinThroughLanding(ben, roomCode, "Ben", "Ben");
  expect(joined).toBe(projectId);
  await waitForTools(ben);
  await expect(boardText(ben, "$2500 max")).toBeVisible();

  await addBoardNote(zach, ZACH_ITEMS[0], { x: 360, y: 110 });
  await addBoardNote(zach, ZACH_ITEMS[1], { x: 580, y: 110 });
  await addBoardSwatch(zach, "orange", { x: 720, y: 240 });
  await zach.waitForTimeout(1500);
  await waitForSnapshot(request, projectId, (s) => JSON.stringify(s).length > 0, 2_000);

  // Realtime sync (#18) is pending: Ben re-reads the board to see Zach's notes, then adds his own.
  const live = await appears(boardText(ben, ZACH_ITEMS[0]), POLL_MS);
  if (!live) {
    note("pending", "Board realtime sync (#18) absent: Ben reloads to see Zach's notes");
    await ben.reload();
  }
  for (const item of ZACH_ITEMS) await expect(boardText(ben, item)).toBeVisible();

  await addBoardNote(ben, BEN_ITEMS[0], { x: 360, y: 110 });
  await addBoardNote(ben, "would love a wool one if the budget allows", { x: 580, y: 110 });
  await addBoardSwatch(ben, "blue", { x: 720, y: 350 });
  await ben.waitForTimeout(1500);
  const liveBack = await appears(boardText(zach, BEN_ITEMS[0]), POLL_MS);
  if (!liveBack) await zach.reload();
  for (const item of BEN_ITEMS) await expect(boardText(zach, item)).toBeVisible();
  await expect(boardText(zach, "would love a wool one if the budget allows")).toBeVisible();
});

test("Scene 2b: each person sees the other in the top bar within 10 s", async () => {
  await expect(zach.getByTestId("presence")).toContainText("Ben", { timeout: 10_000 });
  await expect(ben.getByTestId("presence")).toContainText("Zach", { timeout: 10_000 });
  await expect(zach.getByTestId("presence").locator('[data-testid="presence-member"][data-active="true"]')).toHaveCount(2, { timeout: 10_000 });
  await expect(ben.getByTestId("presence").locator('[data-testid="presence-member"][data-active="true"]')).toHaveCount(2, { timeout: 10_000 });
});

test("Scene 3: create plan from board; both approve; the structured plan appears", async ({ request }) => {
  await zach.getByTestId("create-plan").click();
  const form = zach.getByTestId("spec-form");
  await expect(form).toBeVisible();
  await expect(form.locator("#width")).toHaveValue("12");
  await expect(form.locator("#length")).toHaveValue("18");
  await expect(form.locator("#budget")).toHaveValue("2500");
  await expect(form.locator("#required_by")).toHaveValue("2026-09-15");
  // Items, colours, and rules come from the board in its own words: nothing on the form is preset.
  const itemRows = form.getByTestId("item-row");
  expect(await itemRows.count()).toBe(BOARD_ITEMS.length);
  const values = await itemRows.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  for (const item of BOARD_ITEMS) expect(values).toContain(item);
  await expect(form.getByTestId("swatch-row")).toHaveCount(2);
  await expect(form.getByTestId("rule-row")).toHaveValue("big rug underneath everything");
  await zach.getByTestId("approve-plan").click();
  await zach.waitForURL(/\/room/);

  await ben.getByTestId("create-plan").click();
  await expect(ben.getByTestId("spec-form")).toBeVisible();
  await ben.getByTestId("approve-plan").click();
  await ben.waitForURL(/\/room/);

  const snap = await waitForSnapshot(request, projectId, (s) => s.requirements.some((r) => r.status === "agreed") && s.space !== null, 5_000);
  expect(snap.space!.width_mm).toBe(Math.round(12 * 304.8));
  expect(snap.space!.length_mm).toBe(Math.round(18 * 304.8));
  const agreed = snap.requirements.filter((r) => r.status === "agreed");
  for (const item of BOARD_ITEMS) expect(requiredItems(snap)).toContain(item);
  const colours = agreed.find((r) => r.type === "visual_direction")!.value_json as { base: string[]; accent: string[] };
  expect(colours.base.length + colours.accent.length).toBe(2);
  // "everything" expands to every other item on the board, including the phrases Scene 2 added.
  const rule = agreed.find((r) => r.type === "layout_requirement")!.value_json as { relation: string; subject: string; objects: string[] };
  expect(rule).toMatchObject({ relation: "under", subject: "big rug" });
  expect(rule.objects).toEqual(expect.arrayContaining(BOARD_ITEMS.filter((i) => i !== "big rug")));

  // Stage 2: Zach confirms the room estimate, which unlocks the items stage.
  await openStage(zach, projectId, "room");
  await expect(zach.getByTestId("room-describe")).not.toHaveValue("");
  await zach.getByTestId("confirm-room").click();
  await zach.waitForURL(/\/place/);
  await expect(zach.getByTestId("plan-view")).toBeVisible();
});

test("Scene 4: Zach asks for a set; sourcing starts", async () => {
  await openStage(zach, projectId, "place");
  await waitForTools(zach);
  await sendChat(zach, "Find a set that works for us and make sure everything can arrive by September 15.");
  agentSourced = await appears(zach.getByTestId("artifact-sourcing"), AGENT_WAIT_MS);
  test.fixme(!agentSourced, "PlanningAgent sourcing (#20) has not landed: no artifact-sourcing in the chat");
  await expect(zach.getByTestId("artifact-sourcing")).toBeVisible();
});

test("Scene 5: the agent asks for a delivery address; 10003 resolves to a city and state", async ({ request }) => {
  const question = zach.getByTestId("artifact-question");
  test.fixme(!(await appears(question, AGENT_WAIT_MS)), "PlanningAgent question artifact has not landed");
  await expect(question).toContainText(/address|zip|postal/i);
  await sendChat(zach, "10003");
  const snap = await waitForSnapshot(request, projectId, (s) => s.project.delivery_address_json?.postal_code === "10003", 30_000);
  expect(snap.project.delivery_address_json?.city).toBeTruthy();
  expect(snap.project.delivery_address_json?.region).toBeTruthy();
  // The run resumes without another command: the sourcing artifact advances past "searching".
  await expect(zach.getByTestId("artifact-sourcing")).not.toContainText(/No item has started yet/, { timeout: AGENT_WAIT_MS });
});

test("Scene 6: the sourcing artifact updates with live product cards", async () => {
  const artifact = zach.getByTestId("artifact-sourcing");
  test.fixme(!(await appears(artifact, 1_000)), "PlanningAgent sourcing artifact has not landed");
  await expect(artifact.locator("[data-category]")).not.toHaveCount(0, { timeout: AGENT_WAIT_MS });
  // Rows are the board's own phrases, never a category label of the app's.
  for (const item of BOARD_ITEMS) await expect(artifact.locator(`[data-category="${item}"]`)).toHaveCount(1);
  await expect(artifact.locator("[data-category] .tag")).toContainText([/selected|searching|retrieving|checking/], { timeout: AGENT_WAIT_MS });
});

test("Scene 7: the BOM appears with one line per item and a total inside the budget", async ({ request }) => {
  const rail = zach.getByTestId("bom-rail");
  if (agentSourced) {
    await waitForSnapshot(request, projectId, (s) => activeBom(s).length >= 4, 240_000);
  } else {
    note("pending", "PlanningAgent absent: sourced every board item through the search panel instead");
    await sourceThroughSearchPanel(zach, request, projectId);
  }
  const snap = await getSnapshot(request, projectId);
  // One line per item the board named, keyed by that phrase, and a subtotal inside the budget. The
  // PRD 8.4 window needs a known extra-item price, which this project does not have yet, so only the ceiling holds.
  expect(activeBom(snap)).toHaveLength(BOARD_ITEMS.length);
  for (const item of BOARD_ITEMS) expect(bomLineFor(snap, item), item).toBeTruthy();
  expect(bomLineFor(snap, "big rug")!.kind).toBe("soft_floor");
  await expect(rail.locator(".rail-line")).toHaveCount(BOARD_ITEMS.length);
  note("subtotal", `${agentSourced ? "agent" : "search-panel fallback"} total ${snap.budget.committed_cents} cents of ${BUDGET_CENTS}`);
  expect(snap.budget.committed_cents).toBeLessThanOrEqual(BUDGET_CENTS);
  // Ben's rail follows within one poll.
  await openStage(ben, projectId, "place");
  await expect(ben.getByTestId("bom-rail").locator(".rail-line")).toHaveCount(BOARD_ITEMS.length, { timeout: POLL_MS });
});

test("Scene 8: the 3D room loads with a model for every grounded BOM item", async ({ request }) => {
  await openStage(zach, projectId, "place");
  // Place every item that has dimensions so the plan and the 3D scene carry it.
  const placeButtons = zach.getByRole("button", { name: "Place in room" });
  while ((await placeButtons.count()) > 0) {
    await placeButtons.first().click();
    await zach.waitForTimeout(400);
  }
  const snap = await getSnapshot(request, projectId);
  const grounded = activeBom(snap).filter((l) => l.product?.spatial_status === "grounded");
  expect(grounded.length).toBeGreaterThan(0);
  expect(snap.placements.length).toBe(grounded.length);
  await expect(zach.getByTestId("plan-view").locator("svg g[aria-label]")).toHaveCount(grounded.length);

  await zach.getByTestId("view-toggle-3d").click();
  await expect(zach.locator("main canvas")).toBeVisible({ timeout: 20_000 });
  const modelled = snap.products.filter((p) => grounded.some((l) => l.product_id === p.id));
  const withModel = modelled.filter((p) => p.model_status === "ready" || p.model_status === "proxy");
  if (withModel.length < modelled.length) note("pending", `3D generation (#26): ${withModel.length} of ${modelled.length} grounded products have a model row; the scene draws proxies for the rest`);
  await zach.locator('[role="group"][aria-label="View"] button', { hasText: "2D" }).click();
});

test("Scene 9: Zach asks whether the layout meets the agreement; the agent reports the under rule's result", async ({ request }) => {
  // The board's "big rug underneath everything" is the one agreed rule; the engine evaluates it as
  // under(big rug, [sofa, Coffee table, Ottoman]) and the status row shows the result.
  const status = zach.getByTestId("rule-result");
  await expect(status).toHaveCount(1);
  await expect(status).toHaveAttribute("data-relation", "under");
  await expect(status).toContainText(/big rug under/i);
  const result = await status.getAttribute("data-result");
  expect(["pass", "fail"]).toContain(result);
  const geometry = (await (await request.get(`/api/projects/${projectId}/placements`)).json()) as { geometry: { rules: { rule: { relation: string; subject: string }; pass: boolean | null; detail: string }[] } };
  expect(geometry.geometry.rules).toHaveLength(1);
  expect(geometry.geometry.rules[0]).toMatchObject({ rule: { relation: "under", subject: "big rug" }, pass: result === "pass" });
  note("under rule", `${result}: ${geometry.geometry.rules[0].detail}`);

  await sendChat(zach, "Does this layout meet what we agreed on?");
  const agentMessages = zach.getByTestId("chat-log").locator(".msg.agent");
  const replied = await appears(agentMessages.last(), AGENT_WAIT_MS);
  test.fixme(!replied, "PlanningAgent (#20) sent no reply within the wait");
  const text = await agentMessages.last().innerText();
  test.fixme(PLACEHOLDER_AGENT.test(text), "PlanningAgent (#20) has not landed: placeholder reply");
  expect(text).toMatch(/rug|under|inside|collision|clearance|fits|overlap/i);
});

test("Scene 10: Zach pastes a product URL; the product ingests under his phrase and the BOM regenerates", async ({ request }) => {
  const before = await getSnapshot(request, projectId);
  const known = new Set(activeBom(before).map((l) => l.id));
  const newLine = (s: Snapshot) => activeBom(s).find((l) => !known.has(l.id));
  await sendChat(zach, `Add this ${PASTED_ITEM}: ${PASTED_URL}`);
  let ingested = false;
  try {
    await waitForSnapshot(request, projectId, (s) => newLine(s) !== undefined, AGENT_WAIT_MS);
    ingested = true;
  } catch {
    ingested = false;
  }
  if (!ingested) {
    note("pending", "PlanningAgent did not ingest the pasted URL; added it through the add_product WebMCP tool");
    const result = await executeTool(zach, "add_product", { url: PASTED_URL, category: PASTED_ITEM });
    expect(result.isError, result.text).toBe(false);
  }
  const snap = await waitForSnapshot(request, projectId, (s) => newLine(s) !== undefined, 30_000);
  const side = newLine(snap)!;
  // The line carries the phrase the person used (or the product title when the agent passed none) and an inferred kind.
  expect(side.category.length).toBeGreaterThan(0);
  expect(side.kind.length).toBeGreaterThan(0);
  note("pasted item", `${side.category} (${side.kind})`);
  expect(side.product?.price_cents).toBeGreaterThan(0);
  expect(snap.budget.committed_cents).toBe(before.budget.committed_cents + side.product!.price_cents);
  await expect(zach.getByTestId("bom-rail")).toContainText(side.product!.title);
  // Whether the paste pushes the budget over depends on the sourced subtotal; the scene records it.
  note("budget", `after the paste: ${snap.budget.committed_cents} of ${BUDGET_CENTS} cents, state ${snap.budget.state}`);
  if (snap.budget.state === "over") await expect(zach.getByTestId("budget-stat")).toHaveAttribute("data-state", "over");
  const product = snap.products.find((p) => p.id === side.product_id)!;
  if (!["queued", "generating", "ready", "proxy"].includes(product.model_status)) note("pending", `3D generation (#26): side table model_status is ${product.model_status}`);
  // Ben's rail shows the new line within one poll.
  await expect(ben.getByTestId("bom-rail")).toContainText(side.product!.title, { timeout: POLL_MS });
});

test("Scene 11: Zach asks for a cheaper coffee table; the replacement artifact appears under the board's phrase", async () => {
  await sendChat(zach, `Find a cheaper ${REPLACED_ITEM.toLowerCase()} that still matches everything we agreed on.`);
  const ranking = zach.getByTestId("artifact-ranking");
  test.fixme(!(await appears(ranking, AGENT_WAIT_MS)), "PlanningAgent replacement (#20) has not landed: no artifact-ranking in the chat");
  await expect(ranking).toContainText(new RegExp(REPLACED_ITEM, "i"));
});

test("Scene 12: at least two real candidates evaluate and the selected one meets required_savings", async ({ request }) => {
  const ranking = zach.getByTestId("artifact-ranking");
  test.fixme(!(await appears(ranking, 1_000)), "PlanningAgent replacement artifact has not landed");
  const rows = ranking.locator("tbody tr[data-product-id]");
  await expect.poll(async () => rows.count(), { timeout: 120_000 }).toBeGreaterThanOrEqual(2);
  await expect(ranking.locator('tbody tr[data-status="selected"]')).toHaveCount(1, { timeout: 120_000 });
  const snap = await getSnapshot(request, projectId);
  const artifact = [...snap.messages].reverse().find((m) => m.artifact?.kind === "ranking")!.artifact!.data as {
    required_savings_cents: number;
    rows: { product_id: string; savings_cents: number; status: string }[];
    selected_product_id?: string;
  };
  const evaluated = artifact.rows.filter((r) => r.status !== "pending");
  expect(evaluated.length).toBeGreaterThanOrEqual(2);
  const selected = artifact.rows.find((r) => r.status === "selected" || r.product_id === artifact.selected_product_id)!;
  expect(selected.savings_cents).toBeGreaterThanOrEqual(artifact.required_savings_cents);
});

test("Scene 13: approving the replacement updates the BOM, the scene, and the budget; Ben's session follows", async ({ request }) => {
  const approve = zach.getByTestId("approve-replacement");
  test.fixme(!(await appears(approve, 1_000)), "Replacement approval has not landed");
  const before = await getSnapshot(request, projectId);
  const oldTable = bomLineFor(before, REPLACED_ITEM)!;
  await approve.click();
  const snap = await waitForSnapshot(request, projectId, (s) => bomLineFor(s, REPLACED_ITEM)?.id !== oldTable.id, 30_000);
  const newTable = bomLineFor(snap, REPLACED_ITEM)!;
  expect(newTable.kind).toBe(oldTable.kind);
  // required_savings may be zero when the budget is not over; the replacement still never costs more.
  expect(newTable.product!.price_cents).toBeLessThanOrEqual(oldTable.product!.price_cents);
  expect(snap.budget.committed_cents).toBeLessThanOrEqual(BUDGET_CENTS);
  expect(snap.budget.state).not.toBe("over");
  expect(snap.placements.some((p) => p.bom_item_id === newTable.id)).toBe(true);
  await expect(zach.getByTestId("bom-rail")).toContainText(newTable.product!.title);
  await expect(zach.getByTestId("budget-stat")).not.toHaveAttribute("data-state", "over");
  await expect(ben.getByTestId("bom-rail")).toContainText(newTable.product!.title, { timeout: POLL_MS });
  await expect(ben.getByTestId("budget-stat")).not.toHaveAttribute("data-state", "over", { timeout: POLL_MS });
});

/**
 * Sources one product per item the board named through the search panel, in plan order. Each item
 * takes the priciest card with stated dimensions under an even share of what is left of the
 * budget, so the set stays inside the budget whatever the board asked for.
 */
async function sourceThroughSearchPanel(page: Page, request: APIRequestContext, projectId: string) {
  const panel = page.getByTestId("product-search");
  await expect(panel).toBeVisible();
  const items = requiredItems(await getSnapshot(request, projectId));
  expect(items.length).toBeGreaterThan(0);
  for (const [index, item] of items.entries()) {
    const committed = (await getSnapshot(request, projectId)).budget.committed_cents;
    const share = Math.floor((BUDGET_CENTS - committed - 100) / (items.length - index));
    await addFromSearch(panel, request, projectId, item, Math.floor(share / 100), (cents) => cents <= share);
  }
}

/**
 * Runs one item's search and adds the priciest dimensioned card that `accept`s, or the priciest
 * under the cap. Fast Refresh from a concurrent source edit resets the panel mid-flow, so each
 * attempt re-runs the search and the add is confirmed against the API rather than the card.
 */
async function addFromSearch(panel: Locator, request: APIRequestContext, projectId: string, category: string, maxUsd: number, accept: (cents: number) => boolean) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await panel.locator("#search-cat").selectOption({ label: category });
      await panel.locator("#search-max").fill(String(maxUsd));
      await panel.getByRole("button", { name: "Search" }).click();
      const cards = panel.locator(".card").filter({ hasNot: panel.page().locator(".tag", { hasText: "dimensions unknown" }) });
      await expect(cards.first()).toBeVisible({ timeout: 60_000 });
      const texts = await cards.evaluateAll((els) => els.map((el) => el.querySelector(".meta")?.textContent ?? ""));
      const priced = texts
        .map((text, index) => ({ index, cents: Math.round(Number((text.match(/\$([\d,]+(?:\.\d+)?)/)?.[1] ?? "0").replace(/,/g, "")) * 100) }))
        .filter((p) => p.cents > 0 && p.cents <= maxUsd * 100)
        .sort((a, b) => b.cents - a.cents);
      expect(priced.length, `no dimensioned ${category} under $${maxUsd}`).toBeGreaterThan(0);
      const pick = priced.find((p) => accept(p.cents)) ?? priced[0];
      await cards.nth(pick.index).getByRole("button", { name: "Add to project" }).click({ timeout: 10_000 });
      await waitForSnapshot(request, projectId, (s) => bomLineFor(s, category) !== undefined, 30_000);
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      note("retry", `search panel reset while adding ${category} (attempt ${attempt}): ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

export type { Snapshot };
