import { NextResponse } from "next/server";
import { appState, geometryFor, snapshot } from "../../../../../server/state";
import type { Placement } from "../../../../../domain/types";

type Params = { params: Promise<{ id: string }> };

/**
 * Replaces the project's placements. Body: { placements: [{ bom_item_id, x_mm, y_mm, rotation_deg }] }.
 * Returns the snapshot plus the geometry check for the new layout.
 */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  const body = (await request.json()) as { placements: { bom_item_id: string; x_mm: number; y_mm: number; rotation_deg: number }[] };
  const space = [...s.spaces.values()].find((sp) => sp.project_id === id);
  if (!space) return NextResponse.json({ error: "Project has no space yet" }, { status: 409 });
  const byItem = new Map([...s.store.placements.values()].map((p) => [p.bom_item_id, p]));
  for (const p of body.placements) {
    const item = s.store.bomItems.get(p.bom_item_id);
    if (!item || item.project_id !== id) continue;
    const existing = byItem.get(p.bom_item_id);
    const row: Placement = { id: existing?.id ?? s.store.newId("pl"), space_id: space.id, bom_item_id: p.bom_item_id, x_mm: Math.round(p.x_mm), y_mm: Math.round(p.y_mm), z_mm: 0, rotation_deg: p.rotation_deg };
    s.store.placements.set(row.id, row);
  }
  return NextResponse.json({ ...snapshot(id), geometry: geometryFor(id) });
}

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  return NextResponse.json({ placements: snapshot(id).placements, geometry: geometryFor(id) });
}
