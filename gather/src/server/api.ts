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
  subjectFor,
  updateEvent,
  valuesFor,
  writeValue,
  type EventInput
} from "../domain/store";
import { EventSettings, Guest, GuestStatus, Segment, UpdateKind, Venue, type AttributeDefinition, type VendorUpdate } from "../domain/types";
import { matches } from "../domain/filter";

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

/* ---- Events ---- */

const defaults = library().event_defaults;
export const EventBody = z.object({
  type: z.string().default(defaults.type),
  title: z.string().min(1),
  host: z.string().default(""),
  starts_at: z.string(),
  venue: Venue,
  spots: z.number().int().nullable().default(null),
  cost_per_person_cents: z.number().int().nullable().default(null),
  rsvp_deadline: z.string().nullable().default(null),
  description: z.string().default(""),
  invite_extras: z.array(z.string()).default([]),
  response_options: z.array(GuestStatus).default(defaults.response_options),
  settings: EventSettings.default(defaults.settings),
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

/* ---- Snapshot and follow-ups ---- */

/** A follow-up names its kind and the guests it covers; the page composes the sentence and the action from the kind. */
export type FollowUp = { kind: "missing_value" | "unresolved" | "no_reply"; definition_id: string | null; status: GuestStatus | null; guest_ids: string[]; deadline: string | null };

/** The Overview's follow-ups (PRD Section 5): a required value missing per definition, unresolved maybes, and non-responders. */
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
  return out;
}

export function snapshot(eventId: string) {
  const event = requireEvent(eventId);
  const guests = guestsFor(eventId).map((g) => ({ ...g, values: valuesFor(g) }));
  const counts = { going: 0, maybe: 0, cant_go: 0, no_reply: 0 };
  for (const g of guests) counts[g.status] += 1;
  return { event, definitions: definitionsFor(eventId), guests, counts, follow_ups: followUps(eventId), library: library().questions, seq: currentSeq() };
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
export function submitRsvp(eventId: string, body: unknown) {
  const event = requireEvent(eventId);
  if (event.status !== "published") throw new BadRequestError("The event is not published yet.");
  const parsed = RsvpBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const party = createParty(eventId, parsed.data.party);
  const guests = parsed.data.guests.map((g) => {
    const guest = createGuest(eventId, party.id, { display_name: g.display_name, role: g.role, status: g.status, attendance: g.attendance });
    for (const [definitionId, raw] of Object.entries(g.answers ?? {})) writeAnswer(eventId, guest, definitionId, raw, "guest");
    return guest;
  });
  return { party_id: party.id, guest_ids: guests.map((g) => g.id) };
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
  for (const [definitionId, raw] of Object.entries(parsed.data.answers ?? {})) writeAnswer(eventId, guest, definitionId, raw, parsed.data.source);
  for (const [segment, present] of Object.entries(parsed.data.attendance ?? {})) guest = setGuestAttendance(guestId, segment, present);
  if (parsed.data.status) guest = setGuestStatus(guestId, parsed.data.status, parsed.data.source);
  return { ...guest, values: valuesFor(guest) };
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
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  if (e instanceof BadRequestError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof LockedValueError) return NextResponse.json({ error: e.message, locked: { definition_id: e.definition.id, label: e.definition.label, ...e.lock } }, { status: 409 });
  throw e;
}

export type Definition = AttributeDefinition;
