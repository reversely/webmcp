/**
 * The vendor execution agent for a Customily-personalized gift (#121, spec Section 8): holds a
 * token for one gift, reads the personalized manifest from Gather's MCP endpoint, and produces
 * one unit per ready row on the live storefront through the WebMCP tools the Customily adapter
 * registers (integrations/customily/webmcp-customily.js). Playwright owns the browser lifecycle;
 * every DOM selector stays inside the adapter, so this script speaks only tools. Each unit's
 * outcome goes back through post_update with the Gather guest_id as the recipient reference.
 * The cart accumulates in one browser session; nothing here reaches checkout.
 *
 * Run: npx tsx gather/scripts/personalize-agent.ts <base url> <event id> <token id> <gift id> [product url]
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

const PROFILE = "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";
const DEFAULT_PRODUCT_URL = "https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt";
const POLYFILL = fileURLToPath(new URL("../src/webmcp/polyfill.js", import.meta.url));
const ADAPTER = fileURLToPath(new URL("../integrations/customily/webmcp-customily.js", import.meta.url));
const ADAPTER_TOOLS = ["add_personalized_unit_to_cart", "configure_personalized_unit", "get_personalization_preview", "get_personalization_schema"];

export type ManifestRow = {
  guest_id: string;
  display_name: string;
  variant_id: string | null;
  personalization_status?: string;
  personalization?: Record<string, { value: unknown }>;
};

export type UnitOutcome = {
  guest_id: string;
  ok: boolean;
  variant_id?: string;
  cart_line_key?: string;
  properties?: Record<string, unknown>;
  preview_id?: string;
  error?: string;
};

export type CartLine = { key: string; variant_id: number; quantity: number; properties: Record<string, unknown> };

export type RunResult = { rows: number; ready: number; units: UnitOutcome[]; cart: CartLine[] };

export type RunOptions = {
  base: string;
  eventId: string;
  token: string;
  giftId: string;
  productUrl?: string;
  headless?: boolean;
};

type GatherReply = { payload: Record<string, unknown>; isError: boolean };

/** One JSON-RPC tools/call against Gather's tokenized endpoint, logged like vendor-agent.mts. */
async function callGather(opts: RunOptions, name: string, args: Record<string, unknown>): Promise<GatherReply> {
  const res = await fetch(`${opts.base}/api/events/${opts.eventId}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { ...args, meta: { "ucp-agent": { profile: PROFILE } } } } })
  });
  const body = (await res.json()) as { result?: { content: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (body.error) return { payload: { error: body.error.message }, isError: true };
  const text = body.result?.content?.[0]?.text ?? "null";
  console.log(`> gather ${name} ${JSON.stringify(args).slice(0, 200)}\n< ${text.slice(0, 300)}${text.length > 300 ? "..." : ""}`);
  return { payload: JSON.parse(text) as Record<string, unknown>, isError: body.result?.isError === true };
}

/** One WebMCP tool call on the storefront page through the polyfill's model context. */
async function callPage(page: Page, name: string, args: Record<string, unknown>): Promise<GatherReply> {
  type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
  const raw = await page.evaluate(
    async ({ name, args }) => {
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "null", isError: result.isError === true };
    },
    { name, args }
  );
  console.log(`> page ${name} ${JSON.stringify(args).slice(0, 200)}\n< ${raw.text.slice(0, 300)}${raw.text.length > 300 ? "..." : ""}`);
  return { payload: JSON.parse(raw.text) as Record<string, unknown>, isError: raw.isError };
}

/** Waits for the adapter's four tools; the Customily embed keeps loading its controls after this. */
async function waitForTools(page: Page): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const ctx = document.modelContext as unknown as { getTools(): Promise<{ name: string }[]> } | undefined;
      if (!ctx) return false;
      return ctx.getTools().then((tools) => expected.every((name) => tools.some((t) => t.name === name)));
    },
    ADAPTER_TOOLS,
    { timeout: 60_000 }
  );
}

/**
 * Configures the unit, retrying while the Customily embed is still mounting its controls: the
 * adapter answers "control not found" until the embed renders, and the script has no cheaper
 * signal because the DOM stays behind the tools.
 */
async function configureWithRetry(page: Page, args: Record<string, unknown>): Promise<GatherReply> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const reply = await callPage(page, "configure_personalized_unit", args);
    const stillMounting = reply.isError && JSON.stringify(reply.payload).includes("control not found");
    if (!stillMounting || Date.now() >= deadline) return reply;
    await page.waitForTimeout(5_000);
  }
}

/** Produces one unit on the already-loaded product page and returns its outcome. */
async function produceUnit(page: Page, row: ManifestRow): Promise<UnitOutcome> {
  const guest = row.guest_id;
  if (!row.variant_id) return { guest_id: guest, ok: false, error: "the manifest row names no variant" };

  const schema = await callPage(page, "get_personalization_schema", {});
  if (schema.isError) return { guest_id: guest, ok: false, error: `get_personalization_schema failed: ${JSON.stringify(schema.payload)}` };
  const known = new Set(((schema.payload.fields as { key: string }[] | undefined) ?? []).map((f) => f.key));
  const values: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(row.personalization ?? {})) {
    if (!known.has(key)) return { guest_id: guest, ok: false, error: `the product schema has no field ${key}` };
    values[key] = field.value;
  }

  const configured = await configureWithRetry(page, { recipient_ref: guest, variant_id: row.variant_id, values });
  if (configured.isError) return { guest_id: guest, ok: false, error: `configure failed: ${JSON.stringify(configured.payload)}` };

  const preview = await callPage(page, "get_personalization_preview", { recipient_ref: guest });
  if (preview.isError || preview.payload.ready !== true) return { guest_id: guest, ok: false, error: `preview not ready: ${JSON.stringify(preview.payload)}` };

  const added = await callPage(page, "add_personalized_unit_to_cart", { recipient_ref: guest });
  if (added.isError) return { guest_id: guest, ok: false, error: `add to cart failed: ${JSON.stringify(added.payload)}` };
  return {
    guest_id: guest,
    ok: true,
    variant_id: String(added.payload.variant_id),
    cart_line_key: String(added.payload.cart_line_key),
    properties: (added.payload.properties as Record<string, unknown>) ?? {},
    preview_id: String(added.payload.preview_id ?? "")
  };
}

/**
 * The whole run: manifest in, one configured and carted unit per ready row, an update per unit
 * back to Gather, and the storefront cart as /cart.js reports it. Stops before any checkout.
 */
export async function runPersonalization(opts: RunOptions): Promise<RunResult> {
  const productUrl = opts.productUrl ?? DEFAULT_PRODUCT_URL;
  const manifest = await callGather(opts, "get_manifest", { gift_id: opts.giftId });
  if (manifest.isError) throw new Error(`get_manifest failed: ${JSON.stringify(manifest.payload)}`);
  const rows = (manifest.payload.rows as ManifestRow[] | undefined) ?? [];
  const ready = rows.filter((r) => r.personalization_status === "ready");
  console.log(`${rows.length} manifest rows and ${ready.length} ready to personalize`);

  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const units: UnitOutcome[] = [];
  let cart: CartLine[] = [];
  try {
    // One context so the storefront cart cookie accumulates every unit of this run.
    const context = await browser.newContext();
    await context.addInitScript({ path: POLYFILL });
    await context.addInitScript({ path: ADAPTER });
    const page = await context.newPage();
    for (const row of ready) {
      // A fresh load per unit: the adapter holds one live configuration at a time and the
      // storefront may navigate after its own add-to-cart.
      await page.goto(productUrl, { waitUntil: "domcontentloaded" });
      await waitForTools(page);
      const outcome = await produceUnit(page, row);
      units.push(outcome);
      const update = outcome.ok
        ? { kind: "in_production", text: `unit for ${row.display_name} is in the cart as line ${outcome.cart_line_key}`, reference: outcome.cart_line_key, guest_id: row.guest_id }
        : { kind: "issue", text: `unit for ${row.display_name} failed: ${outcome.error}`.slice(0, 500), guest_id: row.guest_id };
      await callGather(opts, "post_update", { gift_id: opts.giftId, ...update });
    }
    cart = await page.evaluate(async () => {
      const res = await fetch("/cart.js");
      const data = (await res.json()) as { items: { key: string; variant_id: number; quantity: number; properties: Record<string, unknown> | null }[] };
      return data.items.map((i) => ({ key: i.key, variant_id: i.variant_id, quantity: i.quantity, properties: i.properties ?? {} }));
    });
  } finally {
    await browser.close();
  }
  console.log(`produced ${units.filter((u) => u.ok).length} of ${ready.length} units and the cart holds ${cart.length} lines`);
  return { rows: rows.length, ready: ready.length, units, cart };
}

/* ---- CLI ---- */

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  const [base, eventId, token, giftId, productUrl] = process.argv.slice(2);
  if (!base || !eventId || !token || !giftId) {
    console.error("usage: personalize-agent.ts <base url> <event id> <token id> <gift id> [product url]");
    process.exit(2);
  }
  runPersonalization({ base, eventId, token, giftId, productUrl }).then(
    (result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.units.every((u) => u.ok) ? 0 : 1;
    },
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  );
}
