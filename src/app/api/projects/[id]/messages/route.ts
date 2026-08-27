import { NextResponse } from "next/server";
import { handleMessage } from "../../../../../agent/messages";
import { appState } from "../../../../../server/state";

type Params = { params: Promise<{ id: string }> };

/** Sourcing runs many catalog, checkout, and model calls in one request; give it five minutes. */
export const maxDuration = 300;

/**
 * Project-scoped chat (PRD 5, 19). Runs the PlanningAgent to completion, or to a
 * `waiting_for_user` state, and returns the message list; artifacts ride on messages.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json()) as { author?: string; text?: string };
  if (!body.text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });
  try {
    return NextResponse.json(await handleMessage(id, body.author?.trim() || "member", body.text.trim()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
