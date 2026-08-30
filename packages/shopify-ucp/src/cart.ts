/**
 * The cart, checkout, and order tools at a shop's own endpoint. A cart carries one line per
 * variant at a quantity, the buyer's email and phone, and one shipping destination; the shop
 * prices it and returns the same line list with totals. `create_checkout` from a cart returns the
 * shop's hosted checkout URL; the buyer pays there and `get_order` reads the result.
 *
 * Every argument shape below matches the `tools/list` input schema a Shopify storefront serves:
 * `create_cart` takes `{ cart }`, `update_cart` takes `{ id, cart }`, `get_cart`, `cancel_cart`,
 * and `get_order` take `{ id }`, and `create_checkout` takes `{ checkout }` with `cart_id`
 * beside the (required) line items.
 */
import { z } from "zod";
import type { CheckoutDestination } from "./checkout";
import { storefrontEndpoint, type CatalogClient } from "./client";
import { CatalogMessage } from "./types";

export type CartLineInput = { item: { id: string }; quantity: number };
export type CartBuyer = { email?: string; phone_number?: string };
export type CartInput = { line_items: CartLineInput[]; buyer?: CartBuyer; destination?: CheckoutDestination };

/** One `{ type, amount }` row of a cart's or a line's totals; amounts are in the currency's minor unit. */
export const CartTotal = z.looseObject({ type: z.string(), amount: z.number(), display_text: z.string().optional() });
export type CartTotal = z.infer<typeof CartTotal>;

export const CartLine = z.looseObject({
  id: z.string().optional(),
  item: z.looseObject({ id: z.string(), title: z.string().optional(), price: z.number().optional(), image_url: z.string().optional() }),
  quantity: z.number(),
  totals: z.array(CartTotal).default([])
});
export type CartLine = z.infer<typeof CartLine>;

const Link = z.looseObject({ type: z.string().optional(), title: z.string().optional(), url: z.string().optional() });

const Priced = {
  id: z.string(),
  status: z.string().optional(),
  currency: z.string().optional(),
  line_items: z.array(CartLine).default([]),
  totals: z.array(CartTotal).default([]),
  buyer: z.looseObject({ email: z.string().optional(), phone_number: z.string().optional() }).optional(),
  links: z.array(Link).default([]),
  messages: z.array(CatalogMessage).default([]),
  continue_url: z.string().optional(),
  expires_at: z.string().optional()
};

export const Cart = z.looseObject(Priced);
export type Cart = z.infer<typeof Cart>;

export const Checkout = z.looseObject({ ...Priced, order: z.looseObject({ id: z.string().optional() }).optional() });
export type Checkout = z.infer<typeof Checkout>;

export const Order = z.looseObject({
  id: z.string(),
  status: z.string().optional(),
  line_items: z.array(CartLine).default([]),
  totals: z.array(CartTotal).default([]),
  fulfillment: z.looseObject({ events: z.array(z.looseObject({ status: z.string().optional(), occurred_at: z.string().optional() })).optional() }).optional(),
  messages: z.array(CatalogMessage).default([])
});
export type Order = z.infer<typeof Order>;

/** The amount of the row of `type` in a totals list, or null when the shop returned none. */
export function totalOf(totals: CartTotal[], type = "total"): number | null {
  return totals.find((t) => t.type === type)?.amount ?? null;
}

function shopClient(client: CatalogClient, shopHost: string): CatalogClient {
  return client.withEndpoint(storefrontEndpoint(shopHost));
}

/** The `cart` (or `checkout`) argument: lines, buyer, and the destination as one shipping method. */
function cartArgument(input: CartInput): Record<string, unknown> {
  return {
    line_items: input.line_items,
    ...(input.buyer ? { buyer: input.buyer } : {}),
    ...(input.destination ? { fulfillment: { methods: [{ type: "shipping", destinations: [input.destination] }] } } : {})
  };
}

export function createCart(client: CatalogClient, shopHost: string, input: CartInput): Promise<Cart> {
  return shopClient(client, shopHost).callTool("create_cart", { cart: cartArgument(input) }, Cart);
}

/**
 * Sets the cart's lines to `input.line_items`. The buyer goes along because the shop drops it from
 * a cart it rewrites without one; the destination stays out because `update_cart` requires each
 * fulfillment method to name line item ids, which the rewrite reassigns.
 */
export function updateCart(client: CatalogClient, shopHost: string, cartId: string, input: Omit<CartInput, "destination">): Promise<Cart> {
  return shopClient(client, shopHost).callTool("update_cart", { id: cartId, cart: cartArgument(input) }, Cart);
}

export function getCart(client: CatalogClient, shopHost: string, cartId: string): Promise<Cart> {
  return shopClient(client, shopHost).callTool("get_cart", { id: cartId }, Cart);
}

export function cancelCart(client: CatalogClient, shopHost: string, cartId: string): Promise<Cart> {
  return shopClient(client, shopHost).callTool("cancel_cart", { id: cartId }, Cart);
}

/** A checkout from the cart; the shop reads the lines and buyer off the cart and ignores the copies the schema still requires. */
export function createCheckoutFromCart(client: CatalogClient, shopHost: string, cartId: string, input: CartInput): Promise<Checkout> {
  return shopClient(client, shopHost).callTool("create_checkout", { checkout: { cart_id: cartId, ...cartArgument(input) } }, Checkout);
}

export function getOrder(client: CatalogClient, shopHost: string, orderId: string): Promise<Order> {
  return shopClient(client, shopHost).callTool("get_order", { id: orderId }, Order);
}
