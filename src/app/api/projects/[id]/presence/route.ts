import { NextResponse } from "next/server";
import { appState, touchMember } from "../../../../../server/state";

type Params = { params: Promise<{ id: string }> };

/** Heartbeat. Body: { member_id, stage }. 404 when the project or the member is gone, which after a server restart is every member. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!appState().store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { member_id?: string; stage?: string | null };
  if (typeof body.member_id !== "string") return NextResponse.json({ error: "member_id is required" }, { status: 400 });
  if (!touchMember(id, body.member_id, typeof body.stage === "string" ? body.stage : null)) {
    return NextResponse.json({ error: `Member ${body.member_id} is not in project ${id}` }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
