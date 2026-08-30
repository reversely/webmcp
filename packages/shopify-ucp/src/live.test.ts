import { describe, expect, it } from "vitest";
import { catalogClient } from "./client";

/** Hits the real Global Catalog. Run with `LIVE_SHOPIFY=1 npx vitest run src/commerce/live.test.ts`. */
describe.skipIf(process.env.LIVE_SHOPIFY !== "1")("Global Catalog (live)", () => {
  it("searchCatalog('three seat sofa') shipping to the US returns products with sellers", async () => {
    const result = await catalogClient().searchCatalog({
      query: "three seat sofa",
      filters: { ships_to: { country: "US" } },
      pagination: { limit: 5 }
    });
    expect(result.products.length).toBeGreaterThanOrEqual(1);
    expect(result.products[0].variants?.[0].seller?.name).toEqual(expect.any(String));
  }, 30_000);
});
