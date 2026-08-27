import { NextResponse } from "next/server";
import { addCatalogProduct, appState, snapshot } from "../../../../../server/state";
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
      await ingestProductUrl(s.store, {
        projectId: id,
        url: body.url,
        category: body.category,
        client: s.client,
        merchantFromUrl: (u) => new URL(u).host
      });
    } else if (body.catalog && body.category) {
      const variant = body.catalog.variants?.[0];
      const merchant = variant?.seller?.domain ?? "catalog.shopify.com";
      const sourceUrl = body.catalog.url ?? variant?.url ?? `https://${merchant}/`;
      addCatalogProduct(id, body.catalog, body.category, merchant, sourceUrl);
    } else {
      return NextResponse.json({ error: "Provide url, or catalog and category" }, { status: 400 });
    }
    return NextResponse.json(snapshot(id), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
