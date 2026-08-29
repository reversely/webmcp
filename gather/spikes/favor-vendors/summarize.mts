// Rebuilds results-<country>.md from products-<country>.csv, sellers-<country>.csv, and
// card-categories-<country>.csv without touching the network, so the summary can change shape
// after a run. Run from the repo root: npx tsx gather/spikes/favor-vendors/summarize.mts us
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "gather/spikes/favor-vendors";
const country = (process.argv[2] ?? "us").toLowerCase();

/** A small CSV reader that honours quoted cells (the files quote titles with commas). */
function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const products = readCsv(`${DIR}/products-${country}.csv`);
const sellers = readCsv(`${DIR}/sellers-${country}.csv`);
const cards = existsSync(`${DIR}/card-categories-${country}.csv`) ? readCsv(`${DIR}/card-categories-${country}.csv`) : [];
const queries = readCsv(`${DIR}/queries.csv`);
const sellerName = new Map(sellers.map((s) => [s.seller, s.public_host && s.public_host !== s.seller ? `${s.name} (${s.public_host})` : s.name]));

const byQuery = new Map<string, Record<string, string>[]>();
for (const p of products) byQuery.set(p.key, [...(byQuery.get(p.key) ?? []), p]);
const byType = new Map<string, { queries: number; rows: number; sellers: Set<string>; personal: number; diet: number }>();
for (const q of queries) {
  const rows = byQuery.get(q.key) ?? [];
  const t = byType.get(q.type) ?? { queries: 0, rows: 0, sellers: new Set(), personal: 0, diet: 0 };
  t.queries++; t.rows += rows.length; rows.forEach((r) => t.sellers.add(r.seller)); t.personal += rows.filter((r) => r.personalization_words).length; t.diet += rows.filter((r) => r.dietary_words).length;
  byType.set(q.type, t);
}
/** The sellers a query returned, most products first, named. */
function topSellers(rows: Record<string, string>[], n = 5): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.seller, (counts.get(r.seller) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([d, c]) => `${sellerName.get(d) ?? d} ${c}`).join("; ");
}
const optionTotals = new Map<string, number>();
for (const p of products) for (const n of p.option_names.split("; ").filter(Boolean)) optionTotals.set(n, (optionTotals.get(n) ?? 0) + 1);

const md = [
  `# Favor vendor survey (${country.toUpperCase()})`,
  "",
  `Rebuilt from products-${country}.csv (${products.length} rows), sellers-${country}.csv (${sellers.length} sellers), and card-categories-${country}.csv by summarize.mts. Each row of queries.csv was one Global Catalog \`search_catalog\` call: 50 results, in stock, shipping to the run's address, shops located in the run's country, a price ceiling where the row has one. Nothing was hand-picked.`,
  "",
  "## Search types",
  "",
  "| Type | Queries | Product rows | Distinct sellers | Rows with personalization words | Rows with dietary words |",
  "| --- | --- | --- | --- | --- | --- |",
  ...[...byType.entries()].map(([t, v]) => `| ${t} | ${v.queries} | ${v.rows} | ${v.sellers.size} | ${v.personal} | ${v.diet} |`),
  "",
  "## Queries, with the sellers each one returned",
  "",
  "| Type | Query | Price ceiling | Rows | Sellers | Top sellers (products each) |",
  "| --- | --- | --- | --- | --- | --- |",
  ...queries.map((q) => { const rows = byQuery.get(q.key) ?? []; return `| ${q.type} | ${q.query} | ${q.price_max_usd || ""} | ${rows.length} | ${new Set(rows.map((r) => r.seller)).size} | ${topSellers(rows)} |`; }),
  "",
  "## Sellers",
  "",
  `${sellers.length} sellers; ${sellers.filter((s) => s.ucp_tools === "13").length} answer the thirteen UCP tools; ${sellers.filter((s) => s.webmcp_loader === "true").length} carry the WebMCP loader.`,
  "",
  "| Seller | Search types | Products | With personalization words | UCP tools | Price min (cents) | Option names | Sample titles |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...sellers.filter((s) => s.search_types_hit.split("; ").length >= 2).map((s) => `| ${sellerName.get(s.seller)} | ${s.search_types_hit} | ${s.products} | ${s.personalized} | ${s.ucp_tools} | ${s.price_min} | ${s.option_names.split("; ").slice(0, 4).join(", ")} | ${s.samples.slice(0, 120)} |`),
  "",
  "Every seller, including those one search type returned, is in sellers-" + country + ".csv.",
  "",
  "## Variant option names across every product row",
  "",
  "| Option name | Rows |",
  "| --- | --- |",
  ...[...optionTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `| ${n} | ${c} |`),
  "",
  "## The four card categories against the catalog",
  "",
  "| Card | Kind | Query | Filter value | Returned | Catalog total | Titles or messages |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...cards.map((r) => `| ${r.card} | ${r.kind} | ${r.query} | ${r.value} | ${r.returned} | ${r.catalog_total} | ${(r.kind === "query" ? r.titles : r.messages || "").slice(0, 110)}${r.error ? " " + r.error : ""} |`),
  ""
].join("\n");
writeFileSync(`${DIR}/results-${country}.md`, md);
console.log(`results-${country}.md rebuilt: ${products.length} rows, ${sellers.length} sellers, ${cards.length} card probes`);
