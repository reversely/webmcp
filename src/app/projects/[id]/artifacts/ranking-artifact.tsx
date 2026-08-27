"use client";
import { useEffect, useRef, useState } from "react";
import { formatFeetInches } from "../../../../domain/types";
import css from "./artifacts.module.css";
import { CATEGORY_LABEL, dollars, statusText, type RankingData, type RankingRow } from "./types";

function dims(d: RankingRow["dims"]): string {
  if (!d) return "pending";
  if (typeof d === "string") return d;
  if (d.width_mm != null && d.depth_mm != null) return `${formatFeetInches(d.width_mm)} × ${formatFeetInches(d.depth_mm)}${d.height_mm != null ? ` × ${formatFeetInches(d.height_mm)}` : ""}`;
  return "unknown";
}

const FAIL = /^(fail|failed|no|reject)/i;
const PASS = /^(pass|ok|fit|confirmed|yes)/i;

/** A check cell: fail is the only coloured value; pending and pass stay quiet text. */
function Check({ value }: { value: unknown }) {
  const t = statusText(value);
  if (!t) return <span className="tag">pending</span>;
  if (FAIL.test(t)) return <span className="tag red">{t}</span>;
  if (PASS.test(t)) return <span>{t}</span>;
  return <span>{t}</span>;
}

function rowStatusClass(status: string) {
  if (status === "selected") return "tag green";
  return "tag";
}

export function RankingArtifact({ data, title, onApprove, approving = false }: { data: RankingData; title?: string; onApprove?: () => void; approving?: boolean }) {
  // Track which rows changed since the last render so the change highlight fires once per change.
  const seen = useRef<Map<string, string>>(new Map());
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const r of data.rows) {
      const sig = `${r.status}|${r.rank ?? ""}|${statusText(r.geometry)}|${statusText(r.visual)}|${statusText(r.delivery)}`;
      const prev = seen.current.get(r.product_id);
      if (prev !== undefined && prev !== sig) next.add(r.product_id);
      seen.current.set(r.product_id, sig);
    }
    if (next.size > 0) {
      setChanged(next);
      const t = setTimeout(() => setChanged(new Set()), 1600);
      return () => clearTimeout(t);
    }
  }, [data.rows]);

  const rows = [...data.rows].sort((a, b) => {
    const ra = a.rank ?? Number.POSITIVE_INFINITY;
    const rb = b.rank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    const ea = a.status === "eliminated" ? 1 : 0;
    const eb = b.status === "eliminated" ? 1 : 0;
    return ea - eb;
  });
  const selected = data.selected_product_id;
  const category = CATEGORY_LABEL[data.category] ?? data.category;

  return (
    <div className={css.card} data-testid="artifact-ranking" role="group" aria-label={`Replacement ${category.toLowerCase()}`}>
      <div className={css.title}>{title ?? `Cheaper ${category.toLowerCase()} options`}</div>
      <div className={css.sub}>
        Needs {dollars(data.required_savings_cents)} in savings, so the new price stays at or under {dollars(data.ceiling_cents)}. Rows rank by visual match, then delivery, then price.
      </div>
      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead>
            <tr>
              <th>Product</th>
              <th className={css.num}>New price</th>
              <th className={css.num}>Savings</th>
              <th>Dimensions</th>
              <th>Geometry</th>
              <th>Visual match</th>
              <th>Delivery</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className={css.sub}>
                  No candidates yet.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isSelected = r.product_id === selected || r.status === "selected";
              const isOut = r.status === "eliminated";
              const cls = [isSelected ? css.selected : "", isOut ? css.eliminated : "", changed.has(r.product_id) ? css.changed : ""].filter(Boolean).join(" ");
              return (
                <tr key={r.product_id} className={cls} data-product-id={r.product_id} data-status={r.status} aria-selected={isSelected || undefined}>
                  <td>
                    <div className={css.productCell}>
                      {r.image_url ? <img src={r.image_url} alt="" /> : <span className={css.blank} />}
                      <div>
                        <div className={css.name} title={r.title}>
                          {r.title}
                        </div>
                        {isOut && r.reason && <div className={css.reason}>{r.reason}</div>}
                      </div>
                    </div>
                  </td>
                  <td className={css.num}>{dollars(r.price_cents)}</td>
                  <td className={css.num}>{dollars(r.savings_cents)}</td>
                  <td>{dims(r.dims)}</td>
                  <td>
                    <Check value={r.geometry} />
                  </td>
                  <td>
                    <Check value={r.visual} />
                  </td>
                  <td>
                    <Check value={r.delivery} />
                  </td>
                  <td>
                    <span className={rowStatusClass(r.status)}>{r.status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {onApprove && (
        <div className={css.actions}>
          <span className={css.hint}>{selected ? "Approving replaces the item in the BOM." : "Waiting for a selection."}</span>
          <button className="btn primary" type="button" data-testid="approve-replacement" onClick={onApprove} disabled={!selected || approving}>
            Approve replacement
          </button>
        </div>
      )}
    </div>
  );
}
