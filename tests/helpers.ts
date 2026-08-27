import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/** The polyfill flag makes Playwright's Chromium expose document.modelContext (webmcp-provider.tsx). */
export const POLYFILL = "?webmcp=polyfill";

/** Side table pasted in Scene 10: resolves through the Global Catalog at $345 (PRD 8.4 P_side). */
export const SIDE_TABLE_URL = "https://floydhome.com/products/bedside-table";
export const SIDE_TABLE_CENTS = 34500;
export const BUDGET_CENTS = 250000;

/** The rail polls every 4 s; a check on the other person's context allows one poll plus render. */
export const POLL_MS = 6000;

export type Snapshot = {
  /** Present on the create response only: the six-character room code. */
  code?: string;
  project: { id: string; name: string; budget_cents: number; required_by: string | null; delivery_address_json: { postal_code?: string; city?: string; region?: string } | null; version: number };
  space: { width_mm: number; length_mm: number } | null;
  requirements: { type: string; status: string; value_json: unknown }[];
  products: { id: string; title: string; price_cents: number; spatial_status: string; model_status: string }[];
  bom: { id: string; product_id: string; category: string; status: string; product: { title: string; price_cents: number; spatial_status: string } | null }[];
  placements: { bom_item_id: string }[];
  budget: { committed_cents: number; budget_cents: number; state: string; overage_cents: number };
  messages: { id: string; role: string; author: string; text: string; artifact?: { kind: string; id: string; data: unknown } }[];
};

export async function createProject(request: APIRequestContext, name: string): Promise<Snapshot> {
  const res = await request.post("/api/projects", { data: { name, budget_cents: BUDGET_CENTS, required_by: "2026-09-15" } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Snapshot;
}

export async function getSnapshot(request: APIRequestContext, projectId: string): Promise<Snapshot> {
  const res = await request.get(`/api/projects/${projectId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Snapshot;
}

export const activeBom = (snap: Snapshot) => snap.bom.filter((b) => b.status !== "removed");

/** Waits until the project snapshot satisfies `predicate`, polling the API. */
export async function waitForSnapshot(request: APIRequestContext, projectId: string, predicate: (snap: Snapshot) => boolean, timeoutMs = 30_000): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs;
  let last = await getSnapshot(request, projectId);
  while (!predicate(last)) {
    if (Date.now() > deadline) throw new Error(`Snapshot condition not met within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 500));
    last = await getSnapshot(request, projectId);
  }
  return last;
}

/** Returns true when the locator is visible within `timeoutMs`; false otherwise. */
export async function appears(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Reads the project id out of a /projects/:id/... URL. */
export function projectIdFrom(page: Page): string {
  const m = /\/projects\/([^/?#]+)/.exec(page.url());
  if (!m) throw new Error(`Not on a project page: ${page.url()}`);
  return m[1];
}

/** Fills the name and role fields of a landing card (`create` after creating, `join` on the join card). */
async function fillWhoAmI(page: Page, prefix: "create" | "join", name: string, role: string) {
  await page.getByTestId(`${prefix}-name`).fill(name);
  const chip = page.getByTestId(`${prefix}-role-${role}`);
  if ((await chip.count()) > 0) await chip.click();
  else await page.getByTestId(`${prefix}-role`).fill(role);
  await expect(page.getByTestId(`${prefix}-role`)).toHaveValue(role);
}

/**
 * Creates a project through the landing form, enters it as `name` with `role`, and returns the
 * room code shown after creation. Leaves the page on the board with the polyfill flag on the URL.
 */
export async function createThroughLanding(page: Page, project: { name: string; budgetUsd: number; requiredBy: string }, name: string, role: string): Promise<{ code: string; projectId: string }> {
  await page.goto(`/${POLYFILL}`);
  await page.getByTestId("create-name").fill(project.name);
  await page.getByTestId("create-budget").fill(String(project.budgetUsd));
  await page.getByTestId("create-date").fill(project.requiredBy);
  await page.getByTestId("create-submit").click();
  const codeEl = page.getByTestId("project-code");
  await expect(codeEl).toBeVisible();
  const code = (await codeEl.innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await fillWhoAmI(page, "create", name, role);
  await page.getByTestId("create-enter").click();
  await page.waitForURL(/\/projects\/[^/]+\/board/);
  await expect(page.getByTestId("stage-nav")).toBeVisible();
  return { code, projectId: projectIdFrom(page) };
}

/** Joins an existing project through the landing form's join card and lands on its board. */
export async function joinThroughLanding(page: Page, code: string, name: string, role: string): Promise<string> {
  await page.goto(`/${POLYFILL}`);
  await page.getByTestId("join-code").fill(code);
  await fillWhoAmI(page, "join", name, role);
  await page.getByTestId("join-submit").click();
  await page.waitForURL(/\/projects\/[^/]+\/board/);
  await expect(page.getByTestId("stage-nav")).toBeVisible();
  return projectIdFrom(page);
}

export async function openStage(page: Page, projectId: string, stage: "board" | "room" | "place" | "catalog") {
  await page.goto(`/projects/${projectId}/${stage}${POLYFILL}`);
  await expect(page.getByTestId("stage-nav")).toBeVisible();
}

export async function waitForTools(page: Page) {
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
}

export async function sendChat(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-log")).toContainText(text);
}

/** Executes a registered WebMCP tool through the page's document.modelContext. */
export async function executeTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean; json: unknown }> {
  return page.evaluate(
    async ({ name, args }) => {
      type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      const text = result.content[0]?.text ?? "";
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { text, isError: result.isError === true, json };
    },
    { name, args }
  );
}

/** Adds a sticky note to the tldraw board with the note tool: N, click, type, Escape. */
export async function addBoardNote(page: Page, text: string, at: { x: number; y: number }) {
  const canvas = page.getByTestId("board-canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("Escape");
  await page.keyboard.press("n");
  await page.mouse.click(box.x + at.x, box.y + at.y);
  // The note opens its editor a frame after the click; typing before that drops the first key.
  await expect(canvas.locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type(text, { delay: 20 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(boardText(page, text)).toBeVisible();
}

type TldrawWindow = Window & {
  __tldraw_addNote?: (text: string, x: number, y: number, color?: string) => void;
  __tldraw_addSwatch?: (color: string, x: number, y: number, label?: string) => void;
};

/** Creates sticky notes through the editor the board exposes on `window` (board-canvas.tsx), then waits for them to render. */
export async function addBoardNotesByEditor(page: Page, notes: { text: string; x: number; y: number; color?: string }[]) {
  await expect.poll(() => page.evaluate(() => typeof (window as TldrawWindow).__tldraw_addNote === "function"), { timeout: 20_000 }).toBe(true);
  await page.evaluate((list) => {
    for (const n of list) (window as TldrawWindow).__tldraw_addNote!(n.text, n.x, n.y, n.color);
  }, notes);
  for (const n of notes) await expect(boardText(page, n.text)).toBeVisible();
}

/** Creates a filled rectangle in a tldraw colour; the plan reads its fill as a hex swatch. */
export async function addBoardSwatch(page: Page, color: string, at: { x: number; y: number }) {
  await expect.poll(() => page.evaluate(() => typeof (window as TldrawWindow).__tldraw_addSwatch === "function"), { timeout: 20_000 }).toBe(true);
  await page.evaluate(({ color, at }) => (window as TldrawWindow).__tldraw_addSwatch!(color, at.x, at.y), { color, at });
}

/** tldraw renders a note's text twice (the shape and its editor), so the first match is the check. */
export function boardText(page: Page, text: string): Locator {
  return page.getByTestId("board-canvas").getByText(text).first();
}
