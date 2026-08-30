import { beforeEach, describe, expect, it } from "vitest";
import { createGift, getGift, lockGift, manifest, proposeMapping, quantities, resolveGuest, setGiftOverride, unservable, type GiftInput } from "./gifts";
import { createEvent, createGuest, createParty, resetState, setGuestStatus, subjectFor, upsertDefinition, writeValue, type EventInput } from "./store";
import type { AttributeDefinition, GiftRule, Variant } from "./types";

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

const OPTIONS = [{ value: "a", label: "Choice A" }, { value: "b", label: "Choice B" }, { value: "c", label: "Choice C" }];
const VARIANTS: Variant[] = [
  { id: "var_a", title: "Item, Choice A", price_cents: 500, currency: "CAD" },
  { id: "var_b", title: "Item, choice b", price_cents: 500, currency: "CAD" },
  { id: "var_plain", title: "Item", price_cents: 500, currency: "CAD" }
];
const GOING = [{ field: "status", op: "eq", value: "going" }] as const;

function plan(choice: AttributeDefinition, patch: Partial<GiftInput> = {}): GiftInput {
  return {
    product_id: "prod_1",
    shop_domain: "shop.example",
    product_title: "Item",
    recipients: [...GOING],
    mapping: [
      { definition_id: choice.id, value: "a", variant_id: "var_a" },
      { definition_id: choice.id, value: "b", variant_id: "var_b" }
    ],
    default_variant_id: "var_plain",
    variants: VARIANTS,
    missing_value_fallback: "default",
    post_lock_cancellation: "keep",
    cutoff: null,
    cart_id: null,
    checkout_id: null,
    order_id: null,
    rules: [{ filter: [...GOING], product_id: "prod_1" }],
    ...patch
  };
}

function seed() {
  const event = createEvent(EVENT);
  const choice = upsertDefinition(event.id, { namespace: "organizer", key: "choice", label: "Choice", scope: "guest", value_type: "enum", constraints: { options: OPTIONS }, default_visibility: [], required_rule: "going", creator: "organizer" });
  const party = createParty(event.id, {});
  const one = createGuest(event.id, party.id, { display_name: "Guest One", status: "going" });
  const two = createGuest(event.id, party.id, { display_name: "Guest Two", status: "going", role: "role_x" });
  const three = createGuest(event.id, party.id, { display_name: "Guest Three", status: "going" });
  const four = createGuest(event.id, party.id, { display_name: "Guest Four", status: "maybe" });
  writeValue("guest", one.id, choice.id, "a", "guest");
  writeValue("guest", two.id, choice.id, "b", "guest");
  return { event, choice, one, two, three, four };
}

