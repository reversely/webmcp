/** The scripted vendor agent (PRD Section 8, vendor progress): its posts reach the thread and the change feed through the endpoint. */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("the vendor agent reads its manifest and posts a confirmation and a shipped notice", async ({ request, baseURL }) => {
  const created = await request.post("/api/events", { data: { title: "Test event", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, delivery: { destination: "venue", address: null, needed_by: "2030-01-08" } } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);
  await request.post(`/api/events/${id}/rsvp`, { data: { guests: [{ display_name: "Guest One", status: "going" }, { display_name: "Guest Two", status: "going" }] } });
  const going = [{ field: "status", op: "eq", value: "going" }];
  const gift = (await (await request.post(`/api/events/${id}/gifts`, { data: { product_id: "prod_1", shop_domain: "shop.myshopify.com", product_title: "Product", recipients: going, rules: [{ filter: going, product_id: "prod_1" }], mapping: [], default_variant_id: "var_a", variants: [{ id: "var_a", title: "Default", price_cents: 1000, currency: "CAD" }], missing_value_fallback: "default", post_lock_cancellation: "keep" } })).json()) as { id: string };
  const token = (await (await request.post(`/api/events/${id}/tokens`, { data: { holder: "shop.myshopify.com", gift_ids: [gift.id], callable_tools: ["get_manifest", "get_changes", "post_update", "get_updates"] } })).json()) as { id: string };

  const out = execFileSync("npx", ["tsx", "scripts/vendor-agent.mts", baseURL!, id, token.id, gift.id, "confirm"], { encoding: "utf8" });
  expect(out).toContain("2 units to produce");
  expect(out).toContain("2 units confirmed for 2030-01-08");
  const shipped = execFileSync("npx", ["tsx", "scripts/vendor-agent.mts", baseURL!, id, token.id, gift.id, "ship"], { encoding: "utf8" });
  expect(shipped).toContain("shipped");

  const thread = (await (await request.get(`/api/events/${id}/gifts/${gift.id}/updates`)).json()) as { updates: { kind: string; caller: string; reference: string | null }[] };
  expect(thread.updates.map((u) => u.kind)).toEqual(["confirmed", "shipped"]);
  expect(thread.updates[0].caller).toBe(`token:${token.id}`);
  expect(thread.updates[1].reference).toMatch(/^REF-/);
  const changes = (await (await request.get(`/api/events/${id}/changes?since=0`)).json()) as { entries: { kind: string }[] };
  expect(changes.entries.filter((e) => e.kind === "update")).toHaveLength(2);
});
