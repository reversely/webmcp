import { NextResponse } from "next/server";
import { appState, touchMember, type BoardCursor } from "../../../../../server/state";

type Params = { params: Promise<{ id: string }> };

function readCursor(value: unknown): BoardCursor | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Heartbeat. Body: { member_id, stage, cursor? }. `cursor` is the member's pointer on the board in
 * page coordinates (#18); absent off the board. 404 when the project or the member is gone, which
 * after a server restart is every member.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!appState().store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { member_id?: string; stage?: string | null; cursor?: unknown };
  if (typeof body.member_id !== "string") return NextResponse.json({ error: "member_id is required" }, { status: 400 });
  if (!touchMember(id, body.member_id, typeof body.stage === "string" ? body.stage : null, readCursor(body.cursor))) {
    return NextResponse.json({ error: `Member ${body.member_id} is not in project ${id}` }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
