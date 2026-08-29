import { NextResponse } from "next/server";
import { appState, snapshot } from "../../../../server/state";
import { NotFoundError } from "../../../../domain/bom";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  try {
    return NextResponse.json(snapshot(id));
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

/** Budget, required date, and delivery address (PRD 19). */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  const body = (await request.json()) as { budget_cents?: number; required_by?: string | null; delivery_address_json?: unknown; name?: string };
  const project = s.store.projects.get(id);
  if (!project) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  s.store.projects.set(id, {
    ...project,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.budget_cents !== undefined ? { budget_cents: body.budget_cents } : {}),
    ...(body.required_by !== undefined ? { required_by: body.required_by } : {}),
    ...(body.delivery_address_json !== undefined ? { delivery_address_json: body.delivery_address_json as never } : {}),
    version: project.version + 1
  });
  return NextResponse.json(snapshot(id));
}
