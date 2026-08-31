/**
 * The in-memory store (PRD Section 7) on `globalThis`, so the Next dev server's module reloads
 * keep it, with the same backfill pattern as the planner's src/server/state.ts. Every write to a
 * value, a guest's status, or a vendor thread appends one change-log entry with a rising
 * sequence number; readers poll `changesSince`.
 */
import { matches, type Filter, type Subject } from "./filter";
import type { AttributeDefinition, AttributeValue, Batch, CallerToken, ChangeEntry, Event, Guest, GuestStatus, Party, VendorUpdate } from "./types";
import { aggregate, validateValue, type Aggregate } from "./values";
import libraryData from "./library.json";

export type State = {
  events: Map<string, Event>;
  parties: Map<string, Party>;
  guests: Map<string, Guest>;
  definitions: Map<string, AttributeDefinition>;
  /** Keyed by subject type, subject id, and definition id joined with `|`. */
  values: Map<string, AttributeValue>;
  updates: Map<string, VendorUpdate>;
  gifts: Map<string, Batch>;
  tokens: Map<string, CallerToken>;
  changes: ChangeEntry[];
  seq: number;
  ids: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __gatherState: State | undefined;
}

function freshState(): State {
  return { events: new Map(), parties: new Map(), guests: new Map(), definitions: new Map(), values: new Map(), updates: new Map(), gifts: new Map(), tokens: new Map(), changes: [], seq: 0, ids: 0 };
}

export function state(): State {
  if (!globalThis.__gatherState) globalThis.__gatherState = freshState();
  const current = globalThis.__gatherState as unknown as Record<string, unknown>;
  const template = freshState() as unknown as Record<string, unknown>;
  for (const key of Object.keys(template)) if (current[key] === undefined) current[key] = template[key];
  return globalThis.__gatherState;
}

/** Test hook: an empty store. */
export function resetState(): void {
  globalThis.__gatherState = freshState();
}

/**
 * Runs fn as one unit: on a throw, every store map and counter returns to the pre-call snapshot, so
 * a multi-write operation (an RSVP over several guests) never leaves earlier writes committed behind
 * a later item's error. Each write replaces a value rather than mutating it in place, so a shallow
 * clone of each map is a sufficient snapshot.
 */
export function transactionally<T>(fn: () => T): T {
  const s = state();
  const snapshot: State = { events: new Map(s.events), parties: new Map(s.parties), guests: new Map(s.guests), definitions: new Map(s.definitions), values: new Map(s.values), updates: new Map(s.updates), gifts: new Map(s.gifts), tokens: new Map(s.tokens), changes: [...s.changes], seq: s.seq, ids: s.ids };
  try {
    return fn();
  } catch (e) {
    Object.assign(s, snapshot);
    throw e;
  }
}

export function newId(prefix: string): string {
  const s = state();
  s.ids += 1;
  return `${prefix}_${s.ids}`;
}

const now = () => new Date().toISOString();

function nextSeq(): number {
  const s = state();
  s.seq += 1;
  return s.seq;
}

export class LockedValueError extends Error {
  constructor(public readonly definition: AttributeDefinition, public readonly lock: { batch_id: string; date: string }) {
    super(`${definition.label} is locked for the vendor's batch ${lock.batch_id} since ${lock.date}; the organizer can change it through the vendor.`);
  }
}
export class InvalidValueError extends Error {}

/* ---- Events and definitions ---- */

/**
 * The question library (library.json): rows the organizer picks from on the draft page, edits, or
 * replaces. Entries flagged `seed` are added to a new event; their options list starts empty and
 * the organizer fills it, so no dietary vocabulary lives in code.
 */
export type LibraryQuestion = { key: string; label: string; scope: AttributeDefinition["scope"]; value_type: AttributeDefinition["value_type"]; constraints: AttributeDefinition["constraints"]; required_rule: AttributeDefinition["required_rule"]; seed: boolean };
export type Library = { questions: LibraryQuestion[]; event_defaults: { type: string; response_options: GuestStatus[]; settings: Event["settings"] } };

export function library(): Library {
  return libraryData as Library;
}

export function seedDefinitions(eventId: string): AttributeDefinition[] {
  return library()
    .questions.filter((q) => q.seed)
    .map((q) => ({ id: newId("def"), event_id: eventId, namespace: "core", key: q.key, label: q.label, scope: q.scope, value_type: q.value_type, constraints: q.constraints, default_visibility: [], required_rule: q.required_rule, creator: "library" }));
}

export type EventInput = Omit<Event, "id" | "definition_ids" | "status" | "invite_code" | "created_at" | "contact"> & { contact?: Event["contact"] };

