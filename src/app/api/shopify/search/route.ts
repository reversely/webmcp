import { NextResponse } from "next/server";
import { appState } from "../../../../server/state";
import { withProject } from "../../../../server/trace";
import { normalizeCatalogProduct } from "../../../../domain/products/normalize";
import { Category } from "../../../../domain/types";
import { CatalogError } from "../../../../commerce";
import { CATEGORY_QUERIES, DEFAULT_COUNTRY, shipsToFor } from "../../../../agent/catalog";

/**
 * Thin server wrapper around Global Catalog search_catalog (PRD 19). Body:
 * { category?, query?, project_id?, limit?, max_cents?, cursor? }. The query is the category's
 * standard search when `query` is empty. `ships_to` and the buyer context come from the project's
 * delivery address; without one (or without a project) the search carries the country alone.
 * Each result carries the raw catalog object (for adding to a project) and the normalized product
 * (for display); `ships_to` echoes what the search used so the panel can say so.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { category?: string; query?: string; project_id?: string; limit?: number; max_cents?: number; cursor?: string };
  const s = appState();
  const category = Category.safeParse(body.category);
  const query = body.query?.trim() || (category.success ? CATEGORY_QUERIES[category.data] : "");
  if (!query) return NextResponse.json({ error: "A category or a query is required" }, { status: 400 });
  const project = body.project_id ? s.store.projects.get(body.project_id) : undefined;
  const ships_to = project ? shipsToFor(project) : { country: DEFAULT_COUNTRY };
  try {
    const result = await withProject(project?.id ?? "_none", () => s.client.searchCatalog({
      query,
      filters: { ships_to, available: true, ...(body.max_cents ? { price: { max: body.max_cents } } : {}) },
      context: { address_country: ships_to.country, address_region: ships_to.region, postal_code: ships_to.postal_code, currency: "USD" },
      pagination: { limit: Math.min(body.limit ?? 24, 50), cursor: body.cursor }
    }));
    const products = (result.products ?? []).map((raw) => {
      const variant = (raw.variants ?? []).find((v) => v.availability?.available) ?? raw.variants?.[0];
      const merchant = variant?.seller?.domain ?? "catalog.shopify.com";
      const sourceUrl = (raw as { url?: string }).url ?? variant?.url ?? `https://${merchant}/`;
      let normalized = null;
      try {
        normalized = normalizeCatalogProduct(raw, { merchant, sourceUrl });
      } catch {
        normalized = null;
      }
      return { raw, normalized, seller: { domain: merchant, name: variant?.seller?.name ?? merchant } };
    });
    return NextResponse.json({ products, pagination: result.pagination ?? null, ships_to });
  } catch (e) {
    const status = e instanceof CatalogError ? 502 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
