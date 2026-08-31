import { beforeEach, describe, expect, it } from "vitest";
import { publishEvent, resetState } from "../domain/store";
import { getGift } from "../domain/gifts";
import { createEventFromBody, createGiftFromBody, patchRsvp, snapshot, submitRsvp, updatesFor } from "../server/api";
import { cartView, setCartDeps } from "../server/cart-api";
import type { CartDeps } from "./cart";
import { bandPrice, printshopCandidates, printshopClient, printshopHost, type Design, type ShopBatch } from "./printshop";
import { approveGift, isPrintshopGift, pollBatch, refreshCart, sendGift, syncGift, unitsFor } from "./printshop-cart";
import { emptyFunnel, rank, sourcesForSentence, cardsConfig, type Candidate, type EventContext } from "./search";

const URL_ = "http://localhost:3114";
const TODAY = new Date("2029-12-01T12:00:00Z");
const BUYER = { email: "organizer@example.com", phone_number: "+10000000000" };
const EVENT = { title: "Test event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" }, rsvp_deadline: "2030-01-03", delivery: { destination: "venue", address: null, needed_by: "2030-01-10" } };
const CTX: EventContext = { event_date: "2030-01-10", venue: EVENT.venue, budget_cents: 2000, quantity: 20, today: "2029-12-01" };

const FLAT: Design = { id: "thank-you-flat-a2", title: "Thank you flat card", format: "flat", size: "A2", paper: "cotton", print_method: "digital", colours: ["white", "cream"], price_bands: [{ min_quantity: 1, unit_cents: 320 }, { min_quantity: 50, unit_cents: 240 }], lead_time_business_days: 4, minimum_quantity: 1, fields: [{ key: "name", label: "Name", kind: "name", max_length: 32, required: true }, { key: "line", label: "Line", kind: "text", max_length: 90, required: false }], image: null };
const FOLDED: Design = { ...FLAT, id: "note-card-folded-a6", title: "Folded note card", colours: ["white"], price_bands: [{ min_quantity: 25, unit_cents: 410 }], minimum_quantity: 25, fields: [{ key: "name", label: "Name", kind: "name", max_length: 3, required: true }] };

type Call = { tool: string; args: Record<string, any>; meta: Record<string, any> };

