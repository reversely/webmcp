import { NextResponse } from "next/server";
import { RequirementValueError, upsertRequirement } from "../../../../../server/requirements";
import { appState, snapshot } from "../../../../../server/state";
import { withSpan } from "../../../../../server/trace";
import type { Requirement } from "../../../../../domain/types";

type Params = { params: Promise<{ id: string }> };

const TYPES = new Set<Requirement["type"]>(["required_item", "visual_direction", "layout_requirement"]);

/**
 * Appends one agreed requirement or updates the one with the same key (#60). Body:
 * { type, value, created_by?, scope?, source? }. A required_item matches by name, a
 * layout_requirement by relation, subject, and objects; visual_direction replaces its single row.
 * Every other row keeps its status. Returns the project snapshot.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json()) as { type?: Requirement["type"]; value?: unknown; created_by?: string; scope?: string; source?: string };
  if (!body.type || !TYPES.has(body.type)) return NextResponse.json({ error: "type must be required_item, visual_direction, or layout_requirement" }, { status: 400 });
  try {
    await withSpan(id, { kind: "domain", name: "upsert_requirement", prd_ref: "PRD 16", input: { type: body.type, value: body.value, created_by: body.created_by ?? null } }, (span) => {
      const result = upsertRequirement(id, { type: body.type!, value: body.value, created_by: body.created_by?.trim() || "member", source: body.source ?? "webmcp", scope: body.scope });
      span.setOutput({ requirement_id: result.requirement.id, created: result.created, value: result.requirement.value_json });
    });
  } catch (e) {
    if (e instanceof RequirementValueError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json(snapshot(id), { status: 201 });
}
