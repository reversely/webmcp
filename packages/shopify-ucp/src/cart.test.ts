import { describe, expect, it } from "vitest";
import { cancelCart, catalogClient, createCart, createCheckoutFromCart, DEFAULT_AGENT_PROFILE_URL, getCart, getOrder, storefrontEndpoint, totalOf, updateCart } from "./index";

const SHOP = "example-shop.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/1";
const CART_ID = "gid://shopify/Cart/abc?key=k";
const BUYER = { email: "organizer@example.com", phone_number: "+10000000000" };
const DESTINATION = { first_name: "Host", last_name: "Venue", phone_number: BUYER.phone_number, street_address: "1 Street", address_locality: "City", address_region: "RG", postal_code: "00000", address_country: "CA" };

/** A cart reply in the shape a storefront returns for `create_cart`, `update_cart`, and `get_cart`. */
function cartReply(quantity: number) {
  return {
    id: CART_ID,
    currency: "CAD",
    line_items: [{ id: "gid://shopify/CartLine/1", item: { id: VARIANT, title: "Variant", price: 3000 }, quantity, totals: [{ type: "subtotal", amount: 3000 * quantity }, { type: "total", amount: 3000 * quantity }] }],
    totals: [{ type: "subtotal", amount: 3000 * quantity }, { type: "total", amount: 3000 * quantity }],
    buyer: BUYER,
    fulfillment: { methods: [] },
    continue_url: `https://${SHOP}/cart/c/abc`
  };
}

function envelope(payload: unknown) {
  return { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false } };
}

function fakeFetch(payload: unknown) {
  const requests: { url: string; body: any }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(envelope(payload)), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { client: catalogClient({ fetchImpl }), requests };
}

describe("the cart tools", () => {
  it("createCart posts create_cart at the shop with lines, buyer, and the destination as a shipping method", async () => {
    const { client, requests } = fakeFetch(cartReply(2));
    const cart = await createCart(client, SHOP, { line_items: [{ item: { id: VARIANT }, quantity: 2 }], buyer: BUYER, destination: DESTINATION });
    expect(requests[0].url).toBe(storefrontEndpoint(SHOP));
    expect(requests[0].body.params).toEqual({
      name: "create_cart",
      arguments: {
        meta: { "ucp-agent": { profile: DEFAULT_AGENT_PROFILE_URL } },
        cart: { line_items: [{ item: { id: VARIANT }, quantity: 2 }], buyer: BUYER, fulfillment: { methods: [{ type: "shipping", destinations: [DESTINATION] }] } }
      }
    });
    expect(cart.id).toBe(CART_ID);
    expect(cart.line_items[0].quantity).toBe(2);
    expect(totalOf(cart.totals)).toBe(6000);
    expect(totalOf(cart.line_items[0].totals, "subtotal")).toBe(6000);
  });

  it("updateCart carries the cart id beside the cart argument", async () => {
    const { client, requests } = fakeFetch(cartReply(1));
    await updateCart(client, SHOP, CART_ID, { line_items: [{ item: { id: VARIANT }, quantity: 1 }], buyer: BUYER });
    expect(requests[0].body.params.name).toBe("update_cart");
    expect(requests[0].body.params.arguments).toMatchObject({ id: CART_ID, cart: { line_items: [{ item: { id: VARIANT }, quantity: 1 }], buyer: BUYER } });
    expect(requests[0].body.params.arguments.cart.fulfillment).toBeUndefined();
  });

  it("getCart and cancelCart send only the id", async () => {
    const { client, requests } = fakeFetch(cartReply(1));
    await getCart(client, SHOP, CART_ID);
    await cancelCart(client, SHOP, CART_ID);
    expect(requests.map((r) => r.body.params)).toEqual([
      { name: "get_cart", arguments: { meta: { "ucp-agent": { profile: DEFAULT_AGENT_PROFILE_URL } }, id: CART_ID } },
      { name: "cancel_cart", arguments: { meta: { "ucp-agent": { profile: DEFAULT_AGENT_PROFILE_URL } }, id: CART_ID } }
    ]);
  });

  it("createCheckoutFromCart names the cart and repeats the lines the schema requires", async () => {
    const { client, requests } = fakeFetch({ ...cartReply(1), id: "gid://shopify/Checkout/1", status: "requires_escalation", continue_url: `https://${SHOP}/checkouts/1` });
    const checkout = await createCheckoutFromCart(client, SHOP, CART_ID, { line_items: [{ item: { id: VARIANT }, quantity: 1 }], buyer: BUYER, destination: DESTINATION });
    expect(requests[0].body.params.name).toBe("create_checkout");
    expect(requests[0].body.params.arguments.checkout).toMatchObject({ cart_id: CART_ID, line_items: [{ item: { id: VARIANT }, quantity: 1 }], buyer: BUYER });
    expect(checkout.continue_url).toBe(`https://${SHOP}/checkouts/1`);
  });

  it("getOrder reads the order by id and keeps its status", async () => {
    const { client, requests } = fakeFetch({ id: "gid://shopify/Order/1", status: "shipped", line_items: [], totals: [] });
    const order = await getOrder(client, SHOP, "gid://shopify/Order/1");
    expect(requests[0].body.params).toMatchObject({ name: "get_order", arguments: { id: "gid://shopify/Order/1" } });
    expect(order.status).toBe("shipped");
  });

  it("rejects a reply without a cart id as malformed", async () => {
    const { client } = fakeFetch({ line_items: [] });
    await expect(getCart(client, SHOP, CART_ID)).rejects.toMatchObject({ name: "CatalogError", kind: "malformed" });
  });
});
