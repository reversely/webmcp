/**
 * The vendor execution agent for a Customily-personalized gift (#121, #124): holds a token for one
 * gift, reads the personalized manifest from Gather's MCP endpoint, and produces the whole batch on
 * the live storefront through the Customily adapter's three batch WebMCP tools
 * (integrations/customily/webmcp-customily.js). It carts every ready row through
 * `create_personalized_batch`, one item per product-page load and reloading between items so each
 * Customily location widget resolves on a fresh page (a reused location field never re-commits, and
 * an in-page tool cannot reload itself); the calls share one batch_id, idempotency_key, and cart.
 * The script posts one update carrying the checkout URL and the per-recipient preview URLs. Because
 * the test shop runs in test mode, it then drives the returned checkout to a placed order with
 * Shopify's Bogus Gateway test card, captures the order name, and posts it back. Playwright owns the
 * browser lifecycle; every DOM selector on the product page stays inside the adapter, so this script
 * speaks only tools there and touches raw DOM only on Shopify's own checkout.
 *
 * Run: npx tsx gather/scripts/personalize-agent.ts <base url> <event id> <token id> <gift id> [product url]
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { deliveryTarget } from "../src/lib/delivery";
import type { Venue } from "../src/domain/types";

const PROFILE = "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";
const DEFAULT_PRODUCT_URL = "https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt";
const POLYFILL = fileURLToPath(new URL("../src/webmcp/polyfill.js", import.meta.url));
const ADAPTER = fileURLToPath(new URL("../integrations/customily/webmcp-customily.js", import.meta.url));
/** The three batch tools the Customily adapter registers; the script waits for all three. */
const ADAPTER_TOOLS = ["create_personalized_batch", "get_personalization_schema", "validate_personalized_batch"];

export type ManifestRow = {
  guest_id: string;
  display_name: string;
  product_id: string | null;
  variant_id: string | null;
  personalization_status?: string;
  personalization?: Record<string, { value: unknown }>;
};

/** The `create_personalized_batch` response shape (see integrations/customily/README.md). */
export type BatchResponse = {
  batch_id: string;
  status: string;
  ready: { recipient_ref: string; cart_line_key: string; variant_id?: string; replayed?: boolean }[];
  blocked: { recipient_ref: string; issues: unknown[] }[];
  subtotal: number;
  currency: string;
  checkout_url: string;
  preview_urls: Record<string, string>;
  delivery: unknown;
};

export type PlacedOrder = { name: string; url: string };

export type CartLine = { key: string; variant_id: number; quantity: number; properties: Record<string, unknown> };

export type RunResult = { rows: number; ready: number; batch: BatchResponse; order: PlacedOrder | null; cart: CartLine[]; video: string | null };

/** The event facts the run needs off the token path: the ship-to address and the checkout contact. */
export type EventContext = {
  venue: Venue;
  delivery: { destination: "venue" | "address"; address: Venue | null; needed_by: string | null } | null;
  contact: { email: string | null; phone: string | null };
};

export type RunOptions = {
  base: string;
  eventId: string;
  token: string;
  giftId: string;
  productUrl?: string;
  /** The event's ship-to and contact; the batch's delivery and the checkout fields come from here. */
  event: EventContext;
  headless?: boolean;
  /** A directory that receives a recording of the storefront session. */
  videoDir?: string;
  /** Drive the returned checkout to a placed test order; on by default. Set false to stop at the cart. */
  placeOrder?: boolean;
};

type GatherReply = { payload: Record<string, unknown>; isError: boolean };

