import { NextResponse } from "next/server";
import { Kind } from "../../../../../../domain/types";
import { NotFoundError, removeFromBom, setItemKind } from "../../../../../../domain/bom";
import { kindFor, setKind } from "../../../../../../agent/kinds";
import { appState, renameProjectItem, snapshot } from "../../../../../../server/state";
import { withSpanSync } from "../../../../../../server/trace";

type Params = { params: Promise<{ id: string; bomItemId: string }> };

function itemIn(projectId: string, bomItemId: string) {
  const item = appState().store.bomItems.get(bomItemId);
  return item && item.project_id === projectId ? item : null;
}

/**
 * Edits one item's identity in place (#48, PRD 20). Body: { name?, kind? }. `name` renames the BOM
 * line, its candidates, the required_item row, and the layout rules that name it; `kind` changes
 * the rendering kind on the line and its candidate. Each edit is one domain span. Returns the
 * project snapshot.
 */
export async function PUT(request: Request, { params }: Params) {
  const { id, bomItemId } = await params;
  const item = itemIn(id, bomItemId);
  if (!item) return NextResponse.json({ error: `BOM item ${bomItemId} not in project ${id}` }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; kind?: unknown };
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
  const kind = body.kind === undefined ? null : Kind.safeParse(body.kind);
  if (kind && !kind.success) return NextResponse.json({ error: `kind must be one of ${Kind.options.join(", ")}` }, { status: 400 });
  if (body.name === undefined && !kind) return NextResponse.json({ error: "Provide name or kind" }, { status: 400 });
  try {
    if (typeof body.name === "string") {
      const name = body.name;
      withSpanSync(id, { kind: "domain", name: "rename_item", prd_ref: "PRD 20", input: { bom_item_id: bomItemId, name } }, (span) => {
        const result = renameProjectItem(id, bomItemId, name);
        span.setOutput({ old_name: result.old_name, name: result.name, product_id: result.item.product_id });
      });
    }
    if (kind?.success) {
      const next = kind.data;
      withSpanSync(id, { kind: "domain", name: "set_item_kind", prd_ref: "PRD 20", input: { bom_item_id: bomItemId, item_kind: next } }, (span) => {
        const updated = setItemKind(appState().store, bomItemId, next);
        setKind(updated.category, { kind: next, query: kindFor(updated.category).query });
        span.setOutput({ name: updated.category, item_kind: updated.kind, product_id: updated.product_id });
      });
    }
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
  return NextResponse.json(snapshot(id));
}

/** Removes the item from the BOM and drops its placement (#48); the row stays for `update_bom add` to restore. */
export async function DELETE(_: Request, { params }: Params) {
  const { id, bomItemId } = await params;
  const item = itemIn(id, bomItemId);
  if (!item) return NextResponse.json({ error: `BOM item ${bomItemId} not in project ${id}` }, { status: 404 });
  withSpanSync(id, { kind: "domain", name: "remove_item", prd_ref: "PRD 8.1", input: { bom_item_id: bomItemId, name: item.category } }, (span) => {
    const changed = removeFromBom(appState().store, bomItemId);
    span.setOutput({ changed, product_id: item.product_id });
  });
  return NextResponse.json(snapshot(id));
}
