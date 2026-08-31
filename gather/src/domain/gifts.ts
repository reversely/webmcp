/**
 * The gift plan and its per-guest resolution (PRD Sections 9 and 10). A Batch stores what the
 * organizer decided: rules, mapping rows, fallbacks, overrides. Resolution is a pure read over the
 * store, so every value write, status change, plan edit, or definition change shows on the next read
 * with no recompute step to schedule.
 */
import { matches, type Subject } from "./filter";
import { personalized, personalizeRow, type RowPersonalization } from "./personalization";
import { getDefinition, getEvent, guestsFor, lockValue, newId, state, subjectFor } from "./store";
import type { AttributeDefinition, Batch, GiftOverride, Option, SynonymRow, UnitStatus, Variant, VariantMappingRow } from "./types";
import synonymData from "./synonyms.json";

export type Resolution = { product_id: string | null; variant_id: string | null; unit_status: UnitStatus; reason?: string };
export type ManifestRow = Resolution & { guest_id: string; display_name: string; status: Subject["guest"]["status"]; values: Record<string, unknown> } & Partial<RowPersonalization>;
export type Quantity = { product_id: string; variant_id: string | null; quantity: number };

export type GiftInput = Omit<Batch, "id" | "event_id" | "overrides" | "locked_at" | "locked_guest_ids" | "locked_definition_ids">;

/* ---- Records ---- */

export function createGift(eventId: string, input: GiftInput): Batch {
  const s = state();
  const gift: Batch = { ...input, id: newId("gift"), event_id: eventId, overrides: {}, locked_at: null, locked_guest_ids: [], locked_definition_ids: [] };
  s.gifts.set(gift.id, gift);
  return gift;
}

export function getGift(id: string): Batch {
  const gift = state().gifts.get(id);
  if (!gift) throw new Error(`No gift ${id}.`);
  return gift;
}

export function updateGift(id: string, patch: Partial<GiftInput>): Batch {
  const s = state();
  const gift = { ...getGift(id), ...patch };
  s.gifts.set(id, gift);
  return gift;
}

export function removeGift(id: string): void {
  state().gifts.delete(id);
}

export function giftsFor(eventId: string): Batch[] {
  return [...state().gifts.values()].filter((g) => g.event_id === eventId);
}

/** Stores or clears the organizer's decision for one guest; an override with no field removes the row. */
export function setGiftOverride(id: string, guestId: string, override: GiftOverride): Batch {
  const gift = getGift(id);
  const overrides = { ...gift.overrides };
  if (override.variant_id === undefined && override.excluded === undefined) delete overrides[guestId];
  else overrides[guestId] = override;
  return updateGift(id, { overrides } as Partial<GiftInput>);
}

/**
 * Freezes the batch at the lock date: records which guests hold a unit and locks every definition
 * the units read, so a later cancellation resolves through the post-lock choice instead of dropping
 * out. That set is the option mapping, each personalization mapping's definition source, and any
 * extra id the vendor path names (#112: the printed name a print-shop design's name field reads).
 * The set is stored on the batch because lockValue marks only values that exist at the lock;
 * writeValue consults the stored ids, so a guest with no value at the lock is refused all the same.
 */
export function lockGift(id: string, date: string, extraDefinitionIds: string[] = []): Batch {
  const gift = getGift(id);
  const rows = manifest(gift).filter((row) => COUNTED.has(row.unit_status));
  const mappingSourceIds = (gift.personalization_mappings ?? []).flatMap((m) => (m.source.type === "definition" ? [m.source.definition_id] : []));
  const definitionIds = [...new Set([...gift.mapping.map((m) => m.definition_id), ...mappingSourceIds, ...extraDefinitionIds])];
  for (const row of rows) for (const definitionId of definitionIds) lockValue("guest", row.guest_id, definitionId, { batch_id: gift.id, date });
  return updateGift(id, { locked_at: date, locked_guest_ids: rows.map((r) => r.guest_id), locked_definition_ids: definitionIds } as Partial<GiftInput>);
}

/* ---- Variant mapping ---- */

export function synonyms(): SynonymRow[] {
  return (synonymData as { rows: SynonymRow[] }).rows;
}

function titleMatchesLabel(title: string, option: Option): boolean {
  if (title.toLowerCase().includes(option.label.toLowerCase())) return true;
  return synonyms().some((row) => new RegExp(row.option_label_pattern, "i").test(option.label) && new RegExp(row.variant_title_pattern, "i").test(title));
}

/** Proposes one mapping row per option whose label appears in a variant title; the rest go back to the organizer. */
export function proposeMapping(definition: AttributeDefinition, variants: Variant[]): { rows: VariantMappingRow[]; unmatched: Option[] } {
  const rows: VariantMappingRow[] = [];
  const unmatched: Option[] = [];
  for (const option of definition.constraints.options ?? []) {
    const variant = variants.find((v) => titleMatchesLabel(v.title, option));
    if (variant) rows.push({ definition_id: definition.id, value: option.value, variant_id: variant.id });
    else unmatched.push(option);
  }
  return { rows, unmatched };
}

/* ---- Resolution ---- */

const isMissing = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function labelOf(definitionId: string): string {
  try {
    return getDefinition(definitionId).label;
  } catch {
    return definitionId;
  }
}

