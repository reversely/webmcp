"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
import { getSnapshot } from "tldraw";
import type { BoardInitial, SaveState } from "./board-canvas";
import { collectBoardItems, compileBoard, parseLayoutRule, tagSwatches, type Swatch } from "./compileBoard";
import { ruleSentence } from "../../../../domain/geometry";
import { readLayoutRule } from "../../../../domain/types";
import { latestArtifact, type ArtifactMessage } from "../artifacts";
import type { SpecData } from "../artifacts/types";
import { ANONYMOUS, useIdentity } from "../../../identity";
import styles from "./board.module.css";

// tldraw reads window at import time, so the canvas is loaded on the client only.
const BoardCanvas = dynamic(() => import("./board-canvas"), { ssr: false, loading: () => <div className={styles.placeholder}>Loading the board.</div> });

/** A swatch on the form: from a filled shape, or suggested by the model from a colour note (`from_text`). */
type FormSwatch = Swatch & { from_text?: string };

/**
 * The plan form: the three fixed fields (room, budget, date) in their own rows and, below them,
 * whatever the board named, in the board's words: items, colour swatches, and layout sentences.
 * Budget and date are the project's current values (set once on the landing form); the board's
 * parse fills them only while the project has none.
 */
type Form = {
  /** The board's room reading, carried to the Room stage as its prefill; the Room stage is where the numbers are edited and confirmed. */
  room: { width_ft: number; length_ft: number } | null;
  budget: string;
  required_by: string;
  items: string[];
  swatches: FormSwatch[];
  rules: string[];
  room_name: string | null;
};

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

async function compileWithAgent(projectId: string, boardText: string[], swatches: string[]): Promise<SpecData | null> {
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

/** The agent's room in millimetres (or an older artifact's feet) as feet for the form, or null. */
function roomFeet(room: SpecData["room"]): { width_ft: number; length_ft: number } | null {
  if (!room) return null;
  const width = room.width_mm ? room.width_mm / MM_PER_FT : (room.width_ft ?? 0);
  const length = room.length_mm ? room.length_mm / MM_PER_FT : (room.length_ft ?? 0);
  return width > 0 && length > 0 ? { width_ft: Math.round(width * 100) / 100, length_ft: Math.round(length * 100) / 100 } : null;
}

/** A compiled layout rule as the sentence the form edits. */
/**
 * The board's own sentence for a rule the model read, when a board line states the same relation
 * about the same subject ("big rug underneath everything" stays as written); the model's expansion
 * is regenerated only for a rule no board line states. Approve re-parses the sentence, so the
 * board's phrase is what the requirement records.
 */
function sentenceOf(rule: NonNullable<SpecData["layout_requirements"]>[number], boardRules: string[]): string | null {
  const parsed = readLayoutRule("distance_mm" in rule && rule.distance_mm === null ? { ...rule, distance_mm: undefined } : rule);
  if (!parsed) return null;
  if (parsed.relation === "text") return parsed.text;
  const stated = boardRules.find((sentence) => {
    const own = parseLayoutRule(sentence);
    return own.relation === parsed.relation && own.subject.toLowerCase() === parsed.subject.toLowerCase();
  });
  return stated ?? ruleSentence(parsed);
}

/** The project's budget and date as stored: the single entry point for both is the landing form. */
async function projectFields(projectId: string): Promise<{ budget: string; required_by: string }> {
  try {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!res.ok) return { budget: "", required_by: "" };
    const snap = (await res.json()) as { project?: { budget_cents?: number; required_by?: string | null } };
    const cents = snap.project?.budget_cents ?? 0;
    return { budget: cents > 0 ? String(cents / 100) : "", required_by: snap.project?.required_by ?? "" };
  } catch {
    return { budget: "", required_by: "" };
  }
}

/**
 * The model's reading is the form when it answered: its items (the board's phrases, qualifiers
 * kept), its layout rules, its room, and, while the project has none, its budget and date. Colour
 * swatches come from filled shapes plus the colours the model read from notes, tagged base or
 * accent by luminance together. The regex compiler fills the form only when the model returned
 * nothing.
 */