/** One JSON-RPC tools/call against Gather's tokenized endpoint, logged like vendor-agent.mts. */
async function callGather(opts: RunOptions, name: string, args: Record<string, unknown>, attempt = 0): Promise<GatherReply> {
  let res: Response;
  try {
    res = await fetch(`${opts.base}/api/events/${opts.eventId}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { ...args, meta: { "ucp-agent": { profile: PROFILE } } } } })
    });
  } catch (error) {
    // One retry covers a transient failure of the fetch itself before it counts as an error.
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 3_000));
      return callGather(opts, name, args, 1);
    }
    return { payload: { error: String(error) }, isError: true };
  }
  const body = (await res.json()) as { result?: { content: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (body.error) return { payload: { error: body.error.message }, isError: true };
  const text = body.result?.content?.[0]?.text ?? "null";
  console.log(`> gather ${name} ${JSON.stringify(args).slice(0, 200)}\n< ${text.slice(0, 300)}${text.length > 300 ? "..." : ""}`);
  return { payload: JSON.parse(text) as Record<string, unknown>, isError: body.result?.isError === true };
}

/** One WebMCP tool call on the storefront page through the polyfill's model context. */
async function callPage(page: Page, name: string, args: Record<string, unknown>): Promise<GatherReply> {
  type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
  let raw: { text: string; isError: boolean };
  try {
    raw = await page.evaluate(
    async ({ name, args }) => {
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "null", isError: result.isError === true };
    },
    { name, args }
    );
  } catch (error) {
    // A storefront hiccup inside the page (a challenge page, a mid-navigation call) is a failure and never a crash.
    return { payload: { error: String(error) }, isError: true };
  }
  console.log(`> page ${name} ${JSON.stringify(args).slice(0, 200)}\n< ${raw.text.slice(0, 300)}${raw.text.length > 300 ? "..." : ""}`);
  return { payload: JSON.parse(raw.text) as Record<string, unknown>, isError: raw.isError };
}

/** Waits for the adapter's three batch tools; the Customily embed keeps loading its controls after this. */
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

/** The batch's items, one per ready manifest row: recipient, variant, and each personalization value as a string. */
function itemsFrom(ready: ManifestRow[]): { recipient_ref: string; variant_id: string; personalization: Record<string, string> }[] {
  return ready.map((row) => ({
    recipient_ref: row.guest_id,
    variant_id: String(row.variant_id),
    personalization: Object.fromEntries(Object.entries(row.personalization ?? {}).map(([key, field]) => [key, String(field.value)]))
  }));
}

/**
 * The one `create_personalized_batch` call, with the challenge-page pacing #122 added: a store under
 * rapid automation serves a challenge page in place of the product, which the adapter reports as "no
 * personalization adapter"; one paced reload clears it. A pre-click read failure ("did not answer")
 * is safe to retry because nothing has been added yet, and the idempotency_key guards a real retry
 * from doubling any line.
 *
 * The batch tool registers on DOMContentLoaded but the Customily embed keeps mounting its field
 * controls for a while after, and the tool blocks any item whose control is not yet rendered rather
 * than waiting. So the call retries while every block is a still-mounting control ("control not
 * rendered" / "control not found"), which adds nothing to the cart, until the controls appear or the
 * deadline passes; once they render a real per-item issue (a flaky geocode) stops the retry.
 */
async function createBatch(page: Page, productUrl: string, args: Record<string, unknown>): Promise<BatchResponse> {
  let schema = await callPage(page, "get_personalization_schema", { product_id: args.product_id });
  if (schema.isError && JSON.stringify(schema.payload).includes("no personalization adapter")) {
    await page.waitForTimeout(10_000);
    await page.goto(productUrl, { waitUntil: "domcontentloaded" });
    await waitForTools(page);
    schema = await callPage(page, "get_personalization_schema", { product_id: args.product_id });
  }
  // The Mapbox geocoder attaches its suggestion handlers a beat after the location input mounts;
  // give it that beat so the first location fill lands on a live control (customily-live.spec).
  await page.waitForTimeout(1_500);

  const deadline = Date.now() + 120_000;
  let created = await callPage(page, "create_personalized_batch", args);
  for (;;) {
    const txt = JSON.stringify(created.payload);
    const stillMounting = created.isError && (created.payload.ready as unknown[] | undefined)?.length === 0 && (txt.includes("control not rendered") || txt.includes("control not found"));
    const preClickReadFailed = created.isError && txt.includes("did not answer");
    if ((!stillMounting && !preClickReadFailed) || Date.now() >= deadline) break;
    await page.waitForTimeout(3_000);
    created = await callPage(page, "create_personalized_batch", args);
  }
  // A batch-shaped payload (ready/blocked arrays) rides back even when items blocked, so the caller
  // can accumulate the blocks; only a non-batch failure (a page or adapter mismatch) is fatal.
  if (!Array.isArray(created.payload.ready)) throw new Error(`create_personalized_batch failed: ${JSON.stringify(created.payload)}`);
  return created.payload as unknown as BatchResponse;
}

/** Fills one input by any of the candidate selectors, returning true when one was found and set. */
async function fillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if ((await field.count()) && (await field.isVisible().catch(() => false))) {
      await field.fill(value).catch(() => undefined);
      return true;
    }
  }
  return false;
}

/** Selects one option by its value code, falling back to its visible label, on the first matching select. */
async function selectFirst(page: Page, selectors: string[], code: string, label: string): Promise<boolean> {
  for (const selector of selectors) {
    const select = page.locator(selector).first();
    if (!(await select.count())) continue;
    const set = await select.selectOption(code).then(() => true, () => false);
    if (set) return true;
    return select.selectOption({ label }).then(() => true, () => false);
  }
  return false;
}

/** Maps a US state code to its Shopify province label, so a province select keyed by label still resolves. */
const US_STATE_NAMES: Record<string, string> = { CA: "California", NY: "New York", TX: "Texas", WA: "Washington", IL: "Illinois", MA: "Massachusetts" };

/**
 * Drives the returned checkout to a placed order on the test store with Shopify's Bogus Gateway.
 * Best-effort and self-contained: any missing field, changed layout, or blocked automation returns
 * null with the reason logged, so the caller keeps the placed order optional and the batch and cart
 * assertions still pass. The test store ships to Canada only, so a US event venue falls back to a
 * Canadian placeholder address for the ship-to (the batch's delivery object holds the real intent).
 * The newer React checkout renders each card field in its own cross-origin iframe. Playwright
 * element input does not land there (#150, #124), so the card fields are driven at the CDP level: a
 * trusted mouse click focuses each field, Input.insertText types it, and each value is read back
 * before Pay. When a field will not fill, or Pay does not reach a confirmation, the caller logs the
 * exact block or decline message and returns null, which the batch and cart assertions treat as a
 * non-failure unless CUSTOMILY_REQUIRE_ORDER demands a placed order.
 */
async function placeTestOrder(page: Page, checkoutUrl: string, event: EventContext): Promise<PlacedOrder | null> {
  try {
    const target = deliveryTarget({ venue: event.venue, delivery: event.delivery ?? { destination: "venue", address: null, needed_by: null } });
    const ship = target.address;
    const email = event.contact.email ?? "orders@example.com";
    const phone = event.contact.phone ?? "4155550123";

    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4_000);

    await fillFirst(page, ['input[name="email"]', 'input#email', 'input[type="email"]'], email);

    // The test store ships to Canada only: its checkout country select offers a single option (CA),
    // so the event's US venue cannot be the ship-to for the placed order. The batch's delivery object
    // already carries the real ship-to intent; the test-mode order on the user's own store ships to a
    // valid Canadian placeholder when the store does not offer the event's country. Read the offered
    // countries, and switch to the Canadian placeholder when the venue's country is not among them.
    const countrySelect = page.locator('select[name="countryCode"], select[autocomplete*="country" i]').first();
    let addr = { country: ship.country, region: ship.region, city: ship.city, line1: ship.line1, postal: ship.postal_code, regionLabel: US_STATE_NAMES[ship.region] ?? ship.region };
    if (await countrySelect.count()) {
      const offered = await countrySelect.evaluate((s) => Array.from((s as HTMLSelectElement).options).map((o) => o.value));
      if (!offered.includes(addr.country)) {
        addr = offered.includes("CA")
          ? { country: "CA", region: "ON", city: "Toronto", line1: "123 Queen St W", postal: "M5H 2M9", regionLabel: "Ontario" }
          : { ...addr, country: offered[0] };
      }
      await countrySelect.selectOption(addr.country).catch(() => undefined);
    }
    await page.waitForTimeout(1_500);
    await fillFirst(page, ['input[name="firstName"]', 'input[autocomplete="given-name"]'], "Gather");
    await fillFirst(page, ['input[name="lastName"]', 'input[autocomplete="family-name"]'], "Vendor");
    await fillFirst(page, ['input[name="address1"]', 'input[autocomplete="shipping address-line1"]'], addr.line1);
    await fillFirst(page, ['input[name="city"]', 'input[autocomplete="shipping address-level2"]'], addr.city);
    await selectFirst(page, ['select[name="zone"]', 'select[autocomplete="shipping address-level1"]'], addr.region, addr.regionLabel);
    await fillFirst(page, ['input[name="postalCode"]', 'input[autocomplete="shipping postal-code"]'], addr.postal);
    await fillFirst(page, ['input[name="phone"]', 'input[autocomplete="shipping tel"]'], phone);
    // The shipping rates recompute once the address is valid; pick the first rate so the payment
    // section renders, then let it settle.
    await page.waitForTimeout(3_000);
    const rate = page.locator('input[type="radio"][name*="delivery" i], [role="radio"]').first();
    if (await rate.count()) await rate.check().catch(() => undefined);
    await page.waitForTimeout(3_000);
    // Bring the payment section into view so its (possibly lazy) card iframes mount.
    await page.mouse.wheel(0, 2000).catch(() => undefined);
    await page.waitForTimeout(2_000);

    // Each card field is a separate cross-origin iframe (name/title containing card-fields-<field>).
    // The newer React checkout takes a Luhn-valid test number (the classic Bogus "1" is rejected),
    // but its expiry and security-code iframes reject Playwright element input: focus/click +
    // pressSequentially do not land and the number field does not auto-advance (#150, #124). So the
    // fields are driven at the CDP level instead. A trusted mouse click at the iframe's on-page
    // coordinates focuses the field's own input, then Input.insertText delivers a trusted text-input
    // event; where insertText alone does not stick, the value is retyped digit by digit with
    // Input.dispatchKeyEvent. Each field's value is read back before Pay so a field that would not
    // fill is reported rather than silently sent.
    const card = process.env.CUSTOMILY_TEST_CARD || "4242424242424242";
    const cdp = await page.context().newCDPSession(page);
    const cdpSend = (method: string, params: Record<string, unknown>) =>
      (cdp as unknown as { send(m: string, p: Record<string, unknown>): Promise<unknown> }).send(method, params);

    // Focuses one card iframe with a trusted click at its centre, types the value with
    // Input.insertText, and, if the field did not take it, retypes it digit by digit. Returns the
    // value the field holds afterward (empty when the field could not be filled).
    const fillCardFrame = async (namePart: string, value: string): Promise<string> => {
      const frameEl = page.locator(`iframe[name*="${namePart}"], iframe[title*="${namePart}"]`).first();
      if (!(await frameEl.count())) return "";
      await frameEl.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
      const box = await frameEl.boundingBox();
      if (!box) return "";
      const input = page.frameLocator(`iframe[name*="${namePart}"], iframe[title*="${namePart}"]`).locator("input").first();
      const readValue = async () => (await input.inputValue().catch(() => "")) ?? "";

      const focusAndType = async (text: string) => {
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await cdpSend("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
        await cdpSend("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
        await page.waitForTimeout(150);
        await cdpSend("Input.insertText", { text });
        await page.waitForTimeout(200);
      };

      await focusAndType(value);
      if ((await readValue()).replace(/\D/g, "").length < value.replace(/\D/g, "").length) {
        // insertText did not stick; retype digit by digit as trusted key events.
        for (const ch of value) {
          await cdpSend("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
          await cdpSend("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch });
          await cdpSend("Input.dispatchKeyEvent", { type: "keyUp", text: ch, key: ch });
          await page.waitForTimeout(40);
        }
        await page.waitForTimeout(200);
      }
      return readValue();
    };

    const numberVal = await fillCardFrame("card-fields-number", card);
    const expiryVal = await fillCardFrame("card-fields-expiry", "1230");
    const cvvVal = await fillCardFrame("card-fields-verification_value", "123");
    await fillCardFrame("card-fields-name", "Gather Vendor");
    // A field that would not hold its value is the true ceiling; report which one and stop.
    const unfilled = [
      numberVal.replace(/\D/g, "").length ? null : "number",
      expiryVal.replace(/\D/g, "").length ? null : "expiry",
      cvvVal.replace(/\D/g, "").length ? null : "security-code"
    ].filter(Boolean);
    if (unfilled.length) {
      console.log(`checkout: the card ${unfilled.join(", ")} field(s) would not accept CDP input (number=${numberVal || "-"} expiry=${expiryVal || "-"} cvv=${cvvVal || "-"}); reporting the block`);
      return null;
    }
    console.log(`checkout: card fields filled via CDP (number=${numberVal} expiry=${expiryVal} cvv=${cvvVal})`);
    await page.waitForTimeout(1_000);

    // Submit: the newer checkout labels the button "Pay now"; the classic one uses id continue_button.
    const pay = page.getByRole("button", { name: /pay now|complete order|^pay$/i }).first();
    if (await pay.count()) await pay.click().catch(() => undefined);
    else await page.locator("#continue_button").click().catch(() => undefined);

    // The thank-you page carries the order name in its heading and a /orders/ URL. If Pay does not
    // reach it, capture any inline decline/error text so the true ceiling is reported, not swallowed.
    try {
      await page.waitForURL(/\/(thank[_-]?you|orders)\b|thank_you/i, { timeout: 60_000 });
    } catch {
      const decline = (await page
        .locator('[role="alert"], [id*="error" i], [class*="error" i], [class*="banner" i]')
        .first()
        .textContent()
        .catch(() => null))?.trim();
      console.log(`checkout: Pay did not reach a confirmation (at ${page.url()})${decline ? `; message: ${decline}` : "; no inline message found"}`);
      return null;
    }
    await page.waitForTimeout(2_000);
    const heading = (await page.getByText(/order\s+#?\w+/i).first().textContent().catch(() => null)) ?? "";
    const match = heading.match(/#\s?\w+/) ?? (await page.title()).match(/#\s?\w+/);
    const name = match ? match[0].replace(/\s/g, "") : "";
    if (!name) {
      console.log(`checkout: reached ${page.url()} but no order name was on the page`);
      return null;
    }
    return { name, url: page.url() };
  } catch (error) {
    console.log(`checkout: could not complete the order (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

/**
 * The current storefront cart as /cart.js reports it. Under rapid automation Shopify sometimes
 * answers /cart.js with a challenge HTML page instead of JSON (#122); this reads the body as text,
 * treats a non-JSON answer as a challenge, and retries after a paced reload that clears it.
 */
async function readCart(page: Page): Promise<CartLine[]> {
  for (let attempt = 0; ; attempt++) {
    const cart = await page.evaluate(async () => {
      try {
        const res = await fetch("/cart.js", { headers: { accept: "application/json" } });
        const text = await res.text();
        if (!res.ok || text.trimStart().startsWith("<")) return null;
        const data = JSON.parse(text) as { items: { key: string; variant_id: number; quantity: number; properties: Record<string, unknown> | null }[] };
        return data.items.map((i) => ({ key: i.key, variant_id: i.variant_id, quantity: i.quantity, properties: i.properties ?? {} }));
      } catch {
        return null;
      }
    });
    if (cart) return cart;
    if (attempt >= 4) throw new Error("the cart did not answer with JSON after retries; a challenge page may be standing in");
    await page.waitForTimeout(8_000);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  }
}

/**
 * The whole run: manifest in, the ready rows carted through `create_personalized_batch` (one item
 * per product-page load, reloading between them so each Customily location resolves on a fresh
 * widget), one update back to Gather with the checkout URL and preview URLs, then the test-mode
 * checkout driven to a placed order whose name goes back on a second update. The storefront cart
 * accumulates in one browser session so the checkout binds to it.
 */
export async function runPersonalization(opts: RunOptions): Promise<RunResult> {
  const productUrl = opts.productUrl ?? DEFAULT_PRODUCT_URL;
  const manifest = await callGather(opts, "get_manifest", { gift_id: opts.giftId });
  if (manifest.isError) throw new Error(`get_manifest failed: ${JSON.stringify(manifest.payload)}`);
  const rows = (manifest.payload.rows as ManifestRow[] | undefined) ?? [];
  const ready = rows.filter((r) => r.personalization_status === "ready");
  console.log(`${rows.length} manifest rows and ${ready.length} ready to personalize`);
  if (ready.length === 0) throw new Error("no manifest row is ready to personalize");

  const productId = String(ready[0].product_id);
  const target = deliveryTarget({ venue: opts.event.venue, delivery: opts.event.delivery ?? { destination: "venue", address: null, needed_by: null } });
  const delivery = { type: "single_address", address_ref: target.label };
  const batchId = `batch-${opts.eventId}-${opts.giftId}`;
  // The key is stable per event and gift, so a re-run replays the cart lines instead of doubling
  // them; a fresh event id per run keeps runs from colliding. No plan revision is on the token path.
  const idempotencyKey = `${opts.eventId}:${opts.giftId}`;
  const batchArgs = { batch_id: batchId, product_id: productId, delivery, idempotency_key: idempotencyKey };

  const browser = await chromium.launch({ headless: opts.headless ?? true });
  let batch: BatchResponse;
  let order: PlacedOrder | null = null;
  let cart: CartLine[] = [];
  let video: ReturnType<Page["video"]> = null;
  try {
    // One context so the storefront cart cookie holds every line and the checkout binds to it.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(opts.videoDir ? { recordVideo: { dir: opts.videoDir, size: { width: 1440, height: 900 } } } : {}) });
    await context.addInitScript({ path: POLYFILL });
    await context.addInitScript({ path: ADAPTER });
    const page = await context.newPage();
    await page.goto(productUrl, { waitUntil: "domcontentloaded" });
    await waitForTools(page);

    // Configure and cart the batch one item at a time, reloading the product page between items:
    // the Customily location widget commits coordinates only on a fresh page (a second item retyping
    // into the used field never re-commits), and an in-page tool cannot reload itself, so the reset
    // that #122's per-unit driver got from page.goto lives here. Every call shares the batch_id,
    // idempotency_key, and cart cookie, so the sessionStorage idempotency record and the running
    // cart accumulate across the reloads and a re-run replays rather than doubling any line.
    const items = itemsFrom(ready);
    const readyEntries: BatchResponse["ready"] = [];
    const blockedEntries: BatchResponse["blocked"] = [];
    const previewUrls: Record<string, string> = {};
    let lastResp: BatchResponse | null = null;
    for (let i = 0; i < items.length; i++) {
      if (i > 0) {
        await page.goto(productUrl, { waitUntil: "domcontentloaded" });
        await waitForTools(page);
      }
      const resp = await createBatch(page, productUrl, { ...batchArgs, items: [items[i]] });
      readyEntries.push(...resp.ready);
      blockedEntries.push(...resp.blocked);
      Object.assign(previewUrls, resp.preview_urls);
      lastResp = resp;
    }
    batch = { batch_id: batchId, status: "prepared", ready: readyEntries, blocked: blockedEntries, subtotal: lastResp!.subtotal, currency: lastResp!.currency, checkout_url: lastResp!.checkout_url, preview_urls: previewUrls, delivery: lastResp!.delivery };
    console.log(`batch ${batch.batch_id}: ${batch.ready.length} ready, ${batch.blocked.length} blocked, subtotal ${batch.subtotal} ${batch.currency}`);

    // One update carrying the checkout URL and the per-recipient preview URLs.
    await callGather(opts, "post_update", {
      gift_id: opts.giftId,
      kind: "in_production",
      text: JSON.stringify({ batch_id: batch.batch_id, checkout_url: batch.checkout_url, preview_urls: batch.preview_urls }),
      reference: batch.checkout_url
    });

    cart = await readCart(page);

    if (opts.placeOrder ?? true) {
      order = await placeTestOrder(page, batch.checkout_url, opts.event);
      if (order) {
        await callGather(opts, "post_update", {
          gift_id: opts.giftId,
          kind: "in_production",
          text: JSON.stringify({ order_name: order.name, checkout_url: batch.checkout_url }),
          reference: order.name
        });
      }
    }
    video = page.video();
  } finally {
    await browser.close();
  }
  const videoPath = video ? await video.path() : null;
  console.log(`batch ready ${batch!.ready.length}, cart ${cart.length} lines, order ${order?.name ?? "not placed"}`);
  if (videoPath) console.log(`video ${videoPath}`);
  return { rows: rows.length, ready: ready.length, batch: batch!, order, cart, video: videoPath };
}

/* ---- CLI ---- */

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  const [base, eventId, token, giftId, productUrl] = process.argv.slice(2);
  if (!base || !eventId || !token || !giftId) {
    console.error("usage: personalize-agent.ts <base url> <event id> <token id> <gift id> [product url]");
    process.exit(2);
  }
  // The CLI has no event on the token path, so it ships to a placeholder US address and stops at the
  // cart; the live spec supplies the real event context and drives the order.
  const event: EventContext = { venue: { name: "Pickup", line1: "1 Test St", city: "Los Angeles", region: "CA", postal_code: "90027", country: "US" }, delivery: null, contact: { email: null, phone: null } };
  runPersonalization({ base, eventId, token, giftId, productUrl, event, placeOrder: false }).then(
    (result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.batch.blocked.length === 0 ? 0 : 1;
    },
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  );
}
