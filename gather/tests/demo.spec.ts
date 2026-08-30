/**
 * The scripted demo (PRD Section 14), one path per scene, live: the catalog, a real shop's cart,
 * and the scripted vendor agent through the endpoint. Two browser contexts: the organizer and a
 * guest. A caption at the foot of each page names the scene. Videos land in tests/videos.
 * Needs the dev server on 3113 and network; no key. Never completes a checkout.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const EVENT = { title: "A 25th birthday", host: "The host", starts_at: "2030-10-17T19:00", venue: { name: "The venue", line1: "Geary Avenue", city: "Toronto", region: "ON", postal_code: "M6H 2A8", country: "CA" }, spots: "80", cost: "18", deadline: "2030-10-10" };
const CHOICES = ["Vegan", "Gluten-free", "No restriction"];
const GUESTS = [{ name: "Guest One", choice: "Vegan" }, { name: "Guest Two", choice: "No restriction" }, { name: "Guest Three", choice: "Gluten-free" }];
const KEY_DELAY_MS = 35;
const READ_MS = 2000;
const LIVE_MS = 240_000;

let browserRef: Browser;
let organizerContext: BrowserContext;
let guestContext: BrowserContext;
let organizer: Page;
let guest: Page;
let eventId = "";
let inviteUrl = "";
let guestLinks: string[] = [];

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
  await videos[0]?.saveAs(`tests/videos/demo-organizer-${stamp}.webm`);
  await videos[1]?.saveAs(`tests/videos/demo-guest-${stamp}.webm`);
  await Promise.all(videos.map((v) => v?.delete()));
});

test("Scene 1: the organizer sets up the event, adds the dietary choices, and publishes", async () => {
  test.setTimeout(240_000);
  await organizer.goto("/");
  await caption("Scene 1. The organizer sets up the event");
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
  await caption("Scene 1. The dietary question gets the organizer's own choices");
  const choiceInput = organizer.getByTestId("questions").getByLabel(/Add a choice to/).first();
  for (const c of CHOICES) {
    await typeInto(organizer, choiceInput, c);
    await choiceInput.press("Enter");
  }
  await expect(organizer.getByTestId("invite-preview")).toContainText(CHOICES[0]);
  await rest(organizer);
  await organizer.getByTestId("publish").click();
  await organizer.waitForURL(/\/events\/evt_/);
  eventId = organizer.url().split("/events/")[1];
  // The recording shows the agent tools ready: the polyfill stands in for a browser with WebMCP.
  await organizer.goto(`/events/${eventId}?webmcp=polyfill`);
  await expect(organizer.getByTestId("status")).toHaveText("Published");
  await expect(organizer.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(organizer.getByTestId("invite-link")).toContainText(/\/i\//);
  inviteUrl = (await organizer.getByTestId("invite-link").innerText()).trim();
  await caption("Scene 1. Published; the invite link is on the dashboard");
  await rest(organizer);
});

test("Scene 2: three guests reply through the invite, each with a dietary choice", async () => {
  test.setTimeout(240_000);
  for (const g of GUESTS) {
    await guest.goto(inviteUrl);
    await caption(`Scene 2. ${g.name} replies through the invite`);
    await typeInto(guest, guest.getByTestId("guest-name"), g.name);
    await guest.getByTestId("status").getByRole("button", { name: "Going" }).click();
    await typeInto(guest, guest.getByTestId("answer-printed_name").getByRole("textbox"), g.name.split(" ")[1]);
    await guest.getByTestId("answer-dietary").getByRole("button", { name: g.choice, exact: true }).click();
    await guest.getByTestId("send").click();
    await expect(guest.getByTestId("saved")).toHaveText("Saved as Going.");
    guestLinks.push(guest.url());
    await rest(guest, 1200);
  }
  await caption("Scene 2. The Overview follows the replies");
  await expect(organizer.getByTestId("stat-going").locator(".n")).toHaveText("3", { timeout: 10_000 });
  await expect(organizer.getByTestId("replies-card")).toContainText("Vegan");
  await rest(organizer);
});

test("Scene 3: Food & drink; the catalog is searched and delivery to the venue is checked", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await organizer.getByTestId("tab-experience").click();
  await caption("Scene 3. The organizer picks Food & drink; the catalog is searched and delivery to Toronto is checked");
  await organizer.getByTestId("card-food_drink").click();
  await expect(organizer.getByTestId("result").first()).toBeVisible({ timeout: LIVE_MS });
  const count = await organizer.getByTestId("result").count();
  expect(count).toBeGreaterThan(0);
  await caption(`Scene 3. ${count} products fit: delivery by the date, price under $18, in stock`);
  await rest(organizer, 4000);
});

test("Scene 4: the organizer picks one, chooses who receives it, and confirms the dietary mapping", async () => {
  test.setTimeout(120_000);
  // The product with the most variants gives the mapping the most to work with.
  const results = organizer.getByTestId("result");
  const n = await results.count();
  let best = 0;
  let bestChoices = -1;
  for (let i = 0; i < n; i++) {
    const text = await results.nth(i).innerText();
    const hasChoices = /Choices:/.test(text) ? 1 : 0;
    if (hasChoices > bestChoices) { best = i; bestChoices = hasChoices; }
  }
  await caption("Scene 4. One product is chosen");
  await results.nth(best).click();
  await expect(organizer.getByTestId("recipients")).toContainText("Guests going (3)");
  await caption("Scene 4. Who receives one: the guests going");
  await rest(organizer);
  await organizer.getByTestId("next").click();
  await caption("Scene 4. Each dietary choice maps to one of the shop's variants; the organizer confirms");
  await expect(organizer.getByTestId("map-dietary")).toBeVisible();
  await rest(organizer, 4000);
  await organizer.getByTestId("confirm").click();
  await expect(organizer.getByTestId("gift")).toHaveCount(1, { timeout: 10_000 });
  await expect(organizer.getByTestId("gift")).toContainText("3 units");
  await caption("Scene 4. The gift shows 3 units; the order summary splits them by variant");
  await rest(organizer, 3000);
});

test("Scene 5: send to vendor creates the priced cart at the shop", async () => {
  test.setTimeout(LIVE_MS);
  await caption("Scene 5. Send to vendor: the cart is created at the shop and priced");
  await organizer.getByTestId("send-gift").click();
  await expect(organizer.getByTestId("gift")).toContainText("priced at the shop", { timeout: LIVE_MS });
  await rest(organizer, 3000);
});

test("Scene 6: a guest cancels; the quantity and the cart follow", async () => {
  test.setTimeout(LIVE_MS);
  await guest.goto(guestLinks[1]);
  await caption(`Scene 6. ${GUESTS[1].name} cancels from the same link`);
  await expect(guest.getByTestId("guest-name")).toHaveValue(GUESTS[1].name);
  await guest.getByTestId("cancel").click();
  await expect(guest.getByTestId("saved")).toHaveText("Saved as Can't go.");
  await caption("Scene 6. The gift drops to 2 units and the cart at the shop is updated");
  await expect(organizer.getByTestId("gift")).toContainText("2 units", { timeout: 20_000 });
  await rest(organizer, 3000);
});

test("Scene 7: approve sets the lock date; the vendor's agent confirms into the thread", async () => {
  test.setTimeout(LIVE_MS);
  await caption("Scene 7. Approve keeps the cart; the lock date follows the delivery window");
  await organizer.getByTestId("approve-gift").click();
  await expect(organizer.getByTestId("gift")).toContainText(/locks /, { timeout: 30_000 });
  await rest(organizer, 2000);
  const snap = await (await organizer.request.get(`/api/events/${eventId}`)).json() as { gifts: { id: string }[] };
  const giftId = snap.gifts[0].id;
  const token = (await (await organizer.request.post(`/api/events/${eventId}/tokens`, { data: { holder: "the vendor's agent", gift_ids: [giftId], callable_tools: ["get_manifest", "get_changes", "post_update", "get_updates"] } })).json()) as { id: string };
  await caption("Scene 7. The vendor's agent reads the manifest through the endpoint and posts a confirmation");
  const base = new URL(organizer.url()).origin;
  execFileSync("npx", ["tsx", "scripts/vendor-agent.mts", base, eventId, token.id, giftId, "confirm"], { encoding: "utf8" });
  await organizer.getByTestId("thread-gift").click();
  await expect(organizer.getByTestId("thread")).toContainText("Confirmed", { timeout: 10_000 });
  await caption("Scene 7. The confirmation and its expected date are on the dashboard");
  await rest(organizer, 4000);
});
