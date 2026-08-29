/**
 * Favor vendor discovery: finds party-favor merchants the way Gather's agent will.
 *
 * How Shopify's side works, in plain terms
 * ----------------------------------------
 * Shopify runs a single search service for every shop that opted in ("the Global Catalog"). It is
 * not a web page: https://catalog.shopify.com/api/ucp/mcp answers 404 to a browser, because it only
 * accepts a message posted to it. The message names a service ("search_catalog"), says who is
 * asking (a link to a public profile document; no account or key), and carries the search: the
 * words a person would type, plus conditions (ship to this address, in stock, under this price,
 * located in this country). The reply is a list of products, and every product names the shop
 * that sells it. That "sold by" field is how this script finds merchants: it never starts from a
 * list of shops, it starts from searches and collects the shops the results name.
 *
 * Each shop has its own counter at https://{shop}/api/ucp/mcp that answers the same search and
 * also takes cart and checkout messages. The last step here knocks on every discovered shop's
 * counter to confirm it answers.
 *
 * The client that builds and posts the message lives in the room planner
 * (3droom-concept/src/commerce/client.ts); this script only decides what to ask.
 *
 * What to ask comes from queries.csv, one search per row:
 *   type           the kind of search (category, personalization, dietary, occasion, bulk, price, sentence)
 *   key            a short id for the row
 *   query          the words sent to Shopify, as typed
 *   price_max_usd  optional; becomes the "price under" condition
 *   ships_from     optional; limits results to shops located in this country (US here)
 *   note           what the row is testing; not sent
 *
 * Outputs, written next to this file:
 *   products.csv   one row per (search, product): who sells it, price, the shop's option names
 *                  (Flavor, Size, ...), and whether the text mentions personalization or dietary words
 *   sellers.csv    one row per shop: which search types found it, how many products, whether its
 *                  counter answers, price range, option names, three sample titles
 *   results.md     the same, summarised by search type and by query
 *
 * Run from the repo root: npx tsx gather/spikes/favor-vendors/discover.mts
 * The catalog answers "429 Too Many Requests" after a burst, so searches are spaced 2.5 s apart
 * and a failed search waits 10, 20, then 30 s before trying again.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { catalogClient, storefrontEndpoint } from "../../../3droom-concept/src/commerce/index.ts";

const DIR = "gather/spikes/favor-vendors";

/**
 * "Ship to" condition: only products that can be delivered to this address. Set with the SHIP_TO
 * environment variable as country:region:postal code, e.g. SHIP_TO="CA:ON:M6H 2A8" for the
 * Toronto event; the default is New York, 10003. Output files carry the country as a suffix.
 */
const [SHIP_COUNTRY, SHIP_REGION, SHIP_POSTAL] = (process.env.SHIP_TO ?? "US:NY:10003").split(":");
const SHIPS_TO = { country: SHIP_COUNTRY, region: SHIP_REGION, postal_code: SHIP_POSTAL };
/** Hints Shopify uses for pricing and localisation; not a hard filter. */
const CONTEXT = { address_country: SHIP_COUNTRY, address_region: SHIP_REGION, postal_code: SHIP_POSTAL, currency: SHIP_COUNTRY === "CA" ? "CAD" : "USD" };
/** A row's ships_from column may say "*", meaning use the ship-to country; a blank means any country. */
const SUFFIX = `-${SHIP_COUNTRY.toLowerCase()}`;
/** A browser-like identity for the home-page fetch in the probe step; some shops block bare clients. */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The only matching this script does on our side. Shopify decides which products match the search
 * words; these two patterns then read each result's title and description to say whether the shop
 * talks about personalising the item and whether it talks about dietary or allergen properties.
 */
const PERSONAL = /personali[sz]|custom|engrav|monogram|your name|add name|initials/i;
const DIET = /vegan|gluten|nut[- ]free|dairy[- ]free|allerg|kosher|halal/i;

type Query = { type: string; key: string; query: string; price_max_usd: string; ships_from: string; note: string };
type ProductRow = { type: string; key: string; query: string; seller: string; seller_name: string; title: string; price_min: number | null; price_max: number | null; variants: number; option_names: string; personalization_words: string; dietary_words: string; url: string };
type Seller = { domain: string; name: string; queries: Set<string>; types: Set<string>; products: number; personalized: number; option_names: Map<string, number>; prices: number[]; samples: string[] };

/* ---- CSV helpers: quote a cell when it holds a comma, a quote, or a newline ---- */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(rows: Record<string, unknown>[], columns: string[]): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}
/** Reads queries.csv into one object per row. The file has no quoted commas, so a plain split is enough. */
function readQueries(): Query[] {
  const [header, ...lines] = readFileSync(`${DIR}/queries.csv`, "utf8").trim().split("\n");
  const cols = header.split(",");
  return lines.map((line) => Object.fromEntries(cols.map((c, i) => [c, line.split(",")[i] ?? ""])) as Query);
}

