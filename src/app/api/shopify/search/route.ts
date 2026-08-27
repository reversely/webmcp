import { NextResponse } from "next/server";
import { appState } from "../../../../server/state";
import { normalizeCatalogProduct } from "../../../../domain/products/normalize";
import { CatalogError } from "../../../../commerce";

/**
 * Thin server wrapper around Global Catalog search_catalog (PRD 19). Body:
 * { query, limit?, postal_code?, region?, max_cents?, cursor? }. Each result carries the raw
 * catalog object (for adding to a project) and the normalized product (for display).
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { query: string; limit?: number; postal_code?: string; region?: string; max_cents?: number; cursor?: string };
  const s = appState();
  const ships_to = { country: "US", region: body.region ?? "NY", postal_code: body.postal_code ?? "10003" };
  try {
    const result = await s.client.searchCatalog({
      query: body.query,
      filters: { ships_to, available: true, ...(body.max_cents ? { price: { max: body.max_cents } } : {}) } as never,
      context: { address_country: "US", address_region: ships_to.region, postal_code: ships_to.postal_code, currency: "USD" } as never,
      pagination: { limit: Math.min(body.limit ?? 24, 50), cursor: body.cursor }
    });
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
    return NextResponse.json({ products, pagination: result.pagination ?? null });
  } catch (e) {
    const status = e instanceof CatalogError ? 502 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
