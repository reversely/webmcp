import { NextResponse } from "next/server";
import { appState, snapshot } from "../../../../../../server/state";
import { NotFoundError, VersionMismatchError, replaceBomItem } from "../../../../../../domain/bom";

type Params = { params: Promise<{ id: string }> };

/**
 * The replacement transaction (PRD 8.5, 19). Body: { existingBomItemId, replacementProductId }.
 * The transaction runs against the project's current version; a concurrent write between the read
 * and the commit answers 409.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  const body = (await request.json().catch(() => ({}))) as { existingBomItemId?: string; replacementProductId?: string };
  if (typeof body.existingBomItemId !== "string" || typeof body.replacementProductId !== "string") {
    return NextResponse.json({ error: "Provide existingBomItemId and replacementProductId" }, { status: 400 });
  }
  try {
    const project = s.store.getProject(id);
    replaceBomItem(s.store, {
      projectId: id,
      expectedVersion: project.version,
      oldItemId: body.existingBomItemId,
      newProductId: body.replacementProductId,
      actor: "zach"
    });
    return NextResponse.json(snapshot(id));
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof VersionMismatchError) return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
