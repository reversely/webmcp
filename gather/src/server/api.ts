/**
 * The operations the API routes and the tools call (PRD Sections 7 and 8). Each returns plain
 * data or throws a typed error that `errorResponse` maps to a status, so a route handler stays a
 * few lines and a tool call and a page request share one code path.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseFilter, type Filter } from "../domain/filter";
import {
  changesSince,
  countBy,
  createEvent,
  createGuest,
  createParty,
  currentSeq,
  definitionsFor,
  eventByCode,
  getEvent,
  getGuest,
  guestsFor,
  InvalidValueError,
  library,
  listGuests,
  listMissing,
  LockedValueError,
  newId,
  publishEvent,
  setGuestAttendance,
  setGuestStatus,
  state,
  transactionally,
  subjectFor,
  updateEvent,
  upsertDefinition,
  valuesFor,
  writeValue,
  type EventInput
} from "../domain/store";
import { Constraints, EventSettings, FilterSchema, GiftOverride, GiftRule, Guest, GuestStatus, MissingValueFallback, PersonalizationField, PersonalizationMapping, PostLockCancellation, Segment, UpdateKind, ValueType, Variant, VariantMappingRow, Venue, type AttributeDefinition, type Batch, type VendorUpdate, DeliveryWindow, Delivery } from "../domain/types";
import { matches } from "../domain/filter";
import { createGift, getGift, giftsFor, manifest, quantities, removeGift, setGiftOverride, unservable, updateGift, type GiftInput } from "../domain/gifts";
import { validateMappings } from "../domain/personalization";
import { afterRsvpWrite } from "./hooks";

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

/* ---- Events ---- */

const defaults = library().event_defaults;

// #134: the schedule fields (starts_at, rsvp_deadline, needed_by) must be ISO 8601 dates or
// datetimes, and spots and cost_per_person_cents cannot be negative (cost feeds the catalog price
// ceiling in cents, PRD Section 11). A past deadline and a guest count over spots stay display-only
// per the PRD (Section 5 lists spots and the deadlines among the organizer's shown details, not as
// gates), so the API validates format and sign, not temporal ordering or capacity.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const isoString = z.string().refine((v) => ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)), "must be an ISO 8601 date");
const nonNegativeInt = z.number().int().min(0);
const DeliveryBody = Delivery.extend({ needed_by: isoString.nullable().default(null) });

export const EventBody = z.object({
  type: z.string().default(defaults.type),
  title: z.string().min(1),
  host: z.string().default(""),
  starts_at: isoString,
  venue: Venue,
  spots: nonNegativeInt.nullable().default(null),
  cost_per_person_cents: nonNegativeInt.nullable().default(null),
  rsvp_deadline: isoString.nullable().default(null),
  description: z.string().default(""),
  invite_extras: z.array(z.string()).default([]),
  response_options: z.array(GuestStatus).default(defaults.response_options),
  settings: EventSettings.default(defaults.settings),
  delivery: DeliveryBody.default({ destination: "venue", address: null, needed_by: null }),
  contact: z.object({ email: z.string().nullable().default(null), phone: z.string().nullable().default(null) }).default({ email: null, phone: null }),
  segments: z.array(Segment).default([])
});

export function createEventFromBody(body: unknown) {
  const parsed = EventBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return createEvent(parsed.data as EventInput);
}

export function updateEventFromBody(eventId: string, body: unknown) {
  const parsed = EventBody.partial().safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return updateEvent(requireEvent(eventId).id, parsed.data as Partial<EventInput>);
}

export function requireEvent(eventId: string) {
  try {
    return getEvent(eventId);
  } catch {
    throw new NotFoundError(`No event ${eventId}.`);
  }
}

export function requireGuest(eventId: string, guestId: string): Guest {
  let guest: Guest;
  try {
    guest = getGuest(guestId);
  } catch {
    throw new NotFoundError(`No guest ${guestId}.`);
  }
  if (guest.event_id !== eventId) throw new NotFoundError(`No guest ${guestId} on event ${eventId}.`);
  return guest;
}

