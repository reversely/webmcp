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
 * `add_product` WebMCP tool when the chat does not ingest the pasted URL. Scene 10b (#50, #59, #61)
 * asks the agent to record Ben's new item and its relation and then to source it; the board and the
 * search panel are the fallbacks when it does not.
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
  requirementName,
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
/** The item Ben adds in Scene 10b, in his words; the item it goes beside is read from the BOM. */
const BEN_NEW_ITEM = "floor lamp";
/** How long the single-item sourcing pipeline (search, visual, delivery, rank, place) may take through the agent. */
const SOURCE_WAIT_MS = 300_000;
/** How long a real image-to-3D generation may take before the scene gives up (15 to 70 s observed). */
const MODEL_WAIT_MS = 180_000;
/** The gap Scene 10b leaves between the new item and its neighbour; under the engine's 600 mm `beside` limit. */
const BESIDE_GAP_MM = 200;

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

/** Board sync (#18): the 800 ms save plus one 2 s poll; an object reaches the other board inside this. */
const SYNC_MS = 5_000;
/** The heartbeat carries the cursor every 5 s; the other board draws it within three beats. */
const CURSOR_MS = 15_000;

const shapeCount = (page: Page) => page.evaluate(() => (window as Window & { __tldraw_editor?: { getCurrentPageShapeIds(): Set<string> } }).__tldraw_editor?.getCurrentPageShapeIds().size ?? -1);

test("Scene 2: Ben joins with the code; each sees the other's board objects and cursor without reload", async () => {
  const joined = await joinThroughLanding(ben, roomCode, "Ben", "Ben");
  expect(joined).toBe(projectId);
  await waitForTools(ben);
  await expect(boardText(ben, "$2500 max")).toBeVisible();

  await addBoardNote(zach, ZACH_ITEMS[0], { x: 360, y: 110 });
  await addBoardNote(zach, ZACH_ITEMS[1], { x: 580, y: 110 });
  await addBoardSwatch(zach, "orange", { x: 720, y: 240 });
  for (const item of ZACH_ITEMS) await expect(boardText(ben, item)).toBeVisible({ timeout: SYNC_MS });
  // Ben's store holds exactly what both typed: Zach's four Scene 1 notes, two items, one swatch.
  await expect.poll(() => shapeCount(ben), { timeout: SYNC_MS }).toBe(ZACH_NOTES.length + ZACH_ITEMS.length + 1);

  await addBoardNote(ben, BEN_ITEMS[0], { x: 360, y: 460 });
  await addBoardNote(ben, "would love a wool one if the budget allows", { x: 580, y: 460 });
  await addBoardSwatch(ben, "blue", { x: 720, y: 350 });
  for (const item of BEN_ITEMS) await expect(boardText(zach, item)).toBeVisible({ timeout: SYNC_MS });
  await expect(boardText(zach, "would love a wool one if the budget allows")).toBeVisible({ timeout: SYNC_MS });
  const total = ZACH_NOTES.length + ZACH_ITEMS.length + 1 + BEN_ITEMS.length + 2;
  await expect.poll(() => shapeCount(zach), { timeout: SYNC_MS }).toBe(total);
  await expect.poll(() => shapeCount(ben), { timeout: SYNC_MS }).toBe(total);

  // Zach's pointer rides the heartbeat and shows on Ben's board as a labelled dot.
  const box = (await zach.getByTestId("board-canvas").boundingBox())!;
  await zach.mouse.move(box.x + 300, box.y + 300);
  const cursor = ben.getByTestId("remote-cursor");
  await expect(cursor).toHaveCount(1, { timeout: CURSOR_MS });
  await expect(cursor).toContainText("Zach");
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
  // "Create plan from board" waits on the model-backed compile route, which can run past 10 s.
  await expect(form).toBeVisible({ timeout: AGENT_WAIT_MS });
  // Room dimensions are entered once, on the Room stage; the plan form carries the board's reading there.
  await expect(form.locator("#width")).toHaveCount(0);
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
  await expect(ben.getByTestId("spec-form")).toBeVisible({ timeout: AGENT_WAIT_MS });
  // Ben's note "would love a wool one" is a wish about the rug: his plan carries the same four items.
  await expect(ben.getByTestId("spec-form").getByTestId("item-row")).toHaveCount(BOARD_ITEMS.length);
  await ben.getByTestId("approve-plan").click();
  await ben.waitForURL(/\/room/);

  const snap = await waitForSnapshot(request, projectId, (s) => s.requirements.some((r) => r.status === "agreed") && s.room_estimate !== null, 5_000);
  // Approve carries the board's "12 x 18" as an estimate; nothing is the Space until the Room stage confirms it.
  expect(snap.space).toBeNull();
  expect(snap.room_estimate!.width_mm).toBe(Math.round(12 * 304.8));
  expect(snap.room_estimate!.length_mm).toBe(Math.round(18 * 304.8));
  const agreed = snap.requirements.filter((r) => r.status === "agreed");
  for (const item of BOARD_ITEMS) expect(requiredItems(snap)).toContain(item);
  const colours = agreed.find((r) => r.type === "visual_direction")!.value_json as { base: string[]; accent: string[] };
  expect(colours.base.length + colours.accent.length).toBe(2);
  // "everything" expands to every other item on the board, including the phrases Scene 2 added.
  const rule = agreed.find((r) => r.type === "layout_requirement")!.value_json as { relation: string; subject: string; objects: string[] };
  expect(rule).toMatchObject({ relation: "under", subject: "big rug" });
  expect(rule.objects).toEqual(expect.arrayContaining(BOARD_ITEMS.filter((i) => i !== "big rug")));

  // Stage 2: the estimate prefills the fields; Zach confirms it, which writes the Space and unlocks the items stage.
  await openStage(zach, projectId, "room");
  await expect(zach.getByLabel("Width, feet")).toHaveValue("12");
  await expect(zach.getByLabel("Length, feet")).toHaveValue("18");
  await zach.getByTestId("confirm-room").click();
  await zach.waitForURL(/\/place/);
  await expect(zach.getByTestId("plan-view")).toBeVisible();
  const confirmed = await waitForSnapshot(request, projectId, (s) => s.space !== null, 5_000);
  expect(confirmed.space!.width_mm).toBe(Math.round(12 * 304.8));
  expect(confirmed.space!.length_mm).toBe(Math.round(18 * 304.8));
});

test("Scene 4: Zach asks for a set; tool events stream before the sourcing artifact appears", async () => {
  await openStage(zach, projectId, "place");
  await waitForTools(zach);
  await zach.evaluate(() => {
    (window as Window & { __chat_events?: unknown[] }).__chat_events = [];
  });
  await sendChat(zach, "Find a set that works for us and make sure everything can arrive by September 15.");
  agentSourced = await appears(zach.getByTestId("artifact-sourcing"), AGENT_WAIT_MS);
  test.fixme(!agentSourced, "PlanningAgent sourcing (#20) has not landed: no artifact-sourcing in the chat");
  await expect(zach.getByTestId("artifact-sourcing")).toBeVisible();
  // Streaming (#19): the run's first tool event reached the page before the artifact, and rendered as a line under the message.
  const types = await zach.evaluate(() => ((window as Window & { __chat_events?: { type: string }[] }).__chat_events ?? []).map((e) => e.type));
  const firstTool = types.indexOf("tool");
  const firstArtifact = types.indexOf("artifact");
  expect(firstTool).toBeGreaterThanOrEqual(0);
  expect(firstArtifact).toBeGreaterThan(firstTool);
  await expect(zach.getByTestId("chat-tool-event").first()).toBeVisible();
  note("stream", `${types.length} events so far: ${types.slice(0, 8).join(", ")}`);
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

test("Scene 10b: Ben adds a floor lamp beside the sofa and watches its model generate", async ({ request }) => {
  test.setTimeout(600_000);
  const before = await getSnapshot(request, projectId);
  // The neighbour is the first seating line the board produced, by the board's own phrase.
  const seating = activeBom(before).find((l) => l.kind === "seating" && before.placements.some((p) => p.bom_item_id === l.id)) ?? activeBom(before).find((l) => before.placements.some((p) => p.bom_item_id === l.id));
  expect(seating, "a placed item to put the lamp beside").toBeTruthy();
  const target = seating!.category;
  const lower = (s: string) => s.trim().toLowerCase();
  const itemRequirement = (s: Snapshot) => s.requirements.find((r) => r.type === "required_item" && r.status === "agreed" && lower(requirementName(r.value_json)) === BEN_NEW_ITEM);
  const besideRule = (s: Snapshot) =>
    s.requirements.find((r) => {
      if (r.type !== "layout_requirement" || r.status !== "agreed") return false;
      const v = r.value_json as { relation: string; subject?: string; objects?: string[] };
      const names = [v.subject ?? "", ...(v.objects ?? [])].map(lower);
      return v.relation === "beside" && names.includes(BEN_NEW_ITEM) && names.includes(lower(target));
    });
  const recorded = (s: Snapshot) => itemRequirement(s) !== undefined && besideRule(s) !== undefined;

  // Ben states the item and its relation in chat; the agent records both as requirements.
  await sendChat(ben, `Add one more thing to what we agreed: a ${BEN_NEW_ITEM} beside the ${target}.`);
  let viaAgent = true;
  try {
    await waitForSnapshot(request, projectId, recorded, AGENT_WAIT_MS);
  } catch {
    viaAgent = false;
  }
  if (!viaAgent) {
    // The board is the other place Ben can say it: a note, then the plan recompiled and approved.
    note("pending", `PlanningAgent did not record "${BEN_NEW_ITEM} beside ${target}" from chat; Ben added it on the board instead`);
    await openStage(ben, projectId, "board");
    await addBoardNotesByEditor(ben, [{ text: `${BEN_NEW_ITEM} beside the ${target}`, x: 0, y: 480, color: "light-green" }]);
    await ben.waitForTimeout(1500); // the board save debounces 800 ms
    await ben.getByTestId("create-plan").click();
    const form = ben.getByTestId("spec-form");
    await expect(form).toBeVisible({ timeout: AGENT_WAIT_MS });
    const values = await form.getByTestId("item-row").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value.trim().toLowerCase()));
    expect(values).toContain(BEN_NEW_ITEM);
    await expect(form.getByTestId("rule-row")).toHaveCount(2);
    await ben.getByTestId("approve-plan").click();
    await ben.waitForURL(/\/room/);
    await waitForSnapshot(request, projectId, recorded, 10_000);
  }
  // The agent's reply names what it recorded; the next request waits for it so the turns do not overlap.
  if (viaAgent) {
    const benIndex = (s: Snapshot) => s.messages.findIndex((m) => m.role === "user" && m.author === "Ben" && m.text.includes(BEN_NEW_ITEM));
    const replied = await waitForSnapshot(request, projectId, (s) => s.messages.slice(benIndex(s) + 1).some((m) => m.role === "agent" && !m.artifact), AGENT_WAIT_MS).catch(() => null);
    const reply = replied ? replied.messages.slice(benIndex(replied) + 1).find((m) => m.role === "agent" && !m.artifact)?.text : undefined;
    note("agent reply", reply ?? "none within the wait");
    if (reply) expect(reply).toMatch(new RegExp(BEN_NEW_ITEM, "i"));
  }
  const withRule = await getSnapshot(request, projectId);
  const itemName = requirementName(itemRequirement(withRule)!.value_json);
  const rule = besideRule(withRule)!.value_json as { relation: string; subject: string; objects: string[]; distance_mm?: number };
  expect(rule).toMatchObject({ relation: "beside" });
  note("requirement", `${viaAgent ? "agent" : "board"}: ${itemName}; rule ${JSON.stringify(rule)}`);
  // Every earlier item survives the addition.
  for (const item of BOARD_ITEMS) expect(requiredItems(withRule).map(lower)).toContain(lower(item));

  // Ben asks the agent to source it (#61): one BOM line under his phrase, placed by the beside
  // rule, with its 3D model started. The search panel is the fallback when no line appears; that
  // path picks the cheapest dimensioned card with an image and retries a pick whose model is
  // already cached, because a cached job records no image_fetched stage (PRD 15.1).
  await openStage(ben, projectId, "place");
  await waitForTools(ben);
  const known = new Set(activeBom(withRule).map((l) => l.id));
  const newLine = (s: Snapshot) => activeBom(s).find((l) => !known.has(l.id) && lower(l.category) === lower(itemName));
  let line: Snapshot["bom"][number] | undefined;
  let cached = false;
  let viaAgentSource = false;
  await sendChat(ben, `Source the ${itemName}.`);
  try {
    line = newLine(await waitForSnapshot(request, projectId, (s) => newLine(s) !== undefined, SOURCE_WAIT_MS));
    viaAgentSource = true;
  } catch {
    viaAgentSource = false;
  }
  if (line) {
    const withJob = await waitForSnapshot(request, projectId, (s) => s.model_jobs?.[line!.product_id] !== undefined, 15_000).catch(() => getSnapshot(request, projectId));
    const job = withJob.model_jobs?.[line.product_id];
    cached = job?.status === "ready" && job.stages[job.stages.length - 1]?.detail === "cached";
    await expect(ben.getByTestId("chat-log").locator(".msg.agent").last()).toContainText(/\$|price|added|placed|floor lamp/i, { timeout: POLL_MS });
  } else {
    note("pending", `PlanningAgent did not source "${itemName}" within ${SOURCE_WAIT_MS / 1000} s; Ben used the search panel instead`);
    const panel = ben.getByTestId("product-search");
    const tried = new Set<string>();
    for (let pick = 1; pick <= 3; pick++) {
      await addFromSearch(panel, request, projectId, itemName, 300, () => true, { cheapest: true, requireImage: true, skipTitles: tried });
      const snap = await waitForSnapshot(request, projectId, (s) => newLine(s) !== undefined, 30_000);
      line = newLine(snap)!;
      tried.add(line.product!.title);
      // The job row appears with the add; a cached GLB ends it at ready inside the same tick.
      const withJob = await waitForSnapshot(request, projectId, (s) => s.model_jobs?.[line!.product_id] !== undefined, 15_000).catch(() => snap);
      const job = withJob.model_jobs?.[line.product_id];
      cached = job?.status === "ready" && job.stages[job.stages.length - 1]?.detail === "cached";
      if (!cached) break;
      if (pick === 3) {
        note("pending", "every tried product had a cached model; the scene watches the cached job instead of a generation");
        break;
      }
      note("cached", `pick ${pick} "${line.product!.title}" had a cached model; removed it to watch a real generation`);
      const removed = await request.put(`/api/projects/${projectId}/bom`, { data: { bomItemId: line.id, action: "remove" } });
      expect(removed.ok()).toBeTruthy();
    }
  }
  const lamp = line!;
  expect(lower(lamp.category)).toBe(lower(itemName));
  expect(lamp.product?.price_cents).toBeGreaterThan(0);
  note("sourced", `${viaAgentSource ? "agent" : "search panel"}: ${lamp.product!.title} at ${lamp.product!.price_cents} cents (${lamp.kind})`);
  await expect(ben.getByTestId("bom-rail")).toContainText(lamp.product!.title, { timeout: POLL_MS });
  // Every earlier line survives the addition.
  for (const id of known) expect(activeBom(await getSnapshot(request, projectId)).some((l) => l.id === id), id).toBe(true);

  // The UI stage strip is watched from here: the tray shows it as soon as the line exists.
  const stagesSeen = new Set<string>();
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      try {
        for (const v of await ben.locator('[data-testid="model-stages"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-stage") ?? ""))) if (v) stagesSeen.add(v);
      } catch {
        // Ben's page is mid-navigation; the next pass reads it again.
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();

  // The agent's pipeline placed the lamp by the beside rule; the fallback places it through the
  // place_product WebMCP tool on the first side of the neighbour where it stays inside the room
  // and clear of every other placed item.
  const snapNow = await getSnapshot(request, projectId);
  const product = snapNow.products.find((p) => p.id === lamp.product_id)!;
  expect(product.width_mm, "the lamp has a footprint").not.toBeNull();
  let spot = snapNow.placements.find((p) => p.bom_item_id === lamp.id);
  if (spot) {
    note("placement", `agent placed the lamp at (${spot.x_mm}, ${spot.y_mm})`);
  } else {
    const space = snapNow.space!;
    const half = (w: number, d: number, rot: number) => (rot % 180 !== 0 ? { x: d / 2, y: w / 2 } : { x: w / 2, y: d / 2 });
    const boxes = new Map(snapNow.bom.filter((b) => b.product).map((b) => [b.id, snapNow.products.find((p) => p.id === b.product_id)!]));
    const others = snapNow.placements.filter((p) => p.bom_item_id !== lamp.id && boxes.get(p.bom_item_id)?.width_mm != null).map((p) => ({ ...p, h: half(boxes.get(p.bom_item_id)!.width_mm!, boxes.get(p.bom_item_id)!.depth_mm!, p.rotation_deg), kind: snapNow.bom.find((b) => b.id === p.bom_item_id)!.kind }));
    const neighbour = others.find((p) => p.bom_item_id === seating!.id)!;
    const lampHalf = half(product.width_mm!, product.depth_mm!, 0);
    const candidates = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ].map((side) => ({ x: Math.round(neighbour.x_mm + side.x * (neighbour.h.x + BESIDE_GAP_MM + lampHalf.x)), y: Math.round(neighbour.y_mm + side.y * (neighbour.h.y + BESIDE_GAP_MM + lampHalf.y)) }));
    const inside = (c: { x: number; y: number }) => c.x - lampHalf.x >= 0 && c.x + lampHalf.x <= space.width_mm && c.y - lampHalf.y >= 0 && c.y + lampHalf.y <= space.length_mm;
    const clear = (c: { x: number; y: number }) => others.every((o) => o.kind === "soft_floor" || Math.abs(o.x_mm - c.x) >= o.h.x + lampHalf.x || Math.abs(o.y_mm - c.y) >= o.h.y + lampHalf.y);
    const chosen = candidates.find((c) => inside(c) && clear(c)) ?? { x: Math.round(space.width_mm / 2), y: Math.round(space.length_mm / 2) };
    const placed = await executeTool(ben, "place_product", { bomItemId: lamp.id, xMm: chosen.x, yMm: chosen.y, rotationDeg: 0 });
    expect(placed.isError, placed.text).toBe(false);
    const afterPlace = await waitForSnapshot(request, projectId, (s) => s.placements.some((p) => p.bom_item_id === lamp.id), 10_000);
    spot = afterPlace.placements.find((p) => p.bom_item_id === lamp.id)!;
    expect(spot).toMatchObject({ x_mm: chosen.x, y_mm: chosen.y });
  }
  const geometry = (await (await request.get(`/api/projects/${projectId}/placements`)).json()) as { geometry: { rules: { rule: { relation: string; subject: string }; pass: boolean | null; detail: string }[] } };
  const evaluated = geometry.geometry.rules.find((r) => r.rule.relation === "beside")!;
  expect(evaluated, "the beside rule is evaluated").toBeTruthy();
  expect([true, false]).toContain(evaluated.pass);
  expect(evaluated.detail.length).toBeGreaterThan(0);
  note("beside rule", `${evaluated.pass ? "pass" : "fail"} at (${spot.x_mm}, ${spot.y_mm}): ${evaluated.detail}`);

  // Ben's plan shows the rule's row and, with the lamp selected, its stage strip.
  await openStage(ben, projectId, "place");
  const row = ben.locator('[data-testid="rule-result"][data-relation="beside"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(new RegExp(`${itemName} beside`, "i"));
  await expect(row).toHaveAttribute("data-result", evaluated.pass ? "pass" : "fail");
  expect((await row.getAttribute("title"))?.length).toBeGreaterThan(0);
  await ben.getByTestId("plan-view").locator(`svg g[aria-label="${lamp.product!.title.replace(/"/g, '\\"')}"]`).focus();

  // The model job runs to ready or proxy while the strip advances through its stages.
  const jobOf = (s: Snapshot) => s.model_jobs?.[lamp.product_id];
  const done = await waitForSnapshot(request, projectId, (s) => ["ready", "proxy"].includes(jobOf(s)?.status ?? ""), MODEL_WAIT_MS);
  const job = jobOf(done)!;
  await expect(ben.locator(`[data-testid="model-stages"][data-stage="${job.status}"]`).first()).toBeVisible({ timeout: 15_000 });
  watching = false;
  await watcher;
  const apiStages = job.stages.map((s) => s.name);
  note("model job", `${job.status} after ${job.elapsed_ms} ms; stages ${apiStages.join(" > ")}; UI showed ${[...stagesSeen].join(", ")}${job.error ? `; error ${job.error}` : ""}`);
  if (!cached) {
    expect(apiStages).toContain("image_fetched");
    expect([...stagesSeen].some((s) => ["image_fetched", "mesh_generated", "normalized", "verified"].includes(s)), `UI strip stages seen: ${[...stagesSeen].join(", ")}`).toBe(true);
  }
  expect(done.products.find((p) => p.id === lamp.product_id)!.model_status).toBe(job.status);
  if (job.status === "ready") expect(job.glb_url).toMatch(/\.glb$/);

  // The 3D view shows the generated model (or its proxy) in place for the recording.
  await ben.getByTestId("view-toggle-3d").click();
  await expect(ben.locator("main canvas")).toBeVisible({ timeout: 20_000 });
  await ben.waitForTimeout(4000);
});

/** A ranking artifact as Scene 12 and 13 read it off the snapshot (src/agent/artifacts.ts RankingArtifact). */
type RankingData = {
  category: string;
  required_savings_cents: number;
  ceiling_cents: number;
  rows: { product_id: string; savings_cents: number; status: string }[];
  selected_product_id?: string;
  notes?: string[];
};

/**
 * The ranking artifacts the Scene 11 request produced, in write order: the named item's first,
 * then one per line the plan replaces instead when the named item cannot absorb the overage (#64).
 */
function rankingsSinceLastRequest(snap: Snapshot): RankingData[] {
  const lastUser = snap.messages.map((m) => m.role).lastIndexOf("user");
  return snap.messages.slice(lastUser + 1).flatMap((m) => (m.artifact?.kind === "ranking" ? [m.artifact.data as RankingData] : []));
}

/** Whether the agent has replied after the Scene 11 request, which happens only once every line's ranking is done. */
function repliedSinceLastRequest(snap: Snapshot): boolean {
  const lastUser = snap.messages.map((m) => m.role).lastIndexOf("user");
  return snap.messages.slice(lastUser + 1).some((m) => m.role === "agent" && !m.artifact && m.text.trim() !== "");
}

test("Scene 11: Zach asks for a cheaper coffee table; the replacement artifact appears under the board's phrase", async () => {
  await sendChat(zach, `Find a cheaper ${REPLACED_ITEM.toLowerCase()} that still matches everything we agreed on.`);
  const ranking = zach.getByTestId("artifact-ranking");
  test.fixme(!(await appears(ranking, AGENT_WAIT_MS)), "PlanningAgent replacement (#20) has not landed: no artifact-ranking in the chat");
  // The named item's artifact is written first; the plan's other lines, when any, follow it.
  await expect(ranking.first()).toContainText(new RegExp(REPLACED_ITEM, "i"));
});

test("Scene 12: every proposed line evaluates at least two candidates and selects one whose savings meet its share; the shares cover required_savings", async ({ request }) => {
  const ranking = zach.getByTestId("artifact-ranking");
  test.fixme(!(await appears(ranking, 1_000)), "PlanningAgent replacement artifact has not landed");
  // The reply lands after the last line's ranking, so the artifacts are final once it is there.
  const snap = await waitForSnapshot(request, projectId, repliedSinceLastRequest, 2 * AGENT_WAIT_MS);
  const artifacts = rankingsSinceLastRequest(snap);
  expect(artifacts.length).toBeGreaterThanOrEqual(1);
  const named = artifacts[0];
  expect(named.category.toLowerCase()).toBe(REPLACED_ITEM.toLowerCase());
  const proposals = artifacts.filter((a) => a.rows.length > 0);
  note("replacement plan", `${named.notes?.join(" ") ?? "the named item can absorb the overage"}; lines: ${proposals.map((a) => a.category).join(", ") || "none"}`);
  // #64: the proposal must reach the budget whatever the sourced subtotal was.
  expect(proposals.length).toBeGreaterThanOrEqual(1);
  let savings = 0;
  for (const proposal of proposals) {
    const evaluated = proposal.rows.filter((r) => r.status !== "pending" && r.status !== "evaluating");
    expect(evaluated.length).toBeGreaterThanOrEqual(2);
    const selected = proposal.rows.filter((r) => r.status === "selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].product_id).toBe(proposal.selected_product_id);
    expect(selected[0].savings_cents).toBeGreaterThanOrEqual(proposal.required_savings_cents);
    savings += selected[0].savings_cents;
  }
  expect(savings).toBeGreaterThanOrEqual(named.required_savings_cents);
  await expect(zach.locator('[data-testid="artifact-ranking"] tbody tr[data-status="selected"]')).toHaveCount(proposals.length);
});

test("Scene 13: approving the replacement updates the BOM, the scene, and the budget for every replaced line; Ben's session follows", async ({ request }) => {
  // The named item's artifact has no selection when another line is proposed, so its button stays
  // disabled; every button also stays disabled until the chat stream that ranked the lines closes.
  const approve = zach.locator('button[data-testid="approve-replacement"]:not([disabled])');
  test.fixme(!(await appears(approve, 30_000)), "Replacement approval has not landed");
  const before = await getSnapshot(request, projectId);
  const proposals = rankingsSinceLastRequest(before).filter((a) => a.selected_product_id !== undefined);
  const oldLines = proposals.map((a) => bomLineFor(before, a.category)!);
  expect(oldLines.every(Boolean)).toBe(true);
  await approve.last().click();
  const snap = await waitForSnapshot(request, projectId, (s) => oldLines.every((old) => bomLineFor(s, old.category)?.id !== old.id), 30_000);
  const newLines = oldLines.map((old) => bomLineFor(snap, old.category)!);
  for (const [i, newLine] of newLines.entries()) {
    const old = oldLines[i];
    expect(newLine.kind).toBe(old.kind);
    // required_savings may be zero when the budget is not over; a replacement still never costs more.
    expect(newLine.product!.price_cents).toBeLessThanOrEqual(old.product!.price_cents);
    expect(snap.placements.some((p) => p.bom_item_id === newLine.id)).toBe(true);
    expect(snap.placements.some((p) => p.bom_item_id === old.id)).toBe(false);
  }
  expect(snap.budget.committed_cents).toBeLessThanOrEqual(snap.project.budget_cents);
  expect(snap.budget.committed_cents).toBeLessThanOrEqual(BUDGET_CENTS);
  expect(snap.budget.state).not.toBe("over");
  note("replaced lines", newLines.map((l) => `${l.category}: ${l.product!.title} (${l.product!.price_cents} cents)`).join("; "));
  for (const newLine of newLines) {
    await expect(zach.getByTestId("bom-rail")).toContainText(newLine.product!.title);
    await expect(ben.getByTestId("bom-rail")).toContainText(newLine.product!.title, { timeout: POLL_MS });
  }
  await expect(zach.getByTestId("budget-stat")).not.toHaveAttribute("data-state", "over");
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
 * under the cap; `pick` flips the order to cheapest first, demands a product image, or skips
 * titles already tried. Fast Refresh from a concurrent source edit resets the panel mid-flow, so
 * each attempt re-runs the search and the add is confirmed against the API rather than the card.
 */
type SearchPick = { cheapest?: boolean; requireImage?: boolean; skipTitles?: Set<string> };

async function addFromSearch(panel: Locator, request: APIRequestContext, projectId: string, category: string, maxUsd: number, accept: (cents: number) => boolean, pick: SearchPick = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await panel.locator("#search-cat").selectOption({ label: category });
      await panel.locator("#search-max").fill(String(maxUsd));
      await panel.getByRole("button", { name: "Search" }).click();
      const cards = panel.locator(".card").filter({ hasNot: panel.page().locator(".tag", { hasText: "dimensions unknown" }) });
      await expect(cards.first()).toBeVisible({ timeout: 60_000 });
      const read = await cards.evaluateAll((els) => els.map((el) => ({ meta: el.querySelector(".meta")?.textContent ?? "", title: el.querySelector(".name")?.textContent ?? "", image: el.querySelector("img") !== null })));
      const priced = read
        .map((card, index) => ({ index, title: card.title, image: card.image, cents: Math.round(Number((card.meta.match(/\$([\d,]+(?:\.\d+)?)/)?.[1] ?? "0").replace(/,/g, "")) * 100) }))
        .filter((p) => p.cents > 0 && p.cents <= maxUsd * 100 && (!pick.requireImage || p.image) && !pick.skipTitles?.has(p.title))
        .sort((a, b) => (pick.cheapest ? a.cents - b.cents : b.cents - a.cents));
      expect(priced.length, `no dimensioned ${category} under $${maxUsd}`).toBeGreaterThan(0);
      const chosen = priced.find((p) => accept(p.cents)) ?? priced[0];
      await cards.nth(chosen.index).getByRole("button", { name: "Add to project" }).click({ timeout: 10_000 });
      await waitForSnapshot(request, projectId, (s) => bomLineFor(s, category) !== undefined, 30_000);
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      note("retry", `search panel reset while adding ${category} (attempt ${attempt}): ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

export type { Snapshot };
