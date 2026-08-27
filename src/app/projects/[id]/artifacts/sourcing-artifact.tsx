"use client";
import { formatMoney } from "../../../../domain/money";
import type { Product } from "../../../../domain/types";

export type ProductRef = Pick<Product, "id" | "title">;
import css from "./artifacts.module.css";
import type { SourcingData } from "./types";

/** Status tag colour: selected and no match are the actionable minority; every in-progress state stays gray. */
function statusClass(status: string) {
  if (status === "selected") return "tag green";
  if (status === "no match") return "tag red";
  return "tag";
}

/** Counts render in pipeline order and stop at the first stage that has not reported. */
function funnel(c: SourcingData["categories"][keyof SourcingData["categories"]]) {
  if (!c) return "";
  const stages: [number, string][] = [
    [c.found, "found"],
    [c.available, "available"],
    [c.dimensioned, "dimensioned"],
    [c.compatible, "compatible"],
    [c.delivery_checked, "delivery checked"]
  ];
  const parts: string[] = [];
  for (const [n, label] of stages) {
    if (parts.length > 0 && !(n > 0)) break;
    parts.push(`${n ?? 0} ${label}`);
  }
  return parts.join(" → ");
}

export function SourcingArtifact({ data, products, title = "Finding your living room" }: { data: SourcingData; products: ProductRef[]; title?: string }) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const entries = Object.entries(data.categories ?? {});
  const hasWindow = typeof data.window?.min_cents === "number" && typeof data.window?.max_cents === "number";
  return (
    <div className={css.card} data-testid="artifact-sourcing" role="group" aria-label={title}>
      <div className={css.title}>{title}</div>
      <div className={css.rows}>
        {entries.length === 0 && <div className={css.sub}>No item has started yet.</div>}
        {entries.map(([category, c]) => {
          if (!c) return null;
          const product = c.selected_product_id ? byId.get(c.selected_product_id) : undefined;
          return (
            <div className={css.row} key={category} data-category={category}>
              <span className={css.label}>{category}</span>
              <span className={`${statusClass(c.status)} ${css.status}`}>{c.status}</span>
              <span className={css.funnel}>{funnel(c)}</span>
              {c.status === "selected" && (
                <span className={css.product} title={product?.title ?? c.selected_product_id}>
                  {product?.title ?? c.selected_product_id ?? "Selected"}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {(typeof data.subtotal_cents === "number" || hasWindow) && (
        <div className={css.foot}>
          <span>{typeof data.subtotal_cents === "number" ? <>Subtotal <strong>{formatMoney(data.subtotal_cents)}</strong></> : "Subtotal pending"}</span>
          {hasWindow && (
            <span>
              Window {formatMoney(data.window!.min_cents!)} to {formatMoney(data.window!.max_cents!)}
            </span>
          )}
        </div>
      )}
      {(data.notes ?? []).map((note) => (
        <div className={css.sub} key={note}>
          {note}
        </div>
      ))}
    </div>
  );
}
