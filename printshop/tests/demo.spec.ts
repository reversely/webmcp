/**
 * The scripted print-shop demo (Printshop PRD Section 6), one path per scene, live: Gather's
 * search over the catalog and the shop, the shop's batch through its tools, and the clock driven
 * a stage at a time. Two browser contexts: the organizer on Gather and the shop's batch page. A
 * caption at the foot of each page names the scene. Videos land in tests/videos. Needs the Gather
 * dev server on 3113 and this app's on 3114.
 */
import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import designs from "../src/data/designs.json" with { type: "json" };
import shop from "../src/data/shop.json" with { type: "json" };

test.describe.configure({ mode: "serial" });

/**
 * The event, the organizer's email, and the guests come from a local file the person recording
 * writes: docs/demo-event.json (gitignored), or the path in DEMO_EVENT. tests/demo-event.example.json
 * shows the shape. Without the file the suite skips.
 */
type DemoEvent = { title: string; host: string; email: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; choices: string[]; guests: { name: string; choice: string }[]; card: string; guest_list?: string[] };
const DEMO_PATH = process.env.DEMO_EVENT ?? "docs/demo-event.json";
const DEMO: DemoEvent | null = existsSync(DEMO_PATH) ? (JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoEvent) : null;
test.skip(!DEMO, `No demo event at ${DEMO_PATH}; copy tests/demo-event.example.json there and fill it in.`);
const EVENT = DEMO!;
const CHOICES = DEMO?.choices ?? [];
const GUESTS = DEMO?.guests ?? [];
const GATHER = (process.env.GATHER_URL ?? "http://localhost:3113").replace(/\/+$/, "");
const SHOP = (process.env.PRINTSHOP_URL ?? "http://localhost:3114").replace(/\/+$/, "");
const DESIGN_TITLES = designs.map((d) => d.title);
/** Any design title as one pattern; the titles hold no regex character. */
const ANY_DESIGN = new RegExp(DESIGN_TITLES.join("|"));
const KEY_DELAY_MS = 35;
const READ_MS = 2000;
const LIVE_MS = 240_000;

let browserRef: Browser;
let organizerContext: BrowserContext;
let shopContext: BrowserContext;
let organizer: Page;
let shopPage: Page;
let eventId = "";
let giftId = "";
let batchId = "";
let inviteUrl = "";
let designTitle = "";

async function caption(text: string) {
  for (const page of [organizer, shopPage]) {
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

/** Gather's cart poll: reads the shop's change feed into the gift's thread. The dashboard does not call it on its own. */
async function pollGather() {
  const res = await organizer.request.get(`${GATHER}/api/events/${eventId}/gifts/${giftId}/cart`);
  expect(res.ok()).toBe(true);
}
/** Closes and reopens the gift's thread so the page reads the updates again. */
async function reopenThread() {
  const button = organizer.getByTestId("thread-gift");
  if ((await button.innerText()).trim() === "Hide thread") await button.click();
  await button.click();
  await expect(organizer.getByTestId("thread")).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  organizerContext = await browserRef.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 900 } } });
  shopContext = await browserRef.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 900 } } });
  organizer = await organizerContext.newPage();
  shopPage = await shopContext.newPage();
  await shopPage.goto("about:blank");
});

test.afterAll(async () => {
  const videos = [organizer.video(), shopPage.video()];
  await organizerContext.close();
  await shopContext.close();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await videos[0]?.saveAs(`tests/videos/demo-organizer-${stamp}.webm`);
  await videos[1]?.saveAs(`tests/videos/demo-shop-${stamp}.webm`);
  await Promise.all(videos.map((v) => v?.delete()));
});

