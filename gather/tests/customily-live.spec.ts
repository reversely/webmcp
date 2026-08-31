/**
 * Live smoke test for the Customily WebMCP adapter (integrations/customily/webmcp-customily.js).
 * It drives the real storefront, so it runs only with LIVE_CUSTOMILY=1: it injects the WebMCP
 * polyfill and the adapter, lists the three batch tools, reads each product's schema, dry-runs
 * a batch with bad items, and creates a one-item batch on the crewneck and on the hoodie. The
 * create tests add real lines to the test shop's cart and never open checkout.
 */
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const CREWNECK_URL = "https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt";
const HOODIE_URL = "https://springbuilt.myshopify.com/products/1567-comfort-colors-garment-dyed-adult-hoodie";
const MUG_URL = "https://springbuilt.myshopify.com/products/21504-white-15oz-ceramic-mug";
const CREWNECK_ID = "10242071789817";
const HOODIE_ID = "10243540517113";
const MUG_ID = "10243494084857";
const POLYFILL = fileURLToPath(new URL("../src/webmcp/polyfill.js", import.meta.url));
const ADAPTER = fileURLToPath(new URL("../integrations/customily/webmcp-customily.js", import.meta.url));
const DELIVERY = { type: "single_address", address_ref: "addr-smoke-1" };

test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run against the live Customily storefront.");

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };

type Schema = { product_id: string; fields: { key: string; kind: string; required: boolean }[]; variants: { id: string }[] | null; current_variant_id?: string };
type Validation = { valid: boolean; items: { recipient_ref: string | null; ok: boolean; issues: { field_key?: string; message: string }[] }[]; delivery_issues: unknown[] };
type Batch = {
  batch_id: string;
  status: string;
  ready: { recipient_ref: string; cart_line_key: string; replayed?: boolean }[];
  blocked: { recipient_ref: string; issues: unknown[] }[];
  subtotal: number;
  currency: string;
  checkout_url: string;
  preview_urls: Record<string, string>;
  delivery: typeof DELIVERY;
};

async function execute(page: Page, name: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, args }) => {
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "", isError: result.isError === true };
    },
    { name, args }
  );
}

async function openProduct(page: Page, url: string) {
  await page.addInitScript({ path: POLYFILL });
  await page.addInitScript({ path: ADAPTER });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort()), { timeout: 30_000 })
    .toEqual(["create_personalized_batch", "get_personalization_schema", "validate_personalized_batch"]);
}

async function cartLineCount(page: Page) {
  return page.evaluate(async () => ((await (await fetch("/cart.js")).json()) as { items: unknown[] }).items.length);
}

