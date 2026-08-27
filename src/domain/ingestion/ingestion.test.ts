import { describe, expect, it } from "vitest";
import floydSearch from "../../commerce/fixtures/floyd-search-sofa.json";
import globalLookup from "../../commerce/fixtures/global-lookup-floyd-bedside-table.json";
import { catalogClient, GLOBAL_CATALOG_ENDPOINT } from "../../commerce";
import { PRICES, PROJECT_ID, demoStore, rows } from "../bom/fixture";
import { regenerateBom } from "../bom";
import { CategoryRequiredError, InvalidProductUrlError, ProductNotFoundError, inferCategory, ingestProductUrl } from "./index";

const BEDSIDE_URL = "https://floydhome.com/products/bedside-table";
const BEDSIDE_PRICE = 34500;
const SOURCED_TOTAL = PRICES.sofa + PRICES.coffee_table + PRICES.ottoman + PRICES.rug;
const FLOYD_STOREFRONT = "https://floydhome.com/api/ucp/mcp";

/** Envelope shapes recorded from the live endpoints for an unknown id. */
function globalMiss(id: string) {
  return { jsonrpc: "2.0", id: 1, result: { structuredContent: { products: [], messages: [{ type: "info", code: "not_found", content: id }] } } };
}
function storefrontEnvelope(payload: unknown) {
  return { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false } };
}
function storefrontMiss(id: string) {
  return storefrontEnvelope({ products: [], messages: [{ type: "info", code: "not_found", content: id }] });
}
/** The Storefront `lookup_catalog` shape, built from the recorded Storefront search result. */
const storefrontSofaLookup = storefrontEnvelope({
  products: JSON.parse(floydSearch.result.content[0].text).products,
  messages: []
});

function withTitle(envelope: typeof globalLookup, title: string) {
  const copy = structuredClone(envelope);
  copy.result.structuredContent.products[0].title = title;
  return copy;
}

/** Routes each request by endpoint and records the endpoints hit, in order. */
function fakeCatalog(responses: Record<string, unknown>) {
  const endpoints: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    endpoints.push(url);
    const id = JSON.parse(String(init?.body)).params.arguments.catalog.ids[0];
    const payload = responses[url] ?? (url === GLOBAL_CATALOG_ENDPOINT ? globalMiss(id) : storefrontMiss(id));
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  return { client: catalogClient({ fetchImpl }), endpoints };
}

const merchantFromUrl = (url: string) => new URL(url).hostname;

function ingest(store: ReturnType<typeof demoStore>["store"], client: ReturnType<typeof catalogClient>, url = BEDSIDE_URL, category?: "sofa" | "side_table") {
  return ingestProductUrl(store, { projectId: PROJECT_ID, url, category, client, merchantFromUrl });
}

