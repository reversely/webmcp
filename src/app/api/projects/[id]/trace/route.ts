import { NextResponse } from "next/server";
import { appState } from "../../../../../server/state";
import { readTrace, recordSpan, type SpanKind } from "../../../../../server/trace";

type Params = { params: Promise<{ id: string }> };

const KINDS: SpanKind[] = ["agent_run", "tool", "catalog", "storefront", "model", "three_d", "webmcp", "domain", "step"];

/** Spans and issues written after `?since=<cursor>` (PRD 24); the response carries the next cursor. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  if (!appState().store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
  return NextResponse.json(readTrace(id, Number.isFinite(since) ? since : 0));
}

/** A span that finished in the browser, e.g. one WebMCP tool execution. Body: { kind, name, input, output, status, error?, duration_ms? }. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!appState().store.projects.has(id)) return NextResponse.json({ error: `Project ${id} not found` }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { kind?: string; name?: string; input?: unknown; output?: unknown; status?: string; error?: string; duration_ms?: number } | null;
  if (!body || !body.name || !KINDS.includes(body.kind as SpanKind)) return NextResponse.json({ error: "kind and name are required" }, { status: 400 });
  const span = recordSpan(id, {
    kind: body.kind as SpanKind,
    name: body.name,
    input: body.input,
    output: body.output,
    status: body.status === "error" ? "error" : "ok",
    error: body.error,
    duration_ms: typeof body.duration_ms === "number" ? body.duration_ms : undefined
  });
  return NextResponse.json({ id: span.id }, { status: 201 });
}