test("the crewneck page answers schemas, rejects a bad batch, and creates an idempotent one-item batch", async ({ page }) => {
  test.setTimeout(300_000);
  await openProduct(page, CREWNECK_URL);
  await page.locator('input[placeholder="Search Location"]').waitFor({ timeout: 60_000 });
  // The Mapbox geocoder attaches its suggestion handlers a moment after the input mounts; give it
  // that beat so the create flow's first location fill lands on a live control.
  await page.waitForTimeout(2500);

  for (const [productId, keys] of [
    [CREWNECK_ID, ["caption", "star_map_date", "star_map_location"]],
    [HOODIE_ID, ["caption", "photo"]],
    [MUG_ID, ["photo"]]
  ] as const) {
    const schema = await execute(page, "get_personalization_schema", { product_id: productId });
    expect(schema.isError, schema.text).toBe(false);
    const parsed = JSON.parse(schema.text) as Schema;
    expect(parsed.product_id).toBe(productId);
    expect(parsed.fields.map((f) => f.key).sort()).toEqual([...keys]);
    expect(parsed.variants?.length).toBeGreaterThan(0);
  }

  const schema = JSON.parse((await execute(page, "get_personalization_schema", { product_id: CREWNECK_ID })).text) as Schema;
  const variantId = schema.current_variant_id!;
  const good = { recipient_ref: "guest-smoke-1", variant_id: variantId, personalization: { star_map_location: "Paris, France", star_map_date: "2027-02-14", caption: "Under these stars" } };

  const invalid = await execute(page, "validate_personalized_batch", {
    product_id: CREWNECK_ID,
    items: [good, { recipient_ref: "guest-smoke-2", variant_id: "1", personalization: { caption: "Hi", banner: "nope" } }],
    delivery: DELIVERY
  });
  expect(invalid.isError).toBe(true);
  const validation = JSON.parse(invalid.text) as Validation;
  expect(validation.valid).toBe(false);
  expect(validation.items[0].ok).toBe(true);
  const messages = validation.items[1].issues.map((i) => i.message).join(" ");
  expect(messages).toContain("variant_id");
  expect(validation.items[1].issues.some((i) => i.field_key === "banner")).toBe(true);
  expect(validation.items[1].issues.some((i) => i.field_key === "star_map_location")).toBe(true);

  const valid = await execute(page, "validate_personalized_batch", { product_id: CREWNECK_ID, items: [good], delivery: DELIVERY });
  expect(valid.isError, valid.text).toBe(false);

  const linesBefore = await cartLineCount(page);
  const createArgs = { batch_id: "batch-smoke-1", product_id: CREWNECK_ID, items: [good], delivery: DELIVERY, idempotency_key: `smoke-${Date.now()}` };
  const created = await execute(page, "create_personalized_batch", createArgs);
  expect(created.isError, created.text).toBe(false);
  const batch = JSON.parse(created.text) as Batch;
  expect(batch.batch_id).toBe("batch-smoke-1");
  expect(batch.status).toBe("prepared");
  expect(batch.ready).toHaveLength(1);
  expect(batch.blocked).toHaveLength(0);
  expect(batch.subtotal).toBeGreaterThan(0);
  expect(batch.currency).toMatch(/^[A-Z]{3}$/);
  expect(batch.checkout_url).toBe("https://springbuilt.myshopify.com/checkout");
  expect(batch.preview_urls["guest-smoke-1"]).toBeTruthy();
  expect(batch.delivery).toEqual(DELIVERY);
  expect(await cartLineCount(page)).toBe(linesBefore + 1);

  const replayed = await execute(page, "create_personalized_batch", createArgs);
  expect(replayed.isError, replayed.text).toBe(false);
  const replay = JSON.parse(replayed.text) as Batch;
  expect(replay.ready[0].replayed).toBe(true);
  expect(replay.ready[0].cart_line_key).toBe(batch.ready[0].cart_line_key);
  expect(await cartLineCount(page)).toBe(linesBefore + 1);
});

test("the hoodie page creates a one-item batch with a caption and an uploaded image", async ({ page }) => {
  test.setTimeout(300_000);
  await openProduct(page, HOODIE_URL);
  await page.locator('input[name="properties[Text 2]"]').waitFor({ timeout: 60_000 });

  const schema = JSON.parse((await execute(page, "get_personalization_schema", { product_id: HOODIE_ID })).text) as Schema;
  expect(schema.variants?.length).toBe(24);
  const photo = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1c355e";
    ctx.fillRect(0, 0, 600, 600);
    ctx.fillStyle = "#f4c95d";
    ctx.beginPath();
    ctx.arc(300, 300, 180, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL("image/png");
  });

  const linesBefore = await cartLineCount(page);
  const created = await execute(page, "create_personalized_batch", {
    batch_id: "batch-smoke-2",
    product_id: HOODIE_ID,
    items: [{ recipient_ref: "guest-smoke-3", variant_id: schema.variants![1].id, personalization: { caption: "For Blake", photo } }],
    delivery: DELIVERY,
    idempotency_key: `smoke-hoodie-${Date.now()}`
  });
  expect(created.isError, created.text).toBe(false);
  const batch = JSON.parse(created.text) as Batch;
  expect(batch.status).toBe("prepared");
  expect(batch.ready).toHaveLength(1);
  expect(await cartLineCount(page)).toBe(linesBefore + 1);
});

test("the mug page reports its unrendered image control as a per-item issue", async ({ page }) => {
  test.setTimeout(120_000);
  await openProduct(page, MUG_URL);

  const schema = JSON.parse((await execute(page, "get_personalization_schema", { product_id: MUG_ID })).text) as Schema;
  const validated = await execute(page, "validate_personalized_batch", {
    product_id: MUG_ID,
    items: [{ recipient_ref: "guest-smoke-4", variant_id: schema.variants![0].id, personalization: { photo: "data:image/png;base64,iVBORw0KGgo=" } }],
    delivery: DELIVERY
  });
  expect(validated.isError).toBe(true);
  const validation = JSON.parse(validated.text) as Validation;
  expect(validation.items[0].issues.some((i) => i.message.includes("control not rendered"))).toBe(true);
});