const DefinitionBody = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  scope: z.enum(["guest", "party", "event"]).default("guest"),
  value_type: ValueType,
  constraints: Constraints.default({}),
  required_rule: z.enum(["always", "going", "never"]).default("never"),
  default_visibility: z.array(z.string()).default([])
});

/** The organizer's question list replaces the event's: matching keys keep their ids, new keys get one, absent keys leave the event. */
export function replaceDefinitions(eventId: string, body: unknown) {
  const event = requireEvent(eventId);
  const parsed = z.object({ definitions: z.array(DefinitionBody) }).safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const existing = definitionsFor(eventId);
  const kept = parsed.data.definitions.map((d) => {
    const prior = existing.find((x) => x.key === d.key);
    return upsertDefinition(eventId, { ...(prior ?? {}), ...d, namespace: prior?.namespace ?? "organizer", creator: prior?.creator ?? "organizer", id: prior?.id });
  });
  const s = state();
  s.events.set(eventId, { ...getEvent(event.id), definition_ids: kept.map((d) => d.id) });
  return kept;
}

/* ---- Snapshot and follow-ups ---- */

/** A follow-up names its kind and the guests it covers; the page composes the sentence and the action from the kind. */
export type FollowUp = { kind: "missing_value" | "unresolved" | "no_reply" | "unservable" | "vendor_question" | "vendor_issue"; definition_id: string | null; status: GuestStatus | null; guest_ids: string[]; deadline: string | null; gift_id?: string; update_id?: string };

/** The Overview's follow-ups (PRD Section 5): a required value missing per definition, unresolved maybes, non-responders, and guests a gift cannot serve. */
export function followUps(eventId: string): FollowUp[] {
  const event = getEvent(eventId);
  const out: FollowUp[] = [];
  for (const def of definitionsFor(eventId)) {
    if (def.required_rule === "never") continue;
    const filter: Filter = def.required_rule === "going" ? [{ field: "status", op: "eq", value: "going" }] : [{ field: "status", op: "neq", value: "no_reply" }];
    const guests = listMissing(eventId, def.id, filter);
    if (guests.length) out.push({ kind: "missing_value", definition_id: def.id, status: def.required_rule === "going" ? "going" : null, guest_ids: guests.map((g) => g.id), deadline: null });
  }
  const maybes = listGuests(eventId, [{ field: "status", op: "eq", value: "maybe" }]);
  if (maybes.length) out.push({ kind: "unresolved", definition_id: null, status: "maybe", guest_ids: maybes.map((g) => g.id), deadline: event.rsvp_deadline });
  const silent = listGuests(eventId, [{ field: "status", op: "eq", value: "no_reply" }]);
  if (silent.length) out.push({ kind: "no_reply", definition_id: null, status: "no_reply", guest_ids: silent.map((g) => g.id), deadline: event.rsvp_deadline });
  for (const entry of unservable(eventId)) out.push({ kind: "unservable", definition_id: null, status: null, guest_ids: entry.guests.map((g) => g.guest_id), deadline: getGift(entry.gift_id).cutoff, gift_id: entry.gift_id });
  // A vendor's question stays a follow-up until the organizer replies after it; an issue naming a guest stays until that guest's unit changes.
  for (const gift of giftsFor(eventId)) {
    const thread = [...state().updates.values()].filter((u) => u.event_id === eventId && u.gift_id === gift.id).sort((a, b) => a.seq - b.seq);
    for (const u of thread) {
      if (u.kind === "question" && !thread.some((r) => r.kind === "reply" && r.seq > u.seq)) out.push({ kind: "vendor_question", definition_id: null, status: null, guest_ids: [], deadline: u.expected_date, gift_id: gift.id, update_id: u.id });
      if (u.kind === "issue" && u.guest_id && !thread.some((r) => r.kind === "reply" && r.seq > u.seq)) out.push({ kind: "vendor_issue", definition_id: null, status: null, guest_ids: [u.guest_id], deadline: u.expected_date, gift_id: gift.id, update_id: u.id });
    }
  }
  return out;
}

