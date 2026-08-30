import { describe, expect, it } from "vitest";
import { CatalogError, catalogClient, DEFAULT_AGENT_PROFILE_URL, GLOBAL_CATALOG_ENDPOINT, storefrontEndpoint } from "./index";
import floydGetProduct from "../fixtures/floyd-get-product.json";
import floydSearch from "../fixtures/floyd-search-sofa.json";
import globalLookup from "../fixtures/global-lookup-floyd-bedside-table.json";
import globalSearch from "../fixtures/global-search-three-seat-sofa.json";

/** Real error envelopes recorded from the Global endpoint. */
const shipsToStringError = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    content: [{ type: "text", text: "Invalid arguments: value at `/catalog/filters/ships_to` is not an object" }],
    isError: true
  }
};
const profileError = {
  jsonrpc: "2.0",
  id: 1,
  error: {
    code: -32001,
    message: "UCP discovery failed",
    data: { code: "profile_unreachable", content: "Unable to fetch agent profile: Http error" }
  }
};

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

/** A fetch that answers every call with `payload` and records what was sent. */
function fakeFetch(payload: unknown, status = 200) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body))
    });
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, requests };
}

describe("catalogClient request shape", () => {
  it("sends a tools/call with the profile in meta and the catalog arguments", async () => {
    const { fetchImpl, requests } = fakeFetch(globalSearch);
    const client = catalogClient({ fetchImpl });
    await client.searchCatalog({
      query: "three seat sofa",
      filters: { ships_to: { country: "US", region: "NY", postal_code: "10003" } },
      pagination: { limit: 3 }
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.url).toBe(GLOBAL_CATALOG_ENDPOINT);
    expect(request.headers).toMatchObject({ "Content-Type": "application/json", Accept: "application/json" });
    expect(request.body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "search_catalog",
        arguments: {
          meta: { "ucp-agent": { profile: DEFAULT_AGENT_PROFILE_URL } },
          catalog: {
            query: "three seat sofa",
            filters: { ships_to: { country: "US", region: "NY", postal_code: "10003" } },
            pagination: { limit: 3 }
          }
        }
      }
    });
    expect(typeof request.body.id).toBe("number");
  });

  it("targets the given endpoint and profile, and withEndpoint keeps both fetch and profile", async () => {
    const { fetchImpl, requests } = fakeFetch(floydGetProduct);
    const profileUrl = "https://planner.example/.well-known/ucp-agent-profile.json";
    const client = catalogClient({ endpoint: storefrontEndpoint("floydhome.com"), profileUrl, fetchImpl });
    await client.getProduct("gid://shopify/Product/8457432072354");
    await client.withEndpoint(storefrontEndpoint("sabai.design")).getProduct("gid://shopify/Product/1");

    expect(requests.map((request) => request.url)).toEqual([
      "https://floydhome.com/api/ucp/mcp",
      "https://sabai.design/api/ucp/mcp"
    ]);
    for (const request of requests) {
      expect(request.body.params.name).toBe("get_product");
      expect(request.body.params.arguments.meta["ucp-agent"].profile).toBe(profileUrl);
    }
    expect(requests[0].body.params.arguments.catalog).toEqual({ id: "gid://shopify/Product/8457432072354" });
  });

  it("rejects a page size above the catalog's maximum before sending", () => {
    const { fetchImpl, requests } = fakeFetch(globalSearch);
    const client = catalogClient({ fetchImpl });
    expect(() => client.searchCatalog({ query: "sofa", pagination: { limit: 51 } })).toThrow(RangeError);
    expect(() => client.lookupCatalog([])).toThrow(RangeError);
    expect(requests).toHaveLength(0);
  });
});

describe("catalogClient onCall", () => {
  it("wraps every call with the endpoint, tool, and arguments, including calls from a derived client", async () => {
    const { fetchImpl } = fakeFetch(floydGetProduct);
    const calls: { endpoint: string; tool: string; args: Record<string, unknown> }[] = [];
    const client = catalogClient({
      fetchImpl,
      onCall: async (call, run) => {
        calls.push(call);
        return run();
      }
    });
    await client.getProduct("gid://shopify/Product/1");
    await client.withEndpoint(storefrontEndpoint("floydhome.com")).getProduct("gid://shopify/Product/2", { include_variants: true } as never);
    expect(calls).toEqual([
      { endpoint: GLOBAL_CATALOG_ENDPOINT, tool: "get_product", args: { id: "gid://shopify/Product/1" } },
      { endpoint: "https://floydhome.com/api/ucp/mcp", tool: "get_product", args: { id: "gid://shopify/Product/2", include_variants: true } }
    ]);
  });

  it("lets the hook see a failure and still rejects the caller", async () => {
    const outcomes: string[] = [];
    const client = catalogClient({
      fetchImpl: fakeFetch({}, 503).fetchImpl,
      onCall: async (call, run) => {
        try {
          return await run();
        } catch (e) {
          outcomes.push(`${call.tool} ${(e as Error).message}`);
          throw e;
        }
      }
    });
    await expect(client.searchCatalog({ query: "sofa" })).rejects.toMatchObject({ kind: "http", code: 503 });
    expect(outcomes).toEqual([`search_catalog search_catalog: HTTP 503 from ${GLOBAL_CATALOG_ENDPOINT}`]);
  });
});