describe("ingestProductUrl", () => {
  it("adds the pasted side table as a proposed item and pushes the budget over", async () => {
    const { store, events } = demoStore();
    regenerateBom(store, PROJECT_ID);
    events.length = 0;
    const { client } = fakeCatalog({ [GLOBAL_CATALOG_ENDPOINT]: globalLookup });

    const result = await ingest(store, client);

    expect(result.product).toMatchObject({
      id: "floydhome.com:gid://shopify/p/5uV0aBCRyvotspQjfccQGE",
      merchant: "floydhome.com",
      source_url: BEDSIDE_URL,
      title: "Bedside Table",
      price_cents: BEDSIDE_PRICE,
      currency: "USD",
      spatial_status: "visual_only",
      model_status: "no_model"
    });
    expect(store.products.get(result.product.id)).toEqual(result.product);
    expect(result.candidate).toMatchObject({
      project_id: PROJECT_ID,
      product_id: result.product.id,
      category: "side_table",
      ranking_state: "selected"
    });
    expect(store.candidates.get(result.candidate.id)).toEqual(result.candidate);

    const item = rows(store).bomItems.find((row) => row.product_id === result.product.id);
    expect(item).toMatchObject({ category: "side_table", status: "proposed", quantity: 1 });
    expect(result.budget).toEqual({
      committed_cents: SOURCED_TOTAL + BEDSIDE_PRICE,
      budget_cents: 250000,
      state: "over",
      overage_cents: SOURCED_TOTAL + BEDSIDE_PRICE - 250000
    });
    expect(events.map((event) => event.type)).toEqual(["PRODUCT_ADDED", "BOM_REGENERATED", "BUDGET_VIOLATED"]);
    expect(events[0]).toMatchObject({ product_id: result.product.id, candidate_id: result.candidate.id });
    expect(rows(store).project.version).toBe(2);
  });

  it("re-ingesting the same URL creates no second product, candidate, or item", async () => {
    const { store, events } = demoStore();
    const { client, endpoints } = fakeCatalog({ [GLOBAL_CATALOG_ENDPOINT]: globalLookup });

    const first = await ingest(store, client);
    const second = await ingest(store, client, "https://floydhome.com/products/bedside-table?variant=1#x");

    expect(second.candidate).toEqual(first.candidate);
    expect(second.product).toEqual(first.product);
    expect(store.products.size).toBe(7);
    expect(rows(store).candidates.filter((row) => row.product_id === first.product.id)).toHaveLength(1);
    expect(rows(store).bomItems.filter((row) => row.product_id === first.product.id)).toHaveLength(1);
    expect(events.filter((event) => (event.type as string) === "PRODUCT_ADDED")).toHaveLength(1);
    expect(endpoints).toEqual([GLOBAL_CATALOG_ENDPOINT, GLOBAL_CATALOG_ENDPOINT]);
  });

  it("falls through to the storefront endpoint of the URL's host on a Global miss", async () => {
    const { store } = demoStore();
    const { client, endpoints } = fakeCatalog({ [FLOYD_STOREFRONT]: storefrontSofaLookup });

    const result = await ingest(store, client, "https://floydhome.com/collections/sofas/products/sofa-2-0-frame-cushion-set");

    expect(endpoints).toEqual([GLOBAL_CATALOG_ENDPOINT, FLOYD_STOREFRONT]);
    expect(result.product).toMatchObject({
      id: "floydhome.com:gid://shopify/Product/8457432072354",
      source_url: "https://floydhome.com/products/sofa-2-0-frame-cushion-set",
      price_cents: 219000
    });
    expect(result.candidate.category).toBe("sofa");
  });

  it("throws ProductNotFoundError naming both endpoints when neither knows the URL", async () => {
    const { store } = demoStore();
    const { client, endpoints } = fakeCatalog({});
    await expect(ingest(store, client)).rejects.toBeInstanceOf(ProductNotFoundError);
    expect(endpoints).toEqual([GLOBAL_CATALOG_ENDPOINT, FLOYD_STOREFRONT]);
    expect(store.candidates.size).toBe(4);
  });

  it("throws CategoryRequiredError when no category is given and the title matches no keyword", async () => {
    const { store } = demoStore();
    const { client } = fakeCatalog({ [GLOBAL_CATALOG_ENDPOINT]: withTitle(globalLookup, "The Modular Table") });
    await expect(ingest(store, client)).rejects.toBeInstanceOf(CategoryRequiredError);
    expect(store.products.size).toBe(6);
    expect(store.candidates.size).toBe(4);
  });

  it("uses the given category over the inferred one", async () => {
    const { store } = demoStore();
    const { client } = fakeCatalog({ [GLOBAL_CATALOG_ENDPOINT]: withTitle(globalLookup, "The Modular Table") });
    const result = await ingest(store, client, BEDSIDE_URL, "side_table");
    expect(result.candidate.category).toBe("side_table");
  });

  it("rejects a URL without a product handle before calling the catalog", async () => {
    const { store } = demoStore();
    const { client, endpoints } = fakeCatalog({});
    await expect(ingest(store, client, "https://floydhome.com/collections/tables")).rejects.toBeInstanceOf(InvalidProductUrlError);
    expect(endpoints).toEqual([]);
  });
});

describe("inferCategory", () => {
  it.each([
    ["Sofa 2.0 Three Seater", "sofa"],
    ["The Comfy Couch", "sofa"],
    ["The Lift Off Coffee Table", "coffee_table"],
    ["Round Ottoman", "ottoman"],
    ["Wool Area Rug 8x10", "rug"],
    ["Walnut Side Table", "side_table"],
    ["Bedside Table", "side_table"],
    ["Oak End Table", "side_table"],
    ["Nightstand", "side_table"],
    ["Sofa Side Table", "side_table"],
    ["The Modular Table", null],
    ["Rugged Sofa Cover", "sofa"]
  ])("%s → %s", (title, category) => {
    expect(inferCategory(title)).toBe(category);
  });
});