const client = catalogClient();
const queries = readQueries();
const products: ProductRow[] = [];
/** Every shop seen so far, keyed by its domain, with what the searches told us about it. */
const sellers = new Map<string, Seller>();
/** Per-search tallies for the summary table. */
const perQuery: Record<string, { returned: number; total: number | null; sellers: Set<string>; personalized: number; dietary: number }> = {};

/* ---- Step 1: one search per CSV row ---- */
for (const q of queries) {
  // The conditions Shopify applies before matching. ships_to: deliverable to the address.
  // ships_from: the shop is located in the country (the shape is a list of {country} objects).
  // price.max: the ceiling in dollars. available: in stock only.
  const filters: Record<string, unknown> = { ships_to: SHIPS_TO, available: true };
  if (q.ships_from) filters.ships_from = [{ country: q.ships_from === "*" ? SHIP_COUNTRY : q.ships_from }];
  if (q.price_max_usd) filters.price = { max: Number(q.price_max_usd) };

  // Post the search; on a rate-limit or network error wait and try again, three times at most.
  let result;
  for (let attempt = 0; ; attempt++) {
    try {
      result = await client.searchCatalog({ query: q.query, filters: filters as never, context: CONTEXT as never, pagination: { limit: 50 } });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.log(`${q.key}: ${(e as Error).message}; retry in ${10 * (attempt + 1)} s`);
      await sleep(10_000 * (attempt + 1));
    }
  }

  // The reply: up to 50 products, and total_count says how many the whole catalog matched.
  const list = result.products ?? [];
  const pg = result.pagination as { total_count?: number } | undefined;
  const stat = { returned: list.length, total: pg?.total_count ?? null, sellers: new Set<string>(), personalized: 0, dietary: 0 };
  perQuery[q.key] = stat;

  for (const product of list) {
    // A product has one or more variants (the buyable versions: a size, a flavour). The shop is
    // named on the variant, so take the first available one to read the seller.
    const variants = product.variants ?? [];
    const variant = variants.find((v) => v.availability?.available) ?? variants[0];
    const domain = variant?.seller?.domain;
    if (!domain) continue;

    // The option names are the drop-downs the shop's product page offers (Flavor, Size, Pack).
    // For Gather they matter because a dietary or size split can only be expressed as a variant.
    const optionNames = [...new Set(variants.flatMap((v) => (v.options ?? []).map((o) => String(o.name))))];
    const desc = typeof product.description === "string" ? product.description : ((product.description as { plain?: string } | undefined)?.plain ?? "");
    const text = `${product.title}\n${desc}\n${optionNames.join(" ")}`;
    const personal = [...new Set((text.match(new RegExp(PERSONAL.source, "gi")) ?? []).map((w) => w.toLowerCase()))];
    const diet = [...new Set((text.match(new RegExp(DIET.source, "gi")) ?? []).map((w) => w.toLowerCase()))];
    if (personal.length) stat.personalized++;
    if (diet.length) stat.dietary++;
    stat.sellers.add(domain);

    // Prices arrive in minor units (cents); 9000 USD means $90.00. Kept as sent.
    const pr = product.price_range as { min?: { amount?: number | string }; max?: { amount?: number | string } } | undefined;
    const priceMin = pr?.min?.amount !== undefined ? Number(pr.min.amount) : null;

    // One products.csv row per (search, product).
    products.push({ type: q.type, key: q.key, query: q.query, seller: domain, seller_name: variant?.seller?.name ?? domain, title: product.title, price_min: priceMin, price_max: pr?.max?.amount !== undefined ? Number(pr.max.amount) : null, variants: variants.length, option_names: optionNames.join("; "), personalization_words: personal.join("; "), dietary_words: diet.join("; "), url: variant?.url ?? (product.url as string | undefined) ?? "" });

    // Fold the product into its shop's running totals.
    const seller: Seller = sellers.get(domain) ?? { domain, name: variant?.seller?.name ?? domain, queries: new Set(), types: new Set(), products: 0, personalized: 0, option_names: new Map(), prices: [], samples: [] };
    seller.queries.add(q.key);
    seller.types.add(q.type);
    seller.products++;
    if (personal.length) seller.personalized++;
    for (const n of optionNames as string[]) seller.option_names.set(n, (seller.option_names.get(n) ?? 0) + 1);
    if (priceMin !== null) seller.prices.push(priceMin);
    if (seller.samples.length < 3) seller.samples.push(product.title);
    sellers.set(domain, seller);
  }
  console.log(`${q.type}/${q.key}: ${list.length} of ${pg?.total_count ?? "?"} products, ${stat.sellers.size} sellers`);
  await sleep(2_500); // stay under the catalog's burst limit
}

