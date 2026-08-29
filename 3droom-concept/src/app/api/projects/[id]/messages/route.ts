import { NextResponse } from "next/server";
import { primeAddressReply } from "../../../../../agent/address";
import { handleMessage } from "../../../../../agent/messages";
import { streamRun } from "../../../../../server/run-events";
import { appState } from "../../../../../server/state";

type Params = { params: Promise<{ id: string }> };

/** Sourcing runs many catalog, checkout, and model calls in one request; give it five minutes. */
export const maxDuration = 300;

/** A comment line on this interval keeps the connection open through a long tool call. */
const PING_MS = 15000;

/**
 * Project-scoped chat (PRD 5, 19). Runs the PlanningAgent to completion, or to a
 * `waiting_for_user` state. With `Accept: text/event-stream` the answer is a Server-Sent Events
 * stream of `text`, `tool`, `artifact`, `question`, and `done` (or `error`) events as the run
 * progresses (#19); otherwise (`Accept: application/json` or none) it is the message list once
 * the run ends.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json()) as { author?: string; text?: string };
  if (!body.text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });
  const author = body.author?.trim() || "member";
  const text = body.text.trim();
  // A run waiting for the address gets the model's reading of this reply cached before the
  // synchronous reply path in handleMessage resolves it (src/agent/address.ts).
  await primeAddressReply(id, text);

  if (!(request.headers.get("accept") ?? "").includes("text/event-stream")) {
    try {
      return NextResponse.json(await handleMessage(id, author, text));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away; the run finishes on its own and the message list keeps the result.
        }
      };
      const ping = setInterval(() => write(": ping\n\n"), PING_MS);
      streamRun(id, () => handleMessage(id, author, text), (event) => write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)).finally(() => {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
