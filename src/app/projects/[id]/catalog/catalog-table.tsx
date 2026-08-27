"use client";
import { useEffect, useMemo, useState } from "react";
import { KINDS, type Candidate, type Kind, type Product } from "../../../../domain/types";
import { formatMoney } from "../../../../domain/money";
import { dimensionText } from "../components/product-card";
import css from "../components/stages.module.css";

type Filter = "all" | "grounded" | "visual_only";
const MODEL_TAG: Record<Product["model_status"], string> = { no_model: "", queued: "blue", generating: "blue", ready: "green", proxy: "", failed: "red" };
const MODEL_LABEL: Record<Product["model_status"], string> = { no_model: "no model", queued: "queued", generating: "generating model", ready: "model generated", proxy: "colour proxy", failed: "failed" };
const DELIVERY_TAG: Record<NonNullable<Candidate["delivery_status"]>, string> = { confirmed: "green", likely: "", unknown: "", fail: "red" };

import { KIND_LABEL } from "../components/item-panel";

const POLL_MS = 4000;

/**
 * Stage 4 (PRD 20): the working table over the project's Product rows (tables.md). Each row shows
 * the item the product answers to in the project's own words and its rendering kind; the kind is
 * editable and saves through PUT /candidates/:id. Polls the snapshot so an item renamed, re-kinded,
 * or swapped on the plan (#48) shows here on the next poll.
 */
export function CatalogTable({ projectId, products: initialProducts, candidates: initial }: { projectId: string; products: Product[]; candidates: Candidate[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [products, setProducts] = useState(initialProducts);
  const [candidates, setCandidates] = useState(initial);
  useEffect(() => {
    const refresh = async () => {
      const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!res.ok) return;
      const snap = (await res.json()) as { products: Product[]; candidates: Candidate[] };
      setProducts(snap.products);
      setCandidates(snap.candidates);
    };
    const t = setInterval(refresh, POLL_MS);
    window.addEventListener("project:changed", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("project:changed", refresh);
    };
  }, [projectId]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byProduct = useMemo(() => new Map(candidates.map((c) => [c.product_id, c])), [candidates]);

  async function changeKind(candidate: Candidate, kind: Kind) {
    setSaving(candidate.id);
    setError(null);
    setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? { ...c, kind } : c)));
    try {
      const res = await fetch(`/api/projects/${projectId}/candidates/${candidate.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!res.ok) throw new Error(`Saving the kind failed (${res.status}).`);
      const snap = (await res.json()) as { candidates: Candidate[] };
      setCandidates(snap.candidates);
      window.dispatchEvent(new Event("project:changed"));
    } catch (e) {
      setError((e as Error).message);
      setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? { ...c, kind: candidate.kind } : c)));
    } finally {
      setSaving(null);
    }
  }
  const rows = products.filter((p) => (filter === "all" || p.spatial_status === filter) && (!q.trim() || `${p.title} ${p.merchant}`.toLowerCase().includes(q.trim().toLowerCase())));
  const counts = { all: products.length, grounded: products.filter((p) => p.spatial_status === "grounded").length, visual_only: products.filter((p) => p.spatial_status === "visual_only").length };

  return (
    <section className="surface" aria-label="Products">
      <div className="band">
        <div className="field" style={{ minWidth: 260 }}>
          <label htmlFor="catalog-q">Filter</label>
          <input id="catalog-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or merchant" />
        </div>
        <div className="field">
          <label>Dimensions</label>
          <div className={css.chips}>
            {(["all", "grounded", "visual_only"] as Filter[]).map((f) => (
              <button key={f} type="button" className={css.chip} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "grounded" ? "Known" : "Unknown"} {counts[f]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      {products.length === 0 ? (
        <div className="empty">No products yet. Products added from the search panel on the Items stage or from a product URL in chat appear here.</div>
      ) : rows.length === 0 ? (
        <div className="empty">No products match this filter.</div>
      ) : (
        <div className={css.tableWrap}>
          <table className={`table ${css.table}`} data-testid="catalog-table">
            <thead>
              <tr>
                <th aria-label="Image" />
                <th>Product</th>
                <th>Item</th>
                <th>Kind</th>
                <th className="num">Price</th>
                <th>W × D × H</th>
                <th>Dimension source</th>
                <th>Sizing</th>
                <th>Model</th>
                <th>Delivery</th>
                <th>Merchant</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const c = byProduct.get(p.id);
                const dims = dimensionText(p);
                return (
                  <tr key={p.id}>
                    <td style={{ width: 40 }}>{p.primary_image_url ? <img className={css.thumb} src={p.primary_image_url} alt="" /> : <div className={css.thumbEmpty} />}</td>
                    <td className="title">
                      <div className={css.clip} title={p.title}>
                        {p.title || "Untitled product"}
                      </div>
                    </td>
                    <td>{c ? <span className={css.clip} title={c.category}>{c.category}</span> : <span className="tag">none</span>}</td>
                    <td>
                      {c ? (
                        <select className="select" aria-label={`Kind of ${c.category}`} data-testid="kind-select" value={c.kind} disabled={saving === c.id} onChange={(e) => changeKind(c, e.target.value as Kind)}>
                          {KINDS.map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="tag">none</span>
                      )}
                    </td>
                    <td className="num">{formatMoney(p.price_cents, p.currency)}</td>
                    <td>{dims ?? <span className="tag">unknown</span>}</td>
                    <td>{p.dimension_source ? <span className={`mono ${css.clip}`} title={p.dimension_source.text} style={{ display: "block" }}>{p.dimension_source.text}</span> : <span className="tag">not stated</span>}</td>
                    <td>
                      <span className={`tag${p.spatial_status === "visual_only" ? " yellow" : ""}`}>{p.spatial_status === "grounded" ? "dimensions known" : "dimensions unknown"}</span>
                    </td>
                    <td>
                      <span className={`tag ${MODEL_TAG[p.model_status]}`}>{MODEL_LABEL[p.model_status]}</span>
                    </td>
                    <td>{c?.delivery_status ? <span className={`tag ${DELIVERY_TAG[c.delivery_status]}`}>{c.delivery_status}</span> : <span className="tag">pending</span>}</td>
                    <td>
                      <a href={p.source_url} target="_blank" rel="noreferrer" title={p.source_url}>
                        {p.merchant}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
