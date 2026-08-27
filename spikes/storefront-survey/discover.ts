// Discovers furniture merchants the way the planner will: Global Catalog search_catalog per
// required category, then surveys every seller the catalog returns. No merchant list is hard-coded.
// Run: npx tsx spikes/storefront-survey/discover.ts  → spikes/storefront-survey/discovered.json + .md
import { writeFileSync } from "node:fs";
import { catalogClient, storefrontEndpoint } from "../../src/commerce";
import { parseDimensions } from "../../src/domain/products/dimensions";

const CATEGORIES: Record<string, string> = {
  sofa: "three seat sofa",
  coffee_table: "coffee table",
  ottoman: "ottoman",
  rug: "area rug 8x10",
  side_table: "side table"
};
const SHIPS_TO = { country: "US", region: "NY", postal_code: "10003" };
const CONTEXT = { address_country: "US", address_region: "NY", postal_code: "10003", currency: "USD" };
const PROFILE = "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128 Safari/537.36";

type Seller = { domain: string; name: string; categories: Set<string>; products: number; withDims: number; sampleVariantId?: string; sampleTitle?: string };

async function discover() {
  const client = catalogClient();
  const sellers = new Map<string, Seller>();
  for (const [category, query] of Object.entries(CATEGORIES)) {
    const result = await client.searchCatalog({ query, filters: { ships_to: SHIPS_TO, availability: "in_stock" } as never, context: CONTEXT as never, pagination: { limit: 50 } });
    for (const product of result.products ?? []) {
      const variant = (product.variants ?? []).find((v) => v.availability?.available) ?? product.variants?.[0];
      const domain = variant?.seller?.domain;
      if (!domain) continue;
      const seller = sellers.get(domain) ?? { domain, name: variant?.seller?.name ?? domain, categories: new Set(), products: 0, withDims: 0 };
      seller.categories.add(category);
      seller.products++;
      const specs = (product.metadata as { tech_specs?: string } | undefined)?.tech_specs ?? "";
      const desc = typeof product.description === "string" ? product.description : (product.description as { plain?: string } | undefined)?.plain ?? "";
      if (parseDimensions(`${specs}\n${desc}`)) seller.withDims++;
      if (!seller.sampleVariantId && variant?.id) { seller.sampleVariantId = variant.id; seller.sampleTitle = product.title; }
      sellers.set(domain, seller);
    }
    console.log(`${category}: ${result.products?.length ?? 0} products, ${sellers.size} sellers so far`);
  }
  return [...sellers.values()].sort((a, b) => b.categories.size - a.categories.size || b.products - a.products);
}

async function probeStorefront(seller: Seller) {
  const host = seller.domain;
  const out: Record<string, unknown> = { domain: host, name: seller.name, categories: [...seller.categories], products: seller.products, with_dims: seller.withDims };
  const get = (url: string) => fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) }).catch(() => null);
  const home = await get(`https://${host}/`);
  const html = home && home.ok ? await home.text() : "";
  out.public_host = home?.url ? new URL(home.url).host : host;
  out.webmcp_adapter = /storefront\/webmcp\/webmcp-[\d.]+\.js/.test(html);
  out.model_context_ref = /modelContext/.test(html);
  const pj = await get(`https://${host}/products.json?limit=1`);
  out.products_json = !!pj && pj.ok && (await pj.text()).includes('"products"');
  const tools = await fetch(storefrontEndpoint(host), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), signal: AbortSignal.timeout(15000) }).catch(() => null);
  out.ucp_tools = tools && tools.ok ? ((await tools.json()) as { result?: { tools?: { name: string }[] } }).result?.tools?.length ?? 0 : tools?.status ?? "unreachable";
  if (seller.sampleVariantId && typeof out.ucp_tools === "number" && out.ucp_tools > 0) {
    const destination = { first_name: "Zach", last_name: "Planner", phone_number: "+12125551234", street_address: "1 Main St", address_locality: "New York", address_region: "NY", postal_code: "10003", address_country: "US" };
    const checkout = {
      line_items: [{ item: { id: seller.sampleVariantId }, quantity: 1 }],
      buyer: { email: "planner@example.com", first_name: "Zach", last_name: "Planner" },
      fulfillment: { methods: [{ type: "shipping", destinations: [destination] }] }
    };
    const body = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_checkout", arguments: { meta: { "ucp-agent": { profile: PROFILE } }, checkout } } };
    const res = await fetch(storefrontEndpoint(host), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }).catch(() => null);
    try {
      const env = (await res!.json()) as { result?: { content?: { text: string }[] }; error?: unknown };
      const text = env.result?.content?.[0]?.text;
      const t = text ? JSON.parse(text) : env;
      const options = ((t.fulfillment?.methods ?? []) as { groups?: { options?: { title?: string; description?: string; totals?: { amount: number }[] }[] }[] }[]).flatMap((m) => (m.groups ?? []).flatMap((g) => g.options ?? []));
      out.checkout_status = t.status ?? (env.error ? "rpc_error" : "unknown");
      out.shipping_options = options.map((o) => `${o.title ?? ""}${o.description && o.description !== o.title ? ` (${o.description})` : ""} $${((o.totals?.[0]?.amount ?? 0) / 100).toFixed(2)}`);
      out.date_fields = JSON.stringify(options).match(/"[a-z_]*(deliver|estimat|arriv|transit|days|date)[a-z_]*"/g) ?? [];
      out.checkout_messages = (t.messages ?? []).map((m: { code?: string }) => m.code);
    } catch {
      out.checkout_status = "parse_failed";
    }
  }
  return out;
}

async function main() {
  const sellers = await discover();
  console.log(`\n${sellers.length} sellers discovered`);
  const rows: Record<string, unknown>[] = [];
  for (const seller of sellers) {
    const row = await probeStorefront(seller);
    rows.push(row);
    console.log(`${row.domain} | cats=${(row.categories as string[]).length} | products=${row.products} dims=${row.with_dims} | tools=${row.ucp_tools} | adapter=${row.webmcp_adapter} | checkout=${row.checkout_status ?? "-"} | ${JSON.stringify(row.shipping_options ?? [])} ${JSON.stringify(row.date_fields ?? [])}`);
  }
  writeFileSync("spikes/storefront-survey/discovered.json", JSON.stringify(rows, null, 2) + "\n");
  const md = [
    "| Seller | Categories | Products (with dims) | UCP tools | WebMCP adapter | Checkout status | Shipping options | Date fields |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.domain} | ${(r.categories as string[]).join(", ")} | ${r.products} (${r.with_dims}) | ${r.ucp_tools} | ${r.webmcp_adapter ? "yes" : "no"} | ${r.checkout_status ?? ""} | ${((r.shipping_options as string[]) ?? []).join("; ")} | ${((r.date_fields as string[]) ?? []).join(", ") || "none"} |`)
  ].join("\n");
  writeFileSync("spikes/storefront-survey/discovered.md", md + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
