import { NextResponse } from "next/server";
import { appState } from "../../../../server/state";
import { withProject } from "../../../../server/trace";
import { normalizeCatalogProduct } from "../../../../domain/products/normalize";
import { CatalogError } from "../../../../commerce";
import { catalogDestination, shipsToFor } from "../../../../agent/catalog";
import { inferKind } from "../../../../agent/kinds";

/**
 * Thin server wrapper around Global Catalog search_catalog (PRD 19). Body:
 * { item?, query?, project_id?, limit?, max_cents?, cursor? }. `item` is a project item's phrase;
 * its inferred search query is used when `query` is empty, and the keywords are appended to it
 * otherwise. `ships_to` and the buyer context come from the project's delivery address; without
 * one (or without a project) the search carries neither, and `ships_to` echoes as null. Each result carries the raw
 * catalog object (for adding to a project) and the normalized product (for display); `ships_to`
 * echoes what the search used so the panel can say so.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { item?: string; query?: string; project_id?: string; limit?: number; max_cents?: number; cursor?: string };
  const s = appState();
  const item = body.item?.trim();
  const keywords = body.query?.trim() ?? "";
  const base = item ? (await inferKind(item)).query : "";
  const query = [base, keywords].filter(Boolean).join(" ").trim();
  if (!query) return NextResponse.json({ error: "An item or a query is required" }, { status: 400 });
  const project = body.project_id ? s.store.projects.get(body.project_id) : undefined;
  const { ships_to, context } = catalogDestination(project ? shipsToFor(project) : undefined);
  try {
    const result = await withProject(project?.id ?? "_none", () => s.client.searchCatalog({
      query,
      filters: { ...(ships_to ? { ships_to } : {}), available: true, ...(body.max_cents ? { price: { max: body.max_cents } } : {}) },
      ...(context ? { context } : {}),
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
    return NextResponse.json({ products, pagination: result.pagination ?? null, ships_to: ships_to ?? null });
  } catch (e) {
    const status = e instanceof CatalogError ? 502 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
