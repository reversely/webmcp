// Gate script: opens the running app and inspects each stage's DOM for coherence and visible
// functioning. Run: npx tsx scripts/inspect-ui.ts [projectId]  (dev server on 3111)
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3111";
const findings: string[] = [];
const note = (ok: boolean, what: string) => findings.push(`${ok ? "ok " : "FAIL"} ${what}`);
const feetInches = (mm: number) => {
  const inches = mm / 25.4;
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches - ft * 12);
  return inch === 12 ? `${ft + 1}' 0"` : `${ft}' ${inch}"`;
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let projectId = process.argv[2];
  if (!projectId) {
    const res = await page.request.post(`${BASE}/api/projects`, { data: { name: "Inspection", budget_cents: 100000, required_by: null } });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
    // Items and search need a room; confirm one the way the configurator would.
    await page.request.put(`${BASE}/api/projects/${projectId}/spec`, { data: { space: { width_mm: 3658, length_mm: 5486, name: "Inspection room" }, requirements: [{ type: "required_item", value: { name: "reading chair", kind: null } }] } });
  }
  const snap = async () => (await (await page.request.get(`${BASE}/api/projects/${projectId}`)).json()) as { budget: { committed_cents: number; budget_cents: number }; bom: unknown[]; messages: { text: string }[] };

  for (const stage of ["board", "room", "place", "catalog"]) {
    await page.goto(`${BASE}/projects/${projectId}/${stage}`, { waitUntil: "networkidle" });
    const nav = await page.getByTestId("stage-nav").count();
    note(nav === 1, `${stage}: stage-nav present once`);
    const current = await page.locator('[aria-current="page"]').textContent();
    note(!!current, `${stage}: current stage marked (${current?.trim()})`);
    const dup = await page.locator("main").count();
    note(dup === 1, `${stage}: exactly one main (${dup})`);
    const sample = await page.locator("body").innerText();
    note(!/sample data|lorem|placeholder/i.test(sample), `${stage}: no sample/placeholder text`);
    if (stage !== "board") {
      const s = await snap();
      const stat = (await page.getByTestId("budget-stat").textContent()) ?? "";
      const expected = `$${Math.round(s.budget.committed_cents / 100).toLocaleString("en-US")} / $${Math.round(s.budget.budget_cents / 100).toLocaleString("en-US")}`;
      note(stat.includes(expected), `${stage}: budget stat "${stat.trim()}" matches snapshot "${expected}"`);
      const active = s.bom.filter((b) => (b as { status: string }).status !== "removed") as { product: { title: string; price_cents: number; width_mm: number | null; depth_mm: number | null; spatial_status: string } | null; quantity: number }[];
      const lines = page.locator('[data-testid="bom-rail"] .rail-line');
      note((await lines.count()) === active.length, `${stage}: rail lines (${await lines.count()}) equal active BOM rows`);
      // Semantic checks: every rail line's price and dimensions come from the product row.
      for (let i = 0; i < Math.min(active.length, await lines.count()); i++) {
        const text = (await lines.nth(i).innerText()).replace(/\s+/g, " ");
        const b = active[i];
        if (!b.product) continue;
        const price = `$${Math.round((b.product.price_cents * b.quantity) / 100).toLocaleString("en-US")}`;
        note(text.includes(price), `${stage}: rail line ${i} shows ${price} = price_cents × quantity`);
        if (b.product.spatial_status === "grounded" && b.product.width_mm != null) {
          const w = feetInches(b.product.width_mm);
          note(text.includes(w), `${stage}: rail line ${i} width "${w}" derived from width_mm ${b.product.width_mm}`);
        } else {
          note(/dimensions unknown/.test(text), `${stage}: rail line ${i} says dimensions unknown for a visual_only product`);
        }
        note(text.includes(b.product.title.slice(0, 20)), `${stage}: rail line ${i} names the product "${b.product.title.slice(0, 30)}"`);
      }
      // Budget arithmetic: the stat's committed figure equals the sum over active lines.
      const sum = active.reduce((acc, b) => acc + (b.product ? b.product.price_cents * b.quantity : 0), 0);
      note(sum === s.budget.committed_cents, `${stage}: committed_cents ${s.budget.committed_cents} equals sum of active lines ${sum}`);
    }
  }

  // One action per surface.
  await page.goto(`${BASE}/projects/${projectId}/place`, { waitUntil: "networkidle" });
  const before = (await snap()).messages.length;
  await page.getByTestId("chat-input").fill("What is in the project right now?");
  await page.getByTestId("chat-send").click();
  await page.waitForTimeout(6000);
  const after = (await snap()).messages.length;
  note(after > before, `chat: sending a message added ${after - before} message(s) to the snapshot`);
  const logText = await page.getByTestId("chat-log").innerText();
  note(logText.includes("What is in the project"), "chat: the sent message renders in the log");
  const toggle = page.getByTestId("trace-toggle");
  if (await toggle.count()) await toggle.click();
  await page.waitForTimeout(3500);
  const traceRows = await page.getByTestId("trace-row").count().catch(() => -1);
  note(traceRows > 0, `trace: ${traceRows} span rows visible after the message`);
  // Semantic: the trace rows correspond to spans the server holds, and an agent_run span exists for the message.
  const trace = await (await page.request.get(`${BASE}/api/projects/${projectId}/trace`)).json().catch(() => null) as { spans?: { kind: string; name: string; status: string; input?: unknown }[] } | null;
  if (trace?.spans) {
    const run = trace.spans.find((sp) => sp.kind === "agent_run");
    note(!!run, `trace: server holds an agent_run span (${run?.name ?? "none"}) for the chat message`);
    const firstRow = ((await page.getByTestId("trace-row").first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
    const matches = trace.spans.some((sp) => firstRow.includes(sp.name));
    note(matches, `trace: the first visible row "${firstRow.slice(0, 60)}" names a real span`);
  }
  const search = page.locator("#search-cat");
  if (await search.count()) {
    await search.selectOption({ label: "reading chair" }).catch(async () => { await search.selectOption({ index: 0 }); });
    await page.getByRole("button", { name: /^Search$/ }).click();
    await page.waitForTimeout(8000);
    const cards = page.locator('[data-testid="product-search"] .card');
    note((await cards.count()) > 0, `search: ${await cards.count()} live product cards rendered`);
    // Semantic: the first card's price equals the catalog price the API returned for it.
    // Replicate the panel's own parameters: the item and the max price it defaulted to (remaining budget).
    const sNow = await snap();
    const maxCents = sNow.budget.budget_cents - sNow.budget.committed_cents;
    const res = await page.request.post(`${BASE}/api/shopify/search`, { data: { item: await search.inputValue(), project_id: projectId, limit: 3, max_cents: maxCents } });
    const body = (await res.json()) as { products: { normalized: { title: string; price_cents: number } | null }[] };
    const first = body.products.find((p) => p.normalized);
    if (first?.normalized) {
      const cardText = (await cards.first().innerText()).replace(/\s+/g, " ");
      const apiPrice = first.normalized.price_cents % 100 === 0 ? `$${(first.normalized.price_cents / 100).toLocaleString("en-US")}` : `$${(first.normalized.price_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const rounded = `$${Math.round(first.normalized.price_cents / 100).toLocaleString("en-US")}`;
      const shown = cardText.match(/\$[\d,.]+/)?.[0] ?? "";
      note(shown === apiPrice || shown === rounded, `search: card price "${shown}" vs API ${apiPrice} for "${first.normalized.title.slice(0, 30)}"${shown === rounded && shown !== apiPrice ? " (rounded to whole dollars; see the cents ticket)" : ""}`);
    }
    const catalogSpan = (await (await page.request.get(`${BASE}/api/projects/${projectId}/trace`)).json().catch(() => null)) as { spans?: { kind: string }[] } | null;
    note(!!catalogSpan?.spans?.some((sp) => sp.kind === "catalog"), "trace: a catalog span was recorded for the search");
  }
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  note((await page.getByText(/join/i).count()) > 0, "landing: join form present");
  await browser.close();
  console.log(findings.join("\n"));
  process.exit(findings.some((f) => f.startsWith("FAIL")) ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