/** The shop behind a fake fetch at /api/mcp: two designs, a quote that refuses below the minimum, batches with the validation the shop applies, and a change feed. */
function fakeShop() {
  const shop = { calls: [] as Call[], batches: new Map<string, ShopBatch>(), seq: 0, changes: [] as { seq: number; at: string; batch_id: string; kind: string; text: string }[] };
  const designs = [FLAT, FOLDED];
  const design = (id: string) => designs.find((d) => d.id === id)!;
  const record = (batch: ShopBatch, from: "shop" | "buyer", kind: string, text: string, reference: string | null = null) => {
    shop.seq += 1;
    shop.changes.push({ seq: shop.seq, at: "2029-12-01T12:00:00Z", batch_id: batch.id, kind, text });
    batch.thread.push({ seq: shop.seq, at: "2029-12-01T12:00:00Z", from, kind, text, reference });
  };
  const quote = (d: Design, quantity: number) => {
    if (quantity < d.minimum_quantity) throw new Error(`minimum_quantity: Minimum ${d.minimum_quantity} units for ${d.title}`);
    const unit = bandPrice(d, quantity);
    return { unit_cents: unit, quantity, subtotal_cents: unit * quantity, tax_cents: Math.round(unit * quantity * 0.13), total_cents: Math.round(unit * quantity * 1.13), ready_by: "2029-12-06", currency: "CAD" };
  };
  const issues = (d: Design, units: ShopBatch["units"]) => units.flatMap((u) => d.fields.flatMap((f) => (f.required && !u.values[f.key] ? [{ recipient_ref: u.recipient_ref, field: f.key, reason: "missing" }] : (u.values[f.key] ?? "").length > (f.max_length ?? Infinity) ? [{ recipient_ref: u.recipient_ref, field: f.key, reason: `over ${f.max_length}` }] : [])));
  const reply = (tool: string, args: Record<string, any>): unknown => {
    switch (tool) {
      case "list_designs":
        return { designs: designs.filter((d) => args.max_unit_cents === undefined || Math.min(...d.price_bands.map((b) => b.unit_cents)) <= args.max_unit_cents) };
      case "get_design":
        return design(args.design_id);
      case "quote_batch":
        return { design_id: args.design_id, ...quote(design(args.design_id), args.quantity) };
      case "create_batch": {
        const d = design(args.design_id);
        const batch: ShopBatch = { id: `batch_${shop.batches.size + 1}`, design_id: d.id, status: "quoted", units: args.units, quote: quote(d, args.units.length), proof: null, issues: issues(d, args.units), thread: [] };
        shop.batches.set(batch.id, batch);
        record(batch, "shop", "quoted", "Quoted");
        return batch;
      }
      case "update_batch": {
        const batch = shop.batches.get(args.batch_id)!;
        if (batch.status !== "quoted") throw new Error(`Batch ${batch.id} is ${batch.status}`);
        Object.assign(batch, { units: args.units, quote: quote(design(batch.design_id), args.units.length), issues: issues(design(batch.design_id), args.units) });
        record(batch, "shop", "requoted", "Requoted");
        return batch;
      }
      case "order_batch": {
        const batch = shop.batches.get(args.batch_id)!;
        if (batch.issues.length) throw new Error(`${batch.issues.length} units have issues`);
        batch.status = "proofed";
        batch.proof = batch.units.map((u) => ({ recipient_ref: u.recipient_ref, svg: "<svg/>" }));
        record(batch, "shop", "ordered", "Ordered");
        record(batch, "shop", "proof", "Proof ready");
        return batch;
      }
      case "approve_proof": {
        const batch = shop.batches.get(args.batch_id)!;
        if (batch.status !== "proofed") throw new Error(`Batch ${batch.id} is ${batch.status}`);
        batch.status = "approved";
        record(batch, "buyer", "approved", "Proof approved");
        return batch;
      }
      case "get_batch":
        return shop.batches.get(args.batch_id);
      case "get_changes":
        return { since: args.since_seq, seq: shop.seq, entries: shop.changes.filter((c) => c.seq > args.since_seq) };
      default:
        throw new Error(`The fake shop has no ${tool}.`);
    }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    expect(String(input)).toBe(`${URL_}/api/mcp`);
    const body = JSON.parse(String(init?.body));
    const { meta, ...args } = body.params.arguments;
    shop.calls.push({ tool: body.params.name, args, meta });
    let result: unknown;
    try {
      result = { content: [{ type: "text", text: JSON.stringify(reply(body.params.name, args)) }] };
    } catch (e) {
      result = { content: [{ type: "text", text: JSON.stringify({ error: (e as Error).message }) }], isError: true };
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  };
  const client = (buyerEmail: string | null = null) => printshopClient({ url: URL_, buyerEmail, fetchImpl });
  const deps: CartDeps = { client: () => { throw new Error("no catalog"); }, now: () => TODAY, printshop: client };
  const advance = (batchId: string, kind: string, text: string, reference: string | null = null, from: "shop" | "buyer" = "shop") => record(shop.batches.get(batchId)!, from, kind, text, reference);
  return { ...shop, client, deps, advance, of: (tool: string) => shop.calls.filter((c) => c.tool === tool), batch: (id: string) => shop.batches.get(id)! };
}

/** A published event with the seeded printed-name question, three guests (two going, one maybe), and a gift on the flat card. */
function seed(names: (string | undefined)[] = ["Ada", "Ben"]) {
  const event = publishEvent(createEventFromBody(EVENT).id);
  const printed = snapshot(event.id).definitions.find((d) => d.key === "printed_name")!;
  const reply = submitRsvp(event.id, {
    party: { contact: { email: BUYER.email } },
    guests: [
      { display_name: "Guest One", status: "going", answers: names[0] ? { [printed.id]: names[0] } : {} },
      { display_name: "Guest Two", status: "going", answers: names[1] ? { [printed.id]: names[1] } : {} },
      { display_name: "Guest Three", status: "maybe" }
    ]
  });
  const gift = createGiftFromBody(event.id, { product_id: FLAT.id, shop_domain: printshopHost(), product_title: FLAT.title, variants: [{ id: `${FLAT.id}:white`, title: "white", price_cents: 320, currency: "CAD" }], default_variant_id: `${FLAT.id}:white` });
  return { event, printed, gift, guestIds: reply.guest_ids };
}

describe("the print shop as a search source", () => {
  it("lists every design under the budget with a colour per variant, the band price, the quote's ready-by as the window, and the refusal as the verdict", async () => {
    const shop = fakeShop();
    const funnel = emptyFunnel();
    const found = await printshopCandidates(CTX, shop.client(), funnel);
    expect(shop.of("list_designs")[0].args).toEqual({ max_unit_cents: 2000 });
    expect(shop.of("list_designs")[0].meta).toEqual({ "ucp-agent": { profile: expect.stringContaining("https://") } });
    expect(shop.of("quote_batch")[0].args).toEqual({ design_id: FLAT.id, quantity: 20, needed_by: "2030-01-10", address: EVENT.venue });
    expect(funnel.searches).toEqual([{ query: "printshop", returned: 2, total: 2 }]);
    const [flat, folded] = found;
    expect(flat).toMatchObject({ product_id: FLAT.id, shop_domain: "localhost:3114", price_cents: 320, currency: "CAD", searches: ["printshop"], option_names: ["Colour"], personalization: { fields: FLAT.fields } });
    expect(flat.variants).toEqual([
      { id: `${FLAT.id}:white`, title: "white", price_cents: 320, currency: "CAD", available: true, options: [{ name: "Colour", label: "white" }] },
      { id: `${FLAT.id}:cream`, title: "cream", price_cents: 320, currency: "CAD", available: true, options: [{ name: "Colour", label: "cream" }] }
    ]);
    expect(flat.delivery).toEqual({ window: { earliest: "2029-12-06", latest: "2029-12-06" }, text: "Ready by 2029-12-06", confidence: "dated", verdict: "quoted", error: null });
    expect(folded.delivery).toMatchObject({ window: null, verdict: "refused", error: "minimum_quantity: Minimum 25 units for Folded note card" });
    expect(bandPrice(FLAT, 60)).toBe(240);
    expect(bandPrice(FLAT, 5)).toBe(320);
  });

  it("ranks a design among catalog candidates by the same rules", async () => {
    const shop = fakeShop();
    const found = await printshopCandidates(CTX, shop.client());
    const catalog: Candidate = { product_id: "p1", title: "Product", description: "", url: null, image_url: null, shop_domain: "a.myshopify.com", shop_name: "A", shop_url: null, policy_links: [], price_cents: 1500, currency: "CAD", variants: [{ id: "v1", title: "Default", price_cents: 1500, currency: "CAD", available: true, options: [] }], option_names: [], searches: ["gift sets"], delivery: null };
    const { ranked, excluded } = rank([catalog, ...found], CTX);
    expect(ranked.map((r) => r.product_id)).toEqual([FLAT.id, "p1"]);
    expect(excluded.map((e) => [e.product_id, e.verdict.rule])).toEqual([[FOLDED.id, "ships_to_venue"]]);
  });

  it("the stationery card and a sentence naming cards search the shop; the other cards search the catalog alone", () => {
    const cards = cardsConfig().cards;
    expect(cards.find((c) => c.key === "stationery")?.sources).toEqual(["shopify", "printshop"]);
    expect(cards.find((c) => c.key === "food_drink")?.sources).toEqual(["shopify"]);
    expect(sourcesForSentence("a thank-you card for each guest")).toEqual(["shopify", "printshop"]);
    expect(sourcesForSentence("some stationery for the kids")).toEqual(["shopify", "printshop"]);
    expect(sourcesForSentence("a dessert box")).toEqual(["shopify"]);
  });
});

describe("a gift on a print-shop design", () => {
  beforeEach(resetState);

  it("send creates the batch with one unit per going guest carrying the printed name only, orders it, and stores the quote as the proposal", async () => {
    const shop = fakeShop();
    const { event, gift, guestIds } = seed();
    expect(isPrintshopGift(getGift(gift.id))).toBe(true);
    const proposal = await sendGift(event.id, gift.id, shop.deps, BUYER);
    const [create] = shop.of("create_batch");
    expect(create.meta.buyer_email).toBe(BUYER.email);
    expect(create.args).toEqual({ design_id: FLAT.id, units: [{ recipient_ref: guestIds[0], values: { name: "Ada" } }, { recipient_ref: guestIds[1], values: { name: "Ben" } }], address: EVENT.venue, needed_by: "2030-01-10", buyer: { name: "Host", email: BUYER.email, phone: BUYER.phone_number } });
    expect(shop.of("order_batch")).toHaveLength(1);
    expect(shop.batch("batch_1").status).toBe("proofed");
    expect(proposal).toEqual({ cart_id: "batch_1", currency: "CAD", lines: [{ variant_id: `${FLAT.id}:white`, title: "white", unit_price: 320, quantity: 2, total: 640 }], total: 723, continue_url: null });
    expect(getGift(gift.id)).toMatchObject({ cart_id: "batch_1", order_id: "batch_1", proposal, buyer: BUYER });
    await expect(sendGift(event.id, gift.id, shop.deps, BUYER)).rejects.toThrow(/ordered/);
  });

  it("a missing name leaves the batch quoted with a follow-up naming the guest, and a later send orders it", async () => {
    const shop = fakeShop();
    const { event, gift, printed, guestIds } = seed(["Ada", undefined]);
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    expect(shop.of("order_batch")).toHaveLength(0);
    expect(getGift(gift.id)).toMatchObject({ cart_id: "batch_1", order_id: null });
    const { follow_ups } = await refreshCart(event.id, gift.id, shop.deps);
    expect(follow_ups).toEqual([{ kind: "unit_issue", definition_id: null, status: null, guest_ids: [guestIds[1]], deadline: null, gift_id: gift.id, field: "name", reason: "missing" }]);
    patchRsvp(event.id, guestIds[1], { answers: { [printed.id]: "Ben" } });
    await sendGift(event.id, gift.id, shop.deps);
    expect(shop.of("update_batch")[0].args.units[1]).toEqual({ recipient_ref: guestIds[1], values: { name: "Ben" } });
    expect(getGift(gift.id).order_id).toBe("batch_1");
  });

  it("sync rewrites the units after an RSVP write while the batch is quoted and stops once it is ordered", async () => {
    const shop = fakeShop();
    const { event, gift, guestIds } = seed(["Ada", undefined]);
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    expect(await syncGift(event.id, gift.id, shop.deps)).toMatchObject({ updated: false });
    patchRsvp(event.id, guestIds[1], { status: "cant_go" });
    const synced = await syncGift(event.id, gift.id, shop.deps);
    expect(synced.updated).toBe(true);
    expect(shop.of("update_batch")[0].args.units).toEqual([{ recipient_ref: guestIds[0], values: { name: "Ada" } }]);
    expect(synced.proposal?.lines[0].quantity).toBe(1);
    await sendGift(event.id, gift.id, shop.deps);
    patchRsvp(event.id, guestIds[2], { status: "going" });
    expect(await syncGift(event.id, gift.id, shop.deps)).toMatchObject({ updated: false });
  });

  it("a name over the design's max_length comes back as an issue naming the guest", async () => {
    const shop = fakeShop();
    const { event, gift, guestIds } = seed(["Ada", "B".repeat(33)]);
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    expect(shop.of("order_batch")).toHaveLength(0);
    const { follow_ups } = await refreshCart(event.id, gift.id, shop.deps);
    expect(follow_ups.map((f) => [f.guest_ids[0], f.reason])).toEqual([[guestIds[1], "over 32"]]);
  });

  it("approve needs an ordered batch, approves the proof at the shop, and locks the gift on the day", async () => {
    const shop = fakeShop();
    const { event, gift, guestIds } = seed();
    await expect(approveGift(event.id, gift.id, shop.deps)).rejects.toThrow(/Send the gift/);
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    const approved = await approveGift(event.id, gift.id, shop.deps);
    expect(shop.of("approve_proof")[0].args).toEqual({ batch_id: "batch_1" });
    expect(shop.batch("batch_1").status).toBe("approved");
    expect(approved).toMatchObject({ approved_at: TODAY.toISOString(), cutoff: "2029-12-01", locked_at: "2029-12-01", locked_guest_ids: [guestIds[0], guestIds[1]] });
  });

  it("the change feed writes the proof, the stages with their reference, and the shop's messages to the thread once each", async () => {
    const shop = fakeShop();
    const { event, gift } = seed();
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    const first = await pollBatch(event.id, gift.id, shop.deps);
    expect(first.map((u) => [u.caller, u.kind, u.text])).toEqual([["printshop", "proof", "Proof ready"]]);
    expect(await pollBatch(event.id, gift.id, shop.deps)).toEqual([]);
    shop.advance("batch_1", "printing", "Printing started");
    shop.advance("batch_1", "shipped", "Shipped", "PS-1");
    shop.advance("batch_1", "message", "Reply to the shop", null, "buyer");
    shop.advance("batch_1", "message", "Which door?");
    shop.advance("batch_1", "delivered", "Delivered");
    const next = await pollBatch(event.id, gift.id, shop.deps);
    expect(next.map((u) => [u.kind, u.reference])).toEqual([["in_production", null], ["shipped", "PS-1"], ["question", null], ["delivered", null]]);
    expect(shop.of("get_changes").map((c) => c.args.since_seq)).toEqual([0, 3, 3]);
    expect(updatesFor(event.id, gift.id).map((u) => u.kind)).toEqual(["proof", "in_production", "shipped", "question", "delivered"]);
    expect(getGift(gift.id).vendor_seq).toBe(8);
  });

  it("the cart poll on a print-shop gift reads the feed and the issues and never creates a checkout", async () => {
    const shop = fakeShop();
    setCartDeps(shop.deps);
    const { event, gift } = seed();
    expect(await cartView(event.id, gift.id)).toMatchObject({ follow_ups: [], update: null });
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    shop.advance("batch_1", "shipped", "Shipped", "PS-1");
    const view = await cartView(event.id, gift.id);
    expect(view.update).toMatchObject({ kind: "shipped", reference: "PS-1" });
    expect(view.follow_ups).toEqual([]);
    expect(view.checkout_id).toBeNull();
    expect(shop.of("get_batch").length).toBeGreaterThan(0);
  });

  it("unitsFor sends a mapped definition's answer to the design field with the same key and nothing else", () => {
    const { event, gift } = seed();
    const withMapping = { ...getGift(gift.id), mapping: [{ definition_id: snapshot(event.id).definitions.find((d) => d.key === "dietary")!.id, value: "x", variant_id: `${FLAT.id}:white` }] };
    expect(unitsFor(withMapping, FLAT).map((u) => u.values)).toEqual([{ name: "Ada" }, { name: "Ben" }]);
  });
});
