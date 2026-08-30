/**
 * The cart at the shop, from send to order. Send creates the cart from the plan's quantities and
 * stores the priced proposal; approve sets the cutoff; every quantity change until the lock rewrites
 * the cart; the lock creates the checkout and freezes the values the plan reads; after payment the
 * order's status reaches the gift's thread as updates with Gather as the caller.
 *
 * Every function takes `deps` so a test injects a fake client and a fixed clock.
 */
import { addCalendarDays, catalogClient, createCart, createCheckoutFromCart, getCart, getOrder, parseIsoDate, totalOf, updateCart, type Cart, type CartInput, type CartLineInput, type CatalogClient, type CheckoutDestination, type Order } from "@webmcp/shopify-ucp";
import { getGift, lockGift, manifest, quantities, updateGift, type GiftInput } from "../domain/gifts";
import { currentSeq, getEvent } from "../domain/store";
import type { Batch, CartBuyer, DeliveryWindow, Event, Proposal, UpdateKind, VendorUpdate } from "../domain/types";
import { postUpdate, updatesFor } from "../server/api";
import { deliveryTarget } from "../lib/delivery";
import { cardsConfig } from "./search";

export type CartDeps = { client: () => CatalogClient; now: () => Date };
export const liveDeps: CartDeps = { client: () => catalogClient(), now: () => new Date() };

/** The caller name Gather writes on an update it derives from the shop's order. */
export const GATHER_CALLER = "gather";

/** The gift is in a state the call cannot act on; the message says which step comes first. */
export class CartStateError extends Error {}

/** A cart line the shop returned with fewer units than the plan asks for, shaped like an Overview follow-up. */
export type ShortLine = { kind: "short_line"; definition_id: null; status: null; guest_ids: string[]; deadline: string | null; gift_id: string; variant_id: string; asked: number; offered: number };

/* ---- Pure pieces ---- */

/** One cart line per variant the plan resolves; a row with no variant (another product's rule) has nothing to put in this shop's cart. */
export function cartLines(gift: Batch): CartLineInput[] {
  return quantities(gift)
    .filter((q) => q.variant_id !== null)
    .map((q) => ({ item: { id: q.variant_id as string }, quantity: q.quantity }));
}

/** The venue as the shipping destination, addressed to the host at the venue. */
function destinationFor(event: Event, buyer: CartBuyer | null): CheckoutDestination {
  return {
    first_name: event.host,
    last_name: deliveryTarget(event).address.name,
    ...(buyer?.phone_number ? { phone_number: buyer.phone_number } : {}),
    street_address: deliveryTarget(event).address.line1,
    address_locality: deliveryTarget(event).address.city,
    address_region: deliveryTarget(event).address.region,
    postal_code: deliveryTarget(event).address.postal_code,
    address_country: deliveryTarget(event).address.country
  };
}

function cartInput(gift: Batch, event: Event, lines: CartLineInput[]): CartInput {
  const buyer = gift.buyer ?? null;
  return { line_items: lines, ...(buyer ? { buyer } : {}), destination: destinationFor(event, buyer) };
}

export function toProposal(cart: Cart): Proposal {
  return {
    cart_id: cart.id,
    currency: cart.currency ?? null,
    lines: cart.line_items.map((l) => ({ variant_id: l.item.id, title: l.item.title ?? null, unit_price: l.item.price ?? null, quantity: l.quantity, total: totalOf(l.totals) })),
    total: totalOf(cart.totals),
    continue_url: cart.continue_url ?? null
  };
}

function sameLines(asked: CartLineInput[], have: Proposal["lines"]): boolean {
  if (asked.length !== have.length) return false;
  const byVariant = new Map(have.map((l) => [l.variant_id, l.quantity]));
  return asked.every((l) => byVariant.get(l.item.id) === l.quantity);
}

const MS_PER_DAY = 86_400_000;

/**
 * The lock date: the event date minus the delivery lead time minus the buffer, so a checkout made
 * on that date still arrives before the event. The window carries arrival dates for an order placed
 * today, so its latest date minus today is the lead time; with no window the buffer alone applies.
 */
export function cutoffFor(event: Event, window: DeliveryWindow | null, today: string, bufferDays: number): string {
  const eventDate = deliveryTarget(event).needed_by ?? event.starts_at.slice(0, 10);
  const leadDays = window ? Math.max(0, Math.round((parseIsoDate(window.latest).getTime() - parseIsoDate(today).getTime()) / MS_PER_DAY)) : 0;
  return addCalendarDays(eventDate, -(leadDays + bufferDays));
}

/** The update kind an order's status maps to: delivered once any status says so, shipped or fulfilled before that, confirmed otherwise. */
export function updateKindFor(order: Order): UpdateKind {
  const statuses = [order.status, ...(order.fulfillment?.events ?? []).map((e) => e.status)].filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase());
  if (statuses.some((s) => s.includes("deliver"))) return "delivered";
  if (statuses.some((s) => s.includes("ship") || s.includes("fulfill"))) return "shipped";
  return "confirmed";
}

