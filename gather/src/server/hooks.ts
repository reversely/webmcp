/**
 * What runs after a write. An RSVP write can change a gift's quantities, so each gift with a cart
 * and no lock gets a cart sync; the sync runs after the response so the guest's reply never waits
 * on the shop.
 */
import { syncGift } from "../agent/cart";
import { giftsFor } from "../domain/gifts";
import { cartDeps } from "./cart-api";

/** One chain per gift, so two writes in quick succession run their syncs in order and the second sees the first's cart. */
const pending = new Map<string, Promise<unknown>>();

export function afterRsvpWrite(eventId: string): void {
  for (const gift of giftsFor(eventId)) {
    if (!gift.cart_id || gift.locked_at) continue;
    const previous = pending.get(gift.id) ?? Promise.resolve();
    const next = previous.then(() => syncGift(eventId, gift.id, cartDeps())).catch((e: unknown) => console.error(`Cart sync for gift ${gift.id} failed: ${(e as Error).message}`));
    pending.set(gift.id, next);
  }
}
