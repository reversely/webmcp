import { NextResponse } from "next/server";
import { estimateRoom } from "../../../../../agent/compile";

/** Model-backed room estimate (PRD 20, stage 2). Body: { text }. Returns { estimate } with null on model failure so the client's regex estimate stays the fallback. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const estimate = body.text?.trim() ? await estimateRoom(body.text.trim()) : null;
  return NextResponse.json({ estimate });
}
