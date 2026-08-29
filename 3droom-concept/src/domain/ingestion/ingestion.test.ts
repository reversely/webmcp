import { describe, expect, it } from "vitest";
import globalLookup from "../../commerce/fixtures/global-lookup-floyd-bedside-table.json";
import globalMissModway from "../../commerce/fixtures/global-lookup-miss-modway-ollie.json";
import modwayGetProduct from "../../commerce/fixtures/modway-get-product-ollie.json";
import modwayHandleJson from "../../commerce/fixtures/modway-products-ollie-handle.json";
import { catalogClient, GLOBAL_CATALOG_ENDPOINT } from "../../commerce";
import { PRICES, PROJECT_ID, demoStore, rows } from "../bom/fixture";
import { regenerateBom } from "../bom";
import { InvalidProductUrlError, ProductNotFoundError, ingestProductUrl } from "./index";

const BEDSIDE_URL = "https://floydhome.com/products/bedside-table";
const BEDSIDE_PRICE = 34500;
const SOURCED_TOTAL = PRICES.sofa + PRICES.coffee_table + PRICES.ottoman + PRICES.rug;
const FLOYD_STOREFRONT = "https://floydhome.com/api/ucp/mcp";
const MODWAY_URL = "https://modway.com/products/ollie-bed-frame-by-modway-mod-5432";
const MODWAY_STOREFRONT = "https://modway.com/api/ucp/mcp";

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

function withTitle(envelope: typeof globalLookup, title: string) {
  const copy = structuredClone(envelope);
  copy.result.structuredContent.products[0].title = title;
  return copy;
}

/**
 * Routes each request by URL and records the URLs hit, in order. A POST is a JSON-RPC tool call
 * answered from `responses` or with the recorded miss envelope; a GET is a `{handle}.json` fetch,
 * a 404 unless `responses` names it.
 */
function fakeCatalog(responses: Record<string, unknown>) {
  const endpoints: string[] = [];
  const calls: { tool: string; catalog: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    endpoints.push(url);
    if (init?.method !== "POST") {
      const page = responses[url];
      return page ? Response.json(page) : new Response("Not found", { status: 404 });
    }
    const { name, arguments: args } = JSON.parse(String(init?.body)).params;
    const catalog = args.catalog;
    calls.push({ tool: name, catalog });
    const id = catalog.ids?.[0] ?? catalog.id;
    const payload = responses[url] ?? (url === GLOBAL_CATALOG_ENDPOINT ? globalMiss(id) : storefrontMiss(id));
    return Response.json(payload);
  };
  return { client: catalogClient({ fetchImpl }), endpoints, calls, fetchImpl };
}

const merchantFromUrl = (url: string) => new URL(url).hostname;

function ingest(store: ReturnType<typeof demoStore>["store"], { client, fetchImpl }: ReturnType<typeof fakeCatalog>, url = BEDSIDE_URL, category?: string, kind?: "table" | "seating") {
  return ingestProductUrl(store, { projectId: PROJECT_ID, url, category, kind, client, merchantFromUrl, fetchImpl });
}

