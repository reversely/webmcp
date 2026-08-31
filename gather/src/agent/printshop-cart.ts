/**
 * A gift on one of the print shop's designs, from send to delivery. Send creates the batch with one
 * unit per guest and orders it when the shop finds no issue; approve accepts the proof and freezes
 * the plan; sync rewrites the units while the batch is still quoted; each poll reads the shop's
 * change feed and writes the new entries to the gift's thread as updates from the shop.
 */
import { COUNTED, getGift, lockGift, manifest, updateGift, type GiftInput } from "../domain/gifts";
import { currentSeq, definitionsFor, getEvent } from "../domain/store";
import type { Batch, CartBuyer, Proposal, UpdateKind, VendorUpdate } from "../domain/types";
import { postUpdate } from "../server/api";
import { deliveryTarget } from "../lib/delivery";
import { CartStateError, type CartDeps } from "./cart";
import { printshopClient, printshopHost, type Changes, type Design, type PrintshopClient, type ShopBatch, type Unit } from "./printshop";

/** The caller name on an update Gather writes from the shop's thread. */
export const PRINTSHOP_CALLER = "printshop";

/** The key of the seeded definition whose answer prints on a unit. */
const PRINTED_NAME_KEY = "printed_name";

/** A unit the shop cannot print as sent, shaped like an Overview follow-up naming the guest. */
export type UnitIssue = { kind: "unit_issue"; definition_id: null; status: null; guest_ids: string[]; deadline: string | null; gift_id: string; field: string; reason: string };

/** The shop's thread kinds that reach the gift's thread, and the update kind each becomes. */
const UPDATE_KINDS: Record<string, UpdateKind> = { proof: "proof", printing: "in_production", shipped: "shipped", delivered: "delivered", message: "question" };

export function isPrintshopGift(gift: Pick<Batch, "shop_domain">): boolean {
  return gift.shop_domain === printshopHost();
}

function shopClient(deps: CartDeps, buyerEmail: string | null): PrintshopClient {
  return (deps.printshop ?? ((email) => printshopClient({ buyerEmail: email })))(buyerEmail);
}

/* ---- Pure pieces ---- */

/**
 * One unit per counted manifest row on this design. The printed-name answer fills the design's
 * name field; any other design field fills only from a definition the mapping names with the same
 * key, so no answer beyond those reaches the shop.
 */
export function unitsFor(gift: Batch, design: Design): Unit[] {
  const definitions = definitionsFor(gift.event_id);
  const printedName = definitions.find((d) => d.key === PRINTED_NAME_KEY);
  const nameField = design.fields.find((f) => f.kind === "name") ?? design.fields.find((f) => f.required) ?? design.fields[0];
  const byKey = new Map(design.fields.map((f) => [f.key, f]));
  const mapped = [...new Set(gift.mapping.map((m) => m.definition_id))].flatMap((id) => {
    const definition = definitions.find((d) => d.id === id);
    const field = definition && byKey.get(definition.key);
    return definition && field ? [{ definition_id: id, key: field.key }] : [];
  });
  return manifest(gift)
    .filter((row) => COUNTED.has(row.unit_status) && row.product_id === gift.product_id)
    .map((row) => {
      const values: Record<string, string> = {};
      const name = printedName ? row.values[printedName.id] : undefined;
      if (nameField && name !== undefined && name !== null && name !== "") values[nameField.key] = String(name);
      for (const m of mapped) {
        const value = row.values[m.definition_id];
        if (value !== undefined && value !== null && value !== "") values[m.key] = String(value);
      }
      return { recipient_ref: row.guest_id, values };
    });
}

