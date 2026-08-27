/**
 * Catalog access shared by the sourcing and replacement flows: one search per query against the
 * Global Catalog, and the upsert that turns a raw catalog object into a Product row plus a project
 * Candidate without selecting it (selection is the ranking's job).
 */
import { CatalogError, type BuyerContext, type CatalogClient, type ShipsTo } from "../commerce";
import { normalizeCatalogProduct } from "../domain/products/normalize";
import type { Box, Candidate, Category, Kind, Product, Project } from "../domain/types";
import { appState } from "../server/state";

export const SEARCH_LIMIT = 24;

/** Where a search ships to: the catalog's `ships_to` filter plus the currency its buyer context carries. */
export type SearchDestination = ShipsTo & { currency?: string };

/**
 * The destination for a project's searches: its delivery address's country, region, postal code,
 * and currency. Undefined without an address, or with one that names no country (an unread
 * reply), so the search carries no `ships_to` and no country context; nothing is assumed.
 */
export function shipsToFor(project: Pick<Project, "delivery_address_json">): SearchDestination | undefined {
  const address = project.delivery_address_json;
  if (!address || address.country === null) return undefined;
  return {
    country: address.country,
    ...(address.region ? { region: address.region } : {}),
    ...(address.postal_code ? { postal_code: address.postal_code } : {}),
    ...(address.currency ? { currency: address.currency } : {})
  };
}

/** Splits a destination into the catalog's filter and buyer context; both absent without one. */
export function catalogDestination(destination: SearchDestination | undefined): { ships_to?: ShipsTo; context?: BuyerContext } {
  if (!destination) return {};
  const { currency, ...ships_to } = destination;
  return { ships_to, context: { address_country: ships_to.country, address_region: ships_to.region, postal_code: ships_to.postal_code, currency } };
}

export type SearchOptions = { minCents?: number; maxCents?: number; limit?: number };

/** Waits before each retry of a rate-limited search; a run sources one search per item, so a burst of items can trip the catalog's limit. */
const RATE_LIMIT_WAITS_MS = [2000, 6000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One live `search_catalog` call for `query`, filtered to in-stock products that ship to the
 * project address. An HTTP 429 from the catalog is retried after a pause, twice, before it
 * propagates.
 */
export async function searchProducts(client: CatalogClient, query: string, destination: SearchDestination | undefined, options: SearchOptions = {}): Promise<unknown[]> {
  const price = options.minCents !== undefined || options.maxCents !== undefined ? { min: options.minCents, max: options.maxCents } : undefined;
  const { ships_to, context } = catalogDestination(destination);
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await client.searchCatalog({
        query,
        filters: { ...(ships_to ? { ships_to } : {}), available: true, ...(price ? { price } : {}) },
        ...(context ? { context } : {}),
        pagination: { limit: options.limit ?? SEARCH_LIMIT }
      });
      return result.products ?? [];
    } catch (e) {
      const rateLimited = e instanceof CatalogError && e.code === 429;
      if (!rateLimited || attempt >= RATE_LIMIT_WAITS_MS.length) throw e;
      await sleep(RATE_LIMIT_WAITS_MS[attempt]);
    }
  }
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

/** Normalizes a raw catalog object into the store as a `pending` candidate for the named item, or returns the existing one. */
export function upsertCandidate(projectId: string, raw: unknown, category: Category, kind: Kind): { product: Product; candidate: Candidate } {
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
      kind,
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
