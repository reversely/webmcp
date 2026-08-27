import { NextResponse } from "next/server";
import { compileSpec } from "../../../../../agent/compile";

/** Model-backed board compilation (PRD 16). Body: { boardText: string[], swatches: string[] }. Returns { spec } with null on model failure so the client's rule-based compiler stays the fallback. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { boardText?: string[]; swatches?: string[] };
  const spec = await compileSpec(body.boardText ?? [], body.swatches ?? []);
  return NextResponse.json({ spec });
}
