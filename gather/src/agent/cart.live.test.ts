import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cancelCart, catalogClient, createCart, getCart, storefrontEndpoint, totalOf, updateCart } from "@webmcp/shopify-ucp";

const SELLERS_CSV = path.resolve(__dirname, "../../spikes/favor-vendors/sellers-ca.csv");

/** Splits one CSV line on commas outside double quotes. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** The first surveyed shop that answers all thirteen tools, from the favor survey's seller table. */
function firstFullShop(): string {
  const [header, ...rows] = readFileSync(SELLERS_CSV, "utf8").trim().split("\n");
  const columns = csvFields(header);
  const seller = columns.indexOf("seller");
  const tools = columns.indexOf("ucp_tools");
  const row = rows.map(csvFields).find((r) => r[tools] === "13");
  if (!row) throw new Error(`No row in ${SELLERS_CSV} has ucp_tools 13.`);
  return row[seller];
}

/**
 * Runs only with LIVE_SHOPIFY=1: one cart at a surveyed shop, quantity 1, read back, raised to 2 to
 * see the total move, then cancelled. The checkout tools stay untouched.
 */
describe.skipIf(process.env.LIVE_SHOPIFY !== "1")("live cart at a surveyed shop", () => {
  it("creates, reads, updates, and cancels a cart, and the total follows the quantity", async () => {
    const shop = firstFullShop();
    const client = catalogClient();
    const found = await client.withEndpoint(storefrontEndpoint(shop)).searchCatalog({ filters: { available: true }, pagination: { limit: 5 } });
    const variant = found.products.flatMap((p) => p.variants ?? []).find((v) => v.availability?.available);
    expect(variant, `${shop} returned no available variant`).toBeDefined();
    const lines = (quantity: number) => [{ item: { id: variant!.id }, quantity }];
    const buyer = { email: "organizer@example.com", phone_number: "+14165550100" };
    const destination = { first_name: "Event", last_name: "Organizer", phone_number: buyer.phone_number, street_address: "1 Street", address_locality: "Toronto", address_region: "ON", postal_code: "M5V 2T6", address_country: "CA" };

    const created = await createCart(client, shop, { line_items: lines(1), buyer, destination });
    try {
      expect(created.line_items).toHaveLength(1);
      expect(created.line_items[0].quantity).toBe(1);
      const one = totalOf(created.totals);
      expect(one).toBeGreaterThan(0);

      const read = await getCart(client, shop, created.id);
      expect(read.id).toBe(created.id);
      expect(totalOf(read.totals)).toBe(one);

      const updated = await updateCart(client, shop, created.id, { line_items: lines(2), buyer });
      expect(updated.line_items[0].quantity).toBe(2);
      expect(totalOf(updated.totals)).toBeGreaterThan(one!);
    } finally {
      await cancelCart(client, shop, created.id);
    }
    console.log(`live cart at ${shop}: variant ${variant!.id}, cart ${created.id.split("?")[0]}`);
  }, 90_000);
});