export function createEvent(input: EventInput): Event {
  const s = state();
  const id = newId("evt");
  const defs = seedDefinitions(id);
  for (const d of defs) s.definitions.set(d.id, d);
  const event: Event = { ...input, contact: input.contact ?? { email: null, phone: null }, id, definition_ids: defs.map((d) => d.id), status: "draft", invite_code: null, created_at: now() };
  s.events.set(id, event);
  return event;
}

export function getEvent(id: string): Event {
  const event = state().events.get(id);
  if (!event) throw new Error(`No event ${id}.`);
  // An event stored before the delivery choice or the contact existed reads with the field's default.
  const delivery = event.delivery ?? { destination: "venue", address: null, needed_by: null };
  const contact = event.contact ?? { email: null, phone: null };
  return event.delivery && event.contact ? event : { ...event, delivery, contact };
}

export function eventByCode(code: string): Event | undefined {
  return [...state().events.values()].find((e) => e.invite_code === code.toUpperCase());
}

export function updateEvent(id: string, patch: Partial<EventInput>): Event {
  const s = state();
  const event = { ...getEvent(id), ...patch };
  s.events.set(id, event);
  return event;
}

/** Invite codes use letters and digits that read unambiguously (no 0, O, 1, I). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // pragma: allowlist secret
export function publishEvent(id: string): Event {
  const s = state();
  const event = getEvent(id);
  if (event.status === "published" && event.invite_code) return event;
  let code = "";
  do code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  while (eventByCode(code));
  const published: Event = { ...event, status: "published", invite_code: code };
  s.events.set(id, published);
  return published;
}

export function definitionsFor(eventId: string): AttributeDefinition[] {
  const s = state();
  return getEvent(eventId).definition_ids.map((id) => s.definitions.get(id)!).filter(Boolean);
}

export function getDefinition(id: string): AttributeDefinition {
  const def = state().definitions.get(id);
  if (!def) throw new Error(`No definition ${id}.`);
  return def;
}

/** Adds or replaces a definition on the event. A changed definition is what re-asks read (PRD Section 9). */
export function upsertDefinition(eventId: string, def: Omit<AttributeDefinition, "id" | "event_id"> & { id?: string }): AttributeDefinition {
  const s = state();
  const event = getEvent(eventId);
  const row: AttributeDefinition = { ...def, id: def.id ?? newId("def"), event_id: eventId };
  s.definitions.set(row.id, row);
  if (!event.definition_ids.includes(row.id)) s.events.set(eventId, { ...event, definition_ids: [...event.definition_ids, row.id] });
  return row;
}

/* ---- Parties and guests ---- */

export function createParty(eventId: string, input: { contact?: { email?: string | null; phone?: string | null }; plus_one_allowance?: number }): Party {
  const s = state();
  getEvent(eventId);
  const party: Party = { id: newId("party"), event_id: eventId, guest_ids: [], contact: { email: input.contact?.email ?? null, phone: input.contact?.phone ?? null }, plus_one_allowance: input.plus_one_allowance ?? 0 };
  s.parties.set(party.id, party);
  return party;
}

export function createGuest(eventId: string, partyId: string, input: { display_name: string; role?: string; status?: GuestStatus; attendance?: Record<string, boolean> }): Guest {
  const s = state();
  const party = s.parties.get(partyId);
  if (!party || party.event_id !== eventId) throw new Error(`No party ${partyId} on event ${eventId}.`);
  const guest: Guest = { id: newId("guest"), event_id: eventId, party_id: partyId, role: input.role ?? "guest", status: input.status ?? "no_reply", attendance: input.attendance ?? {}, display_name: input.display_name };
  s.guests.set(guest.id, guest);
  s.parties.set(partyId, { ...party, guest_ids: [...party.guest_ids, guest.id] });
  if (guest.status !== "no_reply") s.changes.push({ kind: "status", seq: nextSeq(), at: now(), event_id: eventId, guest_id: guest.id, from: "no_reply", to: guest.status, source: "guest" });
  return guest;
}

export function getGuest(id: string): Guest {
  const guest = state().guests.get(id);
  if (!guest) throw new Error(`No guest ${id}.`);
  return guest;
}

export function guestsFor(eventId: string): Guest[] {
  return [...state().guests.values()].filter((g) => g.event_id === eventId);
}

/** A status change is a change-log entry (PRD Section 7): the write a vendor most needs to see. */
export function setGuestStatus(guestId: string, status: GuestStatus, source: string): Guest {
  const s = state();
  const guest = getGuest(guestId);
  if (guest.status === status) return guest;
  const next = { ...guest, status };
  s.guests.set(guestId, next);
  s.changes.push({ kind: "status", seq: nextSeq(), at: now(), event_id: guest.event_id, guest_id: guestId, from: guest.status, to: status, source });
  return next;
}

