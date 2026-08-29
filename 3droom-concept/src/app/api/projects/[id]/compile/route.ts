import { NextResponse } from "next/server";
import { compileSpec } from "../../../../../agent/compile";
import { withSpan } from "../../../../../server/trace";

type Params = { params: Promise<{ id: string }> };

/** Model-backed board compilation (PRD 16). Body: { boardText: string[], swatches: string[] }. Returns { spec } with null on model failure so the client's rule-based compiler stays the fallback. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const raw = (await request.json().catch(() => ({}))) as { boardText?: string[] | string; swatches?: string[] };
  // Accept a newline-joined string as well as an array, so a client shape drift degrades to a working call.
  const body = { boardText: Array.isArray(raw.boardText) ? raw.boardText : typeof raw.boardText === "string" ? raw.boardText.split("\n").filter(Boolean) : [], swatches: raw.swatches ?? [] };
  const spec = await withSpan(id, { kind: "domain", name: "compile_spec", prd_ref: "PRD 16", input: { board_text: body.boardText ?? [], swatches: body.swatches ?? [] } }, () => compileSpec(body.boardText ?? [], body.swatches ?? []));
  return NextResponse.json({ spec });
}
