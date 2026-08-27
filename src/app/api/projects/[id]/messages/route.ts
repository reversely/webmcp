import { NextResponse } from "next/server";
import { appState, pushMessage, snapshot } from "../../../../../server/state";

type Params = { params: Promise<{ id: string }> };

/**
 * Project-scoped chat (PRD 8). Without an OpenAI key the reply is a placeholder that names what
 * the PlanningAgent would do; the Agents SDK loop replaces this in #20.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json()) as { author: string; text: string };
  pushMessage(id, { role: "user", author: body.author, text: body.text });
  pushMessage(id, {
    role: "agent",
    author: "PlanningAgent",
    text: process.env.OPENAI_API_KEY
      ? "The PlanningAgent loop is not wired yet (#20)."
      : "No OPENAI_API_KEY is set, so the PlanningAgent cannot run. Use the search panel to source products directly."
  });
  return NextResponse.json(snapshot(id).messages);
}
