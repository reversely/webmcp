"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ruleSentence, type LayoutCheck } from "../../../../domain/geometry";
import type { Space } from "../../../../domain/types";
import { formatFeetInches } from "../../../../domain/types";
import type { ProjectSnapshot } from "../../../../server/state";
import { ItemPanel } from "../components/item-panel";
import { ModelStageStrip } from "../components/model-stage-strip";
import { PlanView, type PlanItem } from "../components/plan-view";
import { ProductSearch, requiredItemNames } from "../components/product-search";
import { Room3DView, type RoomItem } from "../components/room3d-view";
import css from "../components/stages.module.css";

type Pos = { x_mm: number; y_mm: number; rotation_deg: number };
type BomLine = ProjectSnapshot["bom"][number];

const hasBox = (b: BomLine) => b.product?.spatial_status === "grounded" && b.product.width_mm != null && b.product.depth_mm != null;
const MODEL_POLL_MS = 4000;

/** The status tag for one rule: red only on a fail; a rule that could not be evaluated stays gray. */
function ruleTag(pass: boolean | null): { cls: string; text: string } {
  if (pass === null) return { cls: "tag", text: "not checked" };
  return pass ? { cls: "tag green", text: "pass" } : { cls: "tag red", text: "fail" };
}

/**
 * Stage 3 (PRD 20): the 2D plan with the BOM's placed items, a tray for unplaced ones, and the
 * geometry result drawn after every drop. Local placement state is the source during a drag; the
 * server's answer replaces it on drop.
 */
