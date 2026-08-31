"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Batch, Design } from "../../../domain/types";
import { minute, money } from "../../format";

const POLL_MS = 4_000;

async function readJson<T>(url: string): Promise<T | { error: string }> {
  const res = await fetch(url);
  return res.json();
}

/**
 * The batch page keeps a copy of the record and refreshes it every four seconds and on `shop:changed`
 * (a tool's write). Order shows while no proof exists and Approve while a proof awaits approval; the
 * status text itself comes from the record and the shop's stages.
 */
export function BatchExperience({ id, email }: { id: string; email: string }) {
  const scope = email ? `?email=${encodeURIComponent(email)}` : "";
  const [batch, setBatch] = useState<Batch | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const b = await readJson<Batch>(`/api/batches/${id}${scope}`);
    if ("error" in b) return setError(b.error);
    setBatch(b);
  }, [id, scope]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener("shop:changed", refresh);
    return () => { clearInterval(timer); window.removeEventListener("shop:changed", refresh); };
  }, [refresh]);

  useEffect(() => {
    if (!batch || design?.id === batch.design_id) return;
    readJson<Design>(`/api/designs/${batch.design_id}`).then((d) => { if (!("error" in d)) setDesign(d); });
  }, [batch, design]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/batches/${id}/${path}${scope}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (res.ok) setBatch(data as Batch);
    else setError(String(data.error ?? res.statusText));
    setBusy(false);
  }

  async function send() {
    const text = message.trim();
    if (!text) return;
    await act("messages", { text, from: "buyer" });
    setMessage("");
  }

  if (!batch) {
    return (
      <div className="wrap">
        <div>
          <h1 className="title">Batch</h1>
          {error ? <p className="error" role="alert" data-testid="batch-error">{error}</p> : <p className="hint">Reading the batch</p>}
        </div>
      </div>
    );
  }

  const fields = design?.fields ?? [];
  const q = batch.quote;
  return (
    <div className="wrap">
      <div>
        <h1 className="title">Batch</h1>
        <div className="acts">
          <span className="tag" data-testid="batch-status">{batch.status}</span>
          <span className="hint">{batch.id}</span>
          {design && <Link href={`/designs/${design.id}`} data-testid="batch-design">{design.title}</Link>}
          {!batch.proof && !batch.approved_at && <button type="button" className="btn primary small" onClick={() => act("order")} disabled={busy || batch.issues.length > 0} data-testid="order">Order</button>}
          {batch.proof && !batch.approved_at && <button type="button" className="btn primary small" onClick={() => act("approve")} disabled={busy} data-testid="approve">Approve proof</button>}
        </div>
        {error && <p className="error" role="alert" data-testid="batch-error">{error}</p>}

        {batch.issues.length > 0 && (
          <section className="block" aria-labelledby="b-issues">
            <div className="labelrow"><h2 id="b-issues">Issues</h2></div>
            <div className="list" data-testid="issues">
              {batch.issues.map((i, n) => <div className="row" key={n}><span>{i.recipient_ref} {i.field}</span><span className="type">{i.reason}</span></div>)}
            </div>
          </section>
        )}

        <section className="block" aria-labelledby="b-units">
          <div className="labelrow"><h2 id="b-units">Units</h2><span className="hint">{batch.units.length} units</span></div>
          <div className="list">
            <table className="units" data-testid="units">
              <thead><tr><th>Recipient</th>{fields.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {batch.units.map((u) => (
                  <tr key={u.recipient_ref} data-testid="unit"><td>{u.recipient_ref}</td>{fields.map((f) => <td key={f.key}>{u.values[f.key] ?? ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {batch.proof && (
          <section className="block" aria-labelledby="b-proof">
            <div className="labelrow"><h2 id="b-proof">Proof sheet</h2><span className="hint">{batch.proof.length} proofs</span></div>
            <div className="proofs" data-testid="proofs">
              {batch.proof.map((p) => (
                <div className="proof" key={p.recipient_ref} data-testid="proof">
                  <div dangerouslySetInnerHTML={{ __html: p.svg }} />
                  <div className="ref">{p.recipient_ref}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="block" aria-labelledby="b-thread">
          <div className="labelrow"><h2 id="b-thread">Thread</h2></div>
          <div className="list" data-testid="thread">
            {batch.thread.map((t) => (
              <div className="row thread" key={t.seq} data-testid="thread-entry">
                <span className={`tag${t.from === "buyer" ? " quiet" : ""}`}>{t.from}</span>
                <span>{t.text}{t.reference ? ` ${t.reference}` : ""}</span>
                <span className="type">{minute(t.at)}</span>
              </div>
            ))}
            <div className="row">
              <input aria-label="Message to the shop" placeholder="Message to the shop" value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} data-testid="message" />
              <button type="button" className="btn ghost small" onClick={send} disabled={busy || !message.trim()} data-testid="send-message">Send</button>
            </div>
          </div>
        </section>
      </div>
      <aside className="side">
        <div className="dark-card" data-testid="quote">
          <div className="in">
            <h2>{money(q.total_cents, q.currency)}</h2>
            <div className="kv"><span>Status</span><span>{batch.status}</span></div>
            <div className="kv"><span>Units</span><span>{q.quantity}</span></div>
            <div className="kv"><span>Unit price</span><span>{money(q.unit_cents, q.currency)}</span></div>
            <div className="kv"><span>Subtotal</span><span>{money(q.subtotal_cents, q.currency)}</span></div>
            <div className="kv"><span>Tax</span><span>{money(q.tax_cents, q.currency)}</span></div>
            <div className="kv"><span>Ready by</span><span>{q.ready_by}</span></div>
            <div className="kv"><span>Needed by</span><span>{batch.needed_by}</span></div>
            <div className="kv"><span>Delivery</span><span>{batch.address.postal_code} {batch.address.country}</span></div>
            <div className="kv"><span>Buyer</span><span>{batch.buyer.email}</span></div>
          </div>
        </div>
      </aside>
    </div>
  );
}
