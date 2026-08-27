import { NextResponse } from "next/server";
import { appState, snapshot } from "../../../../../server/state";
import { readRequiredItem, type Requirement, type Space } from "../../../../../domain/types";

type Params = { params: Promise<{ id: string }> };

/**
 * Writes the room (Space) and the agreed requirements (PRD 16). Body:
 * { space?: { width_mm, length_mm, height_mm? }, requirements?: [{ type, value, scope? }], board?: unknown, created_by?: string }
 * `created_by` is the display name of the person approving; it stamps every requirement row. A
 * `required_item` value is stored as { name, kind }; a bare string names the item with no kind yet.
 */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json()) as {
    space?: { width_mm: number; length_mm: number; height_mm?: number | null; name?: string };
    requirements?: { type: Requirement["type"]; value: unknown; scope?: string; source?: string }[];
    board?: unknown;
    created_by?: string;
  };
  const createdBy = body.created_by?.trim() || "member";
  if (body.space) {
    const existing = [...s.spaces.values()].find((sp) => sp.project_id === id);
    const space: Space = {
      id: existing?.id ?? s.store.newId("space"),
      project_id: id,
      name: body.space.name ?? existing?.name ?? "Living room",
      width_mm: Math.round(body.space.width_mm),
      length_mm: Math.round(body.space.length_mm),
      height_mm: body.space.height_mm == null ? null : Math.round(body.space.height_mm)
    };
    s.spaces.set(space.id, space);
  }
  if (body.requirements) {
    for (const r of [...s.requirements.values()]) if (r.project_id === id) s.requirements.set(r.id, { ...r, status: "superseded" });
    for (const r of body.requirements) {
      const value = r.type === "required_item" ? readRequiredItem(r.value) : r.value;
      if (value === null) continue;
      const row: Requirement = {
        id: s.store.newId("req"),
        project_id: id,
        scope: r.scope ?? "project",
        type: r.type,
        value_json: value,
        status: "agreed",
        source: r.source ?? "board",
        created_by: createdBy
      };
      s.requirements.set(row.id, row);
    }
  }
  if (body.board !== undefined) s.boards.set(id, body.board);
  return NextResponse.json(snapshot(id));
}

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  return NextResponse.json({ board: s.boards.get(id) ?? null, requirements: snapshot(id).requirements, space: snapshot(id).space });
}
