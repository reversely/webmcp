import { NextResponse } from "next/server";
import { Kind } from "../../../../../../domain/types";
import { setKind } from "../../../../../../agent/kinds";
import { appState, setCandidateKind, snapshot } from "../../../../../../server/state";

type Params = { params: Promise<{ id: string; candidateId: string }> };

/**
 * Changes a candidate's rendering kind (PRD 20: the kind the agent inferred is editable by a
 * person). Body: { kind }. The BOM item carrying the same product follows, and the item's phrase
 * keeps the new kind for later sourcing. Returns the project snapshot.
 */
export async function PUT(request: Request, { params }: Params) {
  const { id, candidateId } = await params;
  if (!appState().store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown };
  const kind = Kind.safeParse(body.kind);
  if (!kind.success) return NextResponse.json({ error: `kind must be one of ${Kind.options.join(", ")}` }, { status: 400 });
  const candidate = setCandidateKind(id, candidateId, kind.data);
  if (!candidate) return NextResponse.json({ error: `Candidate ${candidateId} not found in project ${id}` }, { status: 404 });
  setKind(candidate.category, { kind: kind.data, query: candidate.category });
  return NextResponse.json(snapshot(id));
}