/** Looks the guest's value up in the mapping rows; a multi-value answer takes the first element with a row. */
function mappedVariant(gift: Batch, values: Record<string, unknown>): { variant_id: string } | { missing: true } | { unmatched: string } {
  const byKey = new Map(gift.mapping.map((m) => [`${m.definition_id}|${m.value}`, m.variant_id]));
  const definitionIds = [...new Set(gift.mapping.map((m) => m.definition_id))];
  let unmatched: string | null = null;
  let anyPresent = false;
  for (const definitionId of definitionIds) {
    const value = values[definitionId];
    if (isMissing(value)) continue;
    anyPresent = true;
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      const variantId = byKey.get(`${definitionId}|${String(candidate)}`);
      if (variantId) return { variant_id: variantId };
    }
    unmatched ??= `${labelOf(definitionId)} value ${candidates.map(String).join(", ")} maps to no variant.`;
  }
  if (anyPresent && unmatched) return { unmatched };
  return { missing: true };
}

function variantFor(gift: Batch, values: Record<string, unknown>): Pick<Resolution, "variant_id" | "unit_status" | "reason"> {
  if (gift.mapping.length === 0) return { variant_id: gift.default_variant_id, unit_status: "open" };
  const found = mappedVariant(gift, values);
  if ("variant_id" in found) return { variant_id: found.variant_id, unit_status: "open" };
  if ("unmatched" in found) return { variant_id: null, unit_status: "unservable", reason: found.unmatched };
  const labels = [...new Set(gift.mapping.map((m) => m.definition_id))].map(labelOf).join(", ");
  switch (gift.missing_value_fallback) {
    case "default":
      return { variant_id: gift.default_variant_id, unit_status: "open" };
    case "hold":
      return { variant_id: null, unit_status: "held", reason: `No value for ${labels}; the unit waits for one.` };
    case "blank":
      return { variant_id: null, unit_status: "excluded", reason: `No value for ${labels}; the fallback leaves the guest out.` };
  }
}

/**
 * Resolves one guest against the plan (PRD Stage 4): the organizer's override first, then the
 * post-lock cancellation choice, then the first matching rule's product and the mapped variant.
 */
export function resolveGuest(gift: Batch, subject: Subject): Resolution {
  const override = gift.overrides[subject.guest.id];
  if (override?.excluded) return { product_id: null, variant_id: null, unit_status: "excluded", reason: "Excluded by the organizer." };
  const rule = gift.rules.find((r) => matches(r.filter, subject));
  const locked = gift.locked_at !== null && gift.locked_guest_ids.includes(subject.guest.id);
  if (locked && subject.guest.status === "cant_go") return cancelledAfterLock(gift, rule?.product_id ?? gift.product_id, override);
  if (!rule) return { product_id: null, variant_id: null, unit_status: "excluded", reason: "No plan rule matches." };
  const resolved: Resolution = rule.product_id === gift.product_id ? { product_id: rule.product_id, ...variantFor(gift, subject.values) } : { product_id: rule.product_id, variant_id: null, unit_status: "open" };
  if (override?.variant_id) return { product_id: rule.product_id, variant_id: override.variant_id, unit_status: locked ? "locked" : "open" };
  if (locked && resolved.unit_status === "open") return { ...resolved, unit_status: "locked" };
  return resolved;
}

function cancelledAfterLock(gift: Batch, productId: string, override: GiftOverride | undefined): Resolution {
  const variantId = override?.variant_id ?? null;
  switch (gift.post_lock_cancellation) {
    case "keep":
      return { product_id: productId, variant_id: variantId, unit_status: "cancelled_sunk", reason: "Cancelled after the lock; the unit stays in the order." };
    case "reassign":
      return { product_id: productId, variant_id: variantId, unit_status: "cancelled_reassignable", reason: "Cancelled after the lock; the unit can go to another guest." };
    case "drop":
      return { product_id: null, variant_id: null, unit_status: "excluded", reason: "Cancelled after the lock; the unit leaves the order." };
  }
}

/** The unit statuses a cart line counts: a kept or reassignable cancelled unit still ships. */
export const COUNTED: ReadonlySet<UnitStatus> = new Set(["open", "locked", "cancelled_sunk", "cancelled_reassignable"]);

/** One row per guest the recipients filter selects, plus any guest the lock recorded. A personalized product's rows carry the resolved per-guest values (#117). */
export function manifest(gift: Batch): ManifestRow[] {
  const locked = new Set(gift.locked_guest_ids);
  const event = personalized(gift) ? getEvent(gift.event_id) : null;
  return guestsFor(gift.event_id)
    .map((guest) => subjectFor(guest))
    .filter((subject) => locked.has(subject.guest.id) || matches(gift.recipients, subject))
    .map((subject) => ({ guest_id: subject.guest.id, display_name: subject.guest.display_name, status: subject.guest.status, values: subject.values, ...resolveGuest(gift, subject), ...(event ? personalizeRow(gift, event, subject) : {}) }));
}

/** Units per product and variant, excluding unservable, held, and excluded rows. */
export function quantities(gift: Batch): Quantity[] {
  const totals = new Map<string, Quantity>();
  for (const row of manifest(gift)) {
    if (!COUNTED.has(row.unit_status) || !row.product_id) continue;
    const key = `${row.product_id}|${row.variant_id ?? ""}`;
    const entry = totals.get(key) ?? { product_id: row.product_id, variant_id: row.variant_id, quantity: 0 };
    entry.quantity += 1;
    totals.set(key, entry);
  }
  return [...totals.values()];
}

/** Guests each gift cannot serve, with the reason, for the Overview's follow-ups. */
export function unservable(eventId: string): { gift_id: string; guests: { guest_id: string; reason: string }[] }[] {
  return giftsFor(eventId)
    .map((gift) => ({ gift_id: gift.id, guests: manifest(gift).filter((r) => r.unit_status === "unservable").map((r) => ({ guest_id: r.guest_id, reason: r.reason ?? "" })) }))
    .filter((g) => g.guests.length > 0);
}
