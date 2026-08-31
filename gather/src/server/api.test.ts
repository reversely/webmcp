import { beforeEach, describe, expect, it } from "vitest";
import { lockValue, resetState, upsertDefinition } from "../domain/store";
import { GET as getSnapshot } from "../app/api/events/[id]/route";
import { POST as postEvent } from "../app/api/events/route";
import { PATCH as patchGuest } from "../app/api/events/[id]/rsvp/[guestId]/route";
import { changes, counts, createEventFromBody, createGiftFromBody, deleteGift, followUps, giftView, inviteView, manifestView, patchRsvp, postUpdate, setOverride, snapshot, submitRsvp, summary, updateGiftFromBody, updatesFor, importGuests } from "./api";
import { PUT as putOverride } from "../app/api/events/[id]/gifts/[giftId]/overrides/[guestId]/route";
import { DELETE as deleteGiftRoute } from "../app/api/events/[id]/gifts/[giftId]/route";
import { publishEvent } from "../domain/store";
import { lockGift } from "../domain/gifts";

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

  it("rejects a non-ISO schedule field, a negative spots, and a negative cost", () => {
    expect(() => createEventFromBody({ ...BODY, starts_at: "banana" })).toThrow(/starts_at/);
    expect(() => createEventFromBody({ ...BODY, rsvp_deadline: "soon" })).toThrow(/rsvp_deadline/);
    expect(() => createEventFromBody({ ...BODY, delivery: { destination: "venue", address: null, needed_by: "whenever" } })).toThrow(/needed_by/);
    expect(() => createEventFromBody({ ...BODY, spots: -1 })).toThrow(/spots/);
    expect(() => createEventFromBody({ ...BODY, cost_per_person_cents: -5 })).toThrow(/cost_per_person_cents/);
    expect(createEventFromBody(BODY)).toMatchObject({ status: "draft" });
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

  it("answers a malformed JSON body with 400 on the POST and PATCH routes", async () => {
    const { event, guestIds } = seed();
    const posted = await postEvent(new Request("http://x", { method: "POST", body: "{" }));
    expect(posted.status).toBe(400);
    expect((await posted.json()) as { error: string }).toHaveProperty("error");
    const patched = await patchGuest(new Request("http://x", { method: "PATCH", body: "{" }), { params: Promise.resolve({ id: event.id, guestId: guestIds[0] }) });
    expect(patched.status).toBe(400);
  });

  it("stores a gift plan with the default rule and serves its quantities, manifest, and follow-up", () => {
    const { event, dietary, guestIds } = seed();
    const gift = createGiftFromBody(event.id, {
      product_id: "prod_1",
      mapping: [{ definition_id: dietary.id, value: "a", variant_id: "var_a" }],
      default_variant_id: "var_plain"
    });
    expect(gift.rules).toEqual([{ filter: [{ field: "status", op: "eq", value: "going" }], product_id: "prod_1" }]);
    expect(gift.quantities).toEqual(expect.arrayContaining([{ product_id: "prod_1", variant_id: "var_a", quantity: 1 }]));
    expect(gift.manifest.find((r) => r.guest_id === guestIds[1])).toMatchObject({ unit_status: "unservable" });
    expect(followUps(event.id).find((f) => f.kind === "unservable")).toEqual({ kind: "unservable", definition_id: null, status: null, guest_ids: [guestIds[1]], deadline: null, gift_id: gift.id });
    expect(snapshot(event.id).gifts.map((g) => g.id)).toEqual([gift.id]);
    expect(manifestView(event.id, gift.id).rows).toHaveLength(2);
    const patched = updateGiftFromBody(event.id, gift.id, { mapping: [...gift.mapping, { definition_id: dietary.id, value: "none", variant_id: "var_plain" }] });
    expect(patched.quantities.reduce((n, q) => n + q.quantity, 0)).toBe(2);
    expect(() => createGiftFromBody(event.id, {})).toThrow(/product_id/);
    expect(() => giftView(event.id, "gift_none")).toThrow(/No gift/);
    deleteGift(event.id, gift.id);
    expect(() => giftView(event.id, gift.id)).toThrow(/No gift/);
  });

  it("refuses to remove a locked or ordered gift and still removes an open one", async () => {
    const { event } = seed();
    const locked = createGiftFromBody(event.id, { product_id: "prod_1", default_variant_id: "var_plain" });
    lockGift(locked.id, "2030-01-05");
    expect(() => deleteGift(event.id, locked.id)).toThrow(/locked/);
    expect(() => giftView(event.id, locked.id)).not.toThrow();

    const ordered = createGiftFromBody(event.id, { product_id: "prod_2", order_id: "ord_9" });
    const res = await deleteGiftRoute(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: event.id, giftId: ordered.id }) });
    expect(res.status).toBe(400);
    expect(() => giftView(event.id, ordered.id)).not.toThrow();

    const open = createGiftFromBody(event.id, { product_id: "prod_3", default_variant_id: "var_plain" });
    expect(deleteGift(event.id, open.id)).toEqual({ id: open.id });
    expect(() => giftView(event.id, open.id)).toThrow(/No gift/);
  });

  it("sets and clears an override through the route", async () => {
    const { event, guestIds } = seed();
    const gift = createGiftFromBody(event.id, { product_id: "prod_1", default_variant_id: "var_plain" });
    const params = { params: Promise.resolve({ id: event.id, giftId: gift.id, guestId: guestIds[0] }) };
    const res = await putOverride(new Request("http://x", { method: "PUT", body: JSON.stringify({ excluded: true }) }), params);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { quantities: { quantity: number }[] }).quantities).toEqual([{ product_id: "prod_1", variant_id: "var_plain", quantity: 1 }]);
    const cleared = await putOverride(new Request("http://x", { method: "PUT" }), params);
    expect(((await cleared.json()) as { overrides: object }).overrides).toEqual({});
    expect(() => setOverride(event.id, gift.id, "guest_none", {})).toThrow(/No guest/);
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

  it("imports a guest list and matches a reply to a listed guest by name or email", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const imported = importGuests(event.id, { text: "Guest One <one@example.com>\nGuest Two, two@example.com\nGuest Three\n\nGuest One" });
    expect(imported.added).toBe(3);
    expect(snapshot(event.id).counts).toEqual({ going: 0, maybe: 0, cant_go: 0, no_reply: 3 });
    const byName = submitRsvp(event.id, { guests: [{ display_name: "guest two", status: "going" }] });
    expect(byName.guest_ids).toEqual([imported.guest_ids[1]]);
    const byEmail = submitRsvp(event.id, { party: { contact: { email: "ONE@example.com" } }, guests: [{ display_name: "G. One", status: "maybe" }] });
    expect(byEmail.guest_ids).toEqual([imported.guest_ids[0]]);
    const stranger = submitRsvp(event.id, { guests: [{ display_name: "Guest Four", status: "going" }] });
    expect(imported.guest_ids).not.toContain(stranger.guest_ids[0]);
    expect(snapshot(event.id).counts).toEqual({ going: 2, maybe: 1, cant_go: 0, no_reply: 1 });
    expect(snapshot(event.id).guests).toHaveLength(4);
  });

  it("captures a bare-email line and derives the name from its local part", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const imported = importGuests(event.id, { text: "bare@example.com" });
    expect(imported.added).toBe(1);
    expect(snapshot(event.id).guests[0].display_name).toBe("bare");
    // The address was captured, so a reply carrying that email matches the imported row by email.
    const byEmail = submitRsvp(event.id, { party: { contact: { email: "BARE@example.com" } }, guests: [{ display_name: "Someone Else", status: "going" }] });
    expect(byEmail.guest_ids).toEqual([imported.guest_ids[0]]);
    expect(snapshot(event.id).guests).toHaveLength(1);
  });

  it("parses every documented guest-list format on one import", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const imported = importGuests(event.id, { text: "Alone\nAngle <angle@example.com>\nComma, comma@example.com\nbare@example.com" });
    expect(imported.added).toBe(4);
    const names = snapshot(event.id).guests.map((g) => g.display_name);
    expect(names).toEqual(["Alone", "Angle", "Comma", "bare"]);
  });

  it("keeps a line whose second field is not an email as a name with no email", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const imported = importGuests(event.id, { text: "Comma Person, notanemail" });
    expect(imported.added).toBe(1);
    expect(snapshot(event.id).guests[0].display_name).toBe("Comma Person, notanemail");
  });

  it("updates a listed guest on a second RSVP through the invite instead of duplicating the row", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    importGuests(event.id, { text: "Ada <a@x.com>" });
    submitRsvp(event.id, { guests: [{ display_name: "Ada", status: "going" }] });
    submitRsvp(event.id, { guests: [{ display_name: "Ada", status: "cant_go" }] });
    expect(snapshot(event.id).guests).toHaveLength(1);
    expect(snapshot(event.id).counts).toEqual({ going: 0, maybe: 0, cant_go: 1, no_reply: 0 });
  });

  it("rolls back the whole RSVP when a later guest carries an invalid answer", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const name = snapshot(event.id).definitions.find((d) => d.key === "printed_name")!;
    expect(() =>
      submitRsvp(event.id, {
        guests: [
          { display_name: "Guest One", status: "going", answers: { [name.id]: "One" } },
          { display_name: "Guest Two", status: "going", answers: { [name.id]: "x".repeat(50) } }
        ]
      })
    ).toThrow(/40/);
    expect(snapshot(event.id).guests).toHaveLength(0);
  });
});
