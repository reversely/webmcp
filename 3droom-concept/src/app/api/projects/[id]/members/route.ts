import { NextResponse } from "next/server";
import { appState, membersFor } from "../../../../../server/state";

type Params = { params: Promise<{ id: string }> };

/** The project's members with their last heartbeat and board cursor; the client dims a chip after 15 s of silence. */
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  if (!appState().store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  return NextResponse.json({
    members: membersFor(id).map((m) => ({ id: m.id, display_name: m.display_name, role: m.role, stage: m.stage, last_seen: m.last_seen, cursor: m.cursor })),
    now: new Date().toISOString()
  });
}
