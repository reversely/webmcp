import { NextResponse } from "next/server";
import { addCatalogProduct, appState, snapshot, swapCatalogProduct } from "../../../../../server/state";
import { recordIssue, withSpan } from "../../../../../server/trace";
import { ingestProductUrl } from "../../../../../domain/ingestion";
import { Kind } from "../../../../../domain/types";
import { inferKind } from "../../../../../agent/kinds";

type Params = { params: Promise<{ id: string }> };

/**
 * Adds a product to the project (PRD 7.2). Body is either
 * { url, category?, kind? } for a pasted URL, or { catalog: <catalog product object>, category, kind? }
 * for a search result. `category` is the project's phrase for the item; `kind` is inferred from it
 * when absent. Either path ends in regenerateBom. A search result with `replace_bom_item_id`
 * instead swaps that BOM line for the product through the replacement transaction (#48); the
 * line's phrase, kind, and placement carry over and `actor` lands on the Decision row.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json()) as { url?: string; category?: string; kind?: unknown; replace_bom_item_id?: string; actor?: string; catalog?: { url?: string; variants?: { seller?: { domain?: string }; url?: string }[] } };
  const category = body.category?.trim() || undefined;
  const givenKind = Kind.safeParse(body.kind);
  const kind = givenKind.success ? givenKind.data : undefined;
  try {
    if (body.url) {
      const url = body.url;
      await withSpan(id, { kind: "domain", name: "ingest_product_url", prd_ref: "PRD 7.2", input: { url, category: category ?? null, kind: kind ?? null } }, async (span) => {
        const result = await ingestProductUrl(s.store, { projectId: id, url, category, kind, inferKind: async (name) => (await inferKind(name)).kind, client: s.client, merchantFromUrl: (u) => new URL(u).host });
        span.setOutput({ product_id: result.product.id, candidate_id: result.candidate.id, spatial_status: result.product.spatial_status, budget: result.budget });
      });
    } else if (body.catalog && body.replace_bom_item_id) {
      const oldItemId = body.replace_bom_item_id;
      const old = s.store.bomItems.get(oldItemId);
      if (!old || old.project_id !== id) return NextResponse.json({ error: `BOM item ${oldItemId} not in project ${id}` }, { status: 404 });
      const variant = body.catalog.variants?.[0];
      const merchant = variant?.seller?.domain ?? "catalog.shopify.com";
      const sourceUrl = body.catalog.url ?? variant?.url ?? `https://${merchant}/`;
      await withSpan(id, { kind: "domain", name: "swap_product", prd_ref: "PRD 8.5", input: { bom_item_id: oldItemId, name: old.category, item_kind: old.kind, merchant, source_url: sourceUrl } }, (span) => {
        const swapped = swapCatalogProduct(id, body.catalog, oldItemId, merchant, sourceUrl, body.actor?.trim() || "member");
        span.setOutput({ old_product_id: old.product_id, new_item_id: swapped.new_item_id, product_id: swapped.product.id, decision_id: swapped.decision_id, version: swapped.version, budget: swapped.budget });
      });
    } else if (body.catalog && category) {
      const variant = body.catalog.variants?.[0];
      const merchant = variant?.seller?.domain ?? "catalog.shopify.com";
      const sourceUrl = body.catalog.url ?? variant?.url ?? `https://${merchant}/`;
      const resolvedKind = kind ?? (await inferKind(category)).kind;
      await withSpan(id, { kind: "domain", name: "add_catalog_product", prd_ref: "PRD 7.2", input: { category, item_kind: resolvedKind, merchant, source_url: sourceUrl } }, (span) => {
        const added = addCatalogProduct(id, body.catalog, category, resolvedKind, merchant, sourceUrl);
        span.setOutput({ product_id: added.product.id, candidate_id: added.candidate.id, spatial_status: added.product.spatial_status, budget: added.budget });
      });
    } else {
      return NextResponse.json({ error: "Provide url, or catalog and the item's name as category" }, { status: 400 });
    }
    return NextResponse.json(snapshot(id), { status: 201 });
  } catch (e) {
    recordIssue(id, { source: "domain products", severity: "error", message: `Adding a product to the project failed (${(e as Error).message}); nothing was added, so check the URL or pick another result.` });
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
