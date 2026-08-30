import { beforeEach, describe, expect, it } from "vitest";
import { changesSince, countBy, createEvent, createGuest, createParty, definitionsFor, InvalidValueError, listGuests, listMissing, lockValue, LockedValueError, publishEvent, resetState, setGuestStatus, writeValue, type EventInput } from "./store";

const EVENT: EventInput = {
  type: "birthday",
  title: "Lexi's 25th birthday",
  host: "Shereen",
  starts_at: "2026-10-17T19:00:00-04:00",
  venue: { name: "Paradise Grapevine", line1: "218 Geary Ave", city: "Toronto", region: "ON", postal_code: "M6H 2A8", country: "CA" },
  spots: 80,
  cost_per_person_cents: 1800,
  rsvp_deadline: "2026-10-10",
  description: "",
  invite_extras: [],
  response_options: ["going", "maybe", "cant_go"],
  settings: { guest_approval: false, reminders: true, reask_on_change: true, order_approval: true },
  segments: []
};

function seed() {
  const event = createEvent(EVENT);
  const [name, dietary] = definitionsFor(event.id);
  const party = createParty(event.id, { contact: { email: "ana@example.com" } });
  const ana = createGuest(event.id, party.id, { display_name: "Ana Ruiz", status: "going" });
  const marcus = createGuest(event.id, party.id, { display_name: "Marcus Lee", status: "going" });
  const dev = createGuest(event.id, party.id, { display_name: "Dev Patel", status: "maybe" });
  return { event, name, dietary, party, ana, marcus, dev };
}

describe("the store", () => {
  beforeEach(resetState);

  it("seeds the name and dietary questions and publishes with a six-character code", () => {
    const { event, name, dietary } = seed();
    expect(name).toMatchObject({ key: "printed_name", value_type: "text", required_rule: "going" });
    expect(dietary).toMatchObject({ key: "dietary", value_type: "multi_enum" });
    const published = publishEvent(event.id);
    expect(published.status).toBe("published");
    expect(published.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(publishEvent(event.id).invite_code).toBe(published.invite_code);
  });

  it("writes values through validation and appends change-log entries in sequence", () => {
    const { event, name, dietary, ana, marcus } = seed();
    const before = changesSince(event.id, 0).length;
    writeValue("guest", ana.id, name.id, "Ana", "guest");
    writeValue("guest", ana.id, dietary.id, ["vegan"], "guest");
    expect(() => writeValue("guest", marcus.id, dietary.id, ["halal"], "guest")).toThrow(InvalidValueError);
    setGuestStatus(marcus.id, "cant_go", "guest");
    const changes = changesSince(event.id, 0);
    expect(changes.length).toBe(before + 3);
    expect(changes.map((c) => c.seq)).toEqual([...changes.map((c) => c.seq)].sort((a, b) => a - b));
    expect(changes.at(-1)).toMatchObject({ kind: "status", guest_id: marcus.id, from: "going", to: "cant_go" });
    expect(changesSince(event.id, changes.at(-2)!.seq)).toHaveLength(1);
  });

  it("rejects a guest edit of a locked value with the lock, and lets the organizer through", () => {
    const { ana, name } = seed();
    writeValue("guest", ana.id, name.id, "Ana", "guest");
    lockValue("guest", ana.id, name.id, { batch_id: "gift_1", date: "2026-10-12" });
    expect(() => writeValue("guest", ana.id, name.id, "Anna", "guest")).toThrow(LockedValueError);
    expect(writeValue("guest", ana.id, name.id, "Anna", "organizer").value).toBe("Anna");
  });

  it("lists, counts, and finds missing values through the filter grammar", () => {
    const { event, name, dietary, ana, marcus } = seed();
    writeValue("guest", ana.id, dietary.id, ["vegan"], "guest");
    writeValue("guest", marcus.id, dietary.id, ["none"], "guest");
    writeValue("guest", ana.id, name.id, "Ana", "guest");
    expect(listGuests(event.id, [{ field: "status", op: "eq", value: "going" }]).map((g) => g.display_name)).toEqual(["Ana Ruiz", "Marcus Lee"]);
    const counts = countBy(event.id, dietary.id, [{ field: "status", op: "eq", value: "going" }]);
    if (counts.value_type !== "multi_enum") throw new Error();
    expect(counts.counts.map((c) => [c.option.value, c.count])).toEqual([["vegan", 1], ["gluten_free", 0], ["nut_allergy", 0], ["none", 1]]);
    expect(listMissing(event.id, name.id, [{ field: "status", op: "eq", value: "going" }]).map((g) => g.display_name)).toEqual(["Marcus Lee"]);
  });
});
