import { beforeEach, describe, expect, it } from "vitest";
import { changesSince, countBy, createEvent, createGuest, createParty, definitionsFor, InvalidValueError, listGuests, listMissing, lockValue, LockedValueError, publishEvent, resetState, setGuestStatus, upsertDefinition, writeValue, type EventInput } from "./store";

const EVENT: EventInput = {
  type: "event",
  title: "Test event",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" },
  spots: 10,
  cost_per_person_cents: 1000,
  rsvp_deadline: "2030-01-03",
  description: "",
  invite_extras: [],
  response_options: ["going", "maybe", "cant_go"],
  settings: { guest_approval: false, reminders: true, reask_on_change: true, order_approval: true },
  segments: [],
  delivery: { destination: "venue", address: null, needed_by: "2030-01-08" }
};

const OPTIONS = [{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }, { value: "none", label: "None" }];

function seed() {
  const event = createEvent(EVENT);
  const [name, seeded] = definitionsFor(event.id);
  // The organizer fills the option list; the library seeds it empty.
  const dietary = upsertDefinition(event.id, { ...seeded, constraints: { options: OPTIONS } });
  const party = createParty(event.id, { contact: { email: "one@example.com" } });
  const ana = createGuest(event.id, party.id, { display_name: "Guest One", status: "going" });
  const marcus = createGuest(event.id, party.id, { display_name: "Guest Two", status: "going" });
  const dev = createGuest(event.id, party.id, { display_name: "Guest Three", status: "maybe" });
  return { event, name, dietary, party, ana, marcus, dev };
}

describe("the store", () => {
  beforeEach(resetState);

  it("seeds the library's flagged questions with empty option lists and publishes with a six-character code", () => {
    const { event, name, dietary } = seed();
    expect(name).toMatchObject({ key: "printed_name", value_type: "text", required_rule: "going", creator: "library" });
    expect(dietary).toMatchObject({ key: "dietary", value_type: "multi_enum" });
    expect(definitionsFor(event.id).find((d) => d.key === "dietary")!.constraints.options).toEqual(OPTIONS);
    const published = publishEvent(event.id);
    expect(published.status).toBe("published");
    expect(published.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(publishEvent(event.id).invite_code).toBe(published.invite_code);
  });

  it("writes values through validation and appends change-log entries in sequence", () => {
    const { event, name, dietary, ana, marcus } = seed();
    const before = changesSince(event.id, 0).length;
    writeValue("guest", ana.id, name.id, "Ana", "guest");
    writeValue("guest", ana.id, dietary.id, ["a"], "guest");
    expect(() => writeValue("guest", marcus.id, dietary.id, ["zzz"], "guest")).toThrow(InvalidValueError);
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
    writeValue("guest", ana.id, dietary.id, ["a"], "guest");
    writeValue("guest", marcus.id, dietary.id, ["none"], "guest");
    writeValue("guest", ana.id, name.id, "Ana", "guest");
    expect(listGuests(event.id, [{ field: "status", op: "eq", value: "going" }]).map((g) => g.display_name)).toEqual(["Guest One", "Guest Two"]);
    const counts = countBy(event.id, dietary.id, [{ field: "status", op: "eq", value: "going" }]);
    if (counts.value_type !== "multi_enum") throw new Error();
    expect(counts.counts.map((c) => [c.option.value, c.count])).toEqual([["a", 1], ["b", 0], ["none", 1]]);
    expect(listMissing(event.id, name.id, [{ field: "status", op: "eq", value: "going" }]).map((g) => g.display_name)).toEqual(["Guest Two"]);
  });
});
