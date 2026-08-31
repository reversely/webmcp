import { describe, expect, it } from "vitest";
import { catalogClient } from "@webmcp/shopify-ucp";
import { publishEvent, resetState } from "../domain/store";
import { getGift } from "../domain/gifts";
import { createEventFromBody, createGiftFromBody, postUpdate, snapshot, submitRsvp } from "../server/api";
import { forwardOrganizerReply, setCartDeps } from "../server/cart-api";
import type { CartDeps } from "./cart";
import { cardsConfig, rank, searchCandidates, withDelivery, withDetail, type EventContext } from "./search";
import { printshopCandidates, printshopClient, printshopHost, type Design, type ShopBatch } from "./printshop";
import { sendGift } from "./printshop-cart";

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

/** Runs only with LIVE_PRINTSHOP=1 against the print shop at PRINTSHOP_URL (default port 3114): the designs as candidates with a quoted or refused window. */
describe.skipIf(process.env.LIVE_PRINTSHOP !== "1")("live search at the print shop", () => {
  it("lists the designs with a colour per variant and the quote's ready-by as the window", async () => {
    const ctx: EventContext = { event_date: "2030-01-10", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M6H 2A8", country: "CA" }, budget_cents: 3000, quantity: 30, today: new Date().toISOString().slice(0, 10) };
    const found = await printshopCandidates(ctx, printshopClient());
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatchObject({ shop_domain: printshopHost(), searches: ["printshop"] });
    expect(found[0].variants.length).toBeGreaterThan(0);
    expect(found.some((c) => c.delivery?.verdict === "quoted" && c.delivery.window !== null)).toBe(true);
    const { ranked, excluded } = rank(found, ctx);
    expect(ranked.length + excluded.length).toBe(found.length);
  }, 30_000);
});

/** Runs only with LIVE_PRINTSHOP=1: an organizer reply on a live batch lands in the shop's thread as a buyer message (#113). */
describe.skipIf(process.env.LIVE_PRINTSHOP !== "1")("a live reply on a print-shop gift", () => {
  it("shows the reply in the shop's batch thread with from buyer", async () => {
    resetState();
    const email = `live-reply-${Date.now()}@example.com`;
    const event = publishEvent(
      createEventFromBody({
        title: "Live reply test",
        host: "Host",
        starts_at: "2030-01-10T19:00:00Z",
        venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M6H 2A8", country: "CA" },
        delivery: { destination: "venue", address: null, needed_by: "2030-01-10" }
      }).id
    );
    const printed = snapshot(event.id).definitions.find((d) => d.key === "printed_name")!;
    submitRsvp(event.id, {
      party: { contact: { email } },
      guests: [
        { display_name: "Guest One", status: "going", answers: { [printed.id]: "Ada" } },
        { display_name: "Guest Two", status: "going", answers: { [printed.id]: "Ben" } }
      ]
    });
    const { designs } = (await printshopClient().callTool("list_designs", {})) as { designs: Design[] };
    const design = designs.find((d) => d.minimum_quantity <= 2) ?? designs[0];
    const gift = createGiftFromBody(event.id, { product_id: design.id, shop_domain: printshopHost(), product_title: design.title });
    const deps: CartDeps = { client: () => { throw new Error("no catalog"); }, now: () => new Date(), printshop: (buyerEmail) => printshopClient({ buyerEmail }) };
    setCartDeps(deps);
    await sendGift(event.id, gift.id, deps, { email });
    const text = `Reply from the live test at ${Date.now()}`;
    await forwardOrganizerReply(event.id, gift.id, postUpdate(event.id, gift.id, "organizer", { kind: "reply", text }));
    const stored = getGift(gift.id);
    const batch = (await printshopClient({ buyerEmail: email }).callTool("get_batch", { batch_id: stored.order_id ?? stored.cart_id })) as ShopBatch;
    expect(batch.thread.at(-1)).toMatchObject({ from: "buyer", kind: "message", text });
  }, 30_000);
});
