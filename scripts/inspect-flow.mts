// Semantic gate for the landing → join → presence → board → plan → approve flow. Run against the
// dev server on 3111: npx tsx scripts/inspect-flow.mts
import { chromium } from "@playwright/test";
import { addBoardNotesByEditor, addBoardSwatch, createThroughLanding, joinThroughLanding } from "../tests/helpers";

const BASE = "http://localhost:3111";
const out: string[] = [];
const note = (ok: boolean, w: string) => out.push(`${ok ? "ok " : "FAIL"} ${w}`);
const browser = await chromium.launch();
const zach = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })).newPage();
const { code, projectId } = await createThroughLanding(zach, { name: "Inspection flat", budgetUsd: 1800, requiredBy: "2026-10-01" }, "Zach", "Zach");
note(/^[A-Z0-9]{6}$/.test(code), `create: code ${code}`);
const snap = (await (await zach.request.get(`${BASE}/api/projects/${projectId}`)).json()) as { project: { name: string; budget_cents: number; required_by: string | null } };
note(snap.project.name === "Inspection flat" && snap.project.budget_cents === 180000 && snap.project.required_by === "2026-10-01", `create: server row matches the form (${snap.project.name}, ${snap.project.budget_cents}, ${snap.project.required_by})`);
await zach.getByTestId("board-empty").waitFor({ timeout: 20000 }).catch(() => {});
note((await zach.getByTestId("board-empty").count()) === 1, "board: empty state, no seeded notes");
const ben = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })).newPage();
const joined = await joinThroughLanding(ben, code, "Ben", "Ben");
note(joined === projectId, `join: Ben reached the same project by code`);
await zach.waitForTimeout(6000);
const bar = (await zach.locator("header").innerText()).replace(/\s+/g, " ");
note(/Ben/.test(bar) && /Zach/.test(bar) && bar.includes(code), `presence: Zach's top bar shows both members and the code: "${bar.slice(0, 100)}"`);
const members = (await (await zach.request.get(`${BASE}/api/projects/${projectId}/members`)).json()) as { members: { display_name: string; role: string; stage?: string; last_seen: string }[] };
note(members.members.length === 2 && members.members.every((m) => m.role), `presence: server members ${members.members.map((m) => `${m.display_name}/${m.role}@${m.stage ?? "?"}`).join(", ")}`);
await addBoardNotesByEditor(zach, [
  { text: "12 x 18 living room", x: 100, y: 100 }, { text: "reading chair", x: 400, y: 100 }, { text: "standing desk", x: 700, y: 100 },
  { text: "big rug under the desk and the chair", x: 100, y: 400 }, { text: "$1800 max", x: 400, y: 400 }, { text: "by October 1", x: 700, y: 400 }
]);
await addBoardSwatch(zach, "orange", { x: 1000, y: 100 });
await addBoardSwatch(zach, "blue", { x: 1000, y: 400 });
await zach.getByTestId("create-plan").click();
await zach.getByTestId("spec-form").waitFor({ timeout: 30000 });
const form = zach.getByTestId("spec-form");
const items = await form.locator("[data-testid=item-row]").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
note(items.includes("reading chair") && items.includes("standing desk") && !items.includes("chair") && !items.includes("desk"), `plan: item rows are the board's phrases, none leaked from the rule ${JSON.stringify(items)}`);
const swatches = await form.locator("[data-testid=swatch-row] input[type=color]").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value.toLowerCase()));
note(swatches.length === 2 && swatches.every((h) => /^#[0-9a-f]{6}$/.test(h)), `plan: swatches are hex from the shapes ${JSON.stringify(swatches)}`);
const rules = await form.locator("[data-testid=rule-row]").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
note(rules.some((r) => /rug/.test(r)), `plan: rule rows from the board sentence ${JSON.stringify(rules)}`);
note((await form.locator("input[type=checkbox]").count()) === 0, "plan: no checkbox on the form");
const formText = (await form.innerText()).replace(/\s+/g, " ");
note(!/sofa|coffee table|ottoman/i.test(formText), "plan: form names no item the board did not");
const trace = (await (await zach.request.get(`${BASE}/api/projects/${projectId}/trace`)).json()) as { spans: { name: string; status: string; error?: string; output?: unknown }[] };
const compileSpan = trace.spans.filter((sp) => sp.name === "compile_spec").pop();
note(!!compileSpan && compileSpan.status === "ok" && !compileSpan.error, `compile: model-backed compile span ${compileSpan?.status ?? "missing"} ${compileSpan?.error ?? ""}`);
const compiled = (compileSpan?.output ?? null) as { required_items?: unknown[] } | null;
note(!!compiled && Array.isArray(compiled.required_items) && compiled.required_items.length >= 2, `compile: model returned the board's items (${JSON.stringify(compiled?.required_items ?? null)?.slice(0, 120)})`);
await zach.getByTestId("approve-plan").click();
await zach.waitForURL(/\/room/, { timeout: 15000 }).catch(() => {});
const after = (await (await zach.request.get(`${BASE}/api/projects/${projectId}`)).json()) as { requirements: { type: string; value_json: unknown }[]; space: { width_mm: number; length_mm: number } | null; project: { budget_cents: number; required_by: string | null } };
const reqItems = after.requirements.filter((r) => r.type === "required_item").map((r) => (r.value_json as { name: string }).name);
note(reqItems.includes("reading chair") && reqItems.includes("standing desk"), `approve: required_item names ${JSON.stringify(reqItems)}`);
const vis = after.requirements.find((r) => r.type === "visual_direction")?.value_json as { base?: string[]; accent?: string[] } | undefined;
const visAll = [...(vis?.base ?? []), ...(vis?.accent ?? [])].map((h) => h.toLowerCase());
note(swatches.every((h) => visAll.includes(h)), `approve: visual_direction holds the swatch hexes ${JSON.stringify(vis)}`);
const lay = after.requirements.filter((r) => r.type === "layout_requirement").map((r) => r.value_json);
note(lay.length > 0 && JSON.stringify(lay).includes("standing desk") && JSON.stringify(lay).includes("reading chair"), `approve: layout_requirement objects resolve to the named items ${JSON.stringify(lay)}`);
note(after.space?.width_mm === 3658 && after.space?.length_mm === 5486, `approve: space ${after.space?.width_mm} × ${after.space?.length_mm} from "12 x 18"`);
note(after.project.budget_cents === 180000 && after.project.required_by === "2026-10-01", `approve: budget ${after.project.budget_cents}, date ${after.project.required_by}`);
const benBar = (await ben.locator("header").innerText()).replace(/\s+/g, " ");
note(/Zach/.test(benBar), `presence: Ben's bar shows Zach: "${benBar.slice(0, 80)}"`);
await browser.close();
console.log(out.join("\n"));
process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
