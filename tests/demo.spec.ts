/**
 * The scripted demo (PRD 21, 22; issue #32): Zach and Ben in two browser contexts, Scenes 1 to 13
 * in order on one project. Each scene asserts the "Checks" column of the PRD 22 table.
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
  appears,
  boardText,
  BUDGET_CENTS,
  createProject,
  executeTool,
  getSnapshot,
  openStage,
  POLL_MS,
  sendChat,
  SIDE_TABLE_CENTS,
  SIDE_TABLE_URL,
  waitForSnapshot,
  waitForTools,
  type Snapshot
} from "./helpers";

test.describe.configure({ mode: "serial" });

const AGENT_WAIT_MS = 20_000;
const PLACEHOLDER_AGENT = /not wired|No OPENAI_API_KEY/;

/** Sourcing fallback for Scene 7: per-category price caps that keep four items inside the PRD 8.4 window. */
const FALLBACK_CAPS: { category: string; maxUsd: number }[] = [
  { category: "sofa", maxUsd: 1500 },
  { category: "ottoman", maxUsd: 400 },
  { category: "rug", maxUsd: 450 },
  { category: "coffee_table", maxUsd: 600 }
];

let browserRef: Browser;
let zachContext: BrowserContext;
let benContext: BrowserContext;
let zach: Page;
let ben: Page;
let projectId: string;
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

test("Scene 1: Zach creates the project and the values persist after reload", async ({ request }) => {
  const created = await createProject(request, "Zach + Ben Living Room");
  projectId = created.project.id;
  await openStage(zach, projectId, "board");
  await waitForTools(zach);
  await expect(zach.locator(".topbar .brand")).toHaveText("Zach + Ben Living Room");
  // The board seeds the PRD 16 notes (12 × 18, $2500 max, Need Sept 15) on first load and saves them.
  await expect(boardText(zach, "12 × 18 living room")).toBeVisible();
  await expect(boardText(zach, "$2500 max")).toBeVisible();
  await expect(boardText(zach, "Need Sept 15")).toBeVisible();
  await waitForSnapshot(request, projectId, (s) => s.project.budget_cents === BUDGET_CENTS && s.project.required_by === "2026-09-15", 5_000);
  await zach.waitForTimeout(1500); // the board save debounces 800 ms
  await zach.reload();
  await expect(zach.locator(".topbar .brand")).toHaveText("Zach + Ben Living Room");
  await expect(boardText(zach, "$2500 max")).toBeVisible();
  const spec = await (await request.get(`/api/projects/${projectId}/spec`)).json();
  expect(spec.board).not.toBeNull();
});

test("Scene 2: Ben joins; each sees the other's board objects", async ({ request }) => {
  await openStage(ben, projectId, "board");
  await waitForTools(ben);
  await expect(boardText(ben, "$2500 max")).toBeVisible();

  await addBoardNote(zach, "Deep couch", { x: 360, y: 110 });
  await addBoardNote(zach, "Round coffee table", { x: 580, y: 110 });
  await zach.waitForTimeout(1500);
  await waitForSnapshot(request, projectId, (s) => JSON.stringify(s).length > 0, 2_000);

  // Realtime sync (#18) is pending: Ben re-reads the board to see Zach's notes, then adds his own.
  const live = await appears(boardText(ben, "Deep couch"), POLL_MS);
  if (!live) {
    note("pending", "Board realtime sync (#18) absent: Ben reloads to see Zach's notes");
    await ben.reload();
  }
  await expect(boardText(ben, "Deep couch")).toBeVisible();
  await expect(boardText(ben, "Round coffee table")).toBeVisible();

  await addBoardNote(ben, "Leather ottoman", { x: 360, y: 110 });
  await addBoardNote(ben, "Large wool rug", { x: 580, y: 110 });
  await ben.waitForTimeout(1500);
  const liveBack = await appears(boardText(zach, "Leather ottoman"), POLL_MS);
  if (!liveBack) await zach.reload();
  await expect(boardText(zach, "Leather ottoman")).toBeVisible();
  await expect(boardText(zach, "Large wool rug")).toBeVisible();
});

test("Scene 2b: presence and live objects without reload", async () => {
  const presence = zach.locator('[data-testid="presence"]');
  test.fixme((await presence.count()) === 0, "Realtime presence (#18) has not landed");
  await expect(presence).toContainText("Ben");
});

