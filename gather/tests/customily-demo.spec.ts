/**
 * The recorded curation demo (#125), one path per scene, live: the catalog and the user's own
 * Customily store searched together, the CurationAgent's real model run, and the #124 batch driver
 * carting a personalized star-map crewneck per guest onto the live storefront. Two Gather browser
 * contexts (the organizer and a guest) record to tests/videos; the batch driver records the
 * storefront session to tests/videos as well. A caption at the foot of each Gather page names the
 * scene. The recording stops at the cart with one star-map preview per guest; the placed test
 * order is issue #150.
 *
 * Gated on LIVE_CUSTOMILY=1 so the normal suite skips it. Needs the dev server on 3113 with
 * CUSTOMILY_SHOP_URL (the store the search lists) and OPENAI_API_KEY (the curation model) in its
 * environment, and network to the live storefront. Event data comes from the gitignored
 * docs/demo-event.json (or DEMO_EVENT); tests/demo-event.example.json shows the shape.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { runPersonalization, type EventContext } from "../scripts/personalize-agent";

test.describe.configure({ mode: "serial" });
test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run the live Customily curation demo.");

/** The live star-map crewneck: its own product page, its numeric Shopify id, and its personalization schema. */
const PRODUCT_URL = "https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt";
const PRODUCT_ID = "10242071789817";
const SHOP_DOMAIN = "springbuilt.myshopify.com";
const customshop = JSON.parse(readFileSync(fileURLToPath(new URL("../src/agent/customshop.json", import.meta.url)), "utf8")) as { shop_name: string; products: Record<string, { fields: { key: string; label: string; kind: string; required: boolean }[] }> };
const FIELDS = customshop.products[PRODUCT_ID].fields;
const SHOP_NAME = customshop.shop_name;

type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; choices: string[]; guests: { name: string; choice: string }[]; card: string; search: string; curate: string; guest_list?: string[] };
const DEMO_PATH = process.env.DEMO_EVENT ?? "docs/demo-event.json";
const DEMO: DemoEvent | null = existsSync(DEMO_PATH) ? (JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoEvent) : null;
test.skip(!DEMO, `No demo event at ${DEMO_PATH}; copy tests/demo-event.example.json there and fill in the apparel and curation fields.`);
const EVENT = DEMO!;
const GUESTS = DEMO?.guests ?? [];
const CHOICES = DEMO?.choices ?? [];
const KEY_DELAY_MS = 35;
const READ_MS = 2000;
const LIVE_MS = 240_000;

let browserRef: Browser;
let organizerContext: BrowserContext;
let guestContext: BrowserContext;
let organizer: Page;
let guest: Page;
let eventId = "";
let giftId = "";
let inviteUrl = "";

async function caption(text: string) {
  for (const page of [organizer, guest]) {
    await page.evaluate((t) => {
      let el = document.getElementById("demo-caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "demo-caption";
        el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:9999;padding:8px 14px;border-radius:8px;background:#0B3D6E;color:#fff;font:500 14px/1.4 Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none;max-width:70vw";
        document.body.appendChild(el);
      }
      el.textContent = t;
    }, text).catch(() => undefined);
  }
}
const rest = (page: Page, ms = READ_MS) => page.waitForTimeout(ms);
async function typeInto(page: Page, locator: Locator, text: string) {
  await locator.click();
  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
}

/** The event facts the batch driver needs off the token path: the ship-to venue and an empty checkout contact (the demo stops at the cart). */
const EVENT_CONTEXT: EventContext = { venue: EVENT.venue, delivery: { destination: "venue", address: null, needed_by: EVENT.needed_by }, contact: { email: null, phone: null } };

type LiveVariant = { id: string; title: string; price_cents: number };
/** The live product's numeric variants from its storefront JSON; the batch's cart lines bind to these ids. */
async function liveVariants(request: APIRequestContext): Promise<LiveVariant[]> {
  const res = await request.get(`${PRODUCT_URL}.js`);
  expect(res.ok()).toBe(true);
  const product = (await res.json()) as { variants: { id: number; title: string; price: number }[] };
  const variants = product.variants.map((v) => ({ id: String(v.id), title: v.title, price_cents: v.price }));
  expect(variants.length).toBeGreaterThanOrEqual(1);
  return variants;
}

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  organizerContext = await browserRef.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 900 } } });
  guestContext = await browserRef.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 900 } } });
  organizer = await organizerContext.newPage();
  guest = await guestContext.newPage();
  await guest.goto("about:blank");
});

test.afterAll(async () => {
  const videos = [organizer.video(), guest.video()];
  await organizerContext.close();
  await guestContext.close();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await videos[0]?.saveAs(`tests/videos/curation-organizer-${stamp}.webm`);
  await videos[1]?.saveAs(`tests/videos/curation-guest-${stamp}.webm`);
  await Promise.all(videos.map((v) => v?.delete()));
});

