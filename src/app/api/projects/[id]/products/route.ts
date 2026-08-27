import { NextResponse } from "next/server";
import { addCatalogProduct, appState, snapshot } from "../../../../../server/state";
import { recordIssue, withSpan } from "../../../../../server/trace";
import { ingestProductUrl } from "../../../../../domain/ingestion";
import type { Category } from "../../../../../domain/types";

type Params = { params: Promise<{ id: string }> };

/**
 * Adds a product to the project (PRD 7.2). Body is either
 * { url, category? } for a pasted URL, or { catalog: <catalog product object>, category } for a
 * search result. Either path ends in regenerateBom.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json()) as { url?: string; category?: Category; catalog?: { url?: string; variants?: { seller?: { domain?: string }; url?: string }[] } };
  try {
    if (body.url) {
      const url = body.url;
      await withSpan(id, { kind: "domain", name: "ingest_product_url", prd_ref: "PRD 7.2", input: { url, category: body.category ?? null } }, async (span) => {
        const result = await ingestProductUrl(s.store, { projectId: id, url, category: body.category, client: s.client, merchantFromUrl: (u) => new URL(u).host });
        span.setOutput({ product_id: result.product.id, candidate_id: result.candidate.id, spatial_status: result.product.spatial_status, budget: result.budget });
      });
    } else if (body.catalog && body.category) {
      const variant = body.catalog.variants?.[0];
      const merchant = variant?.seller?.domain ?? "catalog.shopify.com";
      const sourceUrl = body.catalog.url ?? variant?.url ?? `https://${merchant}/`;
      const category = body.category;
      await withSpan(id, { kind: "domain", name: "add_catalog_product", prd_ref: "PRD 7.2", input: { category, merchant, source_url: sourceUrl } }, (span) => {
        const added = addCatalogProduct(id, body.catalog, category, merchant, sourceUrl);
        span.setOutput({ product_id: added.product.id, candidate_id: added.candidate.id, spatial_status: added.product.spatial_status, budget: added.budget });
      });
    } else {
      return NextResponse.json({ error: "Provide url, or catalog and category" }, { status: 400 });
    }
    return NextResponse.json(snapshot(id), { status: 201 });
  } catch (e) {
    recordIssue(id, { source: "domain products", severity: "error", message: `Adding a product to the project failed (${(e as Error).message}); nothing was added, so check the URL or pick another result.` });
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
