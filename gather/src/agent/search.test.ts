import { describe, expect, it } from "vitest";
import type { CatalogClient } from "@webmcp/shopify-ucp";
import { eligibility, personalizedRequest, priceFit, rank, searchCandidates, searchesForSentence, withDelivery, type Candidate, type EventContext } from "./search";

const CTX: EventContext = { event_date: "2030-01-10", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, budget_cents: 2000, quantity: 20, today: "2029-12-20" };

function product(id: string, domain: string, priceCents: number, extra: Record<string, unknown> = {}) {
  return { id, title: `Product ${id}`, description: { plain: "A product." }, price_range: { min: { amount: priceCents, currency: "CAD" } }, variants: [{ id: `v_${id}`, title: "Default", price: { amount: priceCents, currency: "CAD" }, availability: { available: true }, seller: { id: `gid://shopify/Shop/${domain}`, domain, name: `Shop ${domain}`, url: `https://${domain}`, links: [{ type: "refund_policy", url: "https://x/r" }, { type: "shipping_policy", url: "https://x/s" }, { type: "privacy_policy", url: "https://x/p" }, { type: "terms_of_service", url: "https://x/t" }] }, options: [{ name: "Flavour", label: "One" }] }], ...extra };
}

function fakeClient(byQuery: Record<string, unknown[]>): CatalogClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async searchCatalog(params: { query: string }) { calls.push(params); return { products: byQuery[params.query] ?? [] } as never; },
    async lookupCatalog() { return { products: [] } as never; },
    async getProduct() { return {} as never; },
    withEndpoint() { return this; },
    endpoint: "x",
    profileUrl: "x"
  } as unknown as CatalogClient & { calls: unknown[] };
}

describe("searchCandidates", () => {
  it("runs every search with the venue, the country, and the price ceiling, and merges products by id", async () => {
    const client = fakeClient({ "gift sets": [product("p1", "a.myshopify.com", 1500)], "party favors": [product("p1", "a.myshopify.com", 1500), product("p2", "b.myshopify.com", 900)] });
    const out = await searchCandidates(client, [{ query: "gift sets", categories: ["bu"] }, { query: "party favors", categories: ["ae-2-1"] }], CTX);
    expect(out.map((c) => c.product_id)).toEqual(["p1", "p2"]);
    expect(out[0].searches).toEqual(["gift sets [bu]", "party favors [ae-2-1]"]);
    expect(out[0]).toMatchObject({ shop_domain: "a.myshopify.com", price_cents: 1500, option_names: ["Flavour"] });
    const first = client.calls[0] as { filters: Record<string, unknown> };
    expect(first.filters).toMatchObject({ ships_to: { country: "CA", postal_code: "00000" }, ships_from: [{ country: "CA" }], categories: ["bu"], price: { max: 2000 }, available: true });
  });
  it("maps a sentence to itself plus the cards it names", () => {
    const searches = searchesForSentence("a small dessert box of food each guest can take home");
    expect(searches[0]).toEqual({ query: "a small dessert box of food each guest can take home" });
    expect(searches.some((s) => s.categories?.includes("fb"))).toBe(true);
    expect(searches.some((s) => s.categories?.includes("aa"))).toBe(false);
  });
});

