import { NextResponse } from "next/server";
import { appState, snapshot } from "../../../../../server/state";
import { addToBom, approveBomItem, removeFromBom } from "../../../../../domain/bom";

type Params = { params: Promise<{ id: string }> };

/** Body: { bomItemId, action: "add" | "remove" | "approve" } (PRD 18 update_bom). */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  const body = (await request.json()) as { bomItemId: string; action: "add" | "remove" | "approve" };
  const item = s.store.bomItems.get(body.bomItemId);
  if (!item || item.project_id !== id) return NextResponse.json({ error: `BOM item ${body.bomItemId} not in project ${id}` }, { status: 404 });
  const ops = { add: addToBom, remove: removeFromBom, approve: approveBomItem } as const;
  const op = ops[body.action];
  if (!op) return NextResponse.json({ error: `Unknown action ${body.action}` }, { status: 400 });
  op(s.store, body.bomItemId);
  return NextResponse.json(snapshot(id));
}
