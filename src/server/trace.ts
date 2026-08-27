/**
 * In-memory per-project trace (PRD 24): one span per agent run, tool call, catalog or storefront
 * request, model call, 3D request, WebMCP tool execution, domain operation, and PRD 9 step, plus
 * an issue list of plain sentences a person can act on. Spans nest through AsyncLocalStorage so a
 * catalog call made inside a tool inside an agent run records the chain without plumbing ids.
 *
 * Kept on `globalThis` like the app state so dev-server module reloads keep the history. Reads are
 * incremental: every write bumps `seq`, and `read(projectId, since)` returns what changed after it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type SpanKind = "agent_run" | "tool" | "catalog" | "storefront" | "model" | "three_d" | "webmcp" | "domain" | "step";
export type SpanStatus = "running" | "ok" | "error";

export type Span = {
  id: string;
  project_id: string;
  parent_id?: string;
  kind: SpanKind;
  name: string;
  /** Where the PRD describes this work, e.g. "PRD 9 step 3". */
  prd_ref?: string;
  input: unknown;
  output: unknown;
  status: SpanStatus;
  error?: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  /** Write sequence; bumps on start and on end so an incremental read sees both. */
  seq: number;
};

export type Issue = {
  id: string;
  project_id: string;
  at: string;
  /** Span kind and name, e.g. "storefront create_checkout". */
  source: string;
  message: string;
  detail?: string;
  severity: "warning" | "error";
  seq: number;
};

export type SpanMeta = { kind: SpanKind; name: string; prd_ref?: string; input?: unknown };

/** Handed to the function under a span so it can set the recorded output independently of its return value. */
export type SpanHandle = { id: string; setOutput(value: unknown): void };

type TraceStore = {
  spans: Map<string, Span[]>;
  issues: Map<string, Issue[]>;
  seq: number;
  nextId: number;
};

type Frame = { projectId: string; spanId?: string };

declare global {
  // eslint-disable-next-line no-var
  var __plannerTrace: TraceStore | undefined;
  // eslint-disable-next-line no-var
  var __plannerTraceContext: AsyncLocalStorage<Frame> | undefined;
}

/** Bytes of serialized JSON kept per input or output. */
export const TRIM_BYTES = 2048;
/** Characters kept from any one string inside an input or output. */
const STRING_LIMIT = 240;
/** Fields that carry merchant prose; cut harder so a product object still fits the budget. */
const MERCHANT_FIELDS = new Set(["untrusted_merchant_text", "description", "tech_specs", "policyText", "policy_text", "html", "plain"]);
const MERCHANT_LIMIT = 120;
/** Spans kept per project; the oldest go first. */
const MAX_SPANS = 2000;
const MAX_ISSUES = 500;
/** Project id for spans recorded outside any project context. */
export const NO_PROJECT = "_none";

function store(): TraceStore {
  if (!globalThis.__plannerTrace) globalThis.__plannerTrace = { spans: new Map(), issues: new Map(), seq: 0, nextId: 1 };
  return globalThis.__plannerTrace;
}

function context(): AsyncLocalStorage<Frame> {
  if (!globalThis.__plannerTraceContext) globalThis.__plannerTraceContext = new AsyncLocalStorage<Frame>();
  return globalThis.__plannerTraceContext;
}

export function resetTrace(): void {
  globalThis.__plannerTrace = undefined;
}

/** The project of the innermost open span, when the caller has no id of its own. */
export function currentProjectId(): string | null {
  return context().getStore()?.projectId ?? null;
}

export function currentSpanId(): string | null {
  return context().getStore()?.spanId ?? null;
}

/** Runs `fn` with `projectId` as the ambient project, so nested spans without an id attach to it. */
export function withProject<T>(projectId: string, fn: () => T): T {
  return context().run({ projectId, spanId: context().getStore()?.spanId }, fn);
}

