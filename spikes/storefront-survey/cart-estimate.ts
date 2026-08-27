// Step 5 of the storefront survey (#14): does the Storefront GraphQL `unstable` cart return
// `minEstimatedDeliveryDate` / `maxEstimatedDeliveryDate` once the buyer's address is known?
// Run: npx tsx spikes/storefront-survey/cart-estimate.ts [host ...]   (defaults to five Liquid sellers)
// Every Liquid storefront embeds its public Storefront token in <script id="shopify-features">
// as `accessToken`; the shop's own domain also answers `/api/unstable/graphql.json` with no token.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128 Safari/537.36";
const DEFAULT_HOSTS = ["modway.com", "tribesigns.com", "www.daals.com", "floydhome.com", "nathanjames.com"];
// `MailingAddressInput` (the deprecated preference) takes names; `CartDeliveryAddressInput` takes codes.
const MAILING_ADDRESS = { address1: "1 Main St", city: "New York", province: "NY", zip: "10003", country: "US" };
const DELIVERY_ADDRESS = { address1: "1 Main St", city: "New York", provinceCode: "NY", zip: "10003", countryCode: "US" };

const CART_FIELDS = `cart { id deliveryGroups(first: 5) { edges { node { deliveryOptions { handle title deliveryMethodType estimatedCost { amount currencyCode } minEstimatedDeliveryDate maxEstimatedDeliveryDate } } } } } userErrors { field message } warnings { code message }`;
// `buyerIdentity.deliveryAddressPreferences` is the shape the spike plan names (deprecated after
// 2025-01); `delivery.addresses` is its replacement. Both are tried so the table records which
// one `unstable` still accepts.
const MUTATIONS = {
  deliveryAddressPreferences: `mutation($variant: ID!, $address: MailingAddressInput!) { cartCreate(input: { lines: [{ merchandiseId: $variant, quantity: 1 }], buyerIdentity: { countryCode: US, deliveryAddressPreferences: [{ deliveryAddress: $address }] } }) { ${CART_FIELDS} } }`,
  deliveryAddresses: `mutation($variant: ID!, $address: CartDeliveryAddressInput!) { cartCreate(input: { lines: [{ merchandiseId: $variant, quantity: 1 }], buyerIdentity: { countryCode: US }, delivery: { addresses: [{ selected: true, address: { deliveryAddress: $address } }] } }) { ${CART_FIELDS} } }`
};

type Option = { title: string; deliveryMethodType: string; estimatedCost: { amount: string }; minEstimatedDeliveryDate: string | null; maxEstimatedDeliveryDate: string | null };

async function graphql(host: string, token: string | null, query: string, variables: Record<string, unknown>) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": UA };
  if (token) headers["X-Shopify-Storefront-Access-Token"] = token;
  const res = await fetch(`https://${host}/api/unstable/graphql.json`, { method: "POST", headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000) });
  return { status: res.status, body: (await res.json().catch(() => null)) as { data?: { cartCreate?: { cart?: { deliveryGroups: { edges: { node: { deliveryOptions: Option[] } }[] } } | null; userErrors: { message: string }[]; warnings?: { code: string; message: string }[] } }; errors?: { message: string }[] } | null };
}

async function probe(host: string) {
  const home = await fetch(`https://${host}/`, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const html = await home.text();
  const features = html.match(/<script id="shopify-features" type="application\/json">(\{.*?\})<\/script>/s)?.[1];
  const token = features ? ((JSON.parse(features) as { accessToken?: string }).accessToken ?? null) : null;
  const pj = (await (await fetch(`https://${host}/products.json?limit=5`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) })).json()) as { products: { handle: string; variants: { id: number; available: boolean }[] }[] };
  const variant = pj.products.flatMap((p) => p.variants.map((v) => ({ ...v, handle: p.handle }))).find((v) => v.available);
  if (!variant) return { host, token: !!token, note: "no available variant in /products.json" };
  const row: Record<string, unknown> = { host, token_in_page: token ? `shopify-features accessToken (${token.length} chars)` : "none", handle: variant.handle };
  const tokenless = await graphql(host, null, "{ shop { name } }", {});
  row.tokenless_shop_query = tokenless.body?.data ? "answers" : `HTTP ${tokenless.status}`;
  for (const [shape, query] of Object.entries(MUTATIONS)) {
    const address = shape === "deliveryAddressPreferences" ? MAILING_ADDRESS : DELIVERY_ADDRESS;
    const r = await graphql(host, token, query, { variant: `gid://shopify/ProductVariant/${variant.id}`, address });
    const cc = r.body?.data?.cartCreate;
    if (r.body?.errors) { row[shape] = `schema error: ${r.body.errors[0].message.slice(0, 120)}`; continue; }
    if (!cc) { row[shape] = `HTTP ${r.status}`; continue; }
    if (cc.userErrors.length) { row[shape] = `userErrors: ${cc.userErrors.map((e) => e.message).join("; ")}`; continue; }
    const options = cc.cart?.deliveryGroups.edges.flatMap((e) => e.node.deliveryOptions) ?? [];
    row[shape] = options.length === 0 ? `cart created, ${cc.cart?.deliveryGroups.edges.length ?? 0} delivery groups, 0 options${cc.warnings?.length ? ` (warnings: ${cc.warnings.map((w) => w.code).join(", ")})` : ""}` : options.map((o) => `${o.title} [${o.deliveryMethodType}] $${o.estimatedCost.amount}: min=${o.minEstimatedDeliveryDate ?? "null"} max=${o.maxEstimatedDeliveryDate ?? "null"}`).join("; ");
  }
  return row;
}

async function main() {
  const hosts = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_HOSTS;
  for (const host of hosts) {
    const row = await probe(host).catch((e: Error) => ({ host, error: e.message }));
    console.log(JSON.stringify(row));
  }
}

main();
