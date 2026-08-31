/** The Guest Experience (PRD Section 5): the four screens, the gift list, the thread, and the ask bar. The catalog search is answered by a fixture so the run is deterministic. */
import { expect, test } from "@playwright/test";

const RESULT = (id: string, title: string, price: number, variants: { id: string; title: string }[]) => ({ product_id: id, title, description: "", url: null, image_url: null, shop_domain: "shop.myshopify.com", shop_name: "Shop", shop_url: "https://shop", policy_links: [], price_cents: price, currency: "CAD", variants: variants.map((v) => ({ ...v, price_cents: price, currency: "CAD", available: true, options: [] })), option_names: ["Choice"], searches: ["q"], delivery: { window: { earliest: "2029-12-30", latest: "2030-01-03" }, text: "Arrives Dec 30 to Jan 3", confidence: "dated", error: null }, score: 0.8, terms: {}, verdict: { eligible: true, rule: null, reason: null } });

test("a category becomes a gift with a mapping, quantities follow the replies, and the thread shows the vendor's posts", async ({ page, request }) => {
  const created = await request.post("/api/events", { data: { title: "Test event", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, cost_per_person_cents: 2000, delivery: { destination: "venue", address: null, needed_by: "2030-01-08" } } });
  const { id } = (await created.json()) as { id: string };
  const snap = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: { id: string; key: string; value_type: string }[] };
  const defs = snap.definitions.map((d) => (d.value_type === "multi_enum" ? { ...d, constraints: { options: [{ value: "a", label: "Choice A" }, { value: "none", label: "None" }] } } : d));
  await request.put(`/api/events/${id}/definitions`, { data: { definitions: defs } });
  await request.post(`/api/events/${id}/publish`);
  const choice = defs.find((d) => d.key === "dietary")!.id;
  await request.post(`/api/events/${id}/rsvp`, { data: { guests: [{ display_name: "Guest One", status: "going", answers: { [choice]: ["a"] } }, { display_name: "Guest Two", status: "going", answers: { [choice]: ["none"] } }, { display_name: "Guest Three", status: "maybe" }] } });

  await page.route(`**/api/events/${id}/search`, async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.fulfill({ json: { searches: [{ query: "q" }], found: 2, probed: 2, duration_ms: 1, ranked: [RESULT("p1", "Box A", 1500, [{ id: "v_a", title: "Choice A box" }, { id: "v_p", title: "Plain box" }]), RESULT("p2", "Box B", 1800, [{ id: "v_b", title: "Box" }])], excluded: [{ product_id: "p3", title: "Box C", shop_name: "Shop", rule: "price", reason: "The unit price is above the budget of 2000 cents." }] } }); });

  await page.goto(`/events/${id}`);
  await page.getByTestId("tab-experience").click();
  await page.getByTestId("card-food_drink").click();
  await expect(page.getByTestId("results-skeleton")).toBeVisible();
  await expect(page.getByTestId("result")).toHaveCount(2);
  await page.getByTestId("result").first().click();
  await expect(page.getByTestId("recipients")).toContainText("Guests going (2)");
  await page.getByTestId("next").click();
  // The mapping proposes the variant whose title carries the option's label.
  await expect(page.getByLabel("Variant for Choice A")).toHaveValue("v_a");
  await page.getByLabel("Variant for None").selectOption("v_p");
  await page.getByTestId("confirm").click();
  await expect(page.getByTestId("gift")).toHaveCount(1, { timeout: 8000 });
  await expect(page.getByTestId("gift")).toContainText("2 units");
  await expect(page.getByTestId("order-summary")).toContainText("2 gifts");
  await expect(page.getByTestId("order-summary")).toContainText("Choice A box");

  // A reply changes the quantity within a poll.
  const guests = (await (await request.get(`/api/events/${id}`)).json()) as { guests: { id: string; display_name: string }[]; gifts: { id: string }[] };
  await request.patch(`/api/events/${id}/rsvp/${guests.guests.find((g) => g.display_name === "Guest Two")!.id}`, { data: { status: "cant_go" } });
  await expect(page.getByTestId("gift")).toContainText("1 unit", { timeout: 8000 });

  // The vendor posts through the endpoint; the thread and the follow-ups show it.
  const gift = guests.gifts[0].id;
  const token = (await (await request.post(`/api/events/${id}/tokens`, { data: { holder: "shop.myshopify.com", gift_ids: [gift], callable_tools: ["post_update"] } })).json()) as { id: string };
  await request.post(`/api/events/${id}/mcp`, { headers: { Authorization: `Bearer ${token.id}` }, data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "post_update", arguments: { gift_id: gift, kind: "question", text: "Can we substitute the box colour?" } } } });
  await page.getByTestId("thread-gift").click();
  await expect(page.getByTestId("thread")).toContainText("Can we substitute the box colour?");
  await page.getByTestId("reply").fill("Yes.");
  await page.getByTestId("reply").press("Enter");
  await expect(page.getByTestId("thread")).toContainText("Yes.");
  await page.getByTestId("tab-overview").click();
  await expect(page.getByTestId("followups")).not.toContainText("asked a question", { timeout: 8000 });

  // The ask bar answers from the search.
  await page.getByTestId("tab-experience").click();
  await page.getByTestId("ask").fill("why is Box C missing?");
  await page.getByTestId("ask").press("Enter");
  await expect(page.getByTestId("answer")).toContainText("price");
});
