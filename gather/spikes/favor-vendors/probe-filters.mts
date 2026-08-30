// Probes how the Global Catalog answers the four Guest Experience card categories (Gift sets, Food
// and drink, Apparel, Stationery): each card name as a plain query, the `categories` filter with
// candidate values (the catalog names unrecognized values in result.messages[]), and `price_tier`.
// Run from the repo root after discover.mts: npx tsx gather/spikes/favor-vendors/probe-filters.mts
// Writes card-categories.csv and appends a section to results.md.
import { appendFileSync, writeFileSync } from "node:fs";
import { catalogClient } from "@webmcp/shopify-ucp";

const DIR = "gather/spikes/favor-vendors";
const [SHIP_COUNTRY, SHIP_REGION, SHIP_POSTAL] = (process.env.SHIP_TO ?? "US:NY:10003").split(":");
const SHIPS_TO = { country: SHIP_COUNTRY, region: SHIP_REGION, postal_code: SHIP_POSTAL };
const CONTEXT = { address_country: SHIP_COUNTRY, address_region: SHIP_REGION, postal_code: SHIP_POSTAL, currency: SHIP_COUNTRY === "CA" ? "CAD" : "USD" };
const SUFFIX = `-${SHIP_COUNTRY.toLowerCase()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const client = catalogClient();

type Probe = { card: string; kind: "query" | "categories" | "price_tier"; query: string; value: string };
const PROBES: Probe[] = [
  ...["gift sets", "food and drink gifts", "apparel gifts", "stationery gifts"].map((q) => ({ card: q.split(" ")[0], kind: "query" as const, query: q, value: "" })),
  ...["Gift Sets", "Food & Drink", "Apparel & Accessories", "Stationery", "Party Favors", "Arts & Entertainment > Party & Celebration > Party Supplies > Party Favors", "gid://shopify/TaxonomyCategory/ae-2-1-3", "ae-2", "fb", "aa", "op"].map((v) => ({ card: "categories filter", kind: "categories" as const, query: "party favors", value: v })),
  ...["low", "medium", "high"].map((v) => ({ card: "price tier", kind: "price_tier" as const, query: "party favors", value: v }))
];

const rows: Record<string, unknown>[] = [];
for (const p of PROBES) {
  const filters: Record<string, unknown> = { ships_to: SHIPS_TO, ships_from: [{ country: SHIP_COUNTRY }], available: true };
  if (p.kind === "categories") filters.categories = [p.value];
  if (p.kind === "price_tier") filters.price_tier = [p.value];
  let result: Record<string, unknown> | null = null;
  let error = "";
  for (let attempt = 0; ; attempt++) {
    try {
      result = (await client.searchCatalog({ query: p.query, filters: filters as never, context: CONTEXT as never, pagination: { limit: 10 } })) as unknown as Record<string, unknown>;
      break;
    } catch (e) {
      if (attempt >= 2) { error = (e as Error).message; break; }
      await sleep(10_000 * (attempt + 1));
    }
  }
  const products = ((result?.products as { title: string; variants?: { seller?: { domain?: string } }[] }[]) ?? []);
  const messages = ((result?.messages as { type?: string; code?: string; content?: string }[]) ?? []).map((m) => `${m.code ?? m.type ?? ""}: ${m.content ?? ""}`).join(" | ");
  const total = (result?.pagination as { total_count?: number } | undefined)?.total_count ?? "";
  rows.push({ card: p.card, kind: p.kind, query: p.query, value: p.value, returned: products.length, catalog_total: total, messages, error, sellers: [...new Set(products.map((x) => x.variants?.[0]?.seller?.domain ?? ""))].join("; "), titles: products.slice(0, 5).map((x) => x.title).join(" | ") });
  console.log(`${p.kind} ${p.value || p.query}: ${products.length} of ${total} ${messages ? "msg: " + messages : ""} ${error}`);
  await sleep(2_500);
}
const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const cols = ["card", "kind", "query", "value", "returned", "catalog_total", "messages", "error", "sellers", "titles"];
writeFileSync(`${DIR}/card-categories${SUFFIX}.csv`, [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n");
appendFileSync(`${DIR}/results${SUFFIX}.md`, ["## The four card categories against the catalog", "", "One row per probe; full text in card-categories.csv.", "", "| Card | Kind | Query | Filter value | Returned | Catalog total | Messages |", "| --- | --- | --- | --- | --- | --- | --- |", ...rows.map((r) => `| ${r.card} | ${r.kind} | ${r.query} | ${r.value} | ${r.returned} | ${r.catalog_total} | ${String(r.messages).slice(0, 120)}${r.error ? " " + r.error : ""} |`), ""].join("\n"));
console.log(`${rows.length} probes written`);