/** The quote as a proposal: one line per colour variant at the band's unit price, the shop's total with tax. */
export function toProposal(gift: Batch, batch: ShopBatch): Proposal {
  const titles = new Map(gift.variants.map((v) => [v.id, v.title]));
  const counts = new Map<string, number>();
  for (const row of manifest(gift)) {
    if (!COUNTED.has(row.unit_status) || row.product_id !== gift.product_id) continue;
    const key = row.variant_id ?? gift.product_id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = [...counts].map(([variant_id, quantity]) => ({ variant_id, title: titles.get(variant_id) ?? null, unit_price: batch.quote.unit_cents, quantity, total: batch.quote.unit_cents * quantity }));
  return { cart_id: batch.id, currency: batch.quote.currency, lines, total: batch.quote.total_cents, continue_url: null };
}

function issuesToFollowUps(gift: Batch, batch: ShopBatch): UnitIssue[] {
  return batch.issues.map((issue) => ({ kind: "unit_issue", definition_id: null, status: null, guest_ids: [issue.recipient_ref], deadline: gift.cutoff, gift_id: gift.id, field: issue.field, reason: issue.reason }));
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/* ---- Steps ---- */

/**
 * Creates the batch (or rewrites a quoted one) with one unit per going guest and orders it when the
 * shop reports no issue; a unit with an issue leaves the batch quoted, and the issues come back as
 * follow-ups from the cart poll.
 */
export async function sendGift(eventId: string, giftId: string, deps: CartDeps, buyer: CartBuyer | null = null): Promise<Proposal> {
  const gift = getGift(giftId);
  const event = getEvent(eventId);
  if (gift.locked_at) throw new CartStateError("The gift is locked; the proof is approved.");
  if (gift.order_id) throw new CartStateError("The batch is ordered; the shop's proof is what the organizer approves next.");
  const email = buyer?.email ?? gift.buyer?.email ?? null;
  if (!email) throw new CartStateError("Send the organizer's email; the shop keeps a batch under the buyer's email.");
  const target = deliveryTarget(event);
  if (!target.needed_by) throw new CartStateError("Set where the cards are delivered and by when before sending.");
  const client = shopClient(deps, email);
  const design = (await client.callTool("get_design", { design_id: gift.product_id })) as Design;
  const units = unitsFor(gift, design);
  if (units.length === 0) throw new CartStateError("The plan resolves to no unit, so there is nothing to send.");
  const withBuyer: CartBuyer = { ...gift.buyer, ...buyer, email };
  const seq = currentSeq();
  let batch = gift.cart_id
    ? ((await client.callTool("update_batch", { batch_id: gift.cart_id, units })) as ShopBatch)
    : ((await client.callTool("create_batch", { design_id: gift.product_id, units, address: target.address, needed_by: target.needed_by, buyer: { name: event.host, email, phone: withBuyer.phone_number ?? null } })) as ShopBatch);
  if (batch.issues.length === 0) batch = (await client.callTool("order_batch", { batch_id: batch.id })) as ShopBatch;
  const proposal = toProposal(gift, batch);
  updateGift(giftId, { cart_id: batch.id, order_id: batch.issues.length === 0 ? batch.id : null, buyer: withBuyer, proposal, cart_seq: seq } as Partial<GiftInput>);
  return proposal;
}

/** Approves the proof at the shop and freezes the plan on today's date, since the shop prints what the proof shows. */
export async function approveGift(eventId: string, giftId: string, deps: CartDeps): Promise<Batch> {
  const gift = getGift(giftId);
  getEvent(eventId);
  if (!gift.order_id) throw new CartStateError("Send the gift before approving it; the shop renders the proof after the order.");
  if (gift.locked_at) return gift;
  await shopClient(deps, gift.buyer?.email ?? null).callTool("approve_proof", { batch_id: gift.order_id });
  const now = deps.now();
  const date = isoDate(now);
  updateGift(giftId, { approved_at: now.toISOString(), cutoff: date } as Partial<GiftInput>);
  // The design's name field reads the printed-name answer outside the option mapping (unitsFor), so the lock names it too (#112).
  const printed = definitionsFor(gift.event_id).find((d) => d.key === PRINTED_NAME_KEY);
  return lockGift(giftId, date, printed ? [printed.id] : []);
}

/** Rewrites the units while the batch is quoted; an ordered batch takes no unit change. */
export async function syncGift(eventId: string, giftId: string, deps: CartDeps): Promise<{ updated: boolean; proposal: Proposal | null }> {
  const gift = getGift(giftId);
  getEvent(eventId);
  if (!gift.cart_id || gift.order_id || gift.locked_at) return { updated: false, proposal: gift.proposal ?? null };
  const seq = currentSeq();
  if (gift.cart_seq === seq) return { updated: false, proposal: gift.proposal ?? null };
  const client = shopClient(deps, gift.buyer?.email ?? null);
  const design = (await client.callTool("get_design", { design_id: gift.product_id })) as Design;
  const units = unitsFor(gift, design);
  if (units.length === 0) return { updated: false, proposal: gift.proposal ?? null };
  const batch = (await client.callTool("update_batch", { batch_id: gift.cart_id, units })) as ShopBatch;
  const proposal = toProposal(gift, batch);
  updateGift(giftId, { proposal, cart_seq: seq } as Partial<GiftInput>);
  return { updated: true, proposal };
}

/** Reads the batch back, stores its quote, and names each unit the shop cannot print as sent. */
export async function refreshCart(eventId: string, giftId: string, deps: CartDeps): Promise<{ proposal: Proposal; follow_ups: UnitIssue[] }> {
  const gift = getGift(giftId);
  getEvent(eventId);
  if (!gift.cart_id) throw new CartStateError("Send the gift first; there is no batch to read.");
  const batch = (await shopClient(deps, gift.buyer?.email ?? null).callTool("get_batch", { batch_id: gift.cart_id })) as ShopBatch;
  const proposal = toProposal(gift, batch);
  updateGift(giftId, { proposal } as Partial<GiftInput>);
  return { proposal, follow_ups: issuesToFollowUps(gift, batch) };
}

/**
 * Reads the shop's change feed after the last sequence number stored on the gift and writes each
 * new thread entry of a mapped kind as an update from the shop; the shop's own messages arrive as
 * questions, the buyer's echo back as nothing.
 */
export async function pollBatch(eventId: string, giftId: string, deps: CartDeps): Promise<VendorUpdate[]> {
  const gift = getGift(giftId);
  getEvent(eventId);
  if (!gift.cart_id) return [];
  const client = shopClient(deps, gift.buyer?.email ?? null);
  const since = gift.vendor_seq ?? 0;
  const changes = (await client.callTool("get_changes", { since_seq: since })) as Changes;
  const written: VendorUpdate[] = [];
  if (changes.entries.some((e) => e.batch_id === gift.cart_id)) {
    const batch = (await client.callTool("get_batch", { batch_id: gift.cart_id })) as ShopBatch;
    for (const entry of batch.thread) {
      const kind = UPDATE_KINDS[entry.kind];
      if (entry.seq <= since || !kind || entry.from !== "shop") continue;
      written.push(postUpdate(eventId, giftId, PRINTSHOP_CALLER, { kind, text: entry.text, reference: entry.reference }));
    }
  }
  updateGift(giftId, { vendor_seq: changes.seq } as Partial<GiftInput>);
  return written;
}
