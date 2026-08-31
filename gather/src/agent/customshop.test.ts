import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { customshopCandidates, customshopFields, customshopHost, customshopUrl } from "./customshop";
import { cardsConfig, emptyFunnel, rank, sourcesForSentence, type EventContext } from "./search";

const URL_ = "https://shop.example";
const CTX: EventContext = { event_date: "2030-01-10", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" }, budget_cents: 6000, quantity: 20, today: "2029-12-03", personalized: true };

const CREWNECK = {
  id: "gid://shopify/Product/10242071789817",
  title: "Customized Crewneck",
  description: { html: "Garment-dyed crewneck." },
  url: `${URL_}/products/crewneck`,
  price_range: { min: { amount: 5000, currency: "CAD" }, max: { amount: 5000, currency: "CAD" } },
  variants: [
    { id: "gid://shopify/ProductVariant/1", title: "White / S", price: { amount: 5000, currency: "CAD" }, availability: { available: true }, options: [{ name: "Color", label: "White" }, { name: "Size", label: "S" }], media: [{ type: "image", url: "https://cdn.example/crewneck.png" }] },
    { id: "gid://shopify/ProductVariant/2", title: "White / M", price: { amount: 5000, currency: "CAD" }, availability: { available: true }, options: [{ name: "Color", label: "White" }, { name: "Size", label: "M" }] }
  ]
};
const PLAIN = {
  id: "gid://shopify/Product/999",
  title: "Plain Tee",
  price_range: { min: { amount: 2000, currency: "CAD" }, max: { amount: 2000, currency: "CAD" } },
  variants: [{ id: "gid://shopify/ProductVariant/9", title: "M", price: { amount: 2000, currency: "CAD" }, availability: { available: true }, options: [{ name: "Size", label: "M" }] }]
};

type Call = { tool: string; args: Record<string, any>; meta: Record<string, any> };

/** The shop behind a fake fetch at /api/ucp/mcp: its own search_catalog and a checkout that quotes the crewneck and refuses the tee. */
function fakeShop() {
  const calls: Call[] = [];
  const reply = (tool: string, args: Record<string, any>): unknown => {
    if (tool === "search_catalog") return { products: [CREWNECK, PLAIN], pagination: { has_next_page: false } };
    if (tool === "create_checkout") {
      const variant = args.checkout.line_items[0].item.id as string;
      if (variant === "gid://shopify/ProductVariant/1") return { id: "gid://shopify/Checkout/1", status: "ready_for_complete", fulfillment: { methods: [{ type: "shipping", groups: [{ options: [{ id: "std", title: "Standard (5-7 business days)" }] }] }] } };
      return { id: "gid://shopify/Checkout/2", status: "requires_update", messages: [{ type: "error", code: "shipping_unavailable", content: "The shop does not ship to the address." }] };
    }
    throw new Error(`The fake shop has no ${tool}.`);
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    expect(String(input)).toBe(`${URL_}/api/ucp/mcp`);
    const body = JSON.parse(String(init?.body));
    const { meta, ...args } = body.params.arguments;
    calls.push({ tool: body.params.name, args, meta });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(reply(body.params.name, args)) }] } }), { status: 200 });
  };
  return { calls, fetchImpl, of: (tool: string) => calls.filter((c) => c.tool === tool) };
}

