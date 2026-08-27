import { NextResponse } from "next/server";
import { appState, boardFor, snapshot } from "../../../../../server/state";
import { applyBoardChanges, boardChangesSince, boardSnapshot, type BoardChanges } from "../../../../../server/board";
import { readRequiredItem, type Requirement, type Space } from "../../../../../domain/types";

type Params = { params: Promise<{ id: string }> };

/**
 * Writes the room (Space), the agreed requirements (PRD 16), and board changes (#18). Body:
 * { space?: { width_mm, length_mm, height_mm? }, requirements?: [{ type, value, scope? }],
 *   board_changes?: { put: TLRecord[], remove: id[] }, since?: number, created_by?: string }
 * `created_by` is the display name of the person approving; it stamps every requirement row. A
 * `required_item` value is stored as { name, kind }; a bare string names the item with no kind yet.
 * `board_changes` merges record by record, last writer wins in arrival order; the answer carries
 * `board`: what other clients wrote after `since`, and the version this client now holds.
 */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json()) as {
    space?: { width_mm: number; length_mm: number; height_mm?: number | null; name?: string };
    requirements?: { type: Requirement["type"]; value: unknown; scope?: string; source?: string }[];
    board_changes?: BoardChanges;
    since?: number;
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
  if (body.board_changes) {
    const doc = boardFor(id);
    // Read the others' writes before applying this client's, so its own records do not echo back.
    const delta = boardChangesSince(doc, typeof body.since === "number" ? body.since : doc.version);
    delta.version = applyBoardChanges(doc, body.board_changes);
    return NextResponse.json({ board: delta });
  }
  return NextResponse.json(snapshot(id));
}

/**
 * The board, the requirements, and the space. With `?since=<version>` the board is a delta
 * (records put and ids removed after that version) instead of the whole document.
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const since = new URL(request.url).searchParams.get("since");
  if (since !== null) return NextResponse.json({ board: boardChangesSince(boardFor(id), Number(since) || 0) });
  const doc = s.boards.get(id);
  const snap = snapshot(id);
  return NextResponse.json({ board: doc && doc.version > 0 ? boardSnapshot(doc) : null, requirements: snap.requirements, space: snap.space });
}
