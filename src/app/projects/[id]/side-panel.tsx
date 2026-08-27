"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { ProjectSnapshot } from "../../../server/state";
import { formatFeetInches } from "../../../domain/types";

/**
 * Right column from stage 2 onward: the BOM and budget rail, then the project chat. Polls the
 * snapshot every few seconds until realtime (#18) replaces it.
 */
export function SidePanel({ projectId, children }: { projectId: string; children: ReactNode }) {
  const pathname = usePathname();
  const wide = pathname.endsWith("/board");
  const [snap, setSnap] = useState<ProjectSnapshot | null>(null);
  const [draft, setDraft] = useState("");

  async function refresh() {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (res.ok) setSnap((await res.json()) as ProjectSnapshot);
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

  async function send() {
    if (!draft.trim()) return;
    const text = draft;
    setDraft("");
    await fetch(`/api/projects/${projectId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: "Zach", text }) });
    refresh();
  }

  const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const lines = snap?.bom.filter((b) => b.status !== "removed") ?? [];

  return (
    <div className={`frame${wide ? " wide" : ""}`}>
      <main className="centre">{children}</main>
      {!wide && (
        <aside className="side">
          <section className="rail" aria-label="Bill of materials">
            <div className="eyebrow">Budget</div>
            <div className={`stat${snap?.budget.state === "over" ? " over" : ""}`}>
              {snap ? `${dollars(snap.budget.committed_cents)} / ${dollars(snap.budget.budget_cents)}` : "—"}
            </div>
            {snap?.budget.state === "over" && <span className="tag red">{dollars(snap.budget.overage_cents)} over</span>}
            <div className="rail-lines">
              {lines.length === 0 && <div className="empty">No items in the BOM yet.</div>}
              {lines.map((b) => (
                <div className="rail-line" key={b.id}>
                  {b.product?.primary_image_url ? <img src={b.product.primary_image_url} alt="" /> : <div />}
                  <div>
                    <div>{b.product?.title ?? b.product_id}</div>
                    <div className="sub">
                      {b.category.replace("_", " ")}
                      {b.product?.spatial_status === "grounded" && b.product.width_mm != null
                        ? ` · ${formatFeetInches(b.product.width_mm)} × ${formatFeetInches(b.product.depth_mm!)}`
                        : " · dimensions unknown"}
                    </div>
                  </div>
                  <div>{b.product ? dollars(b.product.price_cents * b.quantity) : ""}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="chat" aria-label="Chat">
            <div className="rail" style={{ borderBottom: "1px solid var(--line)" }}>
              <div className="eyebrow">Chat</div>
            </div>
            <div className="chat-log">
              {(snap?.messages ?? []).map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  <span className="who">{m.author}</span>
                  {m.text}
                </div>
              ))}
              {snap && snap.messages.length === 0 && <div className="empty">Ask the planner for a room, or paste a product URL.</div>}
            </div>
            <form
              className="chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the planner" aria-label="Message" />
              <button className="btn primary" type="submit">
                Send
              </button>
            </form>
          </section>
        </aside>
      )}
    </div>
  );
}