function buildForm(spec: SpecData | null, boardItems: ReturnType<typeof collectBoardItems>, project: { budget: string; required_by: string }): Form {
  const shapeHexes = boardItems.filter((i) => i.kind === "swatch").map((i) => i.colour);
  const local = compileBoard(boardItems);
  if (!spec) {
    return {
      room: local.room,
      budget: project.budget || (local.budget ? String(local.budget.maximum) : ""),
      required_by: project.required_by || (local.required_by ?? ""),
      items: local.required_items,
      swatches: local.swatches,
      rules: local.layout_rules,
      room_name: local.room_name
    };
  }
  const suggested = spec.suggested_colours ?? [];
  const tagged = tagSwatches([...shapeHexes, ...suggested.map((c) => c.hex)]);
  const swatches: FormSwatch[] = tagged.map((sw, i) => (i < shapeHexes.length ? sw : { ...sw, from_text: suggested[i - shapeHexes.length].from_text }));
  return {
    room: roomFeet(spec.room),
    budget: project.budget || (spec.budget && spec.budget.maximum > 0 ? String(spec.budget.maximum) : ""),
    required_by: project.required_by || (spec.required_by ?? ""),
    items: (spec.required_items ?? []).map((i) => (typeof i === "string" ? i : i.name)).filter(Boolean),
    swatches,
    rules: (spec.layout_requirements ?? []).map((rule) => sentenceOf(rule, local.layout_rules)).filter((r): r is string => !!r),
    room_name: spec.room_name ?? null
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

/** Colour swatches read off the board: a colour input edits each, the tag flips on click, and a colour input adds one. A swatch the model read from a note says which note. */
function SwatchList({ swatches, onChange }: { swatches: FormSwatch[]; onChange: (next: FormSwatch[]) => void }) {
  const [draft, setDraft] = useState("#888888");
  return (
    <div className={styles.list} data-testid="swatch-list">
      {swatches.map((sw, i) => (
        <div className={styles.swatchRow} key={i} data-testid="swatch-row">
          <input className={styles.colour} type="color" value={sw.hex} aria-label={`Colour ${i + 1}`} onChange={(e) => onChange(swatches.map((v, j) => (j === i ? { ...v, hex: e.target.value } : v)))} />
          <span className={styles.hex}>{sw.hex}</span>
          <button
            type="button"
            className={styles.tagButton}
            data-testid="swatch-tag"
            data-tag={sw.tag}
            title="Click to switch between base and accent"
            onClick={() => onChange(swatches.map((v, j) => (j === i ? { ...v, tag: v.tag === "base" ? "accent" : "base" } : v)))}
          >
            {sw.tag === "base" ? "Base" : "Accent"}
          </button>
          <button className="btn" type="button" aria-label={`Remove colour ${sw.hex}`} onClick={() => onChange(swatches.filter((_, j) => j !== i))}>
            Remove
          </button>
          {sw.from_text && (
            <span className={styles.from} data-testid="swatch-from">
              from the note &ldquo;{sw.from_text}&rdquo;
            </span>
          )}
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
  const [board, setBoard] = useState<{ loaded: boolean; initial: BoardInitial }>({ loaded: false, initial: null });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [form, setForm] = useState<Form | null>(null);
  const [approving, setApproving] = useState(false);
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/spec`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { board: BoardInitial }) => {
        if (!cancelled) setBoard({ loaded: true, initial: data.board ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /**
   * "Create plan from board": the PlanningAgent compiles the board (POST compile) when it can;
   * otherwise the newest spec artifact in the chat; otherwise the rule-based compiler.
   */
  async function compile() {
    const editor = editorRef.current;
    if (!editor) return;
    setCompiling(true);
    const items = collectBoardItems(getSnapshot(editor.store));
    const boardText = items.filter((i) => i.kind === "text").map((i) => i.text);
    const swatches = items.filter((i) => i.kind === "swatch").map((i) => i.colour);
    try {
      const [project, agentSpec] = await Promise.all([projectFields(projectId), compileWithAgent(projectId, boardText, swatches)]);
      const spec = agentSpec ?? (await latestSpecArtifact(projectId));
      setForm(buildForm(spec, items, project));
    } finally {
      setCompiling(false);
    }
  }

  const budget = form ? parseFloat(form.budget) : NaN;
  const canApprove = !!form && budget > 0 && !approving;

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
      body: JSON.stringify({
        // The board's room reading travels as an estimate; the Room stage confirms it as the Space.
        ...(form.room ? { space: { confirmed: false, width_mm: form.room.width_ft * MM_PER_FT, length_mm: form.room.length_ft * MM_PER_FT, ...(form.room_name ? { name: form.room_name } : {}) } } : {}),
        requirements,
        created_by: createdBy
      })
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
      <p className="page-summary">Put each item you need, colour swatches, any layout rules, and the room size on the board, then create the plan from it.</p>
      <div className={styles.stage}>
        <section className={styles.canvasSurface} aria-label="Whiteboard">
          <div className={styles.canvasHeader}>
            <span className="eyebrow">Board</span>
            <span className={styles.status} aria-live="polite">{STATUS[saveState]}</span>
          </div>
          <div className={styles.canvas}>
            {board.loaded ? (
              <BoardCanvas
                projectId={projectId}
                initial={board.initial}
                onReady={(editor) => {
                  editorRef.current = editor;
                }}
                onSaveState={setSaveState}
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
              <p>The plan lists every item, colour swatch, and layout sentence the board names, in your words. Edit any of it before approving; the room size the board states goes to the Room stage.</p>
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
