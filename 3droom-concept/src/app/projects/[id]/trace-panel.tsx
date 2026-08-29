"use client";
import { useEffect, useRef, useState } from "react";
import type { Issue, Span, SpanKind, TraceRead } from "../../../server/trace";

const KINDS: SpanKind[] = ["agent_run", "tool", "step", "catalog", "storefront", "model", "three_d", "webmcp", "domain"];
const KIND_LABEL: Record<SpanKind, string> = {
  agent_run: "agent run",
  tool: "tool",
  step: "step",
  catalog: "catalog",
  storefront: "storefront",
  model: "model",
  three_d: "3D",
  webmcp: "webmcp",
  domain: "domain"
};

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour12: false });
/** A span reported after the fact (a model turn inside an SDK run) carries no timing; the cell says so instead of printing 0. */
function duration(span: Span): string {
  if (span.status === "running") return "running";
  if (span.duration_ms === undefined) return "not timed";
  return span.duration_ms < 1000 ? `${span.duration_ms} ms` : `${(span.duration_ms / 1000).toFixed(1)} s`;
}
const json = (value: unknown) => JSON.stringify(value ?? null, null, 2);

/** Nesting depth from the parent chain, so a child span indents under its parent in the newest-first list. */
function depthOf(span: Span, byId: Map<string, Span>): number {
  let depth = 0;
  let current = span;
  while (current.parent_id && byId.has(current.parent_id) && depth < 8) {
    current = byId.get(current.parent_id)!;
    depth += 1;
  }
  return depth;
}

/**
 * The developer trace of PRD 24 as a collapsible third section of the side panel: an issues strip,
 * a filter chip row by kind, and a newest-first table of spans that expand in place to show their
 * input and output. Polls `/trace?since=` every 3 s and merges by id, so a running span updates
 * when it ends.
 */
export function TracePanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [spans, setSpans] = useState<Map<string, Span>>(new Map());
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState<SpanKind | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const cursor = useRef(0);
  const openRowRef = useRef<HTMLTableRowElement | null>(null);

  // An opened row moves to the top of the list so its input and output sit right under it.
  useEffect(() => {
    openRowRef.current?.scrollIntoView({ block: "start" });
  }, [expanded]);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/projects/${projectId}/trace?since=${cursor.current}`, { cache: "no-store" });
        if (!res.ok || !alive) return;
        const read = (await res.json()) as TraceRead;
        cursor.current = read.cursor;
        if (read.spans.length > 0) {
          setSpans((prev) => {
            const next = new Map(prev);
            for (const span of read.spans) next.set(span.id, span);
            return next;
          });
        }
        if (read.issues.length > 0) {
          setIssues((prev) => {
            const seen = new Set(prev.map((i) => i.id));
            return [...prev, ...read.issues.filter((i) => !seen.has(i.id))];
          });
        }
      } catch {
        // The next tick retries; a missed poll loses nothing because `since` stays put.
      }
    }
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [projectId]);

  const byId = spans;
  const all = [...spans.values()].sort((a, b) => b.started_at.localeCompare(a.started_at) || b.seq - a.seq);
  const present = new Set(all.map((s) => s.kind));
  const rows = filter === "all" ? all : all.filter((s) => s.kind === filter);
  const running = all.filter((s) => s.status === "running").length;
  const errors = issues.filter((i) => i.severity === "error").length;

  return (
    <section className={`trace${open ? " open" : ""}`} aria-label="Trace" data-testid="trace-panel" data-open={open}>
      <button type="button" className="trace-head" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="trace-toggle">
        <span className="eyebrow">Trace</span>
        <span className="tag" data-testid="trace-count">
          {all.length} {all.length === 1 ? "span" : "spans"}
        </span>
        {running > 0 && <span className="tag blue">{running} running</span>}
        {issues.length > 0 && <span className={`tag ${errors > 0 ? "red" : "yellow"}`}>{issues.length} {issues.length === 1 ? "issue" : "issues"}</span>}
        <span className="trace-caret" aria-hidden="true">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="trace-body">
          <div className="issues" data-testid="issues-panel">
            {issues.length === 0 && <div className="issues-empty">No issues so far.</div>}
            {[...issues].reverse().map((issue) => (
              <div key={issue.id} className={`issue ${issue.severity}`} data-severity={issue.severity}>
                <span className={`tag ${issue.severity === "error" ? "red" : "yellow"}`}>{issue.severity}</span>
                <div>
                  <div className="issue-msg">{issue.message}</div>
                  <div className="issue-meta">
                    {issue.source}, {clock(issue.at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Filter by kind">
            <button type="button" className={`chip${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>
              All
            </button>
            {KINDS.filter((k) => present.has(k)).map((k) => (
              <button type="button" key={k} className={`chip${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="trace-table-wrap">
            <table className="trace-table">
              <colgroup>
                <col className="c-time" />
                <col className="c-kind" />
                <col />
                <col className="c-ref" />
                <col className="c-dur" />
              </colgroup>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Kind</th>
                  <th>Name</th>
                  <th title="Where the PRD describes this work">PRD</th>
                  <th className="num">Duration</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="trace-empty">
                      No spans recorded for this project yet. Send a message or search the catalog and the calls appear here.
                    </td>
                  </tr>
                )}
                {rows.map((span) => {
                  const isOpen = expanded === span.id;
                  const tone = span.status === "error" ? " red" : span.status === "running" ? " blue" : "";
                  return [
                    <tr
                      key={span.id}
                      className={`trace-row${isOpen ? " on" : ""}`}
                      data-testid="trace-row"
                      data-kind={span.kind}
                      data-status={span.status}
                      ref={isOpen ? openRowRef : undefined}
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : span.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpanded(isOpen ? null : span.id);
                        }
                      }}
                    >
                      <td className="mono-cell">{clock(span.started_at)}</td>
                      <td>
                        <span className={`tag${tone}`}>{KIND_LABEL[span.kind]}</span>
                      </td>
                      <td className="name-cell" style={{ paddingLeft: 4 + depthOf(span, byId) * 10 }} title={span.error ?? span.name}>
                        {span.name}
                      </td>
                      <td className="ref-cell" title={span.prd_ref}>{span.prd_ref?.replace("PRD ", "") ?? ""}</td>
                      <td className="num mono-cell">{duration(span)}</td>
                    </tr>,
                    isOpen && (
                      <tr key={`${span.id}-detail`} className="trace-detail">
                        <td colSpan={5}>
                          {span.error && <div className="trace-error">{span.error}</div>}
                          <div className="trace-json">
                            <div>
                              <div className="eyebrow">Input</div>
                              <pre>{json(span.input)}</pre>
                            </div>
                            <div>
                              <div className="eyebrow">Output</div>
                              <pre>{json(span.output)}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
