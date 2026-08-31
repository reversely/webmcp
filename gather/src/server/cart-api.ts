/**
 * The cart operations the send, approve, sync, lock, and cart routes call. Each checks the gift
 * belongs to the event, validates the body, runs the agent step, and returns the gift view with
 * what the step produced, so a route stays a few lines.
 */
import { z } from "zod";
import { approveGift, CartStateError, liveDeps, lockAndCheckout, lockIsDue, pollOrder, refreshCart, sendGift, syncGift, type CartDeps, type ShortLine } from "../agent/cart";
import * as printshop from "../agent/printshop-cart";
import { getEvent } from "../domain/store";
import { CartBuyer, DeliveryWindow, type Batch } from "../domain/types";
import { BadRequestError, giftView, requireGift } from "./api";

let deps: CartDeps = liveDeps;

/** Test hook: the client factory and clock the routes and the RSVP hook use. */
import { cartOperations } from "./registry";

/** The MCP endpoint dispatches send_to_vendor and approve to these operations (organizer tokens only). */
cartOperations.send = (eventId, giftId) => sendGiftOp(eventId, giftId, {});
cartOperations.approve = (eventId, giftId) => approveGiftOp(eventId, giftId, {});

export function setCartDeps(next: CartDeps): void {
  deps = next;
}

export function cartDeps(): CartDeps {
  return deps;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

/** A gift in the wrong state for the step is the caller's error, so it answers 400 with the step that comes first. */
async function step<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof CartStateError) throw new BadRequestError(e.message);
    throw e;
  }
}

const SendBody = z.object({ buyer: CartBuyer.nullable().default(null) });

/** The shop keeps a batch under the buyer's email, so a send without one takes the event's contact. */
function printshopBuyer(eventId: string, gift: Batch, buyer: CartBuyer | null): CartBuyer | null {
  if (buyer?.email || gift.buyer?.email) return buyer;
  const { contact } = getEvent(eventId);
  if (!contact.email) throw new BadRequestError("Set the event's contact email before sending.");
  return { ...buyer, email: contact.email };
}

/** POST .../send: the cart at the shop, priced (or the print shop's batch, quoted and ordered); the proposal comes back on the gift view. */
export async function sendGiftOp(eventId: string, giftId: string, body: unknown) {
  const gift = requireGift(eventId, giftId);
  const parsed = parseBody(SendBody, body);
  const shop = printshop.isPrintshopGift(gift);
  const buyer = shop ? printshopBuyer(eventId, gift, parsed.buyer) : parsed.buyer;
  const send = shop ? printshop.sendGift : sendGift;
  const proposal = await step(() => send(eventId, giftId, deps, buyer));
  return { ...giftView(eventId, giftId), proposal };
}

const ApproveBody = z.object({ delivery_window: DeliveryWindow.nullable().default(null) });

/** POST .../approve: the organizer keeps the priced cart and the cutoff follows from the delivery window; on a print-shop gift the organizer approves the proof. */
export async function approveGiftOp(eventId: string, giftId: string, body: unknown) {
  const gift = requireGift(eventId, giftId);
  const { delivery_window } = parseBody(ApproveBody, body);
  await step(async () => (printshop.isPrintshopGift(gift) ? printshop.approveGift(eventId, giftId, deps) : approveGift(eventId, giftId, deps, delivery_window)));
  return giftView(eventId, giftId);
}

/** POST .../sync: recompute the quantities and rewrite the cart (or the batch's units) when they changed. */
export async function syncGiftOp(eventId: string, giftId: string) {
  const gift = requireGift(eventId, giftId);
  const sync = printshop.isPrintshopGift(gift) ? printshop.syncGift : syncGift;
  const result = await step(() => sync(eventId, giftId, deps));
  return { ...giftView(eventId, giftId), ...result };
}

/** POST .../lock: the checkout now, whatever the cutoff says. */
export async function lockGiftOp(eventId: string, giftId: string) {
  requireGift(eventId, giftId);
  await step(() => lockAndCheckout(eventId, giftId, deps));
  return giftView(eventId, giftId);
}

/**
 * GET .../cart: the dashboard's poll. Creates the checkout when the cutoff has arrived, reads the
 * order once one exists, and otherwise reads the cart back and names any line the shop cut short.
 * On a print-shop gift the poll reads the shop's change feed into the thread and the batch's
 * issues into the follow-ups.
 */
export async function cartView(eventId: string, giftId: string) {
  let gift = requireGift(eventId, giftId);
  let follow_ups: (ShortLine | printshop.UnitIssue)[] = [];
  let update = null;
  if (printshop.isPrintshopGift(gift)) {
    if (gift.cart_id) {
      update = (await printshop.pollBatch(eventId, giftId, deps)).at(-1) ?? null;
      follow_ups = (await step(() => printshop.refreshCart(eventId, giftId, deps))).follow_ups;
    }
    return { ...giftView(eventId, giftId), follow_ups, update };
  }
  if (lockIsDue(gift, deps.now())) gift = await step(() => lockAndCheckout(eventId, giftId, deps));
  if (gift.order_id) update = await pollOrder(eventId, giftId, deps);
  else if (gift.cart_id) follow_ups = (await step(() => refreshCart(eventId, giftId, deps))).follow_ups;
  return { ...giftView(eventId, giftId), follow_ups, update };
}