test("Scene 1: the organizer publishes the event and the guests answer with the name to print", async () => {
  test.setTimeout(LIVE_MS);
  await organizer.goto(`${GATHER}/`);
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
  await organizer.goto(`${GATHER}/events/${eventId}?webmcp=polyfill`);
  await expect(organizer.getByTestId("status")).toHaveText("Published");
  await expect(organizer.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(organizer.getByTestId("invite-link")).toContainText(/\/i\//);
  inviteUrl = (await organizer.getByTestId("invite-link").innerText()).trim();
  await caption("Scene 1: published with the invite link");
  await rest(organizer);
  for (const g of GUESTS) {
    await shopPage.goto(inviteUrl);
    await caption(`Scene 1: ${g.name} replies with the name to print`);
    await typeInto(shopPage, shopPage.getByTestId("guest-name"), g.name);
    await shopPage.getByTestId("status").getByRole("button", { name: "Going" }).click();
    await typeInto(shopPage, shopPage.getByTestId("answer-printed_name").getByRole("textbox"), g.name);
    await shopPage.getByTestId("answer-dietary").getByRole("button", { name: g.choice, exact: true }).click();
    await shopPage.getByTestId("send").click();
    await expect(shopPage.getByTestId("saved")).toHaveText("Saved as Going");
    await rest(shopPage, 1000);
  }
  await caption(`Scene 1: ${GUESTS.length} guests going with a name to print`);
  await expect(organizer.getByTestId("stat-going").locator(".n")).toHaveText(String(GUESTS.length), { timeout: 10_000 });
  await rest(organizer);
});

test("Scene 2: the stationery card searches and the print shop's design ranks with its ready-by", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await organizer.getByTestId("tab-experience").click();
  await caption("Scene 2: the stationery card searches the catalog and the print shop");
  await organizer.getByTestId(`card-${EVENT.card}`).click();
  await expect(organizer.getByTestId("results")).toContainText(ANY_DESIGN, { timeout: LIVE_MS });
  const design = organizer.getByTestId("result").filter({ hasText: ANY_DESIGN }).first();
  await expect(design).toContainText(/Arrives by [A-Z][a-z]+ \d/);
  const shown = await design.innerText();
  designTitle = DESIGN_TITLES.find((t) => shown.includes(t))!;
  await caption(`Scene 2: ${designTitle} ranked with its ready-by`);
  await design.scrollIntoViewIfNeeded();
  await rest(organizer, 4000);
});

test("Scene 3: the organizer picks the design and the recipients and the units show the guests", async () => {
  test.setTimeout(120_000);
  await caption(`Scene 3: ${designTitle} chosen`);
  await organizer.getByTestId("result").filter({ hasText: designTitle }).first().click();
  await expect(organizer.getByTestId("recipients")).toContainText(`Guests going (${GUESTS.length})`);
  await caption("Scene 3: recipients");
  await rest(organizer);
  await organizer.getByTestId("next").click();
  await caption("Scene 3: one colour per dietary choice or the default");
  await expect(organizer.getByTestId("map-dietary")).toBeVisible();
  await rest(organizer, 3000);
  await organizer.getByTestId("confirm").click();
  await expect(organizer.getByTestId("gift")).toHaveCount(1, { timeout: 10_000 });
  await expect(organizer.getByTestId("gift")).toContainText(`${GUESTS.length} units`);
  await caption(`Scene 3: ${GUESTS.length} units from the going guests`);
  await rest(organizer, 3000);
});

test("Scene 4: send validates the units and creates and orders the batch and the shop shows the quote and the proofs", async () => {
  test.setTimeout(LIVE_MS);
  await caption("Scene 4: send to the vendor");
  const snap = (await (await organizer.request.get(`${GATHER}/api/events/${eventId}`)).json()) as { gifts: { id: string }[] };
  giftId = snap.gifts[0].id;
  // The shop keeps a batch under the buyer's email; the send carries the organizer's from the file.
  const sent = await organizer.request.post(`${GATHER}/api/events/${eventId}/gifts/${giftId}/send`, { data: { buyer: { email: EVENT.email } } });
  expect(sent.ok(), await sent.text()).toBe(true);
  const { cart_id } = (await sent.json()) as { cart_id: string };
  batchId = cart_id;
  await expect(organizer.getByTestId("gift")).toContainText("priced at the shop", { timeout: 20_000 });
  await caption("Scene 4: the batch quoted and ordered at the shop");
  await rest(organizer);
  await shopPage.goto(`${SHOP}/batches/${batchId}`);
  await expect(shopPage.getByTestId("batch-status")).toHaveText("proofed");
  await expect(shopPage.getByTestId("quote")).toContainText(`Units${GUESTS.length}`);
  await expect(shopPage.getByTestId("quote")).toContainText(shop.currency);
  await caption("Scene 4: the units carry the guests' names");
  for (const g of GUESTS) await expect(shopPage.getByTestId("units")).toContainText(g.name);
  await rest(shopPage, 3000);
  await caption(`Scene 4: ${GUESTS.length} proofs on the sheet`);
  await expect(shopPage.getByTestId("proof")).toHaveCount(GUESTS.length);
  await expect(shopPage.getByTestId("proofs").locator("svg").first()).toContainText(GUESTS[0].name);
  await shopPage.getByTestId("proofs").scrollIntoViewIfNeeded();
  await rest(shopPage, 3000);
  await pollGather();
  await reopenThread();
  await expect(organizer.getByTestId("thread")).toContainText("Proof ready", { timeout: 10_000 });
  await caption("Scene 4: the proof in Gather's thread");
  await rest(organizer, 3000);
});

test("Scene 5: approve accepts the proof and locks the plan", async () => {
  test.setTimeout(LIVE_MS);
  await caption("Scene 5: approve the proof");
  await organizer.getByTestId("approve-gift").click();
  await expect(organizer.getByTestId("gift")).toContainText(/locks /, { timeout: 30_000 });
  await shopPage.evaluate(() => window.dispatchEvent(new Event("shop:changed")));
  await expect(shopPage.getByTestId("batch-status")).toHaveText("approved");
  await expect(shopPage.getByTestId("thread")).toContainText("Proof approved");
  await caption("Scene 5: approved on both pages");
  await rest(organizer, 3000);
});

test("Scene 6: the clock advances a stage at a time and each step reaches both threads with its reference", async () => {
  test.setTimeout(LIVE_MS);
  const batch = (await (await shopPage.request.get(`${SHOP}/api/batches/${batchId}`)).json()) as { approved_at: string };
  const approvedAt = Date.parse(batch.approved_at);
  for (const stage of shop.stages) {
    await caption(`Scene 6: the clock reaches ${stage.status}`);
    const at = new Date(approvedAt + stage.after_minutes * 60_000 + 1_000).toISOString();
    const advanced = await shopPage.request.post(`${SHOP}/api/batches/${batchId}/advance`, { data: { at } });
    expect(advanced.ok()).toBe(true);
    await shopPage.evaluate(() => window.dispatchEvent(new Event("shop:changed")));
    await expect(shopPage.getByTestId("batch-status")).toHaveText(stage.status);
    const shopEntry = shopPage.getByTestId("thread-entry").filter({ hasText: stage.text }).last();
    await expect(shopEntry).toBeVisible();
    if (stage.reference_prefix) await expect(shopEntry).toContainText(new RegExp(`${stage.reference_prefix}[0-9A-Z]+`));
    await shopPage.getByTestId("thread").scrollIntoViewIfNeeded();
    await pollGather();
    await reopenThread();
    await expect(organizer.getByTestId("thread")).toContainText(stage.text, { timeout: 10_000 });
    if (stage.reference_prefix) await expect(organizer.getByTestId("thread")).toContainText(new RegExp(`${stage.reference_prefix}[0-9A-Z]+`));
    await caption(`Scene 6: ${stage.text} in both threads`);
    await rest(organizer, 3000);
  }
});