describe("catalogClient result parsing", () => {
  it("reads Global search results from structuredContent when content is absent", async () => {
    const client = catalogClient({ fetchImpl: fakeFetch(globalSearch).fetchImpl });
    const result = await client.searchCatalog({ query: "three seat sofa", filters: { ships_to: { country: "US" } } });

    expect(result.products).toHaveLength(3);
    expect(result.pagination).toMatchObject({ has_next_page: true, total_count: 386 });
    expect(result.messages).toEqual([]);
    const [sofa] = result.products;
    expect(sofa).toMatchObject({ id: "gid://shopify/p/16uKDHRRNeJ1pSpDM2FWwO", title: "M1 Sofa Three Seater" });
    expect(sofa.metadata?.tech_specs).toContain("Seating Capacity: 3");
    expect(sofa.media?.[0].url).toMatch(/^https:\/\/cdn\.shopify\.com\//);
    expect(sofa.variants?.[0]).toMatchObject({
      price: { amount: 119700, currency: "USD" },
      availability: { available: true },
      seller: { domain: "rovelab-us.myshopify.com" }
    });
  });

  it("reads Storefront search results from the JSON string in content[0].text", async () => {
    const client = catalogClient({ endpoint: storefrontEndpoint("floydhome.com"), fetchImpl: fakeFetch(floydSearch).fetchImpl });
    const result = await client.searchCatalog({ query: "sofa" });

    expect(result.products).toHaveLength(1);
    expect(result.pagination?.has_next_page).toBe(true);
    const [sofa] = result.products;
    expect(sofa).toMatchObject({
      id: "gid://shopify/Product/8457432072354",
      title: "Sofa 2.0 Three Seater",
      url: "https://floydhome.com/products/sofa-2-0-frame-cushion-set",
      description: { html: expect.stringContaining("Floyd Sofa 2.0") }
    });
    expect(sofa.variants?.[0]).toMatchObject({
      price: { amount: 219000, currency: "USD" },
      availability: { available: true },
      checkout_url: "https://floyd-home.myshopify.com/cart/44831998574754:1"
    });
  });

  it("reads a Storefront get_product result", async () => {
    const client = catalogClient({ endpoint: storefrontEndpoint("floydhome.com"), fetchImpl: fakeFetch(floydGetProduct).fetchImpl });
    const result = await client.getProduct("gid://shopify/Product/8457432072354");

    expect(result.product).toMatchObject({
      id: "gid://shopify/Product/8457432072354",
      title: "Sofa 2.0 Three Seater",
      handle: "sofa-2-0-frame-cushion-set",
      price_range: { min: { amount: 219000, currency: "USD" } }
    });
    expect(result.product?.variants?.[0]).toMatchObject({ id: "gid://shopify/ProductVariant/44831998574754", availability: { available: true } });
    expect(result.messages).toEqual([]);
  });

  it("looks up a product by its Shopify URL", async () => {
    const { fetchImpl, requests } = fakeFetch(globalLookup);
    const client = catalogClient({ fetchImpl });
    const url = "https://floydhome.com/products/bedside-table";
    const result = await client.lookupCatalog([url]);

    expect(requests[0].body.params).toMatchObject({ name: "lookup_catalog", arguments: { catalog: { ids: [url] } } });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ title: "Bedside Table", description: { plain: expect.any(String) } });
    expect(result.products[0].variants?.[0]).toMatchObject({
      price: { amount: 34500, currency: "USD" },
      url: expect.stringContaining(url),
      seller: { name: "Floyd Home" }
    });
  });
});

describe("catalogClient errors", () => {
  it("surfaces a tool failure (result.isError) with the server message", async () => {
    const client = catalogClient({ fetchImpl: fakeFetch(shipsToStringError).fetchImpl });
    const failure = await client.searchCatalog({ query: "sofa" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CatalogError);
    expect(failure).toMatchObject({
      kind: "tool",
      message: "Invalid arguments: value at `/catalog/filters/ships_to` is not an object"
    });
  });

  it("surfaces a JSON-RPC error with its code and data", async () => {
    const client = catalogClient({ fetchImpl: fakeFetch(profileError).fetchImpl });
    const failure = await client.lookupCatalog(["gid://shopify/p/x"]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CatalogError);
    expect(failure).toMatchObject({
      kind: "rpc",
      code: -32001,
      message: "UCP discovery failed",
      data: { code: "profile_unreachable" }
    });
  });

  it("surfaces a non-2xx HTTP status", async () => {
    const client = catalogClient({ fetchImpl: fakeFetch({}, 503).fetchImpl });
    await expect(client.searchCatalog({ query: "sofa" })).rejects.toMatchObject({ kind: "http", code: 503 });
  });
});
