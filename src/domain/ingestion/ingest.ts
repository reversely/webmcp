import type { CatalogClient, CatalogProduct } from "../../commerce";
import { storefrontEndpoint } from "../../commerce";
import { regenerateBom } from "../bom";
import type { Budget, DomainEvent } from "../bom";
import type { ProjectStore } from "../bom";
import { normalizeCatalogProduct } from "../products/normalize";
import { normalizeProductUrl } from "../products/url";
import type { Candidate, Category, Kind, Product } from "../types";
import { InvalidProductUrlError, ProductNotFoundError } from "./errors";
import { startModelGeneration, startVisualEvaluation } from "./hooks";

export interface IngestProductUrlRequest {
  projectId: string;
  url: string;
  /** The project's phrase for the item; the product title stands in when the person named none. */
  category?: Category;
  /** The rendering kind; when absent, `inferKind` (the PlanningAgent) decides, else `other`. */
  kind?: Kind;
  inferKind?: (name: string) => Promise<Kind>;
  /** Global Catalog client; the storefront fallback is derived from it with `withEndpoint`. */
  client: CatalogClient;
  merchantFromUrl: (normalizedUrl: string) => string;
}

export interface IngestProductUrlResult {
  product: Product;
  candidate: Candidate;
  budget: Budget;
}

export type ProductAddedEvent = Extract<DomainEvent, { type: "PRODUCT_ADDED" }>;

/**
 * Adds a pasted Shopify product URL to a project: looks it up, upserts the global Product row,
 * ensures the project has a selected Candidate for it, and regenerates the BOM.
 *
 * Pasting the same URL twice leaves one Product and one Candidate; the second pass refreshes
 * the product's catalog fields and returns the existing candidate.
 *
 * Raises:
 *   InvalidProductUrlError: when the URL has no `/products/{handle}` path.
 *   ProductNotFoundError: when neither the Global Catalog nor the shop's storefront knows it.
 */
export async function ingestProductUrl(store: ProjectStore, request: IngestProductUrlRequest): Promise<IngestProductUrlResult> {
  const url = normalizeProductUrl(request.url);
  if (!url) throw new InvalidProductUrlError(request.url);

  const catalogProduct = await lookupByUrl(request.client, url);
  const fresh = normalizeCatalogProduct(catalogProduct, { merchant: request.merchantFromUrl(url), sourceUrl: url });
  const category = request.category?.trim() || fresh.title;
  const kind = request.kind ?? (request.inferKind ? await request.inferKind(category) : "other");

  const result = store.mutate(() => {
    const product = upsertProduct(store, fresh);
    const { candidate, created } = ensureCandidate(store, request.projectId, product.id, category, kind);
    if (created) {
      const event: ProductAddedEvent = {
        type: "PRODUCT_ADDED",
        project_id: request.projectId,
        product_id: product.id,
        candidate_id: candidate.id
      };
      store.emit(event);
    }
    const { budget } = regenerateBom(store, request.projectId);
    return { product, candidate, budget, created };
  });

  if (result.created) {
    startModelGeneration(result.product);
    startVisualEvaluation(result.candidate);
  }
  return { product: result.product, candidate: result.candidate, budget: result.budget };
}

/** Global Catalog first; on a miss, the storefront MCP of the URL's own host. */
async function lookupByUrl(client: CatalogClient, url: string): Promise<CatalogProduct> {
  const storefront = client.withEndpoint(storefrontEndpoint(new URL(url).hostname));
  for (const endpoint of [client, storefront]) {
    const { products } = await endpoint.lookupCatalog([url]);
    if (products.length > 0) return products[0];
  }
  throw new ProductNotFoundError(url, [client.endpoint, storefront.endpoint]);
}

/** Replaces catalog fields on re-ingestion but keeps the 3D model state the product already has. */
function upsertProduct(store: ProjectStore, fresh: Product): Product {
  const existing = store.products.get(fresh.id);
  const product = existing ? { ...fresh, glb_url: existing.glb_url, model_status: existing.model_status } : fresh;
  store.products.set(product.id, product);
  return product;
}

function ensureCandidate(
  store: ProjectStore,
  projectId: string,
  productId: string,
  category: Category,
  kind: Kind
): { candidate: Candidate; created: boolean } {
  for (const candidate of store.candidates.values()) {
    if (candidate.project_id === projectId && candidate.product_id === productId) return { candidate, created: false };
  }
  const candidate: Candidate = {
    id: store.newId("cand"),
    project_id: projectId,
    product_id: productId,
    category,
    kind,
    hard_constraint_results_json: null,
    visual_evaluation_json: null,
    delivery_status: null,
    delivery_evidence_json: null,
    ranking_state: "selected",
    rank: null
  };
  store.candidates.set(candidate.id, candidate);
  store.markChanged(projectId);
  return { candidate, created: true };
}
