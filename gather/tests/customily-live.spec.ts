/**
 * Live smoke test for the Customily WebMCP adapter (integrations/customily/webmcp-customily.js).
 * It drives the real storefront, so it runs only with LIVE_CUSTOMILY=1: it injects the WebMCP
 * polyfill and the adapter, lists the four tools, reads the schema, and configures one unit
 * with a location, a date, and a caption. It never presses add to cart.
 */
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const PRODUCT_URL = "https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt";
const POLYFILL = fileURLToPath(new URL("../src/webmcp/polyfill.js", import.meta.url));
const ADAPTER = fileURLToPath(new URL("../integrations/customily/webmcp-customily.js", import.meta.url));

test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run against the live Customily storefront.");

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };

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

test("the adapter registers four tools on the live product page and configures one unit", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript({ path: POLYFILL });
  await page.addInitScript({ path: ADAPTER });
  await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded" });

  await expect
    .poll(async () => page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort()), { timeout: 30_000 })
    .toEqual(["add_personalized_unit_to_cart", "configure_personalized_unit", "get_personalization_preview", "get_personalization_schema"]);

  // Give the Customily embed time to render its controls before configuring.
  await page.locator('input[placeholder="Search Location"]').waitFor({ timeout: 60_000 });

  const schema = await execute(page, "get_personalization_schema", {});
  expect(schema.isError).toBe(false);
  const parsed = JSON.parse(schema.text) as { product_id: string; current_variant_id: string; fields: { key: string; required: boolean }[] };
  expect(parsed.product_id).toBe("10242071789817");
  expect(parsed.fields.map((f) => f.key).sort()).toEqual(["caption", "star_map_date", "star_map_location"]);

  const configured = await execute(page, "configure_personalized_unit", {
    recipient_ref: "guest-smoke-1",
    variant_id: parsed.current_variant_id,
    values: { star_map_location: "Paris, France", star_map_date: "2027-02-14", caption: "Under these stars" }
  });
  expect(configured.isError, configured.text).toBe(false);
  const unit = JSON.parse(configured.text) as { preview: { ready: boolean }; errors: unknown[] };
  expect(unit.preview.ready).toBe(true);
  expect(unit.errors).toEqual([]);

  const preview = await execute(page, "get_personalization_preview", { recipient_ref: "guest-smoke-1" });
  expect(preview.isError, preview.text).toBe(false);
  expect((JSON.parse(preview.text) as { ready: boolean }).ready).toBe(true);
});
