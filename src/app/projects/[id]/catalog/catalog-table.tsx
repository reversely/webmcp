"use client";
import { useMemo, useState } from "react";
import type { Candidate, Product } from "../../../../domain/types";
import { dimensionText, dollars } from "../components/product-card";
import css from "../components/stages.module.css";

type Filter = "all" | "grounded" | "visual_only";
const MODEL_TAG: Record<Product["model_status"], string> = { no_model: "", queued: "blue", generating: "blue", ready: "green", proxy: "", failed: "red" };
const DELIVERY_TAG: Record<NonNullable<Candidate["delivery_status"]>, string> = { confirmed: "green", likely: "", unknown: "", fail: "red" };

/** Stage 4 (PRD 20): the working table over the project's Product rows (tables.md). */
export function CatalogTable({ products, candidates }: { products: Product[]; candidates: Candidate[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const byProduct = useMemo(() => new Map(candidates.map((c) => [c.product_id, c])), [candidates]);
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
          <label>Spatial status</label>
          <div className={css.chips}>
            {(["all", "grounded", "visual_only"] as Filter[]).map((f) => (
              <button key={f} type="button" className={css.chip} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "grounded" ? "Grounded" : "Visual only"} {counts[f]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {products.length === 0 ? (
        <div className="empty">No products yet. A product appears here after it is added to a project, from the search panel on the Items stage or a product URL in chat.</div>
      ) : rows.length === 0 ? (
        <div className="empty">No products match this filter.</div>
      ) : (
        <div className={css.tableWrap}>
          <table className={`table ${css.table}`} data-testid="catalog-table">
            <thead>
              <tr>
                <th aria-label="Image" />
                <th>Product</th>
                <th>Category</th>
                <th>Seller</th>
                <th className="num">Price</th>
                <th>W × D × H</th>
                <th>Dimension source</th>
                <th>Spatial</th>
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
                    <td>{c ? <span className="tag">{c.category.replace("_", " ")}</span> : <span className="tag">none</span>}</td>
                    <td>{p.merchant}</td>
                    <td className="num">{dollars(p.price_cents, p.currency)}</td>
                    <td>{dims ?? <span className="tag">unknown</span>}</td>
                    <td>{p.dimension_source ? <span className={`mono ${css.clip}`} title={p.dimension_source.text} style={{ display: "block" }}>{p.dimension_source.text}</span> : <span className="tag">not stated</span>}</td>
                    <td>
                      <span className={`tag${p.spatial_status === "visual_only" ? " yellow" : ""}`}>{p.spatial_status === "grounded" ? "grounded" : "visual only"}</span>
                    </td>
                    <td>
                      <span className={`tag ${MODEL_TAG[p.model_status]}`}>{p.model_status.replace("_", " ")}</span>
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
