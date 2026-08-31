import { NextResponse } from "next/server";
import { runCurationAgent } from "../../../../../agent/curation-agent";
import { BadRequestError, errorResponse, requireEvent } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };

/**
 * One CurationAgent turn (#120). Body: { message: string }. Returns { response, proposal?,
 * tool_calls, trace_id? }; with ?stream=1 the same run arrives as NDJSON lines, one
 * { kind: "tool", tool, label } per tool start and a final { kind: "done", ...result }, so the
 * page can name the current tool activity while the model works.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const event = requireEvent((await params).id);
    const body = (await request.json()) as { message?: string };
    const message = body.message?.trim();
    if (!message) throw new BadRequestError("Send a message.");
    if (new URL(request.url).searchParams.get("stream") === "1") return streamRun(event.id, message);
    return NextResponse.json(await runCurationAgent({ eventId: event.id }, message));
  } catch (e) {
    return errorResponse(e);
  }
}

function streamRun(eventId: string, message: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      runCurationAgent({ eventId }, message, { onTool: (call) => send({ kind: "tool", ...call }) })
        .then((result) => send({ kind: "done", ...result }))
        .catch((e) => send({ kind: "error", error: e instanceof Error ? e.message : String(e) }))
        .finally(() => controller.close());
    }
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
