import { catalogClient } from "@webmcp/shopify-ucp";
import { cardsConfig, rank, searchCandidates, withDelivery, withDetail, type EventContext } from "../../src/agent/search.ts";
const ctx: EventContext = { event_date: "2030-10-17", venue: { name: "The venue", line1: "Geary Avenue", city: "Toronto", region: "ON", postal_code: "M6H 2A8", country: "CA" }, budget_cents: 1800, quantity: 3, today: new Date().toISOString().slice(0, 10) };
const card = cardsConfig().cards.find((c) => c.key === "food_drink")!;
const client = catalogClient();
for (const s of card.searches) {
  const r = await client.searchCatalog({ query: s.query, filters: { ships_to: { country: "CA", region: "ON", postal_code: "M6H 2A8" }, ships_from: [{ country: "CA" }], available: true, categories: s.categories, price: { max: 1800 } } as never, pagination: { limit: 25 } });
  console.log(`search "${s.query}" ${s.categories}: returned ${r.products?.length} of total ${(r.pagination as { total_count?: number })?.total_count}`);
  await new Promise((x) => setTimeout(x, 1500));
}
const found = await searchCandidates(client, card.searches, ctx, { limit: 25, sleepMs: 1500 });
console.log("merged:", found.length);
const shortlist = [...found].sort((a, b) => (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity)).slice(0, 12);
const probed = await Promise.all(shortlist.map(async (c) => withDelivery(await withDetail(client, c), ctx)));
const ids = new Set(probed.map((c) => c.product_id));
const { ranked, excluded } = rank([...probed, ...found.filter((c) => !ids.has(c.product_id))], ctx);
console.log("ranked:", ranked.length, "excluded:", excluded.length);
for (const p of probed) console.log(` probe ${p.title.slice(0, 40)} | ${p.shop_domain} | ${p.price_cents} | delivery: ${p.delivery?.confidence} ${p.delivery?.text ?? ""} ${p.delivery?.error ?? ""}`);
const byRule: Record<string, number> = {};
for (const e of excluded) byRule[e.verdict.rule ?? "?"] = (byRule[e.verdict.rule ?? "?"] ?? 0) + 1;
console.log("excluded by rule:", byRule);
for (const e of excluded.slice(0, 6)) console.log("  ", e.title.slice(0, 40), "|", e.verdict.reason);