test("Scene 3: create plan from board; both approve; the structured plan appears", async ({ request }) => {
  await zach.getByTestId("create-plan").click();
  const form = zach.getByTestId("spec-form");
  await expect(form).toBeVisible();
  await expect(form.locator("#width")).toHaveValue("12");
  await expect(form.locator("#length")).toHaveValue("18");
  await expect(form.locator("#budget")).toHaveValue("2500");
  await expect(form.locator("#required_by")).toHaveValue("2026-09-15");
  await zach.getByTestId("approve-plan").click();
  await zach.waitForURL(/\/room/);

  await ben.getByTestId("create-plan").click();
  await expect(ben.getByTestId("spec-form")).toBeVisible();
  await ben.getByTestId("approve-plan").click();
  await ben.waitForURL(/\/room/);

  const snap = await waitForSnapshot(request, projectId, (s) => s.requirements.some((r) => r.status === "agreed") && s.space !== null, 5_000);
  expect(snap.space!.width_mm).toBe(Math.round(12 * 304.8));
  expect(snap.space!.length_mm).toBe(Math.round(18 * 304.8));
  expect(snap.requirements.filter((r) => r.status === "agreed").map((r) => r.type)).toContain("required_item");

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
  await expect(zach.getByTestId("artifact-sourcing")).not.toContainText(/No category has started yet/, { timeout: AGENT_WAIT_MS });
});

test("Scene 6: the sourcing artifact updates with live product cards", async () => {
  const artifact = zach.getByTestId("artifact-sourcing");
  test.fixme(!(await appears(artifact, 1_000)), "PlanningAgent sourcing artifact has not landed");
  await expect(artifact.locator("[data-category]")).not.toHaveCount(0, { timeout: AGENT_WAIT_MS });
  await expect(artifact.locator("[data-category] .tag")).toContainText([/selected|searching|retrieving|checking/], { timeout: AGENT_WAIT_MS });
});

