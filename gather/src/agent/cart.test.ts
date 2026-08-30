import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogClient, storefrontEndpoint } from "@webmcp/shopify-ucp";
import { publishEvent, resetState, upsertDefinition } from "../domain/store";
import { getGift, updateGift, type GiftInput } from "../domain/gifts";
import { createEventFromBody, createGiftFromBody, patchRsvp, snapshot, submitRsvp, updatesFor } from "../server/api";
import { cartView, setCartDeps } from "../server/cart-api";
import { approveGift, cutoffFor, lockAndCheckout, pollOrder, refreshCart, sendGift, syncGift, type CartDeps } from "./cart";

const SHOP = "example-shop.myshopify.com";
const VARIANT_A = "gid://shopify/ProductVariant/a";
const VARIANT_B = "gid://shopify/ProductVariant/b";
const PRICE = 3000;
const CART_ID = "gid://shopify/Cart/1?key=k";
const CHECKOUT_ID = "gid://shopify/Checkout/1";
const ORDER_ID = "gid://shopify/Order/1";
const BUYER = { email: "organizer@example.com", phone_number: "+10000000000" };
const TODAY = new Date("2029-12-01T12:00:00Z");

const EVENT = {
  title: "Test event",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" },
  rsvp_deadline: "2030-01-03"
};
const OPTIONS = [{ value: "a", label: "Option A" }, { value: "none", label: "None" }];

type Line = { item: { id: string }; quantity: number };
type Call = { tool: string; endpoint: string; args: Record<string, any> };

/**
 * A shop behind a fake fetch: it prices every line at PRICE, keeps the last cart it returned, and
 * can be told to return a line short (`short`) or an order status (`orderStatus`).
 */
function fakeShop() {
  const shop = { calls: [] as Call[], short: null as { variant_id: string; quantity: number } | null, orderStatus: "confirmed", lines: [] as Line[] };
  const priced = (lines: Line[]) => {
    const line_items = lines.map((l) => {
      const quantity = shop.short?.variant_id === l.item.id ? shop.short.quantity : l.quantity;
      return { id: `line-${l.item.id}`, item: { id: l.item.id, title: `Variant ${l.item.id.slice(-1)}`, price: PRICE }, quantity, totals: [{ type: "total", amount: PRICE * quantity }] };
    });
    return { line_items, currency: "CAD", totals: [{ type: "total", amount: line_items.reduce((sum, l) => sum + l.totals[0].amount, 0) }] };
  };
  const reply = (tool: string, args: Record<string, any>): unknown => {
    switch (tool) {
      case "create_cart":
      case "update_cart":
        shop.lines = args.cart.line_items;
        return { id: CART_ID, ...priced(shop.lines), continue_url: `https://${SHOP}/cart/c/1` };
      case "get_cart":
      case "cancel_cart":
        return { id: CART_ID, ...priced(shop.lines) };
      case "create_checkout":
        return { id: CHECKOUT_ID, status: "requires_escalation", ...priced(args.checkout.line_items), continue_url: `https://${SHOP}/checkouts/1` };
      case "get_order":
        return { id: ORDER_ID, status: shop.orderStatus, line_items: [], totals: [] };
      default:
        throw new Error(`The fake shop has no ${tool}.`);
    }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    const { meta: _meta, ...args } = body.params.arguments;
    shop.calls.push({ tool: body.params.name, endpoint: String(input), args });
    const payload = reply(body.params.name, args);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }), { status: 200 });
  };
  const deps: CartDeps = { client: () => catalogClient({ fetchImpl }), now: () => TODAY };
  return { ...shop, deps, calls: shop.calls, of: (tool: string) => shop.calls.filter((c) => c.tool === tool), setShort: (s: typeof shop.short) => (shop.short = s), setOrderStatus: (s: string) => (shop.orderStatus = s) };
}

