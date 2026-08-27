"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { ProjectSnapshot } from "../../../server/state";
import { formatMoney } from "../../../domain/money";
import { formatFeetInches } from "../../../domain/types";
import { ArtifactView, type ArtifactMessage } from "./artifacts";
import { useAnimatedNumber } from "./artifacts/animated-number";
import { modelTagFor } from "./components/model-stage-strip";
import { TracePanel } from "./trace-panel";
import { ANONYMOUS, useIdentity } from "../../identity";

type Snapshot = Omit<ProjectSnapshot, "messages"> & { messages: ArtifactMessage[] };


/**
 * Right column from stage 2 onward: the BOM and budget rail, then the project chat. Polls the
 * snapshot every few seconds until realtime (#18) replaces it. Messages carry optional artifacts
 * (PRD 9.2, 13.1, 5.2) that render as cards in the stream.
 */
export function SidePanel({ projectId, children }: { projectId: string; children: ReactNode }) {
  const pathname = usePathname();
  const wide = pathname.endsWith("/board");
  const identity = useIdentity(projectId);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusedQuestion = useRef<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (res.ok) setSnap((await res.json()) as Snapshot);
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    const onChange = () => refresh();
    window.addEventListener("project:changed", onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener("project:changed", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function send(text: string) {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      await fetch(`/api/projects/${projectId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: identity?.display_name ?? ANONYMOUS, text: body }) });
      await refresh();
    } finally {
      setSending(false);
    }
  }

  const messages = snap?.messages ?? [];
  const last = messages[messages.length - 1];

  // Auto-scroll to the newest message, and to an artifact that changed in place.
  const lastKey = last ? `${last.id}:${JSON.stringify(last.artifact ?? null).length}` : "";
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastKey]);

  // A new question artifact focuses the input once (PRD 5.2: the next message answers it).
  useEffect(() => {
    const q = last?.artifact?.kind === "question" ? last.artifact.id : null;
    if (q && q !== focusedQuestion.current) {
      focusedQuestion.current = q;
      inputRef.current?.focus();
    }
  }, [last]);

  const committed = useAnimatedNumber(snap ? snap.budget.committed_cents : null);
  const lines = snap?.bom.filter((b) => b.status !== "removed") ?? [];
  const over = snap?.budget.state === "over";

  return (
    <div className={`frame${wide ? " wide" : ""}`}>
      <main className="centre">{children}</main>
      {!wide && (
        <aside className="side">
          <section className="rail" aria-label="Bill of materials" data-testid="bom-rail">
            <div className="eyebrow">Budget</div>
            <div className={`stat${over ? " over" : ""}`} data-testid="budget-stat" data-state={snap?.budget.state}>
              {snap && committed !== null ? `${formatMoney(committed)} / ${formatMoney(snap.budget.budget_cents)}` : "—"}
            </div>
            {over && (
              <span className="tag red appear" key={snap!.budget.overage_cents}>
                {formatMoney(snap!.budget.overage_cents)} over
              </span>
            )}
            <div className="rail-lines">
              {lines.length === 0 && <div className="empty">No items in the BOM yet.</div>}
              {lines.map((b) => (
                <div className="rail-line" key={b.id}>
                  {b.product?.primary_image_url ? <img src={b.product.primary_image_url} alt="" /> : <div />}
                  <div>
                    <div>{b.product?.title ?? b.product_id}</div>
                    <div className="sub">
                      {b.category}
                      {b.product?.spatial_status === "grounded" && b.product.width_mm != null
                        ? ` · ${formatFeetInches(b.product.width_mm)} × ${formatFeetInches(b.product.depth_mm!)}`
                        : " · dimensions unknown"}
                    </div>
                    {b.product && modelTagFor(snap?.model_jobs?.[b.product.id], b.product.model_status) && (
                      <span className="tag" style={{ marginTop: 4 }} data-testid="model-tag">
                        {modelTagFor(snap?.model_jobs?.[b.product.id], b.product.model_status)}
                      </span>
                    )}
                  </div>
                  <div>{b.product ? formatMoney(b.product.price_cents * b.quantity, b.product.currency) : ""}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="chat" aria-label="Chat">
            <div className="rail" style={{ borderBottom: "1px solid var(--line)" }}>
              <div className="eyebrow">Chat</div>
            </div>
            <div className="chat-log" ref={logRef} data-testid="chat-log">
              {messages.map((m) => {
                if (m.artifact && (m.artifact.kind === "sourcing" || m.artifact.kind === "ranking" || m.artifact.kind === "question")) {
                  return (
                    <div key={m.id} className="msg-artifact" data-message-id={m.id}>
                      <ArtifactView artifact={m.artifact} title={m.text} products={snap?.products ?? []} onSend={send} sending={sending} />
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={`msg ${m.role}`} data-message-id={m.id}>
                    {m.role === "user" && <span className="who">{m.author}</span>}
                    {m.text}
                  </div>
                );
              })}
              {snap && messages.length === 0 && <div className="empty">Ask the planner for a room, or paste a product URL.</div>}
            </div>
            <form
              className="chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
            >
              <input ref={inputRef} className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the planner" aria-label="Message" data-testid="chat-input" />
              <button className="btn primary" type="submit" data-testid="chat-send" disabled={sending}>
                Send
              </button>
            </form>
          </section>
          <TracePanel projectId={projectId} />
        </aside>
      )}
    </div>
  );
}
