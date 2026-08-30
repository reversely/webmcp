/**
 * The cart operations the send, approve, sync, lock, and cart routes call. Each checks the gift
 * belongs to the event, validates the body, runs the agent step, and returns the gift view with
 * what the step produced, so a route stays a few lines.
 */
import { z } from "zod";
import { approveGift, CartStateError, liveDeps, lockAndCheckout, lockIsDue, pollOrder, refreshCart, sendGift, syncGift, type CartDeps, type ShortLine } from "../agent/cart";
import { CartBuyer, DeliveryWindow } from "../domain/types";
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

/** POST .../send: the cart at the shop, priced; the proposal comes back on the gift view. */
export async function sendGiftOp(eventId: string, giftId: string, body: unknown) {
  requireGift(eventId, giftId);
  const { buyer } = parseBody(SendBody, body);
  const proposal = await step(() => sendGift(eventId, giftId, deps, buyer));
  return { ...giftView(eventId, giftId), proposal };
}

const ApproveBody = z.object({ delivery_window: DeliveryWindow.nullable().default(null) });

/** POST .../approve: the organizer keeps the priced cart; the cutoff follows from the delivery window. */
export async function approveGiftOp(eventId: string, giftId: string, body: unknown) {
  requireGift(eventId, giftId);
  const { delivery_window } = parseBody(ApproveBody, body);
  await step(async () => approveGift(eventId, giftId, deps, delivery_window));
  return giftView(eventId, giftId);
}

/** POST .../sync: recompute the quantities and rewrite the cart when they changed. */
export async function syncGiftOp(eventId: string, giftId: string) {
  requireGift(eventId, giftId);
  const result = await step(() => syncGift(eventId, giftId, deps));
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
 */
export async function cartView(eventId: string, giftId: string) {
  let gift = requireGift(eventId, giftId);
  if (lockIsDue(gift, deps.now())) gift = await step(() => lockAndCheckout(eventId, giftId, deps));
  let follow_ups: ShortLine[] = [];
  let update = null;
  if (gift.order_id) update = await pollOrder(eventId, giftId, deps);
  else if (gift.cart_id) follow_ups = (await step(() => refreshCart(eventId, giftId, deps))).follow_ups;
  return { ...giftView(eventId, giftId), follow_ups, update };
}
