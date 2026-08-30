/**
 * The scripted demo (PRD Section 14), one path per scene, live: the catalog, a real shop's cart,
 * and the scripted vendor agent through the endpoint. Two browser contexts: the organizer and a
 * guest. A caption at the foot of each page names the scene. Videos land in tests/videos.
 * Needs the dev server on 3113 and network; no key. Never completes a checkout.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/**
 * The event, the choices, and the guests come from a local file the person recording writes:
 * docs/demo-event.json (gitignored), or the path in DEMO_EVENT. tests/demo-event.example.json
 * shows the shape. Without the file the suite skips.
 */
type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; choices: string[]; guests: { name: string; choice: string }[]; card: string; guest_list?: string[] };
const DEMO_PATH = process.env.DEMO_EVENT ?? "docs/demo-event.json";
const DEMO: DemoEvent | null = existsSync(DEMO_PATH) ? (JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoEvent) : null;
test.skip(!DEMO, `No demo event at ${DEMO_PATH}; copy tests/demo-event.example.json there and fill it in.`);
const EVENT = DEMO!;
const CHOICES = DEMO?.choices ?? [];
const GUESTS = DEMO?.guests ?? [];
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
  await caption("Scene 1: dietary choices in the organizer's words");
  const choiceInput = organizer.getByTestId("questions").getByLabel(/Add a choice to/).first();
  for (const c of CHOICES) {
    await typeInto(organizer, choiceInput, c);
    await choiceInput.press("Enter");
  }
  await expect(organizer.getByTestId("invite-preview")).toContainText(CHOICES[0]);
  if (EVENT.guest_list?.length) {
    await caption("Scene 1: the guest list");
    await organizer.getByTestId("guest-list").fill(EVENT.guest_list.filter(Boolean).join("\n"));
  }
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
  await caption("Scene 1: published with the invite link");
  await rest(organizer);
});

test("Scene 2: three guests reply through the invite, each with a dietary choice", async () => {
  test.setTimeout(240_000);
  for (const g of GUESTS) {
    await guest.goto(inviteUrl);
    await caption(`Scene 2: ${g.name} replies through the invite`);
    await typeInto(guest, guest.getByTestId("guest-name"), g.name);
    await guest.getByTestId("status").getByRole("button", { name: "Going" }).click();
    await typeInto(guest, guest.getByTestId("answer-printed_name").getByRole("textbox"), g.name.split(" ")[1]);
    await guest.getByTestId("answer-dietary").getByRole("button", { name: g.choice, exact: true }).click();
    await guest.getByTestId("send").click();
    await expect(guest.getByTestId("saved")).toHaveText("Saved as Going");
    guestLinks.push(guest.url());
    await rest(guest, 1200);
  }
  await caption("Scene 2: the Overview follows the replies");
  await expect(organizer.getByTestId("stat-going").locator(".n")).toHaveText(String(GUESTS.length), { timeout: 10_000 });
  await expect(organizer.getByTestId("replies-card")).toContainText(CHOICES[0]);
  await rest(organizer);
});

test("Scene 3: a card; the catalog is searched and delivery to the destination is checked", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await organizer.getByTestId("tab-experience").click();
  await caption(`Scene 3: catalog search with delivery checked to ${EVENT.venue.city}`);
  await organizer.getByTestId(`card-${EVENT.card}`).click();
  await expect(organizer.getByTestId("result").first()).toBeVisible({ timeout: LIVE_MS });
  const count = await organizer.getByTestId("result").count();
  expect(count).toBeGreaterThan(0);
  await caption("Scene 3: the funnel from catalog to ranked");
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
  await caption("Scene 4: one product chosen");
  await results.nth(best).click();
  await expect(organizer.getByTestId("recipients")).toContainText(`Guests going (${GUESTS.length})`);
  if (EVENT.guest_list?.length) await expect(organizer.getByTestId("recipients")).toContainText(`Everyone invited (${Math.max(EVENT.guest_list.filter(Boolean).length, GUESTS.length)})`);
  await caption("Scene 4: recipients");
  await rest(organizer);
  await organizer.getByTestId("next").click();
  await caption("Scene 4: one variant per dietary choice");
  await expect(organizer.getByTestId("map-dietary")).toBeVisible();
  await rest(organizer, 4000);
  await organizer.getByTestId("confirm").click();
  await expect(organizer.getByTestId("gift")).toHaveCount(1, { timeout: 10_000 });
  await expect(organizer.getByTestId("gift")).toContainText(`${GUESTS.length} units`);
  await caption(`Scene 4: ${GUESTS.length} units split by variant`);
  await rest(organizer, 3000);
});

test("Scene 5: send to vendor creates the priced cart at the shop", async () => {
  test.setTimeout(LIVE_MS);
  await caption("Scene 5: the cart priced at the shop");
  await organizer.getByTestId("send-gift").click();
  await expect(organizer.getByTestId("gift")).toContainText("priced at the shop", { timeout: LIVE_MS });
  await rest(organizer, 3000);
});

test("Scene 6: a guest cancels; the quantity and the cart follow", async () => {
  test.setTimeout(LIVE_MS);
  await guest.goto(guestLinks[1]);
  await caption(`Scene 6: ${GUESTS[1].name} cancels from the same link`);
  await expect(guest.getByTestId("guest-name")).toHaveValue(GUESTS[1].name);
  await guest.getByTestId("cancel").click();
  await expect(guest.getByTestId("saved")).toHaveText("Saved as Can't go");
  await caption(`Scene 6: ${GUESTS.length - 1} units and the cart updated`);
  await expect(organizer.getByTestId("gift")).toContainText(`${GUESTS.length - 1} units`, { timeout: 20_000 });
  await rest(organizer, 3000);
});

test("Scene 7: approve sets the lock date; the vendor's agent confirms into the thread", async () => {
  test.setTimeout(LIVE_MS);
  await caption("Scene 7: approved with a lock date");
  await organizer.getByTestId("approve-gift").click();
  await expect(organizer.getByTestId("gift")).toContainText(/locks /, { timeout: 30_000 });
  await rest(organizer, 2000);
  const snap = await (await organizer.request.get(`/api/events/${eventId}`)).json() as { gifts: { id: string }[] };
  const giftId = snap.gifts[0].id;
  const token = (await (await organizer.request.post(`/api/events/${eventId}/tokens`, { data: { holder: "the vendor's agent", gift_ids: [giftId], callable_tools: ["get_manifest", "get_changes", "post_update", "get_updates"] } })).json()) as { id: string };
  await caption("Scene 7: the vendor's agent confirms through the endpoint");
  const base = new URL(organizer.url()).origin;
  execFileSync("npx", ["tsx", "scripts/vendor-agent.mts", base, eventId, token.id, giftId, "confirm"], { encoding: "utf8" });
  await organizer.getByTestId("thread-gift").click();
  await expect(organizer.getByTestId("thread")).toContainText("confirmed", { timeout: 10_000 });
  await caption("Scene 7: the confirmation on the dashboard");
  await rest(organizer, 4000);
});
