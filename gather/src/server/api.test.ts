import { beforeEach, describe, expect, it } from "vitest";
import { lockValue, resetState, upsertDefinition } from "../domain/store";
import { GET as getSnapshot } from "../app/api/events/[id]/route";
import { POST as postEvent } from "../app/api/events/route";
import { PATCH as patchGuest } from "../app/api/events/[id]/rsvp/[guestId]/route";
import { changes, counts, createEventFromBody, followUps, inviteView, patchRsvp, postUpdate, snapshot, submitRsvp, summary, updatesFor } from "./api";
import { publishEvent } from "../domain/store";

const BODY = {
  title: "Test event",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" },
  spots: 10,
  cost_per_person_cents: 1000,
  rsvp_deadline: "2030-01-03"
};
const OPTIONS = [{ value: "a", label: "Option A" }, { value: "none", label: "None" }];

function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const snap = snapshot(event.id);
  const name = snap.definitions.find((d) => d.key === "printed_name")!;
  const dietary = upsertDefinition(event.id, { ...snap.definitions.find((d) => d.key === "dietary")!, constraints: { options: OPTIONS } });
  const reply = submitRsvp(event.id, {
    party: { contact: { email: "one@example.com" } },
    guests: [
      { display_name: "Guest One", status: "going", answers: { [name.id]: "One", [dietary.id]: ["a"] } },
      { display_name: "Guest Two", status: "going", answers: { [dietary.id]: ["none"] } },
      { display_name: "Guest Three", status: "maybe" },
      { display_name: "Guest Four" }
    ]
  });
  return { event, name, dietary, guestIds: reply.guest_ids };
}

describe("the API operations", () => {
  beforeEach(resetState);

  it("creates a draft with defaults, publishes it, and serves the invite by code", () => {
    const event = createEventFromBody(BODY);
    expect(event).toMatchObject({ status: "draft", response_options: ["going", "maybe", "cant_go"], settings: { order_approval: true } });
    expect(() => inviteView("ZZZZZZ")).toThrow(/No published event/);
    const published = publishEvent(event.id);
    const invite = inviteView(published.invite_code!);
    expect(invite.event.title).toBe(BODY.title);
    expect(invite.questions.map((q) => q.key)).toEqual(["printed_name", "dietary"]);
  });

  it("rejects an RSVP before publish and a bad answer with the reason", () => {
    const event = createEventFromBody(BODY);
    expect(() => submitRsvp(event.id, { guests: [{ display_name: "Ana" }] })).toThrow(/not published/);
    publishEvent(event.id);
    const dietary = snapshot(event.id).definitions[1];
    expect(() => submitRsvp(event.id, { guests: [{ display_name: "Guest", answers: { [dietary.id]: ["zzz"] } }] })).toThrow(/takes any of/);
  });

  it("builds the snapshot with counts and follow-ups from the records", () => {
    const { event, name, dietary, guestIds } = seed();
    const snap = snapshot(event.id);
    expect(snap.counts).toEqual({ going: 2, maybe: 1, cant_go: 0, no_reply: 1 });
    expect(followUps(event.id)).toEqual([
      { kind: "missing_value", definition_id: name.id, status: "going", guest_ids: [guestIds[1]], deadline: null },
      { kind: "unresolved", definition_id: null, status: "maybe", guest_ids: [guestIds[2]], deadline: "2030-01-03" },
      { kind: "no_reply", definition_id: null, status: "no_reply", guest_ids: [guestIds[3]], deadline: "2030-01-03" }
    ]);
    expect(snap.guests.find((g) => g.display_name === "Guest One")!.values).toMatchObject({ [dietary.id]: ["a"] });
  });

  it("counts, summarizes, and lists changes since a sequence number", () => {
    const { event, dietary, guestIds } = seed();
    const c = counts(event.id, dietary.id, [{ field: "status", op: "eq", value: "going" }]);
    if (c.value_type !== "multi_enum") throw new Error();
    expect(c.counts.map((x) => [x.option.value, x.count])).toEqual([["a", 1], ["none", 1]]);
    const s = summary(event.id, [dietary.id], []);
    expect(s.status).toEqual({ going: 2, maybe: 1, cant_go: 0, no_reply: 1 });
    const before = changes(event.id, 0).seq;
    patchRsvp(event.id, guestIds[2], { status: "cant_go" });
    const after = changes(event.id, before);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0]).toMatchObject({ kind: "status", from: "maybe", to: "cant_go" });
  });

  it("answers a locked edit with 409 and the lock through the route handler", async () => {
    const { event, name, guestIds } = seed();
    lockValue("guest", guestIds[0], name.id, { batch_id: "gift_1", date: "2026-10-12" });
    const res = await patchGuest(new Request("http://x", { method: "PATCH", body: JSON.stringify({ answers: { [name.id]: "Anna" } }) }), { params: Promise.resolve({ id: event.id, guestId: guestIds[0] }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { locked: { batch_id: string; label: string } };
    expect(body.locked).toMatchObject({ batch_id: "gift_1", definition_id: name.id });
  });

  it("creates through the route and reads the snapshot through the route", async () => {
    const created = await postEvent(new Request("http://x", { method: "POST", body: JSON.stringify(BODY) }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const res = await getSnapshot(new Request("http://x"), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { event: { title: string } }).event.title).toBe(BODY.title);
    const missing = await getSnapshot(new Request("http://x"), { params: Promise.resolve({ id: "evt_none" }) });
    expect(missing.status).toBe(404);
  });

  it("keeps one thread per gift with a change-log entry per post", () => {
    const { event } = seed();
    const before = changes(event.id, 0).seq;
    const posted = postUpdate(event.id, "gift_1", "token:vendor_1", { kind: "confirmed", text: "Confirmed.", expected_date: "2030-01-08" });
    postUpdate(event.id, "gift_1", "organizer", { kind: "reply", text: "Reply." });
    expect(updatesFor(event.id, "gift_1").map((u) => u.kind)).toEqual(["confirmed", "reply"]);
    expect(updatesFor(event.id, "gift_1", posted.seq)).toHaveLength(1);
    expect(changes(event.id, before).entries.map((c) => c.kind)).toEqual(["update", "update"]);
  });
});