/** A published event with a dietary question, three guests (two going, one maybe), and a gift mapped by dietary value. */
function seed() {
  const event = publishEvent(createEventFromBody(EVENT).id);
  const dietary = upsertDefinition(event.id, { ...snapshot(event.id).definitions.find((d) => d.key === "dietary")!, constraints: { options: OPTIONS } });
  const reply = submitRsvp(event.id, {
    party: { contact: { email: BUYER.email } },
    guests: [
      { display_name: "Guest One", status: "going", answers: { [dietary.id]: ["a"] } },
      { display_name: "Guest Two", status: "going", answers: { [dietary.id]: ["none"] } },
      { display_name: "Guest Three", status: "maybe" }
    ]
  });
  const gift = createGiftFromBody(event.id, {
    product_id: "gid://shopify/Product/1",
    shop_domain: SHOP,
    variants: [{ id: VARIANT_A, title: "Variant a", price_cents: PRICE, currency: "CAD" }, { id: VARIANT_B, title: "Variant b", price_cents: PRICE, currency: "CAD" }],
    mapping: [{ definition_id: dietary.id, value: "a", variant_id: VARIANT_A }, { definition_id: dietary.id, value: "none", variant_id: VARIANT_B }],
    default_variant_id: VARIANT_B
  });
  return { event, dietary, gift, guestIds: reply.guest_ids };
}

