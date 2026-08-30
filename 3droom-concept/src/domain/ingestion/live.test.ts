import { describe, expect, it } from "vitest";
import { catalogClient } from "@webmcp/shopify-ucp";
import { PROJECT_ID, demoStore } from "../bom/fixture";
import { ingestProductUrl } from "./ingest";

/**
 * Hits the real Global Catalog and modway.com. Run with
 * `LIVE_SHOPIFY=1 npx vitest run src/domain/ingestion/live.test.ts`. The URL was a recorded
 * Global miss on 2026-08-27 (fixture global-lookup-miss-modway-ollie.json); the test still holds if
 * the catalog learns it, since both paths key the row on merchant plus handle.
 */
describe.skipIf(process.env.LIVE_SHOPIFY !== "1")("ingestProductUrl (live)", () => {
  it("resolves a Modway product URL through {handle}.json and the storefront get_product", async () => {
    const { store } = demoStore();
    const result = await ingestProductUrl(store, {
      projectId: PROJECT_ID,
      url: "https://modway.com/products/ollie-bed-frame-by-modway-mod-5432",
      client: catalogClient(),
      merchantFromUrl: (url) => new URL(url).host
    });
    expect(result.product).toMatchObject({
      id: "modway.com:ollie-bed-frame-by-modway-mod-5432",
      title: "Ollie Bed Frame"
    });
    expect(result.product.price_cents).toBeGreaterThan(0);
  }, 60_000);
});