describe("the custom shop as a search source", () => {
  const saved = process.env.CUSTOMILY_SHOP_URL;
  beforeEach(() => {
    process.env.CUSTOMILY_SHOP_URL = URL_;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CUSTOMILY_SHOP_URL;
    else process.env.CUSTOMILY_SHOP_URL = saved;
  });

  it("lists the shop's products with the profile meta and a catalog object, the configured fields, and a funnel row", async () => {
    const shop = fakeShop();
    const funnel = emptyFunnel();
    const found = await customshopCandidates(CTX, { fetchImpl: shop.fetchImpl, funnel });
    const [search] = shop.of("search_catalog");
    expect(search.meta).toEqual({ "ucp-agent": { profile: expect.stringContaining("https://") } });
    expect(search.args.catalog).toBeTypeOf("object");
    expect(funnel.searches).toEqual([{ query: "customshop", returned: 2, total: 2 }]);
    const crewneck = found.find((c) => c.product_id === CREWNECK.id)!;
    expect(crewneck).toMatchObject({ title: "Customized Crewneck", shop_domain: "shop.example", shop_name: "Customworks", shop_url: URL_, price_cents: 5000, currency: "CAD", searches: ["customshop"], option_names: ["Color", "Size"], image_url: "https://cdn.example/crewneck.png" });
    expect(crewneck.personalization?.fields).toEqual([
      { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true },
      { key: "star_map_date", label: "Pick a date for Star Map 1", kind: "date", required: true },
      { key: "caption", label: "Text 2", kind: "name", required: true }
    ]);
    expect(customshopFields(CREWNECK.id)).toEqual(crewneck.personalization?.fields);
    expect(found.find((c) => c.product_id === PLAIN.id)?.personalization).toBeUndefined();
  });

  it("probes the shop's checkout for each product so the verdict is the shop's own", async () => {
    const shop = fakeShop();
    const found = await customshopCandidates(CTX, { fetchImpl: shop.fetchImpl });
    expect(shop.of("create_checkout").map((c) => c.args.checkout.line_items[0].item.id)).toEqual(["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/9"]);
    const [probe] = shop.of("create_checkout");
    expect(probe.args.checkout.fulfillment.methods[0].destinations[0]).toMatchObject({ address_locality: "Toronto", address_region: "ON", postal_code: "M5V 1A1", address_country: "CA" });
    const crewneck = found.find((c) => c.product_id === CREWNECK.id)!;
    expect(crewneck.delivery).toMatchObject({ verdict: "quoted", confidence: "duration", text: "Standard (5-7 business days)" });
    expect(crewneck.delivery?.window).not.toBeNull();
    expect(found.find((c) => c.product_id === PLAIN.id)?.delivery).toMatchObject({ verdict: "refused", window: null, error: "The shop does not ship to the address." });
  });

  it("ranks the crewneck among catalog candidates and coverage sees its name field on a personalized request", async () => {
    const shop = fakeShop();
    const found = await customshopCandidates(CTX, { fetchImpl: shop.fetchImpl });
    const { ranked } = rank(found, CTX);
    expect(ranked[0].product_id).toBe(CREWNECK.id);
    expect(ranked[0].terms.coverage).toBe(1);
    expect(rank(found, CTX).ranked.find((c) => c.product_id === PLAIN.id)).toBeUndefined();
  });

  it("returns nothing without a configured shop so a run degrades to the other sources", async () => {
    delete process.env.CUSTOMILY_SHOP_URL;
    const shop = fakeShop();
    expect(customshopUrl()).toBeNull();
    expect(customshopHost()).toBeNull();
    expect(await customshopCandidates(CTX, { fetchImpl: shop.fetchImpl })).toEqual([]);
    expect(shop.calls).toEqual([]);
  });

  it("the apparel card and a sentence naming sweatshirts search the shop; a plain sentence searches the catalog alone", () => {
    expect(cardsConfig().cards.find((c) => c.key === "apparel")?.sources).toEqual(["shopify", "customshop"]);
    expect(sourcesForSentence("personalized sweatshirts for everyone attending")).toEqual(["shopify", "customshop"]);
    expect(sourcesForSentence("a crewneck for each guest")).toEqual(["shopify", "customshop"]);
    expect(sourcesForSentence("a dessert box")).toEqual(["shopify"]);
  });
});

/** Runs only with LIVE_CUSTOMSHOP=1 and CUSTOMILY_SHOP_URL set: the shop's own search and one real checkout probe. */
describe.skipIf(process.env.LIVE_CUSTOMSHOP !== "1" || !process.env.CUSTOMILY_SHOP_URL)("live search at the custom shop", () => {
  it("lists the crewneck with its personalization fields and a probed delivery verdict", async () => {
    const ctx: EventContext = { event_date: "2030-01-10", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M6H 2A8", country: "CA" }, budget_cents: 6000, quantity: 20, today: new Date().toISOString().slice(0, 10) };
    const funnel = emptyFunnel();
    const found = await customshopCandidates(ctx, { funnel });
    expect(found.length).toBeGreaterThan(0);
    const crewneck = found.find((c) => c.personalization);
    expect(crewneck).toBeDefined();
    expect(crewneck!.personalization!.fields.some((f) => f.kind === "name")).toBe(true);
    expect(crewneck!.delivery).not.toBeNull();
    console.log("live crewneck delivery", crewneck!.delivery);
    const { ranked, excluded } = rank(found, ctx);
    expect(ranked.length + excluded.length).toBe(found.length);
  }, 60_000);
});