/* ---- Step 2: knock on every discovered shop's own counter ---- */
const sellerRows: Record<string, unknown>[] = [];
for (const s of [...sellers.values()].sort((a, b) => b.types.size - a.types.size || b.products - a.products)) {
  const get = (url: string) => fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) }).catch(() => null);
  // The home page tells us the public host (a myshopify.com domain often redirects to a brand
  // domain) and whether Shopify's in-page WebMCP loader is installed on this shop's theme.
  const home = await get(`https://${s.domain}/`);
  const html = home && home.ok ? await home.text() : "";
  // "tools/list" is the message that asks a counter what it can do. A Shopify shop answers with
  // 13 tools (search, product, cart, checkout, order). A number here means the shop is reachable
  // for the cart and checkout steps Gather needs later; anything else is the HTTP status we got.
  const tools = await fetch(storefrontEndpoint(s.domain), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), signal: AbortSignal.timeout(15000) }).catch(() => null);
  const ucp = tools && tools.ok ? (((await tools.json()) as { result?: { tools?: { name: string }[] } }).result?.tools?.length ?? 0) : (tools?.status ?? "unreachable");
  sellerRows.push({ seller: s.domain, name: s.name, public_host: home?.url ? new URL(home.url).host : s.domain, search_types_hit: [...s.types].join("; "), queries_hit: [...s.queries].join("; "), products: s.products, personalized: s.personalized, ucp_tools: ucp, webmcp_loader: /shopify:webmcp_adapter_loaded/.test(html), price_min: s.prices.length ? Math.min(...s.prices) : "", price_max: s.prices.length ? Math.max(...s.prices) : "", option_names: [...s.option_names.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`).join("; "), samples: s.samples.join(" | ") });
  console.log(`${s.domain}: ${s.products} products, tools ${ucp}`);
}

/* ---- Step 3: write the two CSVs and the summary ---- */
writeFileSync(`${DIR}/products${SUFFIX}.csv`, csv(products, ["type", "key", "query", "seller", "seller_name", "title", "price_min", "price_max", "variants", "option_names", "personalization_words", "dietary_words", "url"]));
writeFileSync(`${DIR}/sellers${SUFFIX}.csv`, csv(sellerRows, ["seller", "name", "public_host", "search_types_hit", "queries_hit", "products", "personalized", "ucp_tools", "webmcp_loader", "price_min", "price_max", "option_names", "samples"]));

// Which option names (drop-downs) appear most across every product, and the tallies per search type.
const optionTotals = new Map<string, number>();
for (const s of sellers.values()) for (const [n, c] of s.option_names) optionTotals.set(n, (optionTotals.get(n) ?? 0) + c);
const byType = new Map<string, { queries: number; returned: number; sellers: Set<string>; personalized: number; dietary: number }>();
for (const q of queries) {
  const t = byType.get(q.type) ?? { queries: 0, returned: 0, sellers: new Set(), personalized: 0, dietary: 0 };
  const st = perQuery[q.key];
  t.queries++; t.returned += st.returned; st.sellers.forEach((d) => t.sellers.add(d)); t.personalized += st.personalized; t.dietary += st.dietary;
  byType.set(q.type, t);
}
const md = [
  "# Favor vendor survey",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)} by discover.mts from queries.csv: one Global Catalog \`search_catalog\` call per row (50 results, ships to ${SHIP_COUNTRY} ${SHIP_POSTAL}, shops located in the row's ships_from country, available only, a price ceiling where the row has one), then a storefront probe of every seller returned. Rows: products${SUFFIX}.csv (one per query and product) and sellers${SUFFIX}.csv. Nothing was hand-picked.`,
  "",
  "## Search types",
  "",
  "| Type | Queries | Products returned | Distinct sellers | Products with personalization words | Products with dietary words |",
  "| --- | --- | --- | --- | --- | --- |",
  ...[...byType.entries()].map(([t, v]) => `| ${t} | ${v.queries} | ${v.returned} | ${v.sellers.size} | ${v.personalized} | ${v.dietary} |`),
  "",
  "## Queries",
  "",
  "| Type | Query | Ships from | Price ceiling | Returned | Catalog total | Sellers | Personalization words | Dietary words |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...queries.map((q) => { const s = perQuery[q.key]; return `| ${q.type} | ${q.query} | ${q.ships_from} | ${q.price_max_usd || ""} | ${s.returned} | ${s.total ?? "?"} | ${s.sellers.size} | ${s.personalized} | ${s.dietary} |`; }),
  "",
  "## Variant option names across every product returned",
  "",
  "| Option name | Products |",
  "| --- | --- |",
  ...[...optionTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `| ${n} | ${c} |`),
  "",
  "## Sellers hit by two or more search types",
  "",
  "| Seller | Search types | Products | With personalization words | UCP tools | WebMCP loader | Price min | Option names |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...sellerRows.filter((r) => String(r.search_types_hit).split("; ").length >= 2).map((r) => `| ${r.name} (${r.public_host}) | ${r.search_types_hit} | ${r.products} | ${r.personalized} | ${r.ucp_tools} | ${r.webmcp_loader ? "yes" : "no"} | ${r.price_min} | ${String(r.option_names).split("; ").slice(0, 4).join(", ")} |`),
  ""
].join("\n");
writeFileSync(`${DIR}/results${SUFFIX}.md`, md);
console.log(`\n${products.length} product rows, ${sellerRows.length} sellers written`);
