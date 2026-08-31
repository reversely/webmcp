/**
 * The one-clause rule (ui-copy skill, closed #114 for dates and #147 for the join sites): no
 * app-authored string a page renders carries a comma. This walks every text node plus the
 * placeholder, aria-label, and title attributes on the draft, invite, overview, and experience
 * screens and fails on any comma. The catalog search and curate routes are answered by fixtures so
 * the run is deterministic and no live service is called. Seed data stays comma-free, and multi
 * answers hold a single value, so a comma left in guest-entered or vendor data is out of scope
 * (issue #147) and never reaches the walker.
 */
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

const VENUE = { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" };

/** Every rendered text node and every placeholder or aria-label or title attribute on the page. */
async function strings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const tag = n.parentElement?.tagName.toLowerCase();
      if (tag !== "script" && tag !== "style" && n.textContent?.trim()) out.push(n.textContent.trim());
    }
    for (const el of document.body.querySelectorAll("[placeholder],[aria-label],[title]")) {
      for (const a of ["placeholder", "aria-label", "title"]) { const v = el.getAttribute(a); if (v) out.push(v); }
    }
    return out;
  });
}

async function expectNoComma(page: Page) {
  const withComma = (await strings(page)).filter((s) => s.includes(","));
  expect(withComma, "app-authored strings with a comma").toEqual([]);
}

/** A search result the fixture serves; its option names stay a single value so the "Choices" list is comma-free. */
const RESULT = (id: string, title: string, price: number, variants: { id: string; title: string }[]) => ({ product_id: id, title, description: "", url: null, image_url: null, shop_domain: "shop.myshopify.com", shop_name: "Shop", shop_url: "https://shop", policy_links: [], price_cents: price, currency: "CAD", variants: variants.map((v) => ({ ...v, price_cents: price, currency: "CAD", available: true, options: [] })), option_names: ["Choice"], searches: ["q"], delivery: { window: { earliest: "2029-12-30", latest: "2030-01-03" }, text: "Arrives soon", confidence: "dated", error: null }, score: 0.8, terms: {}, verdict: { eligible: true, rule: null, reason: null } });

/** Create, define a multi-choice question, publish, and reply so every screen has data to render. */
async function publishedEvent(request: APIRequestContext) {
  const created = await request.post("/api/events", { data: { title: "Test event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: VENUE, cost_per_person_cents: 2000, rsvp_deadline: "2030-01-03", delivery: { destination: "venue", address: null, needed_by: "2030-01-08" } } });
  const { id } = (await created.json()) as { id: string };
  const snap = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: { id: string; key: string; value_type: string }[] };
  const defs = snap.definitions.map((d) => (d.value_type === "multi_enum" ? { ...d, constraints: { options: [{ value: "a", label: "Choice A" }, { value: "none", label: "None" }] } } : d));
  await request.put(`/api/events/${id}/definitions`, { data: { definitions: defs } });
  const published = (await (await request.post(`/api/events/${id}/publish`)).json()) as { event: { invite_code: string } };
  const choice = defs.find((d) => d.key === "dietary")!.id;
  // Single-value answers so the guest table's answer join renders one label with no comma.
  await request.post(`/api/events/${id}/rsvp`, { data: { guests: [{ display_name: "Guest One", status: "going", answers: { [choice]: ["a"] } }, { display_name: "Guest Two", status: "maybe" }] } });
  return { id, code: published.event.invite_code };
}

test("the draft page renders no comma in the details or the invite preview", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("title").fill("Team offsite");
  await page.getByTestId("starts_at").fill("2030-01-10T19:00");
  await page.getByTestId("host").fill("A. Host");
  await page.getByTestId("venue_name").fill(VENUE.name);
  await page.getByTestId("line1").fill(VENUE.line1);
  await page.getByTestId("city").fill(VENUE.city);
  await page.getByTestId("cost").fill("10");
  await page.getByTestId("deadline").fill("2030-01-03");
  await page.getByTestId("needed_by").fill("2030-01-08");
  const choiceInput = page.getByTestId("questions").getByLabel(/Add a choice to/).first();
  await choiceInput.fill("Choice one");
  await choiceInput.press("Enter");
  // The preview carries the venue hero built from name and line1 and city.
  await expect(page.getByTestId("invite-preview")).toContainText(VENUE.city);
  await expectNoComma(page);
});

test("the invite page renders no comma in the venue hero", async ({ page, request }) => {
  const { code } = await publishedEvent(request);
  await page.goto(`/i/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText("Test event");
  await expectNoComma(page);
});

test("the overview renders no comma in the setup delivery or the guest table", async ({ page, request }) => {
  const { id } = await publishedEvent(request);
  await page.goto(`/events/${id}`);
  await expect(page.getByTestId("setup-delivery")).toContainText("Gifts to Venue in City");
  await expect(page.getByTestId("guests")).toContainText("Choice A");
  await expectNoComma(page);
});

test("the experience results and mapping render no comma in the funnel or the summaries", async ({ page, request }) => {
  const { id } = await publishedEvent(request);
  await page.route(`**/api/events/${id}/search`, async (route) => {
    await route.fulfill({ json: {
      // A funnel whose search names two categories exercises the category join.
      funnel: { searches: [{ query: "q", categories: ["kitchen", "toys"], returned: 2, total: 5 }], merged: 2, probed: 2, ranked: 2, excluded: { price: 1 } },
      searches: [{ query: "q", categories: ["kitchen", "toys"] }], found: 2, probed: 2, duration_ms: 1,
      ranked: [RESULT("p1", "Box A", 1500, [{ id: "v_a", title: "Choice A box" }, { id: "v_p", title: "Plain box" }]), RESULT("p2", "Box B", 1800, [{ id: "v_b", title: "Box" }])],
      excluded: [{ product_id: "p3", title: "Box C", shop_name: "Shop", rule: "price", reason: "Above the budget" }],
    } });
  });

  await page.goto(`/events/${id}`);
  await page.getByTestId("tab-experience").click();
  await page.getByTestId("card-food_drink").click();
  await expect(page.getByTestId("result")).toHaveCount(2);
  await expect(page.getByTestId("funnel")).toContainText("kitchen and toys");
  await expectNoComma(page);

  // The mapping step lists each variant with its price, the site the ", $" join used to render.
  await page.getByTestId("result").first().click();
  await expect(page.getByTestId("recipients")).toBeVisible();
  await page.getByTestId("next").click();
  await expect(page.getByLabel("Variant for Choice A")).toBeVisible();
  await expectNoComma(page);
});
