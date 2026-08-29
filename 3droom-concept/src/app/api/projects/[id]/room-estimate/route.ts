import { NextResponse } from "next/server";
import { estimateRoom } from "../../../../../agent/compile";
import { withSpan } from "../../../../../server/trace";

type Params = { params: Promise<{ id: string }> };

/** Model-backed room estimate (PRD 20, stage 2). Body: { text }. Returns { estimate } with null on model failure so the client's regex estimate stays the fallback. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  const estimate = text ? await withSpan(id, { kind: "domain", name: "estimate_room", prd_ref: "PRD 20", input: { text } }, () => estimateRoom(text)) : null;
  return NextResponse.json({ estimate });
}
