"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Editor, TLEditorSnapshot } from "tldraw";
import { getSnapshot } from "tldraw";
import { collectBoardItems, compileBoard, parseLayoutRule, type CompiledSpec, type Swatch } from "./compileBoard";
import { latestArtifact, type ArtifactMessage } from "../artifacts";
import type { SpecData } from "../artifacts/types";
import { ANONYMOUS, useIdentity } from "../../../identity";
import styles from "./board.module.css";

// tldraw reads window at import time, so the canvas is loaded on the client only.
const BoardCanvas = dynamic(() => import("./board-canvas"), { ssr: false, loading: () => <div className={styles.placeholder}>Loading the board.</div> });

/**
 * The plan form: the three fixed fields (room, budget, date) and, below them, whatever the board
 * named, in the board's words: items, colour swatches, and layout sentences. Each list is edited
 * in place and sent as written.
 */
type Form = {
  width_ft: string;
  length_ft: string;
  budget: string;
  required_by: string;
  items: string[];
  swatches: Swatch[];
  rules: string[];
  room_name: string | null;
};

function toForm(spec: CompiledSpec): Form {
  return {
    width_ft: spec.room ? String(spec.room.width_ft) : "",
    length_ft: spec.room ? String(spec.room.length_ft) : "",
    budget: spec.budget ? String(spec.budget.maximum) : "",
    required_by: spec.required_by ?? "",
    items: spec.required_items,
    swatches: spec.swatches,
    rules: spec.layout_rules,
    room_name: spec.room_name
  };
}

const MM_PER_FT = 304.8;

/** Reads a PRD 16 ProjectSpec from the compile response, which may wrap it as { spec } or return it bare. */
function readSpec(json: unknown): SpecData | null {
  if (!json || typeof json !== "object") return null;
  const o = json as { spec?: unknown };
  const candidate = "spec" in o ? o.spec : json;
  if (!candidate || typeof candidate !== "object") return null;
  const s = candidate as SpecData;
  return s.room !== undefined || s.budget !== undefined || s.required_items !== undefined ? s : null;
}

async function compileWithAgent(projectId: string, boardText: string, swatches: string[]): Promise<SpecData | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}/compile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardText, swatches }) });
    if (!res.ok) return null;
    return readSpec(await res.json());
  } catch {
    return null;
  }
}

async function latestSpecArtifact(projectId: string): Promise<SpecData | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const snap = (await res.json()) as { messages?: ArtifactMessage[] };
    return latestArtifact(snap.messages, "spec")?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * The agent's spec wins on the three fixed fields it states. Items stay in the board's own words;
 * the agent's category ids fill in only when the board named none. Colours come from swatches
 * alone, and layout sentences from the board alone.
 */
function mergeSpec(local: CompiledSpec, spec: SpecData): CompiledSpec {
  const agentItems = (spec.required_items ?? []).map((i) => i.replace(/_/g, " "));
  return {
    ...local,
    room: spec.room && spec.room.width_ft > 0 && spec.room.length_ft > 0 ? { width_ft: spec.room.width_ft, length_ft: spec.room.length_ft } : local.room,
    budget: spec.budget && spec.budget.maximum > 0 ? { maximum: spec.budget.maximum, currency: "USD" } : local.budget,
    required_by: spec.required_by ?? local.required_by,
    required_items: local.required_items.length > 0 ? local.required_items : agentItems
  };
}