describe("the gift plan", () => {
  beforeEach(resetState);

  it("sends the product to every going guest under the default plan and to no one else", () => {
    const { event, choice, one, four } = seed();
    const gift = createGift(event.id, plan(choice));
    expect(resolveGuest(gift, subjectFor(one))).toEqual({ product_id: "prod_1", variant_id: "var_a", unit_status: "open" });
    expect(manifest(gift).map((r) => r.guest_id)).not.toContain(four.id);
    expect(quantities(gift).reduce((n, q) => n + q.quantity, 0)).toBe(3);
  });

  it("assigns the first matching rule's product in a two-rule plan", () => {
    const { event, choice, one, two } = seed();
    const rules: GiftRule[] = [
      { filter: [{ field: "role", op: "eq", value: "role_x" }], product_id: "prod_2" },
      { filter: [...GOING], product_id: "prod_1" }
    ];
    const gift = createGift(event.id, plan(choice, { rules }));
    expect(resolveGuest(gift, subjectFor(two))).toMatchObject({ product_id: "prod_2", unit_status: "open" });
    expect(resolveGuest(gift, subjectFor(one))).toMatchObject({ product_id: "prod_1", variant_id: "var_a" });
    expect(quantities(gift)).toEqual(expect.arrayContaining([{ product_id: "prod_2", variant_id: null, quantity: 1 }, { product_id: "prod_1", variant_id: "var_a", quantity: 1 }, { product_id: "prod_1", variant_id: "var_plain", quantity: 1 }]));
  });

  it("applies each missing-value fallback to a guest with no value", () => {
    const { event, choice, three } = seed();
    const byDefault = createGift(event.id, plan(choice, { missing_value_fallback: "default" }));
    expect(resolveGuest(byDefault, subjectFor(three))).toEqual({ product_id: "prod_1", variant_id: "var_plain", unit_status: "open" });
    const held = createGift(event.id, plan(choice, { missing_value_fallback: "hold" }));
    expect(resolveGuest(held, subjectFor(three))).toMatchObject({ variant_id: null, unit_status: "held", reason: expect.stringContaining("Choice") });
    const blank = createGift(event.id, plan(choice, { missing_value_fallback: "blank" }));
    expect(resolveGuest(blank, subjectFor(three))).toMatchObject({ variant_id: null, unit_status: "excluded" });
    expect(quantities(held).reduce((n, q) => n + q.quantity, 0)).toBe(2);
  });

  it("marks a value with no mapped variant unservable and lists the guest as a follow-up", () => {
    const { event, choice, three } = seed();
    writeValue("guest", three.id, choice.id, "c", "guest");
    const gift = createGift(event.id, plan(choice));
    expect(resolveGuest(gift, subjectFor(three))).toMatchObject({ product_id: "prod_1", variant_id: null, unit_status: "unservable", reason: expect.stringContaining("c") });
    expect(quantities(gift).reduce((n, q) => n + q.quantity, 0)).toBe(2);
    expect(unservable(event.id)).toEqual([{ gift_id: gift.id, guests: [{ guest_id: three.id, reason: expect.stringContaining("Choice") }] }]);
  });

  it("keeps an override through a later value write and an exclusion out of the count", () => {
    const { event, choice, one, two } = seed();
    const created = createGift(event.id, plan(choice));
    setGiftOverride(created.id, one.id, { variant_id: "var_b" });
    setGiftOverride(created.id, two.id, { excluded: true });
    writeValue("guest", one.id, choice.id, "a", "organizer");
    const gift = getGift(created.id);
    const rows = manifest(gift);
    expect(rows.find((r) => r.guest_id === one.id)).toMatchObject({ variant_id: "var_b", unit_status: "open" });
    expect(rows.find((r) => r.guest_id === two.id)).toMatchObject({ unit_status: "excluded" });
    expect(quantities(gift)).toEqual(expect.arrayContaining([{ product_id: "prod_1", variant_id: "var_b", quantity: 1 }, { product_id: "prod_1", variant_id: "var_plain", quantity: 1 }]));
    expect(resolveGuest(setGiftOverride(gift.id, one.id, {}), subjectFor(one)).variant_id).toBe("var_a");
  });

  it("counts units per variant and drops a cancellation before the lock", () => {
    const { event, choice, one } = seed();
    const gift = createGift(event.id, plan(choice));
    expect(quantities(gift)).toEqual(expect.arrayContaining([{ product_id: "prod_1", variant_id: "var_a", quantity: 1 }, { product_id: "prod_1", variant_id: "var_b", quantity: 1 }, { product_id: "prod_1", variant_id: "var_plain", quantity: 1 }]));
    setGuestStatus(one.id, "cant_go", "guest");
    expect(quantities(gift).find((q) => q.variant_id === "var_a")).toBeUndefined();
  });

  it("applies the post-lock choice to a cancellation after the lock", () => {
    const { event, choice, one } = seed();
    const gift = lockGift(createGift(event.id, plan(choice, { post_lock_cancellation: "reassign" })).id, "2030-01-05");
    expect(resolveGuest(gift, subjectFor(one)).unit_status).toBe("locked");
    expect(() => writeValue("guest", one.id, choice.id, "b", "guest")).toThrow(/locked/);
    expect(resolveGuest(gift, subjectFor(setGuestStatus(one.id, "cant_go", "guest")))).toMatchObject({ product_id: "prod_1", unit_status: "cancelled_reassignable" });
    expect(quantities(gift).reduce((n, q) => n + q.quantity, 0)).toBe(3);
  });

  it("lists one manifest row per recipient with product, variant, status, and values", () => {
    const { event, choice, one, two, three } = seed();
    const gift = createGift(event.id, plan(choice));
    const rows = manifest(gift);
    expect(rows.map((r) => r.guest_id)).toEqual([one.id, two.id, three.id]);
    expect(rows[0]).toMatchObject({ product_id: "prod_1", variant_id: "var_a", unit_status: "open", status: "going", values: { [choice.id]: "a" } });
  });

  it("proposes a mapping only where a variant title carries the option label", () => {
    const { choice } = seed();
    const proposed = proposeMapping(choice, VARIANTS);
    expect(proposed.rows).toEqual([
      { definition_id: choice.id, value: "a", variant_id: "var_a" },
      { definition_id: choice.id, value: "b", variant_id: "var_b" }
    ]);
    expect(proposed.unmatched).toEqual([OPTIONS[2]]);
  });
});