export function setGuestAttendance(guestId: string, segmentId: string, present: boolean): Guest {
  const s = state();
  const guest = getGuest(guestId);
  const next = { ...guest, attendance: { ...guest.attendance, [segmentId]: present } };
  s.guests.set(guestId, next);
  return next;
}

/* ---- Values ---- */

const valueKey = (subjectType: string, subjectId: string, definitionId: string) => `${subjectType}|${subjectId}|${definitionId}`;

export function getValue(subjectType: AttributeValue["subject_type"], subjectId: string, definitionId: string): AttributeValue | undefined {
  return state().values.get(valueKey(subjectType, subjectId, definitionId));
}

/**
 * Validates and stores one value. A locked value rejects the write with the lock, so the form can
 * show the organizer's path; an invalid value rejects with the reason. Both are change-log entries when they succeed.
 */
/**
 * The lock a frozen gift places on a subject's definition. lockValue marks only values that exist
 * at the lock, so the write path also checks the definition ids the lock stored on the batch; a
 * guest with no value at approval is refused the same way (#112).
 */
function giftLock(subjectType: AttributeValue["subject_type"], subjectId: string, definitionId: string): { batch_id: string; date: string } | null {
  const s = state();
  for (const gift of s.gifts.values()) {
    if (!gift.locked_at || !gift.locked_definition_ids?.includes(definitionId)) continue;
    const covers =
      subjectType === "guest" ? gift.locked_guest_ids.includes(subjectId)
      : subjectType === "party" ? gift.locked_guest_ids.some((id) => s.guests.get(id)?.party_id === subjectId)
      : gift.event_id === subjectId;
    if (covers) return { batch_id: gift.id, date: gift.locked_at };
  }
  return null;
}

export function writeValue(subjectType: AttributeValue["subject_type"], subjectId: string, definitionId: string, raw: unknown, source: string): AttributeValue {
  const s = state();
  const def = getDefinition(definitionId);
  const existing = getValue(subjectType, subjectId, definitionId);
  const lock = existing?.lock ?? giftLock(subjectType, subjectId, definitionId);
  if (lock && source !== "organizer" && !source.startsWith("token:")) throw new LockedValueError(def, lock);
  const checked = validateValue(def, raw);
  if (!checked.ok) throw new InvalidValueError(checked.reason);
  const row: AttributeValue = { subject_type: subjectType, subject_id: subjectId, definition_id: definitionId, value: checked.value, source, lock: existing?.lock ?? null, updated_at: now(), seq: nextSeq() };
  s.values.set(valueKey(subjectType, subjectId, definitionId), row);
  s.changes.push({ kind: "value", seq: row.seq, at: row.updated_at, event_id: def.event_id, subject_type: subjectType, subject_id: subjectId, definition_id: definitionId, value: checked.value, source });
  return row;
}

export function lockValue(subjectType: AttributeValue["subject_type"], subjectId: string, definitionId: string, lock: { batch_id: string; date: string }): void {
  const s = state();
  const existing = getValue(subjectType, subjectId, definitionId);
  if (existing) s.values.set(valueKey(subjectType, subjectId, definitionId), { ...existing, lock });
}

/** A guest's values by definition id, with the party's values under their definition ids as well. */
export function valuesFor(guest: Guest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of definitionsFor(guest.event_id)) {
    const row = def.scope === "party" ? getValue("party", guest.party_id, def.id) : def.scope === "event" ? getValue("event", guest.event_id, def.id) : getValue("guest", guest.id, def.id);
    if (row) out[def.id] = row.value;
  }
  return out;
}

export function subjectFor(guest: Guest): Subject {
  return { guest, party: state().parties.get(guest.party_id) ?? null, values: valuesFor(guest) };
}

/* ---- Reads the tools map onto ---- */

export function listGuests(eventId: string, filter: Filter = []): Guest[] {
  return guestsFor(eventId).filter((g) => matches(filter, subjectFor(g)));
}

export function countBy(eventId: string, definitionId: string, filter: Filter = []): Aggregate {
  const def = getDefinition(definitionId);
  const guests = listGuests(eventId, filter);
  return aggregate(def, guests.map((g) => valuesFor(g)[definitionId]));
}

export function listMissing(eventId: string, definitionId: string, filter: Filter = []): Guest[] {
  getDefinition(definitionId);
  return listGuests(eventId, filter).filter((g) => {
    const v = valuesFor(g)[definitionId];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  });
}

export function changesSince(eventId: string, seq: number): ChangeEntry[] {
  return state().changes.filter((c) => c.event_id === eventId && c.seq > seq);
}

export function currentSeq(): number {
  return state().seq;
}
