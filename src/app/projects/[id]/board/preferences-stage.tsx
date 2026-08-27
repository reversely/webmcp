"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Editor, TLEditorSnapshot } from "tldraw";
import { getSnapshot } from "tldraw";
import { collectBoardItems, compileBoard, type CompiledSpec, type RequiredItem } from "./compileBoard";
import styles from "./board.module.css";

// tldraw reads window at import time, so the canvas is loaded on the client only.
const BoardCanvas = dynamic(() => import("./board-canvas"), { ssr: false, loading: () => <div className={styles.placeholder}>Loading the board.</div> });

const ITEM_LABELS: [RequiredItem, string][] = [
  ["sofa", "Sofa"],
  ["coffee_table", "Coffee table"],
  ["ottoman", "Ottoman"],
  ["rug", "Rug"],
  ["side_table", "Side table"]
];

type Form = {
  width_ft: string;
  length_ft: string;
  budget: string;
  required_by: string;
  items: RequiredItem[];
  base_colors: string;
  accent_colors: string;
  rug_group: boolean;
  room_name: string | null;
};

function toForm(spec: CompiledSpec): Form {
  return {
    width_ft: spec.room ? String(spec.room.width_ft) : "",
    length_ft: spec.room ? String(spec.room.length_ft) : "",
    budget: spec.budget ? String(spec.budget.maximum) : "",
    required_by: spec.required_by ?? "",
    items: spec.required_items,
    base_colors: spec.visual_direction.base_colors.join(", "),
    accent_colors: spec.visual_direction.accent_colors.join(", "),
    rug_group: spec.layout_requirements.length > 0,
    room_name: spec.room_name
  };
}

const splitList = (s: string) => s.split(",").map((c) => c.trim()).filter(Boolean);
const MM_PER_FT = 304.8;

export function PreferencesStage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const editorRef = useRef<Editor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [board, setBoard] = useState<{ loaded: boolean; snapshot: TLEditorSnapshot | null }>({ loaded: false, snapshot: null });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [form, setForm] = useState<Form | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/spec`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { board: TLEditorSnapshot | null }) => {
        if (!cancelled) setBoard({ loaded: true, snapshot: data.board ?? null });
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [projectId]);

  function persist(snapshot: TLEditorSnapshot) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/projects/${projectId}/spec`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board: snapshot }) });
      setSaveState(res.ok ? "saved" : "failed");
    }, 800);
  }

  function compile() {
    const editor = editorRef.current;
    if (!editor) return;
    const spec = compileBoard(collectBoardItems(getSnapshot(editor.store)));
    setForm(toForm(spec));
    setMissing([!spec.room && "room size", !spec.budget && "budget", !spec.required_by && "date"].filter((m): m is string => !!m));
  }

  const width = form ? parseFloat(form.width_ft) : NaN;
  const length = form ? parseFloat(form.length_ft) : NaN;
  const budget = form ? parseFloat(form.budget) : NaN;
  const canApprove = !!form && width > 0 && length > 0 && budget > 0 && !approving;

  async function approve() {
    if (!form || !canApprove) return;
    setApproving(true);
    const requirements: { type: string; value: unknown }[] = [
      ...form.items.map((value) => ({ type: "required_item", value })),
      { type: "visual_direction", value: { base_colors: splitList(form.base_colors), accent_colors: splitList(form.accent_colors) } },
      ...(form.rug_group ? [{ type: "layout_requirement", value: { type: "rug_encompasses_group", items: ["sofa", "coffee_table"] } }] : [])
    ];
    const spec = fetch(`/api/projects/${projectId}/spec`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ space: { width_mm: width * MM_PER_FT, length_mm: length * MM_PER_FT, ...(form.room_name ? { name: form.room_name } : {}) }, requirements })
    });
    const project = fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget_cents: Math.round(budget * 100), required_by: form.required_by || null })
    });
    const [a, b] = await Promise.all([spec, project]);
    if (!a.ok || !b.ok) {
      setApproving(false);
      return;
    }
    window.dispatchEvent(new Event("project:changed"));
    router.push(`/projects/${projectId}/room`);
  }

  const STATUS: Record<typeof saveState, string> = { idle: "", saving: "Saving", saved: "Saved", failed: "Save failed" };

  return (
    <>
      <h1 className="page-title">Preferences</h1>
      <p className="page-summary">Put room size, budget, date, required items, and colour swatches on the board, then create the plan from it.</p>
      <div className={styles.stage}>
        <section className={styles.canvasSurface} aria-label="Whiteboard">
          <div className={styles.canvasHeader}>
            <span className="eyebrow">Board</span>
            <span className={styles.status} aria-live="polite">{STATUS[saveState]}</span>
          </div>
          <div className={styles.canvas}>
            {board.loaded ? (
              <BoardCanvas
                initial={board.snapshot}
                onReady={(editor) => {
                  editorRef.current = editor;
                }}
                onChange={persist}
              />
            ) : (
              <div className={styles.placeholder}>Loading the board.</div>
            )}
          </div>
        </section>

        <section className={`surface ${styles.plan}`} aria-label="Plan">
          <div className="eyebrow">Plan from board</div>
          {!form && (
            <>
              <p>The plan reads the board's notes and swatches for room size, budget, date, required items, and colours. You can edit it before approving.</p>
              <button className="btn primary focal" type="button" onClick={compile} disabled={!board.loaded}>
                Create plan from board
              </button>
            </>
          )}
          {form && (
            <form
              className={styles.plan}
              onSubmit={(e) => {
                e.preventDefault();
                approve();
              }}
            >
              {missing.length > 0 && <p className={styles.note}>The board did not state the {missing.join(", ")}. Fill it in here.</p>}
              <div className={styles.pair}>
                <div className="field">
                  <label htmlFor="width">Room width (ft)</label>
                  <input id="width" className="input" type="number" min="1" step="0.25" value={form.width_ft} onChange={(e) => setForm({ ...form, width_ft: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="length">Room length (ft)</label>
                  <input id="length" className="input" type="number" min="1" step="0.25" value={form.length_ft} onChange={(e) => setForm({ ...form, length_ft: e.target.value })} />
                </div>
              </div>
              <div className={styles.pair}>
                <div className="field">
                  <label htmlFor="budget">Budget (USD)</label>
                  <input id="budget" className="input" type="number" min="1" step="1" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="required_by">Required by</label>
                  <input id="required_by" className="input" type="date" value={form.required_by} onChange={(e) => setForm({ ...form, required_by: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Required items</label>
                <div className={styles.checks}>
                  {ITEM_LABELS.map(([item, label]) => (
                    <label key={item} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={form.items.includes(item)}
                        onChange={(e) => setForm({ ...form, items: e.target.checked ? [...form.items, item] : form.items.filter((i) => i !== item) })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="base">Base colours</label>
                <input id="base" className="input" value={form.base_colors} onChange={(e) => setForm({ ...form, base_colors: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="accent">Accent colours</label>
                <input id="accent" className="input" value={form.accent_colors} onChange={(e) => setForm({ ...form, accent_colors: e.target.value })} />
              </div>
              <label className={styles.check}>
                <input type="checkbox" checked={form.rug_group} onChange={(e) => setForm({ ...form, rug_group: e.target.checked })} />
                The rug sits under the sofa and coffee table
              </label>
              <div className={styles.actions}>
                <button className="btn primary focal" type="submit" disabled={!canApprove}>
                  Approve
                </button>
                <button className="btn" type="button" onClick={compile}>
                  Read the board again
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
