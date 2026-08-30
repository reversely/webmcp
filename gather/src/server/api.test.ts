import { beforeEach, describe, expect, it } from "vitest";
import { lockValue, resetState } from "../domain/store";
import { GET as getSnapshot } from "../app/api/events/[id]/route";
import { POST as postEvent } from "../app/api/events/route";
import { PATCH as patchGuest } from "../app/api/events/[id]/rsvp/[guestId]/route";
import { changes, counts, createEventFromBody, followUps, inviteView, patchRsvp, postUpdate, snapshot, submitRsvp, summary, updatesFor } from "./api";
import { publishEvent } from "../domain/store";

const BODY = {
  title: "Lexi's 25th birthday",
  host: "Shereen",
  starts_at: "2026-10-17T19:00:00-04:00",
  venue: { name: "Paradise Grapevine", line1: "218 Geary Ave", city: "Toronto", region: "ON", postal_code: "M6H 2A8", country: "CA" },
  spots: 80,
  cost_per_person_cents: 1800,
  rsvp_deadline: "2026-10-10"
};

function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const snap = snapshot(event.id);
  const name = snap.definitions.find((d) => d.key === "printed_name")!;
  const dietary = snap.definitions.find((d) => d.key === "dietary")!;
  const reply = submitRsvp(event.id, {
    party: { contact: { email: "ana@example.com" } },
    guests: [
      { display_name: "Ana Ruiz", status: "going", answers: { [name.id]: "Ana", [dietary.id]: ["vegan"] } },
      { display_name: "Marcus Lee", status: "going", answers: { [dietary.id]: ["none"] } },
      { display_name: "Dev Patel", status: "maybe" },
      { display_name: "Theo B." }
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
    expect(() => submitRsvp(event.id, { guests: [{ display_name: "Ana", answers: { [dietary.id]: ["halal"] } }] })).toThrow(/takes any of/);
  });

  it("builds the snapshot with counts and follow-ups from the records", () => {
    const { event } = seed();
    const snap = snapshot(event.id);
    expect(snap.counts).toEqual({ going: 2, maybe: 1, cant_go: 0, no_reply: 1 });
    expect(followUps(event.id).map((f) => f.text)).toEqual([
      "1 guest going has no name for printing",
      "1 guest is Maybe; resolve to Can't go on 2026-10-10",
      "1 guest has not replied"
    ]);
    expect(snap.guests.find((g) => g.display_name === "Ana Ruiz")!.values).toMatchObject({ [snap.definitions[1].id]: ["vegan"] });
  });

  it("counts, summarizes, and lists changes since a sequence number", () => {
    const { event, dietary, guestIds } = seed();
    const c = counts(event.id, dietary.id, [{ field: "status", op: "eq", value: "going" }]);
    if (c.value_type !== "multi_enum") throw new Error();
    expect(c.counts.map((x) => [x.option.value, x.count])).toEqual([["vegan", 1], ["gluten_free", 0], ["nut_allergy", 0], ["none", 1]]);
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
    expect(body.locked).toMatchObject({ batch_id: "gift_1", label: "Name for printing" });
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
    const posted = postUpdate(event.id, "gift_1", "token:vendor_1", { kind: "confirmed", text: "We can do 52 by Oct 15.", expected_date: "2026-10-15" });
    postUpdate(event.id, "gift_1", "organizer", { kind: "reply", text: "Thanks." });
    expect(updatesFor(event.id, "gift_1").map((u) => u.kind)).toEqual(["confirmed", "reply"]);
    expect(updatesFor(event.id, "gift_1", posted.seq)).toHaveLength(1);
    expect(changes(event.id, before).entries.map((c) => c.kind)).toEqual(["update", "update"]);
  });
});