test("Scene 1: the organizer publishes the event and the guests answer with the name to print", async () => {
  test.setTimeout(LIVE_MS);
  await organizer.goto("/");
  await caption("Scene 1: event setup");
  await typeInto(organizer, organizer.getByTestId("title"), EVENT.title);
  await organizer.getByTestId("starts_at").fill(EVENT.starts_at);
  await typeInto(organizer, organizer.getByTestId("host"), EVENT.host);
  await typeInto(organizer, organizer.getByTestId("venue_name"), EVENT.venue.name);
  await typeInto(organizer, organizer.getByTestId("line1"), EVENT.venue.line1);
  await organizer.getByTestId("city").fill(EVENT.venue.city);
  await organizer.getByTestId("region").fill(EVENT.venue.region);
  await organizer.getByTestId("postal_code").fill(EVENT.venue.postal_code);
  await organizer.getByTestId("country").fill(EVENT.venue.country);
  await organizer.getByTestId("spots").fill(EVENT.spots);
  await organizer.getByTestId("cost").fill(EVENT.cost);
  await organizer.getByTestId("deadline").fill(EVENT.deadline);
  await organizer.getByTestId("needed_by").fill(EVENT.needed_by);
  await caption("Scene 1: the dietary choices in the organizer's words");
  const choiceInput = organizer.getByTestId("questions").getByLabel(/Add a choice to/).first();
  for (const c of CHOICES) {
    await typeInto(organizer, choiceInput, c);
    await choiceInput.press("Enter");
  }
  await expect(organizer.getByTestId("invite-preview")).toContainText(CHOICES[0]);
  if (EVENT.guest_list?.length) await organizer.getByTestId("guest-list").fill(EVENT.guest_list.filter(Boolean).join("\n"));
  await rest(organizer);
  await organizer.getByTestId("publish").click();
  await organizer.waitForURL(/\/events\/evt_/);
  eventId = organizer.url().split("/events/")[1];
  await organizer.goto(`/events/${eventId}?webmcp=polyfill`);
  await expect(organizer.getByTestId("status")).toHaveText("Published");
  await expect(organizer.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(organizer.getByTestId("invite-link")).toContainText(/\/i\//);
  inviteUrl = (await organizer.getByTestId("invite-link").innerText()).trim();
  await caption("Scene 1: published with the invite link");
  await rest(organizer);
  for (const g of GUESTS) {
    await guest.goto(inviteUrl);
    await caption(`Scene 1: ${g.name} replies with the name to print`);
    await typeInto(guest, guest.getByTestId("guest-name"), g.name);
    await guest.getByTestId("status").getByRole("button", { name: "Going" }).click();
    await typeInto(guest, guest.getByTestId("answer-printed_name").getByRole("textbox"), g.name);
    await guest.getByTestId("answer-dietary").getByRole("button", { name: g.choice, exact: true }).click();
    await guest.getByTestId("send").click();
    await expect(guest.getByTestId("saved")).toHaveText("Saved as Going");
    await rest(guest, 1000);
  }
  await caption(`Scene 1: ${GUESTS.length} guests going with a name to print`);
  await expect(organizer.getByTestId("stat-going").locator(".n")).toHaveText(String(GUESTS.length), { timeout: 10_000 });
  await rest(organizer);
});

test("Scene 2: a search of the catalog and the user's store ranks the store's crewneck among the results", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await organizer.getByTestId("tab-experience").click();
  await caption("Scene 2: a search across the catalog and the store");
  // A natural-language personalized request; the search reads it as personalized so the store's
  // crewneck ranks among the catalog rather than below the shown rows.
  await typeInto(organizer, organizer.getByTestId("sentence"), EVENT.search);
  await organizer.getByTestId("sentence").press("Enter");
  await expect(organizer.getByTestId("result").first()).toBeVisible({ timeout: LIVE_MS });
  // Reveal every ranked row so the store's crewneck is on screen beside the catalog's products.
  for (let i = 0; i < 3; i++) {
    const more = organizer.getByTestId("show-more");
    if (!(await more.isVisible().catch(() => false))) break;
    await more.click();
    await rest(organizer, 500);
  }
  const storeRow = organizer.getByTestId("result").filter({ hasText: SHOP_NAME }).first();
  await expect(storeRow, `a result from ${SHOP_NAME} is visible`).toBeVisible({ timeout: 10_000 });
  await storeRow.scrollIntoViewIfNeeded();
  await caption("Scene 2: the store's crewneck ranked among the catalog");
  await rest(organizer, 4000);
});

test("Scene 3: the curation request returns the product and the mappings and the coverage", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await organizer.getByTestId("result").first().waitFor();
  // The curation input lives on the first step; step back from the results to reach it.
  await organizer.getByRole("button", { name: "Back", exact: true }).click();
  await caption("Scene 3: the curation request for personalized star-map shirts");
  await typeInto(organizer, organizer.getByTestId("curate"), EVENT.curate);
  await rest(organizer, 800);
  await organizer.getByTestId("curate-run").click();
  await expect(organizer.getByTestId("curate-proposal")).toBeVisible({ timeout: LIVE_MS });
  await expect(organizer.getByTestId("curate-mapping").first()).toBeVisible();
  await expect(organizer.getByTestId("curate-coverage")).toContainText("ready");
  await organizer.getByTestId("curate-proposal").scrollIntoViewIfNeeded();
  await caption("Scene 3: the proposal with the product and mappings and coverage");
  await rest(organizer, 4000);
});

