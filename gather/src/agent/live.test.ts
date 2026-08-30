import { describe, expect, it } from "vitest";
import { catalogClient } from "@webmcp/shopify-ucp";
import { cardsConfig, rank, searchCandidates, withDelivery, withDetail, type EventContext } from "./search";

/** Runs only with LIVE_SHOPIFY=1: one card against the Global Catalog and one probe at a returned shop. */
describe.skipIf(process.env.LIVE_SHOPIFY !== "1")("live search for a card", () => {
  it("returns products with sellers for Food & drink shipping to Toronto and probes one for a delivery window", async () => {
    const ctx: EventContext = { event_date: "2030-01-10", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M6H 2A8", country: "CA" }, budget_cents: 3000, quantity: 20, today: new Date().toISOString().slice(0, 10) };
    const card = cardsConfig().cards.find((c) => c.key === "food_drink")!;
    const found = await searchCandidates(catalogClient(), card.searches.slice(0, 1), ctx, { limit: 10 });
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].shop_domain).toMatch(/\./);
    const probed = await withDelivery(await withDetail(catalogClient(), found[0]), ctx);
    expect(probed.delivery).not.toBeNull();
    const { ranked, excluded } = rank([probed, ...found.slice(1)], ctx);
    expect(ranked.length + excluded.length).toBe(found.length);
  }, 90_000);
});