/**
 * Cuts a value down to what a trace row can show: long strings truncated (merchant prose harder),
 * then the whole thing capped at TRIM_BYTES of JSON. Never throws; an unserializable value becomes
 * its String form.
 */
export function trim(value: unknown): unknown {
  const shrunk = shrink(value, 0, undefined);
  let json: string;
  try {
    json = JSON.stringify(shrunk) ?? "null";
  } catch {
    return String(value).slice(0, TRIM_BYTES);
  }
  if (json.length <= TRIM_BYTES) return shrunk;
  return { _truncated: true, bytes: json.length, preview: json.slice(0, TRIM_BYTES) };
}

function shrink(value: unknown, depth: number, key: string | undefined): unknown {
  if (typeof value === "string") {
    const limit = key !== undefined && MERCHANT_FIELDS.has(key) ? MERCHANT_LIMIT : STRING_LIMIT;
    return value.length > limit ? `${value.slice(0, limit)}… (+${value.length - limit} chars)` : value;
  }
  if (value === null || typeof value !== "object") return value instanceof Error ? value.message : value;
  if (value instanceof Error) return { error: value.message };
  if (depth >= 6) return "[nested]";
  if (Array.isArray(value)) {
    const head = value.slice(0, 20).map((v) => shrink(v, depth + 1, key));
    return value.length > 20 ? [...head, `… ${value.length - 20} more`] : head;
  }
  if (value instanceof Map || value instanceof Set) return `[${value.constructor.name} of ${value.size}]`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = shrink(v, depth + 1, k);
  return out;
}

function push<T>(map: Map<string, T[]>, projectId: string, row: T, cap: number): void {
  const list = map.get(projectId) ?? [];
  list.push(row);
  if (list.length > cap) list.splice(0, list.length - cap);
  map.set(projectId, list);
}

/** Opens a running span; `endSpan` closes it. Prefer `withSpan` unless the end is somewhere else. */
export function startSpan(projectId: string, meta: SpanMeta, parentId?: string): Span {
  const s = store();
  const span: Span = {
    id: `sp_${s.nextId++}`,
    project_id: projectId,
    ...(parentId ? { parent_id: parentId } : {}),
    kind: meta.kind,
    name: meta.name,
    ...(meta.prd_ref ? { prd_ref: meta.prd_ref } : {}),
    input: trim(meta.input ?? null),
    output: null,
    status: "running",
    started_at: new Date().toISOString(),
    seq: ++s.seq
  };
  push(s.spans, projectId, span, MAX_SPANS);
  return span;
}

export function endSpan(span: Span, outcome: { status: "ok"; output?: unknown } | { status: "error"; error: string; output?: unknown }): Span {
  const s = store();
  const ended = new Date();
  span.status = outcome.status;
  span.output = trim(outcome.output ?? null);
  if (outcome.status === "error") span.error = outcome.error;
  span.ended_at = ended.toISOString();
  span.duration_ms = Math.max(0, ended.getTime() - Date.parse(span.started_at));
  span.seq = ++s.seq;
  return span;
}

/**
 * Records `fn` as a span under the current one. The return value is the output unless `fn` set one
 * through the handle; a throw ends the span as `error` and is rethrown.
 */
export async function withSpan<T>(projectId: string | null, meta: SpanMeta, fn: (span: SpanHandle) => Promise<T> | T): Promise<T> {
  const ctx = context();
  const frame = ctx.getStore();
  const pid = projectId ?? frame?.projectId ?? NO_PROJECT;
  const span = startSpan(pid, meta, frame?.spanId);
  const explicit: { set: boolean; value: unknown } = { set: false, value: undefined };
  const handle: SpanHandle = {
    id: span.id,
    setOutput: (value) => {
      explicit.set = true;
      explicit.value = value;
    }
  };
  try {
    const result = await ctx.run({ projectId: pid, spanId: span.id }, () => fn(handle));
    endSpan(span, { status: "ok", output: explicit.set ? explicit.value : result });
    return result;
  } catch (e) {
    endSpan(span, { status: "error", error: e instanceof Error ? e.message : String(e), output: explicit.set ? explicit.value : undefined });
    throw e;
  }
}