test("Scene 4: approve puts the personalized gift on the gift list", async () => {
  test.setTimeout(120_000);
  await caption("Scene 4: approve into the gift list");
  await organizer.getByTestId("curate-approve").click();
  await expect(organizer.getByTestId("gift")).toHaveCount(1, { timeout: 10_000 });
  const snap = (await (await organizer.request.get(`/api/events/${eventId}`)).json()) as { gifts: { id: string }[] };
  giftId = snap.gifts[0].id;
  expect(giftId).toBeTruthy();
  await organizer.getByTestId("gift").scrollIntoViewIfNeeded();
  await caption("Scene 4: the personalized gift on the list");
  await rest(organizer, 3000);
});

test("Scene 5: the batch fills the cart with one star-map preview per guest", async () => {
  test.setTimeout(20 * 60_000);
  const request = organizer.request;
  // Bind the curation gift to the live storefront's numeric variants: the store's search returns a
  // Shopify gid variant per option, while the cart and the Customily adapter address the storefront's
  // numeric variant ids. The gift's product id and plan rule stay as the curation stored them (the
  // adapter now accepts either the gid or the bare id), so the manifest keeps resolving the plan.
  const variants = await liveVariants(request);
  const patch = await request.patch(`/api/events/${eventId}/gifts/${giftId}`, {
    data: {
      variants: variants.map((v) => ({ id: v.id, title: v.title, price_cents: v.price_cents, currency: "USD" })),
      default_variant_id: variants[0].id,
      personalization: { fields: FIELDS }
    }
  });
  expect(patch.ok(), await patch.text()).toBe(true);
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { definitions: { id: string; key: string }[] };
  const printedName = snap.definitions.find((d) => d.key === "printed_name")!;
  const mappings = await request.post(`/api/events/${eventId}/gifts/${giftId}/personalization`, {
    data: {
      mappings: [
        { vendor_field_key: "star_map_location", source: { type: "event", key: "venue" }, transform: "location_query" },
        { vendor_field_key: "star_map_date", source: { type: "event", key: "starts_at" }, transform: "date_only" },
        { vendor_field_key: "caption", source: { type: "definition", definition_id: printedName.id, subject_scope: "guest" } }
      ]
    }
  });
  expect(mappings.ok(), await mappings.text()).toBe(true);
  const token = (await (await request.post(`/api/events/${eventId}/tokens`, { data: { holder: SHOP_DOMAIN, gift_ids: [giftId], readable_definition_ids: [printedName.id], callable_tools: ["get_manifest", "post_update"] } })).json()) as { id: string };

  await caption("Scene 5: the batch fills the cart with a star map per guest");
  const base = new URL(organizer.url()).origin;
  const result = await runPersonalization({ base, eventId, token: token.id, giftId, productUrl: PRODUCT_URL, event: EVENT_CONTEXT, placeOrder: false, videoDir: "tests/videos" });

  expect(result.ready).toBe(GUESTS.length);
  expect(result.batch.status).toBe("prepared");
  expect(result.batch.blocked).toHaveLength(0);
  expect(result.cart).toHaveLength(GUESTS.length);
  expect(Object.keys(result.batch.preview_urls)).toHaveLength(GUESTS.length);
  for (const id of Object.keys(result.batch.preview_urls)) expect(result.batch.preview_urls[id]).toBeTruthy();

  // The batch driver posted the previews into the gift's thread; show them on the dashboard.
  await organizer.getByTestId("thread-gift").click();
  await expect(organizer.getByTestId("thread")).toBeVisible();
  await expect(organizer.getByTestId("thread")).toContainText("In production", { timeout: 10_000 });
  await caption("Scene 5: the cart is the stopping point and the order is issue 150");
  await rest(organizer, 5000);
});