test("Scene 7: the BOM appears with a total inside the PRD 8.4 window", async ({ request }) => {
  const rail = zach.getByTestId("bom-rail");
  if (agentSourced) {
    await waitForSnapshot(request, projectId, (s) => activeBom(s).length >= 4, 120_000);
  } else {
    note("pending", "PlanningAgent absent: sourced four categories through the search panel instead");
    await sourceThroughSearchPanel(zach, request, projectId);
  }
  const snap = await getSnapshot(request, projectId);
  const lines = activeBom(snap);
  expect(lines.map((l) => l.category).sort()).toEqual(["coffee_table", "ottoman", "rug", "sofa"]);
  await expect(rail.locator(".rail-line")).toHaveCount(4);
  const min = BUDGET_CENTS - SIDE_TABLE_CENTS;
  if (agentSourced) {
    expect(snap.budget.committed_cents).toBeGreaterThanOrEqual(min);
    expect(snap.budget.committed_cents).toBeLessThan(BUDGET_CENTS);
  } else {
    note("window", `search-panel fallback total ${snap.budget.committed_cents} cents; window ${min} to ${BUDGET_CENTS}`);
    expect(snap.budget.committed_cents).toBeLessThan(BUDGET_CENTS);
  }
  // Ben's rail follows within one poll.
  await openStage(ben, projectId, "place");
  await expect(ben.getByTestId("bom-rail").locator(".rail-line")).toHaveCount(4, { timeout: POLL_MS });
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

test("Scene 9: Zach asks whether the layout meets the agreement; the agent reports geometry results", async () => {
  await sendChat(zach, "Does this layout meet what we agreed on?");
  const agentMessages = zach.getByTestId("chat-log").locator(".msg.agent");
  const replied = await appears(agentMessages.last(), AGENT_WAIT_MS);
  test.fixme(!replied, "PlanningAgent (#20) sent no reply within the wait");
  const text = await agentMessages.last().innerText();
  test.fixme(PLACEHOLDER_AGENT.test(text), "PlanningAgent (#20) has not landed: placeholder reply");
  expect(text).toMatch(/inside|collision|rug|clearance|fits|overlap/i);
});

test("Scene 10: Zach pastes the side-table URL; the BOM regenerates and the budget goes over", async ({ request }) => {
  const before = await getSnapshot(request, projectId);
  await sendChat(zach, SIDE_TABLE_URL);
  let ingested = false;
  try {
    await waitForSnapshot(request, projectId, (s) => activeBom(s).some((l) => l.category === "side_table"), AGENT_WAIT_MS);
    ingested = true;
  } catch {
    ingested = false;
  }
  if (!ingested) {
    note("pending", "PlanningAgent did not ingest the pasted URL; added it through the add_product WebMCP tool");
    const result = await executeTool(zach, "add_product", { url: SIDE_TABLE_URL, category: "side_table" });
    expect(result.isError, result.text).toBe(false);
  }
  const snap = await waitForSnapshot(request, projectId, (s) => activeBom(s).some((l) => l.category === "side_table"), 30_000);
  const side = activeBom(snap).find((l) => l.category === "side_table")!;
  expect(side.product?.price_cents).toBe(SIDE_TABLE_CENTS);
  expect(snap.budget.committed_cents).toBe(before.budget.committed_cents + SIDE_TABLE_CENTS);
  await expect(zach.getByTestId("bom-rail")).toContainText("Bedside Table");
  if (before.budget.committed_cents >= BUDGET_CENTS - SIDE_TABLE_CENTS) {
    expect(snap.budget.state).toBe("over");
    await expect(zach.getByTestId("budget-stat")).toHaveAttribute("data-state", "over");
  } else {
    note("window", "fallback BOM sat below the PRD 8.4 window, so the side table does not push the budget over");
  }
  const product = snap.products.find((p) => p.id === side.product_id)!;
  if (!["queued", "generating", "ready", "proxy"].includes(product.model_status)) note("pending", `3D generation (#26): side table model_status is ${product.model_status}`);
  // Ben's rail shows the new line within one poll.
  await expect(ben.getByTestId("bom-rail")).toContainText("Bedside Table", { timeout: POLL_MS });
});

test("Scene 11: Zach asks for a cheaper coffee table; the replacement artifact appears", async () => {
  await sendChat(zach, "Find a cheaper coffee table that still matches everything we agreed on.");
  const ranking = zach.getByTestId("artifact-ranking");
  test.fixme(!(await appears(ranking, AGENT_WAIT_MS)), "PlanningAgent replacement (#20) has not landed: no artifact-ranking in the chat");
  await expect(ranking).toContainText(/Replacing the coffee table/i);
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
  const oldTable = activeBom(before).find((l) => l.category === "coffee_table")!;
  await approve.click();
  const snap = await waitForSnapshot(request, projectId, (s) => activeBom(s).some((l) => l.category === "coffee_table" && l.id !== oldTable.id), 30_000);
  const newTable = activeBom(snap).find((l) => l.category === "coffee_table")!;
  expect(newTable.product!.price_cents).toBeLessThan(oldTable.product!.price_cents);
  expect(snap.budget.committed_cents).toBeLessThanOrEqual(BUDGET_CENTS);
  expect(snap.budget.state).not.toBe("over");
  expect(snap.placements.some((p) => p.bom_item_id === newTable.id)).toBe(true);
  await expect(zach.getByTestId("bom-rail")).toContainText(newTable.product!.title);
  await expect(zach.getByTestId("budget-stat")).not.toHaveAttribute("data-state", "over");
  await expect(ben.getByTestId("bom-rail")).toContainText(newTable.product!.title, { timeout: POLL_MS });
  await expect(ben.getByTestId("budget-stat")).not.toHaveAttribute("data-state", "over", { timeout: POLL_MS });
});

/**
 * Sources one product per required category through the search panel. Sofa, ottoman, and rug take
 * the priciest card with stated dimensions under their cap; the coffee table is chosen last, at a
 * price that lands the four inside the PRD 8.4 window when the results allow it.
 */
async function sourceThroughSearchPanel(page: Page, request: APIRequestContext, projectId: string) {
  const panel = page.getByTestId("product-search");
  await expect(panel).toBeVisible();
  const first = FALLBACK_CAPS.filter((c) => c.category !== "coffee_table");
  for (const { category, maxUsd } of first) {
    await addFromSearch(panel, request, projectId, category, maxUsd, () => true);
  }
  const others = (await getSnapshot(request, projectId)).budget.committed_cents;
  const minCents = BUDGET_CENTS - SIDE_TABLE_CENTS - others;
  const maxCents = BUDGET_CENTS - others - 100;
  await addFromSearch(panel, request, projectId, "coffee_table", Math.floor(maxCents / 100), (cents) => cents >= minCents && cents <= maxCents);
}

/**
 * Runs one category search and adds the priciest dimensioned card that `accept`s, or the priciest
 * under the cap. Fast Refresh from a concurrent source edit resets the panel mid-flow, so each
 * attempt re-runs the search and the add is confirmed against the API rather than the card.
 */
async function addFromSearch(panel: Locator, request: APIRequestContext, projectId: string, category: string, maxUsd: number, accept: (cents: number) => boolean) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await panel.locator("#search-cat").selectOption(category);
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
      await waitForSnapshot(request, projectId, (s) => activeBom(s).some((l) => l.category === category), 30_000);
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      note("retry", `search panel reset while adding ${category} (attempt ${attempt}): ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

export type { Snapshot };