describe("ingestProductUrl", () => {
  it("adds the pasted side table as a proposed item and pushes the budget over", async () => {
    const { store, events } = demoStore();
    regenerateBom(store, PROJECT_ID);
    events.length = 0;
    const catalog = fakeCatalog({ [GLOBAL_CATALOG_ENDPOINT]: globalLookup });

    const result = await ingest(store, catalog);

    expect(result.product).toMatchObject({
      id: "floydhome.com:bedside-table",
      external_product_id: "gid://shopify/p/5uV0aBCRyvotspQjfccQGE",
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
      category: "Bedside Table",
      kind: "other",
      ranking_state: "selected"
    });
    expect(store.candidates.get(result.candidate.id)).toEqual(result.candidate);

    const item = rows(store).bomItems.find((row) => row.product_id === result.product.id);
    expect(item).toMatchObject({ category: "Bedside Table", kind: "other", status: "proposed", quantity: 1 });
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
    const catalog = fakeCatalog({ [GLOBAL_CATALOG_ENDPOINT]: globalLookup });
    const { endpoints } = catalog;

    const first = await ingest(store, catalog);
    const second = await ingest(store, catalog, "https://floydhome.com/products/bedside-table?variant=1#x");

    expect(second.candidate).toEqual(first.candidate);
    expect(second.product).toEqual(first.product);
    expect(store.products.size).toBe(7);
    expect(rows(store).candidates.filter((row) => row.product_id === first.product.id)).toHaveLength(1);
    expect(rows(store).bomItems.filter((row) => row.product_id === first.product.id)).toHaveLength(1);
    expect(events.filter((event) => (event.type as string) === "PRODUCT_ADDED")).toHaveLength(1);
    expect(endpoints).toEqual([GLOBAL_CATALOG_ENDPOINT, GLOBAL_CATALOG_ENDPOINT]);
  });

  it("on a Global miss reads the numeric id from {handle}.json and asks the storefront get_product by gid", async () => {
    const { store } = demoStore();
    const catalog = fakeCatalog({
      [GLOBAL_CATALOG_ENDPOINT]: globalMissModway,
      [`${MODWAY_URL}.json`]: modwayHandleJson,
      [MODWAY_STOREFRONT]: modwayGetProduct
    });

    const result = await ingest(store, catalog, "https://modway.com/collections/beds/products/ollie-bed-frame-by-modway-mod-5432?variant=1");

    expect(catalog.endpoints).toEqual([GLOBAL_CATALOG_ENDPOINT, `${MODWAY_URL}.json`, MODWAY_STOREFRONT]);
    expect(catalog.calls).toEqual([
      { tool: "lookup_catalog", catalog: { ids: [MODWAY_URL] } },
      { tool: "get_product", catalog: { id: "gid://shopify/Product/8729389400236" } }
    ]);
    expect(result.product).toMatchObject({
      id: "modway.com:ollie-bed-frame-by-modway-mod-5432",
      external_product_id: "gid://shopify/Product/8729389400236",
      source_url: MODWAY_URL,
      title: "Ollie Bed Frame",
      price_cents: 13764
    });
    expect(result.candidate.category).toBe("Ollie Bed Frame");
  });

  it("keys the row on merchant and handle, so a Global hit and a storefront hit for one URL share it", async () => {
    const globalHit = structuredClone(globalMissModway) as { result: { structuredContent: { products: unknown[] } } };
    globalHit.result.structuredContent.products = [
      { ...globalLookup.result.structuredContent.products[0], id: "gid://shopify/p/OllieOpaqueGlobalId", url: MODWAY_URL, title: "Ollie Bed Frame" }
    ];
    const viaGlobal = await ingest(demoStore().store, fakeCatalog({ [GLOBAL_CATALOG_ENDPOINT]: globalHit }), MODWAY_URL);
    const viaStorefront = await ingest(
      demoStore().store,
      fakeCatalog({ [GLOBAL_CATALOG_ENDPOINT]: globalMissModway, [`${MODWAY_URL}.json`]: modwayHandleJson, [MODWAY_STOREFRONT]: modwayGetProduct }),
      MODWAY_URL
    );

    expect(viaGlobal.product.id).toBe("modway.com:ollie-bed-frame-by-modway-mod-5432");
    expect(viaStorefront.product.id).toBe(viaGlobal.product.id);
    expect(viaGlobal.product.external_product_id).not.toBe(viaStorefront.product.external_product_id);
  });

  it("throws ProductNotFoundError naming both endpoints when the shop serves no {handle}.json", async () => {
    const { store } = demoStore();
    const catalog = fakeCatalog({});
    await expect(ingest(store, catalog)).rejects.toBeInstanceOf(ProductNotFoundError);
    expect(catalog.endpoints).toEqual([GLOBAL_CATALOG_ENDPOINT, `${BEDSIDE_URL}.json`]);
    expect(store.candidates.size).toBe(4);
  });

  it("throws ProductNotFoundError when the storefront does not know the gid from {handle}.json", async () => {
    const { store } = demoStore();
    const catalog = fakeCatalog({ [`${BEDSIDE_URL}.json`]: { product: { id: 1 } } });
    await expect(ingest(store, catalog)).rejects.toThrow(ProductNotFoundError);
    expect(catalog.endpoints).toEqual([GLOBAL_CATALOG_ENDPOINT, `${BEDSIDE_URL}.json`, FLOYD_STOREFRONT]);
  });

  it("takes the given phrase and kind over the title, and asks the kind inferrer when only a phrase is given", async () => {
    const { store } = demoStore();
    const catalog = fakeCatalog({ [GLOBAL_CATALOG_ENDPOINT]: withTitle(globalLookup, "The Modular Table") });
    const given = await ingest(store, catalog, BEDSIDE_URL, "side table", "table");
    expect(given.candidate).toMatchObject({ category: "side table", kind: "table" });

    const asked: string[] = [];
    const other = demoStore().store;
    const inferred = await ingestProductUrl(other, { projectId: PROJECT_ID, url: BEDSIDE_URL, category: "reading lamp", client: catalog.client, merchantFromUrl, inferKind: async (name) => (asked.push(name), "lighting") });
    expect(asked).toEqual(["reading lamp"]);
    expect(inferred.candidate).toMatchObject({ category: "reading lamp", kind: "lighting" });
  });

  it("rejects a URL without a product handle before calling the catalog", async () => {
    const { store } = demoStore();
    const catalog = fakeCatalog({});
    await expect(ingest(store, catalog, "https://floydhome.com/collections/tables")).rejects.toBeInstanceOf(InvalidProductUrlError);
    expect(catalog.endpoints).toEqual([]);
  });
});
