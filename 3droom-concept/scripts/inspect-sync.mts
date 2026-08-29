// Semantic gate for #18: board sync by polling and heartbeat cursors, two contexts, no reloads. Run
// against the dev server on 3111: npx tsx scripts/inspect-sync.mts
import { chromium } from "@playwright/test";
import { addBoardNotesByEditor, createThroughLanding, joinThroughLanding } from "../tests/helpers";

const BASE = "http://localhost:3111";
const out: string[] = [];
const note = (ok: boolean, w: string) => out.push(`${ok ? "ok " : "FAIL"} ${w}`);
type Ed = { getCurrentPageShapeIds(): Set<string>; getCurrentPageShapes(): { id: string; type: string; x: number; y: number; props: Record<string, unknown> }[]; updateShapes(s: unknown[]): void; deleteShapes(ids: string[]): void; pageToViewport(p: { x: number; y: number }): { x: number; y: number } };
type W = Window & { __tldraw_editor?: Ed };
const shapes = (p: import("@playwright/test").Page) => p.evaluate(() => (window as unknown as W).__tldraw_editor!.getCurrentPageShapes().map((s) => ({ id: s.id, type: s.type, x: s.x, y: s.y })));
const until = async (fn: () => Promise<boolean>, ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return fn(); };

const browser = await chromium.launch();
const zach = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })).newPage();
const { code, projectId } = await createThroughLanding(zach, { name: "Sync flat", budgetUsd: 1800, requiredBy: "2026-10-01" }, "Zach", "owner");
await addBoardNotesByEditor(zach, [{ text: "first note", x: 0, y: 0 }]);
const ben = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })).newPage();
await joinThroughLanding(ben, code, "Ben", "partner");
await ben.getByTestId("board-canvas").waitFor();
await until(async () => (await shapes(ben)).length === 1, 10000);
note((await shapes(ben)).length === 1, `initial load: Ben's store holds Zach's first note (${(await shapes(ben)).length} shape)`);

const t0 = Date.now();
await addBoardNotesByEditor(zach, [{ text: "from zach", x: 400, y: 0 }]);
const arrived = await until(async () => (await shapes(ben)).length === 2, 6000);
note(arrived, `add: Zach's second note reached Ben in ${Date.now() - t0} ms without reload`);
await ben.evaluate(() => {
  (window as unknown as W & { __tldraw_editor: { zoomToFit(o: unknown): void } }).__tldraw_editor.zoomToFit({ animation: { duration: 0 } });
});
note(await ben.getByTestId("board-canvas").getByText("from zach").first().waitFor({ timeout: 3000 }).then(() => true, () => false), "add: the note text renders on Ben's board once it is in his viewport");

const zs = await shapes(zach);
const moved = zs.find((s) => s.x === 400)!;
await zach.evaluate((id) => {
  (window as unknown as W).__tldraw_editor!.updateShapes([{ id, type: "note", x: 900, y: 300 }]);
}, moved.id);
const t1 = Date.now();
const movedOk = await until(async () => (await shapes(ben)).some((s) => s.id === moved.id && s.x === 900 && s.y === 300), 6000);
note(movedOk, `move: the same record id at (900,300) on Ben's board in ${Date.now() - t1} ms`);

await ben.evaluate((id) => {
  (window as unknown as W).__tldraw_editor!.deleteShapes([id]);
}, moved.id);
const t2 = Date.now();
const removedOk = await until(async () => !(await shapes(zach)).some((s) => s.id === moved.id), 6000);
note(removedOk, `remove: Ben's delete reached Zach in ${Date.now() - t2} ms; Zach has ${(await shapes(zach)).length} shape`);

const spec = (await (await zach.request.get(`${BASE}/api/projects/${projectId}/spec`)).json()) as { board: { version: number; records: { typeName: string; id: string }[] } };
const serverShapes = spec.board.records.filter((r) => r.typeName === "shape");
note(serverShapes.length === 1 && serverShapes[0].id !== moved.id, `server: board version ${spec.board.version}, ${serverShapes.length} shape record, the deleted id is gone`);
const delta = (await (await zach.request.get(`${BASE}/api/projects/${projectId}/spec?since=${spec.board.version}`)).json()) as { board: { put: unknown[]; remove: string[] } };
note(delta.board.put.length === 0 && delta.board.remove.length === 0, `server: since=${spec.board.version} returns nothing`);
const delta0 = (await (await zach.request.get(`${BASE}/api/projects/${projectId}/spec?since=0`)).json()) as { board: { put: { typeName: string }[]; remove: string[] } };
note(delta0.board.remove.includes(moved.id), `server: since=0 lists the removed id as a tombstone (${delta0.board.remove.length} removed, ${delta0.board.put.length} put)`);

// Cursor: Zach's pointer rides the next heartbeat; Ben draws it where Zach's page point maps in his viewport.
const box = (await zach.getByTestId("board-canvas").boundingBox())!;
await zach.mouse.move(box.x + 250, box.y + 200);
const t3 = Date.now();
const cursorOk = await until(async () => (await ben.getByTestId("remote-cursor").count()) === 1, 12000);
note(cursorOk, `cursor: Ben sees one remote cursor after ${Date.now() - t3} ms`);
const label = await ben.getByTestId("remote-cursor").innerText().catch(() => "");
note(label.trim() === "Zach", `cursor: labelled with the display name "${label.trim()}"`);
const members = (await (await zach.request.get(`${BASE}/api/projects/${projectId}/members`)).json()) as { members: { display_name: string; cursor: { x: number; y: number } | null }[] };
const zm = members.members.find((m) => m.display_name === "Zach")!;
const expected = await ben.evaluate((c) => { const v = (window as unknown as W).__tldraw_editor!.pageToViewport(c); return { x: v.x, y: v.y }; }, zm.cursor!);
const pos = await ben.getByTestId("remote-cursor").evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }));
note(Math.abs(pos.x - expected.x) < 1 && Math.abs(pos.y - expected.y) < 1, `cursor: drawn at (${pos.x.toFixed(0)},${pos.y.toFixed(0)}) = pageToViewport of the server cursor (${expected.x.toFixed(0)},${expected.y.toFixed(0)}); page point ${JSON.stringify(zm.cursor)}`);
const zachSees = await zach.getByTestId("remote-cursor").count();
note(zachSees === 0, `cursor: Zach's board draws no cursor for himself and none for Ben, whose pointer is off the canvas (${zachSees})`);
const dot = await ben.getByTestId("remote-cursor").locator("span").first().evaluate((el) => getComputedStyle(el).backgroundColor);
note(dot !== "rgba(0, 0, 0, 0)", `cursor: dot colour ${dot} derived from role "owner"`);
await browser.close();
console.log(out.join("\n"));
process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