/** The guests whose unit resolves to `variantId`, for a follow-up naming who a short line affects. */
function guestsOnVariant(gift: Batch, variantId: string): string[] {
  return manifest(gift)
    .filter((row) => row.variant_id === variantId)
    .map((row) => row.guest_id);
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/* ---- Steps ---- */

/** Creates the cart at the gift's shop from the plan's quantities and stores the priced proposal. */
export async function sendGift(eventId: string, giftId: string, deps: CartDeps, buyer: CartBuyer | null = null): Promise<Proposal> {
  const gift = getGift(giftId);
  const event = getEvent(eventId);
  if (gift.locked_at) throw new CartStateError("The gift is locked; the checkout already exists.");
  const lines = cartLines(gift);
  if (lines.length === 0) throw new CartStateError("The plan resolves to no unit, so there is nothing to send.");
  const withBuyer: Batch = { ...gift, buyer: buyer ?? gift.buyer ?? null };
  const seq = currentSeq();
  const cart = await createCart(deps.client(), gift.shop_domain, cartInput(withBuyer, event, lines));
  const proposal = toProposal(cart);
  updateGift(giftId, { cart_id: cart.id, buyer: withBuyer.buyer, proposal, cart_seq: seq } as Partial<GiftInput>);
  return proposal;
}

/** Records the organizer's approval and sets the cutoff from the delivery window and the buffer in cards.json. */
export function approveGift(eventId: string, giftId: string, deps: CartDeps, window: DeliveryWindow | null = null): Batch {
  const gift = getGift(giftId);
  const event = getEvent(eventId);
  if (!gift.cart_id) throw new CartStateError("Send the gift before approving it; the priced cart is what the organizer approves.");
  const now = deps.now();
  const cutoff = cutoffFor(event, window ?? gift.delivery_window ?? null, isoDate(now), cardsConfig().delivery_buffer_days);
  return updateGift(giftId, { approved_at: now.toISOString(), cutoff, delivery_window: window ?? gift.delivery_window ?? null } as Partial<GiftInput>);
}

/**
 * Recomputes the quantities and rewrites the cart when they differ from the lines it holds.
 * Runs after every RSVP write until the lock; a locked gift's cart never changes again.
 */
export async function syncGift(eventId: string, giftId: string, deps: CartDeps): Promise<{ updated: boolean; proposal: Proposal | null }> {
  const gift = getGift(giftId);
  if (!gift.cart_id || gift.locked_at) return { updated: false, proposal: gift.proposal ?? null };
  const lines = cartLines(gift);
  if (gift.proposal && sameLines(lines, gift.proposal.lines)) return { updated: false, proposal: gift.proposal };
  const seq = currentSeq();
  const cart = await updateCart(deps.client(), gift.shop_domain, gift.cart_id, { line_items: lines, ...(gift.buyer ? { buyer: gift.buyer } : {}) });
  const proposal = toProposal(cart);
  updateGift(giftId, { proposal, cart_seq: seq } as Partial<GiftInput>);
  return { updated: true, proposal };
}

/** Reads the cart back from the shop, stores it, and names each line the shop returned short of the plan's quantity. */
export async function refreshCart(eventId: string, giftId: string, deps: CartDeps): Promise<{ proposal: Proposal; follow_ups: ShortLine[] }> {
  const gift = getGift(giftId);
  if (!gift.cart_id) throw new CartStateError("Send the gift first; there is no cart to read.");
  const cart = await getCart(deps.client(), gift.shop_domain, gift.cart_id);
  const proposal = toProposal(cart);
  updateGift(giftId, { proposal } as Partial<GiftInput>);
  const offered = new Map(proposal.lines.map((l) => [l.variant_id, l.quantity]));
  const follow_ups: ShortLine[] = [];
  for (const line of cartLines(gift)) {
    const have = offered.get(line.item.id) ?? 0;
    if (have < line.quantity) follow_ups.push({ kind: "short_line", definition_id: null, status: null, guest_ids: guestsOnVariant(gift, line.item.id), deadline: gift.cutoff, gift_id: giftId, variant_id: line.item.id, asked: line.quantity, offered: have });
  }
  return { proposal, follow_ups };
}

/** Creates the checkout from the cart, stores its id and URL, and locks the gift on today's date. */
export async function lockAndCheckout(eventId: string, giftId: string, deps: CartDeps): Promise<Batch> {
  const gift = getGift(giftId);
  if (gift.locked_at) return gift;
  if (!gift.cart_id) throw new CartStateError("Send the gift first; the checkout comes from the cart.");
  if (!gift.approved_at) throw new CartStateError("The organizer approves the priced cart before any checkout.");
  const checkout = await createCheckoutFromCart(deps.client(), gift.shop_domain, gift.cart_id, cartInput(gift, getEvent(eventId), cartLines(gift)));
  const date = isoDate(deps.now());
  updateGift(giftId, { checkout_id: checkout.id, checkout_url: checkout.continue_url ?? null, order_id: checkout.order?.id ?? gift.order_id, cutoff: gift.cutoff ?? date } as Partial<GiftInput>);
  return lockGift(giftId, date);
}

/** True once the gift is approved, unlocked, and its cutoff has arrived. */
export function lockIsDue(gift: Batch, now: Date): boolean {
  return gift.approved_at !== null && gift.approved_at !== undefined && gift.locked_at === null && gift.cutoff !== null && gift.cutoff <= isoDate(now);
}

/** Reads the order and writes its status to the thread when it moved on since Gather's last update. */
export async function pollOrder(eventId: string, giftId: string, deps: CartDeps): Promise<VendorUpdate | null> {
  const gift = getGift(giftId);
  if (!gift.order_id) return null;
  const order = await getOrder(deps.client(), gift.shop_domain, gift.order_id);
  const kind = updateKindFor(order);
  const last = updatesFor(eventId, giftId).filter((u) => u.caller === GATHER_CALLER).at(-1);
  if (last?.kind === kind) return null;
  return postUpdate(eventId, giftId, GATHER_CALLER, { kind, text: `Order ${order.id}: ${order.status ?? kind}.`, reference: order.id });
}
