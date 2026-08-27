import { NextResponse } from "next/server";
import { appState, createProject, projectCode, snapshot } from "../../../server/state";

/** Creates a project and its join code. Body: { name, budget_cents?, required_by? }. Returns the snapshot plus `code`. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { name?: string; budget_cents?: number; required_by?: string | null };
  const budget = Number(body.budget_cents);
  const { id, code } = createProject({
    name: body.name?.trim() || "Untitled project",
    budget_cents: Number.isFinite(budget) && budget > 0 ? Math.round(budget) : 250000,
    required_by: body.required_by || null
  });
  return NextResponse.json({ ...snapshot(id), code }, { status: 201 });
}

export async function GET() {
  const s = appState();
  return NextResponse.json([...s.store.projects.values()].map((p) => ({ id: p.id, name: p.name, code: projectCode(p.id), created_at: p.created_at })));
}
