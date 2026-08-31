import { beforeEach, describe, expect, it } from "vitest";
import { createGift, updateGift } from "../domain/gifts";
import { publishEvent, resetState, upsertDefinition } from "../domain/store";
import { createEventFromBody, snapshot, submitRsvp } from "./api";
import { createToken, handleRpc, tokenFrom, type RpcRequest } from "./mcp";
import { TOOLS } from "../webmcp/tools";
import { cartOperations } from "./registry";

const BODY = { title: "Test event", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };

function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const snap = snapshot(event.id);
  const name = snap.definitions.find((d) => d.key === "printed_name")!;
  const choice = upsertDefinition(event.id, { ...snap.definitions.find((d) => d.key === "dietary")!, constraints: { options: [{ value: "a", label: "Choice A" }, { value: "none", label: "None" }] } });
  const reply = submitRsvp(event.id, { guests: [{ display_name: "Guest One", status: "going", answers: { [name.id]: "One", [choice.id]: ["a"] } }, { display_name: "Guest Two", status: "going", answers: { [choice.id]: ["none"] } }] });
  const going = [{ field: "status", op: "eq", value: "going" }] as const;
  const gift = createGift(event.id, {
    product_id: "prod_1",
    shop_domain: "shop.myshopify.com",
    product_title: "Product",
    recipients: [...going],
    rules: [{ filter: [...going], product_id: "prod_1" }],
    mapping: [{ definition_id: choice.id, value: "a", variant_id: "var_a" }],
    default_variant_id: "var_n",
    variants: [{ id: "var_a", title: "Choice A", price_cents: 1000, currency: "CAD" }, { id: "var_n", title: "Plain", price_cents: 1000, currency: "CAD" }],
    missing_value_fallback: "default",
    post_lock_cancellation: "keep",
    cutoff: null,
    cart_id: null,
    checkout_id: null,
    order_id: null
  } as never);
  const organizer = createToken(event.id, { holder: "organizer", callable_tools: TOOLS.map((t) => t.name) });
  const vendor = createToken(event.id, { holder: "shop.myshopify.com", gift_ids: [gift.id], readable_definition_ids: [choice.id], callable_tools: ["get_manifest", "get_changes", "post_update", "get_updates", "count_by", "get_summary"] });
  return { event, name, choice, gift, organizer, vendor, guestIds: reply.guest_ids };
}
const call = (eventId: string, token: ReturnType<typeof createToken> | null, name: string, args: Record<string, unknown> = {}) => handleRpc(eventId, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const payload = (r: Record<string, unknown>) => JSON.parse((r.result as { content: { text: string }[] }).content[0].text);
const isError = (r: Record<string, unknown>) => (r.result as { isError?: boolean }).isError === true;

describe("the MCP endpoint", () => {
  beforeEach(resetState);

  it("returns a JSON-RPC error for a non-object body rather than a 500 (issue #132)", async () => {
    const { event, organizer } = seed();
    for (const bad of [null, 42]) {
      const r = await handleRpc(event.id, organizer, bad as unknown as RpcRequest);
      expect((r.error as { code: number }).code).toBe(-32600);
      expect(r.result).toBeUndefined();
    }
  });

  it("lists only the tools a token may call, and refuses without a token", async () => {
    const { event, organizer, vendor } = seed();
    const all = await handleRpc(event.id, organizer, { method: "tools/list", id: 1 });
    expect((all.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    const some = await handleRpc(event.id, vendor, { method: "tools/list", id: 2 });
    expect((some.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(["count_by", "get_summary", "get_manifest", "get_changes", "post_update", "get_updates"]);
    const none = await handleRpc(event.id, null, { method: "tools/list", id: 3 });
    expect(isError(none)).toBe(true);
    expect((await call("evt_none", organizer, "get_summary")).error).toMatchObject({ code: -32004 });
  });

  it("scopes a vendor's manifest to its gift and its readable definitions, and refuses the tools it lacks", async () => {
    const { event, vendor, gift, name, choice } = seed();
    const manifest = await call(event.id, vendor, "get_manifest", { gift_id: gift.id });
    expect(isError(manifest)).toBe(false);
    const rows = payload(manifest).rows as { values: Record<string, unknown> }[];
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0].values)).toEqual([choice.id]);
    expect(rows[0].values[name.id]).toBeUndefined();
    expect(isError(await call(event.id, vendor, "get_manifest", { gift_id: "gift_other" }))).toBe(true);
    expect(isError(await call(event.id, vendor, "list_guests", {}))).toBe(true);
    expect(isError(await call(event.id, vendor, "approve", { gift_id: gift.id }))).toBe(true);
    expect(isError(await call(event.id, vendor, "count_by", { definition_id: name.id }))).toBe(true);
    expect(isError(await call(event.id, vendor, "count_by", { definition_id: choice.id }))).toBe(false);
  });

  it("a vendor's post reaches the thread and the change feed, and its profile is recorded", async () => {
    const { event, vendor, gift, organizer } = seed();
    const before = payload(await call(event.id, vendor, "get_changes", { since_seq: 0 })).seq as number;
    const posted = await call(event.id, vendor, "post_update", { gift_id: gift.id, kind: "confirmed", text: "Confirmed.", expected_date: "2030-01-08", meta: { "ucp-agent": { profile: "https://vendor.example/profile.json" } } });
    expect(isError(posted)).toBe(false);
    expect(payload(posted)).toMatchObject({ kind: "confirmed", caller: `token:${vendor.id}` });
    const thread = payload(await call(event.id, organizer, "get_updates", { gift_id: gift.id })).updates as { kind: string }[];
    expect(thread.map((u) => u.kind)).toEqual(["confirmed"]);
    const feed = payload(await call(event.id, vendor, "get_changes", { since_seq: before })).entries as { kind: string }[];
    expect(feed.map((e) => e.kind)).toEqual(["update"]);
    expect(tokenFrom(event.id, new Request("http://x", { headers: { authorization: `Bearer ${vendor.id}` } }))?.last_profile_url).toBe("https://vendor.example/profile.json");
  });

  it("has the cart operations registered for the organizer's send and approve", () => {
    expect(typeof cartOperations.send).toBe("function");
    expect(typeof cartOperations.approve).toBe("function");
  });

  it("reads the token from the bearer header and rejects an expired or foreign one", () => {
    const { event, vendor } = seed();
    expect(tokenFrom(event.id, new Request("http://x", { headers: { authorization: `Bearer ${vendor.id}` } }))?.id).toBe(vendor.id);
    expect(tokenFrom("evt_other", new Request("http://x", { headers: { authorization: `Bearer ${vendor.id}` } }))).toBeNull();
    const expired = createToken(event.id, { holder: "x", callable_tools: ["get_changes"], expires_at: "2000-01-01T00:00:00Z" });
    expect(tokenFrom(event.id, new Request("http://x", { headers: { authorization: `Bearer ${expired.id}` } }))).toBeNull();
    expect(tokenFrom(event.id, new Request("http://x"))).toBeNull();
  });

  it("stores a personalization mapping through the organizer tool and refuses an invalid one", async () => {
    const { event, gift, organizer, vendor, name } = seed();
    updateGift(gift.id, { personalization: { fields: [{ key: "caption", label: "Caption", kind: "name", required: true }] } } as never);
    const good = [{ vendor_field_key: "caption", source: { type: "definition", definition_id: name.id, subject_scope: "guest" } }];
    const stored = await call(event.id, organizer, "set_personalization_mapping", { gift_id: gift.id, mappings: good });
    expect(isError(stored)).toBe(false);
    expect(payload(stored).personalization_mappings).toEqual(good);
    const bad = await call(event.id, organizer, "set_personalization_mapping", { gift_id: gift.id, mappings: [{ vendor_field_key: "nope", source: { type: "literal", value: "x" } }] });
    expect(isError(bad)).toBe(true);
    expect(payload(bad).error).toContain("unknown_field");
    expect(isError(await call(event.id, vendor, "set_personalization_mapping", { gift_id: gift.id, mappings: good }))).toBe(true);
  });

  it("hides the personalization entries a vendor token may not read", async () => {
    const { event, gift, vendor, name, choice } = seed();
    const fields = [
      { key: "caption", label: "Caption", kind: "name", required: true },
      { key: "flavour", label: "Flavour", kind: "word_list", required: false },
      { key: "heading", label: "Heading", kind: "text", required: false }
    ];
    const rows = [
      { vendor_field_key: "caption", source: { type: "definition", definition_id: name.id, subject_scope: "guest" } },
      { vendor_field_key: "flavour", source: { type: "definition", definition_id: choice.id, subject_scope: "guest" } },
      { vendor_field_key: "heading", source: { type: "event", key: "title" } }
    ];
    updateGift(gift.id, { personalization: { fields }, personalization_mappings: rows } as never);
    const view = payload(await call(event.id, vendor, "get_manifest", { gift_id: gift.id }));
    const first = (view.rows as { personalization: Record<string, unknown>; personalization_status: string }[])[0];
    expect(Object.keys(first.personalization).sort()).toEqual(["flavour", "heading"]);
    expect(first.personalization_status).toBe("ready");
  });
});