export function ItemsStage({ projectId, initial }: { projectId: string; initial: ProjectSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [positions, setPositions] = useState<Record<string, Pos>>(() => Object.fromEntries(initial.placements.map((p) => [p.bom_item_id, { x_mm: p.x_mm, y_mm: p.y_mm, rotation_deg: p.rotation_deg }])));
  const [geometry, setGeometry] = useState<LayoutCheck | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const space = snap.space as Space;

  const adopt = useCallback((next: ProjectSnapshot) => {
    setSnap(next);
    setPositions(Object.fromEntries(next.placements.map((p) => [p.bom_item_id, { x_mm: p.x_mm, y_mm: p.y_mm, rotation_deg: p.rotation_deg }])));
  }, []);

  const refresh = useCallback(async () => {
    const [a, b] = await Promise.all([fetch(`/api/projects/${projectId}`, { cache: "no-store" }), fetch(`/api/projects/${projectId}/placements`, { cache: "no-store" })]);
    if (a.ok) adopt((await a.json()) as ProjectSnapshot);
    if (b.ok) setGeometry(((await b.json()) as { geometry: LayoutCheck | null }).geometry);
  }, [projectId, adopt]);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener("project:changed", onChange);
    return () => window.removeEventListener("project:changed", onChange);
  }, [refresh]);

  // Polls the snapshot alone (positions stay local, so a drag in progress is not reset) so a
  // proxy swaps for its generated model when the job lands at ready (PRD 15.1).
  useEffect(() => {
    const poll = async () => {
      const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (res.ok) setSnap((await res.json()) as ProjectSnapshot);
    };
    const t = setInterval(poll, MODEL_POLL_MS);
    return () => clearInterval(t);
  }, [projectId]);

  const lines = useMemo(() => snap.bom.filter((b) => b.status !== "removed"), [snap]);
  const placed: PlanItem[] = lines
    .filter((b) => hasBox(b) && positions[b.id])
    .map((b) => ({
      id: b.id,
      title: b.product!.title,
      category: b.category,
      kind: b.kind,
      image_url: b.product!.primary_image_url,
      box: { width_mm: b.product!.width_mm!, depth_mm: b.product!.depth_mm!, height_mm: b.product!.height_mm ?? 0 },
      placement: positions[b.id],
      flagged: geometry ? geometry.inside[b.id] === false || geometry.collisions.some(([x, y]) => x === b.id || y === b.id) : false
    }));
  const tray = lines.filter((b) => !positions[b.id]);
  const selected = placed.find((p) => p.id === selectedId) ?? null;
  const selectedLine = selected ? lines.find((b) => b.id === selected.id) ?? null : null;
  const productOf = new Map(lines.map((b) => [b.id, b.product!]));
  const jobFor = (productId: string) => snap.model_jobs?.[productId];
  const roomItems: RoomItem[] = placed.map((p) => {
    const product = productOf.get(p.id)!;
    return { id: p.id, kind: p.kind, title: p.title, imageUrl: p.image_url, glbUrl: product.glb_url, modelStatus: product.model_status, box: p.box, placement: p.placement };
  });
  const generated = roomItems.filter((i) => i.modelStatus === "ready").length;
  const proxies = roomItems.length - generated;

  async function save(next: Record<string, Pos>) {
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/placements`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placements: Object.entries(next).map(([bom_item_id, p]) => ({ bom_item_id, ...p })) })
    });
    if (!res.ok) {
      setError(`Saving placements failed (${res.status}).`);
      return;
    }
    const body = (await res.json()) as ProjectSnapshot & { geometry: LayoutCheck | null };
    adopt(body);
    setGeometry(body.geometry);
  }

  function move(id: string, x_mm: number, y_mm: number) {
    setPositions((p) => ({ ...p, [id]: { ...p[id], x_mm, y_mm } }));
  }
  function place(id: string) {
    const next = { ...positions, [id]: { x_mm: Math.round(space.width_mm / 2), y_mm: Math.round(space.length_mm / 2), rotation_deg: 0 } };
    setPositions(next);
    setSelectedId(id);
    save(next);
  }
  function rotate() {
    if (!selectedId) return;
    const cur = positions[selectedId];
    const next = { ...positions, [selectedId]: { ...cur, rotation_deg: (cur.rotation_deg + 90) % 360 } };
    setPositions(next);
    save(next);
  }
  /** The removed line's placement is gone from the server; the geometry check re-runs over the rest. */
  async function removed(next: ProjectSnapshot) {
    adopt(next);
    setSelectedId(null);
    setSwapFor(null);
    const res = await fetch(`/api/projects/${projectId}/placements`, { cache: "no-store" });
    if (res.ok) setGeometry(((await res.json()) as { geometry: LayoutCheck | null }).geometry);
  }
  /** After a swap the replacement line carries the old placement; select it so the panel follows. */
  function swapped(next: ProjectSnapshot, newItemId: string | null) {
    adopt(next);
    setSwapFor(null);
    if (newItemId) setSelectedId(newItemId);
  }

  const insideCount = placed.filter((p) => geometry?.inside[p.id] !== false).length;
  const rules = geometry?.rules ?? [];
  const itemNames = requiredItemNames(snap.requirements);

  return (
    <>
      <h1 className="page-title">Items</h1>
      <p className="page-summary">Source products from the catalog, then place them in the plan. Drag to move; the geometry check runs after every drop.</p>
      <div className={css.splitPlan}>
        <ProductSearch projectId={projectId} items={itemNames} budget={snap.budget} onAdded={(s) => adopt(s)} swap={swapFor && selectedLine?.id === swapFor ? { bomItemId: swapFor, name: selectedLine.category, onSwapped: swapped, onCancel: () => setSwapFor(null) } : null} />
        <section className="surface" aria-label="Plan">
          <div className={css.spread}>
            <div>
              <div className="eyebrow">Plan</div>
              <h2 className="surface-title" style={{ margin: 0 }}>
                {space.name}, {formatFeetInches(space.width_mm)} × {formatFeetInches(space.length_mm)}
              </h2>
              {roomItems.length > 0 && (
                <div className={css.note} data-testid="model-caption">
                  {generated} {generated === 1 ? "model" : "models"} generated, {proxies} colour {proxies === 1 ? "proxy" : "proxies"}
                </div>
              )}
            </div>
            <div className={css.segmented} role="group" aria-label="View">
              <button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>
                2D
              </button>
              <button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")} data-testid="view-toggle-3d">
                3D
              </button>
            </div>
          </div>
          {!selected && (
            <div className={css.row} style={{ margin: "12px 0", minHeight: 32 }}>
              <span className={css.note}>{placed.length === 0 ? "No items placed yet." : "Select an item to rename it, change its kind, swap its product, or remove it. Hover an item to read clearances."}</span>
            </div>
          )}
          <div className={selected ? css.planWithPanel : undefined}>
            <div className={css.canvas}>
              {view === "2d" ? (
                <PlanView space={space} items={placed} selectedId={selectedId} clearances={geometry?.clearances} rules={rules} maxHeight={520} onSelect={setSelectedId} onMove={move} onDrop={() => save(positions)} />
              ) : (
                <Room3DView space={space} items={roomItems} selectedId={selectedId} onSelect={setSelectedId} />
              )}
            </div>
            {selected && selectedLine && (
              <ItemPanel
                key={selectedLine.id}
                projectId={projectId}
                item={selectedLine}
                placement={selected.placement}
                job={jobFor(selectedLine.product_id)}
                swapping={swapFor === selectedLine.id}
                onChanged={(s) => adopt(s)}
                onRotate={rotate}
                onSwap={() => setSwapFor((cur) => (cur === selectedLine.id ? null : selectedLine.id))}
                onRemoved={removed}
              />
            )}
          </div>
          <div className={css.status} style={{ marginTop: 12 }} aria-label="Geometry">
            <span>
              Inside <span className={`tag${placed.length && insideCount < placed.length ? " red" : ""}`}>{placed.length ? `${insideCount} of ${placed.length}` : "none placed"}</span>
            </span>
            <span>
              Collisions <span className={`tag${geometry && geometry.collisions.length > 0 ? " red" : ""}`}>{geometry ? geometry.collisions.length : "not checked"}</span>
            </span>
            {rules.map((r, i) => {
              const tag = ruleTag(r.pass);
              return (
                <span key={i} data-testid="rule-result" data-relation={r.rule.relation} data-result={tag.text} title={r.detail}>
                  {ruleSentence(r.rule)} <span className={tag.cls}>{tag.text}</span>
                </span>
              );
            })}
            {geometry && rules.length === 0 && <span className={css.note}>The approved plan has no layout rules.</span>}
            {error && <span className={css.error}>{error}</span>}
          </div>
          {tray.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginTop: 20 }}>
                Not yet placed
              </div>
              <div className={css.tray}>
                {tray.map((b) => (
                  <div className={css.trayItem} key={b.id}>
                    {b.product?.primary_image_url ? <img src={b.product.primary_image_url} alt="" /> : <div />}
                    <div>
                      <div style={{ color: "var(--ink)" }}>{b.product?.title ?? b.product_id}</div>
                      <div className={css.sub}>
                        {b.category}
                        {hasBox(b) ? `, ${formatFeetInches(b.product!.width_mm!)} × ${formatFeetInches(b.product!.depth_mm!)}` : ""}
                      </div>
                      {hasBox(b) ? (
                        <button className="btn" type="button" onClick={() => place(b.id)}>
                          Place in room
                        </button>
                      ) : (
                        <span className="tag yellow" style={{ marginTop: 4 }}>
                          dimensions unknown
                        </span>
                      )}
                      {b.product && <ModelStageStrip job={jobFor(b.product.id)} productId={b.product.id} projectId={projectId} status={b.product.model_status} />}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