export function snapshot(eventId: string) {
  const event = requireEvent(eventId);
  const guests = guestsFor(eventId).map((g) => ({ ...g, values: valuesFor(g) }));
  const counts = { going: 0, maybe: 0, cant_go: 0, no_reply: 0 };
  for (const g of guests) counts[g.status] += 1;
  const gifts = giftsFor(eventId).map((g) => ({ ...g, quantities: quantities(g) }));
  return { event, definitions: definitionsFor(eventId), guests, counts, follow_ups: followUps(eventId), gifts, library: library().questions, seq: currentSeq() };
}

/* ---- Gifts ---- */

const GOING: Filter = [{ field: "status", op: "eq", value: "going" }];

export const GiftBody = z.object({
  product_id: z.string().min(1),
  shop_domain: z.string().default(""),
  product_title: z.string().default(""),
  recipients: FilterSchema.default(GOING),
  mapping: z.array(VariantMappingRow).default([]),
  default_variant_id: z.string().nullable().default(null),
  variants: z.array(Variant).default([]),
  /** The vendor's personalization schema the search read for the product, when it has one. */
  personalization: z.object({ fields: z.array(PersonalizationField) }).nullable().optional(),
  missing_value_fallback: MissingValueFallback.default("default"),
  post_lock_cancellation: PostLockCancellation.default("keep"),
  cutoff: z.string().nullable().default(null),
  cart_id: z.string().nullable().default(null),
  checkout_id: z.string().nullable().default(null),
  order_id: z.string().nullable().default(null),
  rules: z.array(GiftRule).optional(),
  /** The delivery window the search read for the product; approve derives the lock date from it. */
  delivery_window: DeliveryWindow.nullable().optional()
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

export function requireGift(eventId: string, giftId: string): Batch {
  let gift: Batch;
  try {
    gift = getGift(giftId);
  } catch {
    throw new NotFoundError(`No gift ${giftId}.`);
  }
  if (gift.event_id !== eventId) throw new NotFoundError(`No gift ${giftId} on event ${eventId}.`);
  return gift;
}

/** Stores a plan (set_gift_plan); the default plan carries one rule that sends the product to every going guest. */
export function createGiftFromBody(eventId: string, body: unknown) {
  requireEvent(eventId);
  const data = parseBody(GiftBody, body);
  const input: GiftInput = { ...data, rules: data.rules ?? [{ filter: GOING, product_id: data.product_id }] };
  return giftView(eventId, createGift(eventId, input).id);
}

export function updateGiftFromBody(eventId: string, giftId: string, body: unknown) {
  requireGift(eventId, giftId);
  const patch = parseBody(GiftBody.partial(), body);
  return giftView(eventId, updateGift(giftId, patch as Partial<GiftInput>).id);
}

export function deleteGift(eventId: string, giftId: string) {
  const gift = requireGift(eventId, giftId);
  // A placed order or a lock is a committed record; removing it would drop the local trace of a real order.
  if (gift.order_id) throw new BadRequestError("An ordered gift cannot be removed.");
  if (gift.locked_at || gift.cutoff) throw new BadRequestError("A locked gift cannot be removed.");
  removeGift(giftId);
  return { id: giftId };
}

/** The gift with its derived quantities and manifest, recomputed on every read. */
export function giftView(eventId: string, giftId: string) {
  const gift = requireGift(eventId, giftId);
  return { ...gift, quantities: quantities(gift), manifest: manifest(gift) };
}

export function manifestView(eventId: string, giftId: string) {
  const gift = requireGift(eventId, giftId);
  const event = requireEvent(eventId);
  return { gift_id: giftId, product_title: gift.product_title, needed_by: event.delivery?.needed_by ?? null, cutoff: gift.cutoff, locked_at: gift.locked_at, rows: manifest(gift) };
}

/** The organizer's decision for one guest; an empty body clears it. */
export function setOverride(eventId: string, giftId: string, guestId: string, body: unknown) {
  requireGift(eventId, giftId);
  requireGuest(eventId, guestId);
  setGiftOverride(giftId, guestId, parseBody(GiftOverride, body ?? {}));
  return giftView(eventId, giftId);
}

const MappingsBody = z.object({ mappings: z.array(PersonalizationMapping) });

/** Stores a gift's personalization mappings (set_personalization_mapping) after validating them against the product schema and the event's definitions (#117). */
export function setPersonalizationMappings(eventId: string, giftId: string, body: unknown) {
  const gift = requireGift(eventId, giftId);
  const event = requireEvent(eventId);
  if (!gift.personalization?.fields.length) throw new BadRequestError("The gift's product has no personalization schema.");
  const data = parseBody(MappingsBody, body);
  const errors = validateMappings(gift, event, data.mappings, definitionsFor(eventId));
  if (errors.length) throw new BadRequestError(errors.map((e) => `${e.code}: ${e.message}`).join("; "));
  updateGift(giftId, { personalization_mappings: data.mappings } as Partial<GiftInput>);
  return giftView(eventId, giftId);
}

/* ---- Invite and RSVP ---- */

export function inviteView(code: string) {
  const event = eventByCode(code);
  if (!event || event.status !== "published") throw new NotFoundError(`No published event with code ${code}.`);
  return { event, questions: definitionsFor(event.id).filter((d) => d.scope === "guest" && d.required_rule !== "never") };
}

const Answers = z.record(z.string(), z.unknown());
export const RsvpBody = z.object({
  party: z.object({ contact: z.object({ email: z.string().nullable().optional(), phone: z.string().nullable().optional() }).optional(), plus_one_allowance: z.number().int().optional() }).default({}),
  guests: z.array(z.object({ display_name: z.string().min(1), role: z.string().optional(), status: GuestStatus.optional(), attendance: z.record(z.string(), z.boolean()).optional(), answers: Answers.optional() })).min(1)
});

/** One party replies: guests, statuses, and answers, each answer validated by its definition. */
/**
 * The guest list (PRD Section 5): one guest per line as "Name", "Name <email>", "Name, email",
 * or a bare email. A bare-email line captures the address and derives the name from its local part.
 * A line whose second field is not an email (e.g. "Comma Person, notanemail") stays a name with no
 * email, so no data is dropped. Each line becomes a party with that contact and a guest with no
 * reply, so "everyone invited" counts the list and a reply from a listed guest updates their row.
 */
export function importGuests(eventId: string, body: unknown) {
  requireEvent(eventId);
  const parsed = z.object({ lines: z.array(z.string()).optional(), text: z.string().optional() }).safeParse(body);
  if (!parsed.success) throw new BadRequestError("Send lines or text.");
  const lines = (parsed.data.lines ?? parsed.data.text?.split(/\r?\n/) ?? []).map((l) => l.trim()).filter(Boolean);
  const existing = guestsFor(eventId);
  const added: Guest[] = [];
  for (const line of lines) {
    const m = line.match(/^(.*?)\s*(?:<([^>]+)>|,\s*(\S+@\S+))?\s*$/);
    let display_name = (m?.[1] ?? line).trim();
    let email = (m?.[2] ?? m?.[3] ?? "").trim() || null;
    // A bare-email line has no name field: capture the address, name from the local part.
    if (!email && /^\S+@\S+$/.test(display_name)) {
      email = display_name;
      display_name = display_name.slice(0, display_name.indexOf("@"));
    }
    if (!display_name) continue;
    if (existing.some((g) => g.display_name.toLowerCase() === display_name.toLowerCase()) || added.some((g) => g.display_name.toLowerCase() === display_name.toLowerCase())) continue;
    const party = createParty(eventId, { contact: { email } });
    added.push(createGuest(eventId, party.id, { display_name }));
  }
  return { added: added.length, guest_ids: added.map((g) => g.id) };
}

/**
 * An already-invited guest whose name or party email matches the reply, across any status, since
 * the invite form is the re-RSVP path (a re-reply or a cancel updates the row, not adds one). Guests
 * already taken in this submission are skipped so several guests sharing one party email each land on
 * a distinct row.
 */
function invitedMatch(eventId: string, displayName: string, email: string | null | undefined, used: Set<string>): Guest | undefined {
  const s = state();
  return guestsFor(eventId).find((g) => {
    if (used.has(g.id)) return false;
    if (g.display_name.toLowerCase() === displayName.trim().toLowerCase()) return true;
    const party = s.parties.get(g.party_id);
    return !!email && !!party?.contact.email && party.contact.email.toLowerCase() === email.toLowerCase();
  });
}

export function submitRsvp(eventId: string, body: unknown) {
  const event = requireEvent(eventId);
  if (event.status !== "published") throw new BadRequestError("The event is not published yet.");
  const parsed = RsvpBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  // One transaction over the whole party: a later guest's invalid answer rolls back every earlier write.
  return transactionally(() => {
  const email = parsed.data.party.contact?.email ?? null;
  const created: { party: ReturnType<typeof createParty> | null } = { party: null };
  const used = new Set<string>();
  const guests = parsed.data.guests.map((g) => {
    const invited = invitedMatch(eventId, g.display_name, email, used);
    let guest: Guest;
    if (invited) {
      // A listed guest replies: their row takes the status and the answers; the party keeps its contact.
      guest = g.status ? setGuestStatus(invited.id, g.status, "guest") : invited;
      for (const [segment, present] of Object.entries(g.attendance ?? {})) guest = setGuestAttendance(guest.id, segment, present);
      if (email) { const p = state().parties.get(guest.party_id); if (p && !p.contact.email) state().parties.set(p.id, { ...p, contact: { ...p.contact, email } }); }
    } else {
      created.party ??= createParty(eventId, parsed.data.party);
      guest = createGuest(eventId, created.party.id, { display_name: g.display_name, role: g.role, status: g.status, attendance: g.attendance });
    }
    used.add(guest.id);
    for (const [definitionId, raw] of Object.entries(g.answers ?? {})) writeAnswer(eventId, guest, definitionId, raw, "guest");
    return guest;
  });
  afterRsvpWrite(eventId);
  return { party_id: created.party?.id ?? guests[0]?.party_id ?? null, guest_ids: guests.map((g) => g.id) };
  });
}

function writeAnswer(eventId: string, guest: Guest, definitionId: string, raw: unknown, source: string) {
  const def = definitionsFor(eventId).find((d) => d.id === definitionId);
  if (!def) throw new BadRequestError(`No question ${definitionId} on this event.`);
  const subject = def.scope === "party" ? (["party", guest.party_id] as const) : def.scope === "event" ? (["event", eventId] as const) : (["guest", guest.id] as const);
  try {
    return writeValue(subject[0], subject[1], definitionId, raw, source);
  } catch (e) {
    if (e instanceof InvalidValueError) throw new BadRequestError(e.message);
    throw e;
  }
}

export const RsvpPatch = z.object({ status: GuestStatus.optional(), attendance: z.record(z.string(), z.boolean()).optional(), answers: Answers.optional(), source: z.string().default("guest") });

/** A guest edits or cancels from the same link; a locked value rejects the edit with the lock (409). */
export function patchRsvp(eventId: string, guestId: string, body: unknown) {
  const parsed = RsvpPatch.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  let guest = requireGuest(eventId, guestId);
  // One transaction over the edit: a later invalid answer rolls back every earlier write.
  return transactionally(() => {
  for (const [definitionId, raw] of Object.entries(parsed.data.answers ?? {})) writeAnswer(eventId, guest, definitionId, raw, parsed.data.source);
  for (const [segment, present] of Object.entries(parsed.data.attendance ?? {})) guest = setGuestAttendance(guestId, segment, present);
  if (parsed.data.status) guest = setGuestStatus(guestId, parsed.data.status, parsed.data.source);
  afterRsvpWrite(eventId);
  return { ...guest, values: valuesFor(guest) };
  });
}

/* ---- Reads the tools map onto ---- */

export function readFilter(raw: unknown): Filter {
  try {
    return parseFilter(raw);
  } catch (e) {
    throw new BadRequestError((e as Error).message);
  }
}

export function guestView(eventId: string, guestId: string, fields?: string[]) {
  const guest = requireGuest(eventId, guestId);
  const values = valuesFor(guest);
  return { ...guest, values: fields ? Object.fromEntries(Object.entries(values).filter(([k]) => fields.includes(k))) : values };
}

export function guestList(eventId: string, filter: Filter, fields?: string[]) {
  requireEvent(eventId);
  return listGuests(eventId, filter).map((g) => guestView(eventId, g.id, fields));
}

export function counts(eventId: string, definitionId: string, filter: Filter) {
  requireEvent(eventId);
  const def = definitionsFor(eventId).find((d) => d.id === definitionId);
  if (!def) throw new NotFoundError(`No definition ${definitionId} on event ${eventId}.`);
  return { definition: def, filter, ...countBy(eventId, definitionId, filter) };
}

export function missing(eventId: string, definitionId: string, filter: Filter) {
  requireEvent(eventId);
  const def = definitionsFor(eventId).find((d) => d.id === definitionId);
  if (!def) throw new NotFoundError(`No definition ${definitionId} on event ${eventId}.`);
  return { definition: def, guests: listMissing(eventId, definitionId, filter).map((g) => ({ id: g.id, display_name: g.display_name, status: g.status })) };
}

export function summary(eventId: string, definitionIds: string[], filter: Filter) {
  requireEvent(eventId);
  const defs = definitionsFor(eventId);
  const chosen = definitionIds.length ? definitionIds : defs.map((d) => d.id);
  const guests = guestsFor(eventId).filter((g) => matches(filter, subjectFor(g)));
  const statusCounts = { going: 0, maybe: 0, cant_go: 0, no_reply: 0 };
  for (const g of guests) statusCounts[g.status] += 1;
  return { filter, guests: guests.length, status: statusCounts, definitions: chosen.map((id) => counts(eventId, id, filter)) };
}

export function changes(eventId: string, since: number) {
  requireEvent(eventId);
  return { since, seq: currentSeq(), entries: changesSince(eventId, since) };
}

/* ---- Vendor updates ---- */

export const UpdateBody = z.object({ kind: UpdateKind, text: z.string().default(""), expected_date: z.string().nullable().default(null), reference: z.string().nullable().default(null), asset: z.string().nullable().default(null), guest_id: z.string().nullable().default(null) });

/** A vendor's or the organizer's post into a gift's thread; each becomes a change-log entry (PRD Section 9). */
export function postUpdate(eventId: string, giftId: string, caller: string, body: unknown): VendorUpdate {
  requireEvent(eventId);
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (parsed.data.guest_id) requireGuest(eventId, parsed.data.guest_id);
  const s = state();
  s.seq += 1;
  const update: VendorUpdate = { id: newId("upd"), event_id: eventId, gift_id: giftId, caller, ...parsed.data, created_at: new Date().toISOString(), seq: s.seq };
  s.updates.set(update.id, update);
  s.changes.push({ kind: "update", seq: update.seq, at: update.created_at, event_id: eventId, update_id: update.id, gift_id: giftId, update_kind: update.kind, caller });
  return update;
}

export function updatesFor(eventId: string, giftId: string, since = 0): VendorUpdate[] {
  requireEvent(eventId);
  return [...state().updates.values()].filter((u) => u.event_id === eventId && u.gift_id === giftId && u.seq > since).sort((a, b) => a.seq - b.seq);
}

/* ---- Errors to responses ---- */

export function errorResponse(e: unknown): NextResponse {
  // A malformed request body makes `request.json()` throw a SyntaxError; that is a client error, not a 500.
  if (e instanceof SyntaxError) return NextResponse.json({ error: "The body is not JSON." }, { status: 400 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  if (e instanceof BadRequestError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof LockedValueError) return NextResponse.json({ error: e.message, locked: { definition_id: e.definition.id, label: e.definition.label, ...e.lock } }, { status: 409 });
  throw e;
}

export type Definition = AttributeDefinition;