/** One editable text row per entry, a remove control per row, and an add row. */
function EditableList({ id, values, placeholder, addLabel, onChange }: { id: string; values: string[]; placeholder: string; addLabel: string; onChange: (next: string[]) => void }) {
  return (
    <div className={styles.list} data-testid={`${id}-list`}>
      {values.map((value, i) => (
        <div className={styles.row} key={i}>
          <input
            className="input"
            value={value}
            aria-label={`${placeholder} ${i + 1}`}
            data-testid={`${id}-row`}
            onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.value : v)))}
          />
          <button className="btn" type="button" aria-label={`Remove ${value || placeholder}`} onClick={() => onChange(values.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div className={styles.add}>
        <button className="btn" type="button" onClick={() => onChange([...values, ""])} data-testid={`${id}-add`}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}

/** Colour swatches read off the board: a colour input edits each, the tag flips on click, and a colour input adds one. */
function SwatchList({ swatches, onChange }: { swatches: Swatch[]; onChange: (next: Swatch[]) => void }) {
  const [draft, setDraft] = useState("#888888");
  return (
    <div className={styles.list} data-testid="swatch-list">
      {swatches.map((sw, i) => (
        <div className={styles.swatchRow} key={i} data-testid="swatch-row">
          <input className={styles.colour} type="color" value={sw.hex} aria-label={`Colour ${i + 1}`} onChange={(e) => onChange(swatches.map((v, j) => (j === i ? { ...v, hex: e.target.value } : v)))} />
          <span className={styles.hex}>{sw.hex}</span>
          <button
            type="button"
            className={`tag ${sw.tag === "base" ? "blue" : "yellow"} ${styles.tagButton}`}
            data-testid="swatch-tag"
            data-tag={sw.tag}
            title="Click to switch between base and accent"
            onClick={() => onChange(swatches.map((v, j) => (j === i ? { ...v, tag: v.tag === "base" ? "accent" : "base" } : v)))}
          >
            {sw.tag === "base" ? "Base" : "Accent"}
          </button>
          <button className={styles.remove} type="button" aria-label={`Remove colour ${sw.hex}`} onClick={() => onChange(swatches.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <div className={styles.add}>
        <input className={styles.colour} type="color" value={draft} aria-label="New colour" onChange={(e) => setDraft(e.target.value)} />
        <button className="btn" type="button" onClick={() => onChange([...swatches, { hex: draft, tag: swatches.length === 0 ? "base" : "accent" }])} data-testid="swatch-add">
          Add colour
        </button>
      </div>
    </div>
  );
}

export function PreferencesStage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const identity = useIdentity(projectId);
  const editorRef = useRef<Editor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [board, setBoard] = useState<{ loaded: boolean; snapshot: TLEditorSnapshot | null }>({ loaded: false, snapshot: null });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [form, setForm] = useState<Form | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [approving, setApproving] = useState(false);
  const [compiling, setCompiling] = useState(false);

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

  /**
   * "Create plan from board": the PlanningAgent compiles the board (POST compile) when it can;
   * otherwise the newest spec artifact in the chat; otherwise the rule-based compiler. The
   * board's own room name survives either way because ProjectSpec has no field for it.
   */
  async function compile() {
    const editor = editorRef.current;
    if (!editor) return;
    setCompiling(true);
    const items = collectBoardItems(getSnapshot(editor.store));
    const local = compileBoard(items);
    const boardText = items.filter((i) => i.kind === "text").map((i) => i.text).join("\n");
    const swatches = items.filter((i) => i.kind === "swatch").map((i) => i.colour);
    try {
      let spec = await compileWithAgent(projectId, boardText, swatches);
      if (!spec) spec = await latestSpecArtifact(projectId);
      const merged = spec ? mergeSpec(local, spec) : local;
      setForm(toForm(merged));
      setMissing([!merged.room && "room size", !merged.budget && "budget", !merged.required_by && "date"].filter((m): m is string => !!m));
    } finally {
      setCompiling(false);
    }
  }

  const width = form ? parseFloat(form.width_ft) : NaN;
  const length = form ? parseFloat(form.length_ft) : NaN;
  const budget = form ? parseFloat(form.budget) : NaN;
  const canApprove = !!form && width > 0 && length > 0 && budget > 0 && !approving;

  async function approve() {
    if (!form || !canApprove) return;
    setApproving(true);
    const items = form.items.map((i) => i.trim()).filter(Boolean);
    const rules = form.rules.map((r) => r.trim()).filter(Boolean);
    const requirements: { type: string; value: unknown }[] = [
      ...items.map((value) => ({ type: "required_item", value })),
      { type: "visual_direction", value: { base: form.swatches.filter((s) => s.tag === "base").map((s) => s.hex), accent: form.swatches.filter((s) => s.tag === "accent").map((s) => s.hex) } },
      ...rules.map((sentence) => ({ type: "layout_requirement", value: parseLayoutRule(sentence, items) }))
    ];
    const createdBy = identity?.display_name ?? ANONYMOUS;
    const spec = fetch(`/api/projects/${projectId}/spec`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ space: { width_mm: width * MM_PER_FT, length_mm: length * MM_PER_FT, ...(form.room_name ? { name: form.room_name } : {}) }, requirements, created_by: createdBy })
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
      <p className="page-summary">Put the room size, budget, date, each item you need, colour swatches, and any layout rules on the board, then create the plan from it.</p>
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
              <p>The plan reads the board's notes for room size, budget, and date, then lists every item, colour swatch, and layout sentence the board names, in your words. Edit any of it before approving.</p>
              <button className="btn primary focal" type="button" onClick={compile} disabled={!board.loaded || compiling} data-testid="create-plan">
                {compiling ? "Reading the board" : "Create plan from board"}
              </button>
            </>
          )}
          {form && (
            <form
              className={styles.plan}
              data-testid="spec-form"
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
                <label>Items the board names</label>
                <EditableList id="item" values={form.items} placeholder="Item" addLabel="Add item" onChange={(items) => setForm({ ...form, items })} />
              </div>
              <div className="field">
                <label>Colours from the swatches</label>
                <SwatchList swatches={form.swatches} onChange={(swatches) => setForm({ ...form, swatches })} />
              </div>
              <div className="field">
                <label>Layout rules the board states</label>
                <EditableList id="rule" values={form.rules} placeholder="Rule" addLabel="Add rule" onChange={(rules) => setForm({ ...form, rules })} />
              </div>
              <div className={styles.actions}>
                <button className="btn primary focal" type="submit" disabled={!canApprove} data-testid="approve-plan">
                  Approve
                </button>
                <button className="btn" type="button" onClick={compile} disabled={compiling}>
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