describe("withDelivery, eligibility, and rank", () => {
  const base = (over: Partial<Candidate> = {}): Candidate => ({ product_id: "p", title: "P", description: "", url: null, image_url: null, shop_domain: "s.myshopify.com", shop_name: "S", shop_url: "https://s", policy_links: [{ type: "refund_policy", url: "u" }, { type: "shipping_policy", url: "u" }, { type: "privacy_policy", url: "u" }, { type: "terms_of_service", url: "u" }], price_cents: 1500, currency: "CAD", variants: [{ id: "v", title: "Default", price_cents: 1500, currency: "CAD", available: true, options: [] }], option_names: [], searches: ["q"], delivery: null, ...over });
  const checkoutWith = (titles: string[]): typeof fetch => async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ status: "incomplete", fulfillment: { methods: [{ groups: [{ options: titles.map((title) => ({ title })) }] }] } }) }] } }), { headers: { "Content-Type": "application/json" } });

  it("reads a dated window from the checkout's option title and passes the delivery rule", async () => {
    const c = await withDelivery(base(), CTX, checkoutWith(["Standard: arrives Dec 28 to Jan 2"]));
    expect(c.delivery).toMatchObject({ confidence: "dated", window: { latest: "2030-01-02" } });
    expect(eligibility(c, CTX)).toEqual({ eligible: true, rule: null, reason: null });
  });
  it("fails the delivery rule when the window plus the buffer passes the event, and names the rule", async () => {
    const c = await withDelivery(base(), CTX, checkoutWith(["Standard: arrives Jan 9 to Jan 12"]));
    expect(eligibility(c, CTX)).toMatchObject({ eligible: false, rule: "delivery" });
  });
  it("keeps a product whose probe failed, with delivery unknown, and excludes a refused destination", async () => {
    const failing: typeof fetch = async () => new Response("no", { status: 429 });
    const unknown = await withDelivery(base(), CTX, failing);
    expect(unknown.delivery).toMatchObject({ confidence: "unknown", error: "HTTP 429" });
    expect(eligibility(unknown, CTX).eligible).toBe(true);
    const refused = await withDelivery(base(), CTX, async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ status: "incomplete", fulfillment: { methods: [] }, messages: [{ type: "error", code: "delivery_unavailable", content: "We do not ship to this address." }] }) }], isError: true } }), { headers: { "Content-Type": "application/json" } }));
    expect(eligibility(refused, CTX)).toMatchObject({ eligible: false, rule: "ships_to_venue" });
    // A sign-in step or an escalation is not a refusal: the product stays, delivery unknown.
    const step = await withDelivery(base(), CTX, async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ status: "requires_escalation", fulfillment: { methods: [] }, messages: [{ type: "error", code: "customer_account_required", content: "You must sign in to continue." }] }) }], isError: true } }), { headers: { "Content-Type": "application/json" } }));
    expect(step.delivery?.verdict).toBe("needs_buyer");
    expect(eligibility(step, CTX).eligible).toBe(true);
  });
  it("scores a price that uses the budget above a cheap one", () => {
    expect(priceFit(1800, 2000)).toBe(1);
    expect(priceFit(1200, 2000)).toBe(1);
    expect(priceFit(300, 2000)).toBeCloseTo(0.25);
    expect(priceFit(2500, 2000)).toBe(0);
    expect(priceFit(1000, null)).toBe(0.5);
  });
  it("excludes a price above the budget and ranks dated, budget-using, better-documented sellers first", async () => {
    const dated = await withDelivery(base({ product_id: "dated", price_cents: 1500 }), CTX, checkoutWith(["Arrives Dec 28 to Jan 2"]));
    const unknown = await withDelivery(base({ product_id: "unknown", price_cents: 1500 }), CTX, async () => new Response("no", { status: 500 }));
    const pricey = base({ product_id: "pricey", price_cents: 2500 });
    const { ranked, excluded } = rank([unknown, dated, pricey], CTX);
    expect(ranked.map((r) => r.product_id)).toEqual(["dated", "unknown"]);
    expect(ranked[0].terms.delivery_confidence).toBe(1);
    expect(excluded.map((e) => [e.product_id, e.verdict.rule])).toEqual([["pricey", "price"]]);
  });
  it("ranks a design with a name field above a boxed product when the request is personalized", async () => {
    const boxed = await withDelivery(base({ product_id: "boxed", price_cents: 1500 }), CTX, checkoutWith(["Arrives Dec 28 to Jan 2"]));
    const design = { ...base({ product_id: "design", price_cents: 320 }), delivery: boxed.delivery, personalization: { fields: [{ key: "name", label: "Name", kind: "name" as const, max_length: 40, required: true }] } };
    expect(rank([boxed, design], CTX).ranked.map((r) => r.product_id)).toEqual(["boxed", "design"]);
    const { ranked } = rank([boxed, design], { ...CTX, personalized: true });
    expect(ranked.map((r) => r.product_id)).toEqual(["design", "boxed"]);
    expect(ranked.map((r) => r.terms.coverage)).toEqual([1, 0]);
    expect(personalizedRequest("thank-you cards with each guest's name")).toBe(true);
    expect(personalizedRequest("chocolate boxes")).toBe(false);
  });
});
