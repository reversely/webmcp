/**
 * Catalog access shared by the sourcing and replacement flows: one search per category against
 * the Global Catalog, and the upsert that turns a raw catalog object into a Product row plus a
 * project Candidate without selecting it (selection is the ranking's job).
 */
import type { CatalogClient, ShipsTo } from "../commerce";
import { normalizeCatalogProduct } from "../domain/products/normalize";
import type { Box, Candidate, Category, Product, Project } from "../domain/types";
import { appState } from "../server/state";

export const CATEGORY_QUERIES: Record<Category, string> = {
  sofa: "three seat sofa",
  coffee_table: "coffee table",
  ottoman: "ottoman",
  rug: "area rug 8x10",
  side_table: "side table"
};

export const SEARCH_LIMIT = 24;
const DEFAULT_SHIPS_TO: ShipsTo = { country: "US", region: "NY", postal_code: "10003" };

export function shipsToFor(project: Pick<Project, "delivery_address_json">): ShipsTo {
  const address = project.delivery_address_json;
  if (!address) return DEFAULT_SHIPS_TO;
  return { country: address.country, region: address.region ?? DEFAULT_SHIPS_TO.region, postal_code: address.postal_code };
}

export type SearchOptions = { minCents?: number; maxCents?: number; limit?: number; query?: string };

/** One live `search_catalog` call filtered to in-stock products that ship to the project address. */
export async function searchCategory(client: CatalogClient, category: Category, shipsTo: ShipsTo, options: SearchOptions = {}): Promise<unknown[]> {
  const price = options.minCents !== undefined || options.maxCents !== undefined ? { min: options.minCents, max: options.maxCents } : undefined;
  const result = await client.searchCatalog({
    query: options.query ?? CATEGORY_QUERIES[category],
    filters: { ships_to: shipsTo, available: true, ...(price ? { price } : {}) },
    context: { address_country: shipsTo.country, address_region: shipsTo.region, postal_code: shipsTo.postal_code, currency: "USD" },
    pagination: { limit: options.limit ?? SEARCH_LIMIT }
  });
  return result.products ?? [];
}

type RawCatalog = { url?: string; variants?: { seller?: { domain?: string }; url?: string; availability?: { available?: boolean } }[] };

export function isAvailable(raw: unknown): boolean {
  const variants = (raw as RawCatalog).variants ?? [];
  return variants.length === 0 || variants.some((v) => v.availability?.available !== false);
}

export function sellerOf(raw: unknown): { merchant: string; sourceUrl: string } {
  const r = raw as RawCatalog;
  const variant = r.variants?.find((v) => v.availability?.available) ?? r.variants?.[0];
  const merchant = variant?.seller?.domain ?? "catalog.shopify.com";
  return { merchant, sourceUrl: r.url ?? variant?.url ?? `https://${merchant}/` };
}

/** Normalizes a raw catalog object into the store as a `pending` candidate, or returns the existing one. */
export function upsertCandidate(projectId: string, raw: unknown, category: Category): { product: Product; candidate: Candidate } {
  const s = appState();
  const { merchant, sourceUrl } = sellerOf(raw);
  const fresh = normalizeCatalogProduct(raw, { merchant, sourceUrl });
  const existing = s.store.products.get(fresh.id);
  const product: Product = existing ? { ...fresh, glb_url: existing.glb_url, model_status: existing.model_status } : fresh;
  s.store.products.set(product.id, product);
  let candidate = [...s.store.candidates.values()].find((c) => c.project_id === projectId && c.product_id === product.id);
  if (!candidate) {
    candidate = {
      id: s.store.newId("cand"),
      project_id: projectId,
      product_id: product.id,
      category,
      hard_constraint_results_json: null,
      visual_evaluation_json: null,
      delivery_status: null,
      delivery_evidence_json: null,
      ranking_state: "pending",
      rank: null
    };
    s.store.candidates.set(candidate.id, candidate);
  }
  return { product, candidate };
}

export function boxOf(product: Product): Box | null {
  if (product.width_mm === null || product.depth_mm === null || product.height_mm === null) return null;
  return { width_mm: product.width_mm, depth_mm: product.depth_mm, height_mm: product.height_mm };
}

export function dimsText(product: Product): string | null {
  const box = boxOf(product);
  return box ? `${box.width_mm} × ${box.depth_mm} × ${box.height_mm} mm` : null;
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
