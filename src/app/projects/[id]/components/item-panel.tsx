"use client";
import { useEffect, useState } from "react";
import { KINDS, type Kind } from "../../../../domain/types";
import type { ModelJob, ProjectSnapshot } from "../../../../server/state";
import { ModelStageStrip } from "./model-stage-strip";
import css from "./stages.module.css";

export const KIND_LABEL: Record<Kind, string> = { seating: "seating", table: "table", storage: "storage", soft_floor: "soft floor", bed: "bed", lighting: "lighting", decor: "decor", other: "other" };

type Line = ProjectSnapshot["bom"][number];

export type ItemPanelProps = {
  projectId: string;
  item: Line;
  placement: { x_mm: number; y_mm: number; rotation_deg: number };
  job: ModelJob | undefined;
  /** True while the search panel is scoped to this item's swap. */
  swapping: boolean;
  onChanged: (snapshot: ProjectSnapshot) => void;
  onRotate: () => void;
  onSwap: () => void;
  onRemoved: (snapshot: ProjectSnapshot) => void;
};

/**
 * The inline panel beside the plan for the selected item (#48, PRD 20): the item's name as a
 * field, its rendering kind, and the swap and remove actions. Name and kind save through
 * PUT /items/:id and hand the returned snapshot up so the plan, 3D view, and rail follow.
 */
export function ItemPanel({ projectId, item, placement, job, swapping, onChanged, onRotate, onSwap, onRemoved }: ItemPanelProps) {
  const [name, setName] = useState(item.category);
  const [busy, setBusy] = useState<"name" | "kind" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(item.category), [item.category]);

  async function put(body: { name?: string; kind?: Kind }, what: "name" | "kind") {
    setBusy(what);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/items/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const snap = (await res.json()) as ProjectSnapshot & { error?: string };
      if (!res.ok) throw new Error(snap.error ?? `Saving the ${what} failed (${res.status}).`);
      window.dispatchEvent(new Event("project:changed"));
      onChanged(snap);
    } catch (e) {
      setError((e as Error).message);
      if (what === "name") setName(item.category);
    } finally {
      setBusy(null);
    }
  }

  function commitName() {
    const next = name.trim();
    if (!next) {
      setName(item.category);
      return;
    }
    if (next !== item.category) put({ name: next }, "name");
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/items/${item.id}`, { method: "DELETE" });
      const snap = (await res.json()) as ProjectSnapshot & { error?: string };
      if (!res.ok) throw new Error(snap.error ?? `Removing the item failed (${res.status}).`);
      window.dispatchEvent(new Event("project:changed"));
      onRemoved(snap);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const product = item.product;
  return (
    <aside className={css.itemPanel} aria-label="Selected item" data-testid="item-panel" data-item-id={item.id}>
      <div className="eyebrow">Selected item</div>
      <div style={{ color: "var(--ink)", fontWeight: 500, fontSize: 14 }} title={product?.title}>
        {product?.title ?? item.product_id}
      </div>
      <div className={css.mm}>
        x {placement.x_mm} mm, y {placement.y_mm} mm, {placement.rotation_deg}°
      </div>
      <div className="field">
        <label htmlFor={`item-name-${item.id}`}>Name (your words)</label>
        <input
          id={`item-name-${item.id}`}
          className="input"
          data-testid="item-name"
          value={name}
          disabled={busy === "name"}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setName(item.category);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={`item-kind-${item.id}`}>Rendering kind</label>
        <select id={`item-kind-${item.id}`} className="select" data-testid="item-kind" value={item.kind} disabled={busy === "kind"} onChange={(e) => put({ kind: e.target.value as Kind }, "kind")}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className={css.row}>
        <button className="btn" type="button" style={{ height: 30, padding: "0 10px", fontSize: 13 }} onClick={onRotate}>
          Rotate 90°
        </button>
        <button className="btn" type="button" style={{ height: 30, padding: "0 10px", fontSize: 13 }} data-testid="item-swap" aria-pressed={swapping} onClick={onSwap}>
          {swapping ? "Cancel swap" : "Swap product"}
        </button>
        <button className="btn" type="button" style={{ height: 30, padding: "0 10px", fontSize: 13 }} data-testid="item-remove" disabled={busy === "remove"} onClick={remove}>
          {busy === "remove" ? "Removing" : "Remove"}
        </button>
      </div>
      {swapping && <p className={css.hint}>Pick a result in the search panel; it takes this item&apos;s place, name, and kind.</p>}
      {product && <ModelStageStrip job={job} productId={product.id} projectId={projectId} status={product.model_status} />}
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