describe("the cart from send to order", () => {
  beforeEach(resetState);

  it("send creates the cart with one line per variant, the buyer, and the venue, and stores the priced proposal", async () => {
    const shop = fakeShop();
    const { event, gift } = seed();
    const proposal = await sendGift(event.id, gift.id, shop.deps, BUYER);
    const [call] = shop.of("create_cart");
    expect(call.endpoint).toBe(storefrontEndpoint(SHOP));
    expect(call.args.cart.line_items).toEqual([{ item: { id: VARIANT_A }, quantity: 1 }, { item: { id: VARIANT_B }, quantity: 1 }]);
    expect(call.args.cart.buyer).toEqual(BUYER);
    expect(call.args.cart.fulfillment.methods[0].destinations[0]).toMatchObject({ first_name: "Host", last_name: "Venue", street_address: "1 Street", address_locality: "City", address_region: "RG", postal_code: "00000", address_country: "CA", phone_number: BUYER.phone_number });
    expect(proposal).toEqual({
      cart_id: CART_ID,
      currency: "CAD",
      lines: [{ variant_id: VARIANT_A, title: "Variant a", unit_price: PRICE, quantity: 1, total: PRICE }, { variant_id: VARIANT_B, title: "Variant b", unit_price: PRICE, quantity: 1, total: PRICE }],
      total: 2 * PRICE,
      continue_url: `https://${SHOP}/cart/c/1`
    });
    expect(getGift(gift.id)).toMatchObject({ cart_id: CART_ID, proposal, buyer: BUYER, cart_seq: expect.any(Number) });
  });

  it("a cancellation before the lock lowers the quantity and rewrites the cart once; an unchanged plan sends nothing", async () => {
    const shop = fakeShop();
    const { event, gift, guestIds } = seed();
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    expect(await syncGift(event.id, gift.id, shop.deps)).toMatchObject({ updated: false });
    patchRsvp(event.id, guestIds[1], { status: "cant_go" });
    const result = await syncGift(event.id, gift.id, shop.deps);
    expect(result.updated).toBe(true);
    expect(shop.of("update_cart")).toHaveLength(1);
    expect(shop.of("update_cart")[0].args).toMatchObject({ id: CART_ID, cart: { line_items: [{ item: { id: VARIANT_A }, quantity: 1 }], buyer: BUYER } });
    expect(result.proposal?.total).toBe(PRICE);
    expect(getGift(gift.id).proposal?.lines).toHaveLength(1);
  });

  it("the RSVP hook runs the sync after a guest edit, so one status change is one update_cart", async () => {
    const shop = fakeShop();
    setCartDeps(shop.deps);
    const { event, gift, guestIds } = seed();
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    patchRsvp(event.id, guestIds[1], { status: "cant_go" });
    patchRsvp(event.id, guestIds[0], { answers: {} });
    await vi.waitFor(() => expect(getGift(gift.id).proposal?.total).toBe(PRICE));
    await new Promise((r) => setTimeout(r, 10));
    expect(shop.of("update_cart")).toHaveLength(1);
  });

  it("approve needs a cart and sets the cutoff from the delivery window and the buffer", async () => {
    const shop = fakeShop();
    const { event, gift } = seed();
    expect(() => approveGift(event.id, gift.id, shop.deps)).toThrow(/Send the gift/);
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    const approved = approveGift(event.id, gift.id, shop.deps, { earliest: "2029-12-04", latest: "2029-12-06" });
    expect(approved.approved_at).toBe(TODAY.toISOString());
    // Event 2030-01-10, five days of lead time, three days of buffer.
    expect(approved.cutoff).toBe("2030-01-02");
    expect(cutoffFor(event, null, "2029-12-01", 3)).toBe("2030-01-07");
  });

  it("the lock needs approval, creates the checkout, freezes the plan's values, and stops cart updates", async () => {
    const shop = fakeShop();
    const { event, gift, dietary, guestIds } = seed();
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    await expect(lockAndCheckout(event.id, gift.id, shop.deps)).rejects.toThrow(/approves/);
    approveGift(event.id, gift.id, shop.deps);
    const locked = await lockAndCheckout(event.id, gift.id, shop.deps);
    expect(shop.of("create_checkout")[0].args.checkout).toMatchObject({ cart_id: CART_ID, line_items: [{ item: { id: VARIANT_A }, quantity: 1 }, { item: { id: VARIANT_B }, quantity: 1 }] });
    expect(locked).toMatchObject({ checkout_id: CHECKOUT_ID, checkout_url: `https://${SHOP}/checkouts/1`, locked_at: "2029-12-01", locked_guest_ids: [guestIds[0], guestIds[1]] });
    expect(() => patchRsvp(event.id, guestIds[0], { answers: { [dietary.id]: ["none"] } })).toThrow(/locked/);
    patchRsvp(event.id, guestIds[1], { status: "cant_go" });
    expect(await syncGift(event.id, gift.id, shop.deps)).toMatchObject({ updated: false });
    await lockAndCheckout(event.id, gift.id, shop.deps);
    expect(shop.of("update_cart")).toHaveLength(0);
    expect(shop.of("create_checkout")).toHaveLength(1);
  });

  it("the cart poll locks the gift once the cutoff arrives", async () => {
    const shop = fakeShop();
    setCartDeps(shop.deps);
    const { event, gift } = seed();
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    approveGift(event.id, gift.id, shop.deps);
    updateGift(gift.id, { cutoff: "2029-12-01" } as Partial<GiftInput>);
    const view = await cartView(event.id, gift.id);
    expect(view.locked_at).toBe("2029-12-01");
    expect(view.checkout_id).toBe(CHECKOUT_ID);
  });

  it("a cart line the shop returns short of the plan raises a follow-up naming the guests on that variant", async () => {
    const shop = fakeShop();
    const { event, gift, guestIds } = seed();
    await sendGift(event.id, gift.id, shop.deps, BUYER);
    expect((await refreshCart(event.id, gift.id, shop.deps)).follow_ups).toEqual([]);
    shop.setShort({ variant_id: VARIANT_A, quantity: 0 });
    const { proposal, follow_ups } = await refreshCart(event.id, gift.id, shop.deps);
    expect(follow_ups).toEqual([{ kind: "short_line", definition_id: null, status: null, guest_ids: [guestIds[0]], deadline: null, gift_id: gift.id, variant_id: VARIANT_A, asked: 1, offered: 0 }]);
    expect(proposal.total).toBe(PRICE);
  });

  it("pollOrder writes the order's status as an update from Gather and repeats nothing", async () => {
    const shop = fakeShop();
    const { event, gift } = seed();
    expect(await pollOrder(event.id, gift.id, shop.deps)).toBeNull();
    updateGift(gift.id, { order_id: ORDER_ID } as Partial<GiftInput>);
    const first = await pollOrder(event.id, gift.id, shop.deps);
    expect(first).toMatchObject({ caller: "gather", kind: "confirmed", reference: ORDER_ID, gift_id: gift.id });
    expect(await pollOrder(event.id, gift.id, shop.deps)).toBeNull();
    shop.setOrderStatus("shipped");
    expect(await pollOrder(event.id, gift.id, shop.deps)).toMatchObject({ kind: "shipped" });
    shop.setOrderStatus("delivered");
    expect(await pollOrder(event.id, gift.id, shop.deps)).toMatchObject({ kind: "delivered" });
    expect(updatesFor(event.id, gift.id).map((u) => u.kind)).toEqual(["confirmed", "shipped", "delivered"]);
  });
});
