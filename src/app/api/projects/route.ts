import { NextResponse } from "next/server";
import { appState, snapshot } from "../../../server/state";

/** Creates a project. Body: { name, budget_cents?, required_by? }. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { name?: string; budget_cents?: number; required_by?: string };
  const s = appState();
  const id = s.store.newId("proj");
  s.store.insertProject({
    id,
    name: body.name?.trim() || "Untitled project",
    budget_cents: body.budget_cents ?? 250000,
    currency: "USD",
    required_by: body.required_by ?? null,
    delivery_address_json: null,
    created_at: new Date().toISOString()
  });
  return NextResponse.json(snapshot(id), { status: 201 });
}

export async function GET() {
  const s = appState();
  return NextResponse.json([...s.store.projects.values()].map((p) => ({ id: p.id, name: p.name, created_at: p.created_at })));
}