/** `withSpan` for synchronous work; the span still nests under the current one. */
export function withSpanSync<T>(projectId: string | null, meta: SpanMeta, fn: (span: SpanHandle) => T): T {
  const ctx = context();
  const frame = ctx.getStore();
  const pid = projectId ?? frame?.projectId ?? NO_PROJECT;
  const span = startSpan(pid, meta, frame?.spanId);
  const explicit: { set: boolean; value: unknown } = { set: false, value: undefined };
  const handle: SpanHandle = {
    id: span.id,
    setOutput: (value) => {
      explicit.set = true;
      explicit.value = value;
    }
  };
  try {
    const result = ctx.run({ projectId: pid, spanId: span.id }, () => fn(handle));
    endSpan(span, { status: "ok", output: explicit.set ? explicit.value : result });
    return result;
  } catch (e) {
    endSpan(span, { status: "error", error: e instanceof Error ? e.message : String(e), output: explicit.set ? explicit.value : undefined });
    throw e;
  }
}

/** Records a span that already finished elsewhere, e.g. a WebMCP call reported by the browser; nests under the current span if any. */
export function recordSpan(projectId: string, row: SpanMeta & { output?: unknown; status: "ok" | "error"; error?: string; duration_ms?: number; started_at?: string }): Span {
  const s = store();
  const started = row.started_at ?? new Date(Date.now() - (row.duration_ms ?? 0)).toISOString();
  const ended = new Date(Date.parse(started) + (row.duration_ms ?? 0));
  const timed = row.duration_ms !== undefined;
  const parentId = currentSpanId();
  const span: Span = {
    id: `sp_${s.nextId++}`,
    project_id: projectId,
    ...(parentId ? { parent_id: parentId } : {}),
    kind: row.kind,
    name: row.name,
    ...(row.prd_ref ? { prd_ref: row.prd_ref } : {}),
    input: trim(row.input ?? null),
    output: trim(row.output ?? null),
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    started_at: started,
    ended_at: ended.toISOString(),
    ...(timed ? { duration_ms: row.duration_ms } : {}),
    seq: ++s.seq
  };
  push(s.spans, projectId, span, MAX_SPANS);
  return span;
}

/** Adds an issue. `message` is one plain sentence saying what happened and what it means for the project. */
export function recordIssue(projectId: string | null, issue: { source: string; message: string; detail?: string; severity?: "warning" | "error" }): Issue {
  const s = store();
  const pid = projectId ?? currentProjectId() ?? NO_PROJECT;
  const row: Issue = {
    id: `is_${s.nextId++}`,
    project_id: pid,
    at: new Date().toISOString(),
    source: issue.source,
    message: issue.message,
    ...(issue.detail ? { detail: issue.detail.slice(0, 1000) } : {}),
    severity: issue.severity ?? "warning",
    seq: ++s.seq
  };
  push(s.issues, pid, row, MAX_ISSUES);
  return row;
}

export type TraceRead = { spans: Span[]; issues: Issue[]; cursor: number };

/** Everything written after `since` (a cursor from an earlier read; 0 for all), oldest first. */
export function readTrace(projectId: string, since = 0): TraceRead {
  const s = store();
  const spans = (s.spans.get(projectId) ?? []).filter((sp) => sp.seq > since);
  const issues = (s.issues.get(projectId) ?? []).filter((is) => is.seq > since);
  return { spans, issues, cursor: s.seq };
}

export function spansFor(projectId: string): Span[] {
  return [...(store().spans.get(projectId) ?? [])];
}

export function issuesFor(projectId: string): Issue[] {
  return [...(store().issues.get(projectId) ?? [])];
}
