/**
 * A configured Shopify shop as a search source. The Global Catalog does not index the shop, so
 * `customshopCandidates` lists its products through the shop's own UCP endpoint; the shared
 * client already sends the profile meta and the `catalog` argument that endpoint requires, so
 * `withEndpoint` is the whole reach. A per-product config (customshop.json, data like
 * cards.json) attaches the personalization fields the shop's Customily template renders, so
 * the coverage term sees the name field. Each candidate gets the shared checkout probe for a
 * real delivery verdict.
 */
import { catalogClient, storefrontEndpoint, type CatalogClient, type CatalogProduct } from "@webmcp/shopify-ucp";
import { withDelivery, type Candidate, type EventContext, type Funnel, type PersonalizationField, type Variant } from "./search";
import configData from "./customshop.json";

export const CUSTOMSHOP_SOURCE = "customshop";

export type CustomshopConfig = { shop_name: string; products: Record<string, { fields: PersonalizationField[] }> };

export function customshopConfig(): CustomshopConfig {
  return configData as CustomshopConfig;
}

/** The shop's base URL from CUSTOMILY_SHOP_URL, or null when no shop is configured. */
export function customshopUrl(): string | null {
  const url = process.env.CUSTOMILY_SHOP_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

/** The host a gift's `shop_domain` carries when its product is the configured shop's. */
export function customshopHost(): string | null {
  const url = customshopUrl();
  return url ? new URL(url).host : null;
}

/** The configured fields for a product; the config keys the numeric id, the shop returns a gid. */
export function customshopFields(productId: string, config = customshopConfig()): PersonalizationField[] | null {
  const numeric = productId.split("/").pop() ?? productId;
  return config.products[numeric]?.fields ?? null;
}

function toCandidate(product: CatalogProduct, host: string, url: string, config: CustomshopConfig): Candidate {
  const variants: Variant[] = (product.variants ?? []).map((v) => ({ id: v.id, title: v.title ?? "", price_cents: v.price?.amount !== undefined ? Number(v.price.amount) : null, currency: v.price?.currency ?? null, available: v.availability?.available !== false, options: (v.options ?? []).map((o) => ({ name: String(o.name), label: String(o.label) })) }));
  const desc = typeof product.description === "string" ? product.description : ((product.description as { plain?: string; html?: string } | undefined)?.plain ?? (product.description as { html?: string } | undefined)?.html ?? "");
  const pr = product.price_range as { min?: { amount?: number; currency?: string } } | undefined;
  const fields = customshopFields(product.id, config);
  return {
    product_id: product.id,
    title: product.title,
    description: desc,
    url: (product.url as string | undefined) ?? url,
    image_url: (product.variants ?? []).flatMap((v) => v.media ?? []).find((m) => m.url)?.url ?? null,
    shop_domain: host,
    shop_name: config.shop_name,
    shop_url: url,
    policy_links: [],
    price_cents: pr?.min?.amount !== undefined ? Number(pr.min.amount) : (variants[0]?.price_cents ?? null),
    currency: pr?.min?.currency ?? variants[0]?.currency ?? null,
    variants,
    option_names: [...new Set(variants.flatMap((v) => v.options.map((o) => o.name)))],
    searches: [CUSTOMSHOP_SOURCE],
    delivery: null,
    ...(fields ? { personalization: { fields } } : {})
  };
}

/**
 * Every product the shop's own search lists, with the configured personalization fields and the
 * shared checkout probe's delivery verdict. Returns nothing without a configured shop, so a run
 * degrades to the other sources.
 */
export async function customshopCandidates(ctx: EventContext, options: { client?: CatalogClient; fetchImpl?: typeof fetch; funnel?: Funnel; config?: CustomshopConfig } = {}): Promise<Candidate[]> {
  const url = customshopUrl();
  if (!url) return [];
  const host = new URL(url).host;
  const config = options.config ?? customshopConfig();
  const client = (options.client ?? catalogClient({ fetchImpl: options.fetchImpl })).withEndpoint(storefrontEndpoint(host));
  const result = await client.searchCatalog({ pagination: { limit: 50 } });
  const products = result.products ?? [];
  const candidates = await Promise.all(products.map((p) => withDelivery(toCandidate(p, host, url, config), ctx, options.fetchImpl ?? fetch)));
  options.funnel?.searches.push({ query: CUSTOMSHOP_SOURCE, returned: products.length, total: (result.pagination as { total_count?: number } | undefined)?.total_count ?? products.length });
  return candidates;
}
