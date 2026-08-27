"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Requirement, Space } from "../../../../domain/types";
import { formatFeetInches } from "../../../../domain/types";
import { FeetInchesField } from "../components/feet-inches-field";
import { PlanView } from "../components/plan-view";
import { DEFAULT_ROOM, DOOR_WIDTH_MM, WINDOW_WIDTH_MM, describeSpace, estimateRoom, wallLength, type Opening, type RoomEstimate, type Wall } from "../components/room-estimate";
import css from "../components/stages.module.css";
import type { RoomEstimateData } from "../artifacts/types";

const WALLS_SET = new Set<string>(["bottom", "top", "left", "right"]);

function readOpening(o: RoomEstimateData["door"], fallbackWidth: number): Opening | null {
  if (!o || !WALLS_SET.has(o.wall)) return null;
  return { wall: o.wall as Wall, offset_mm: Math.max(0, Number(o.offset_mm) || 0), width_mm: Math.max(100, Number(o.width_mm) || fallbackWidth) };
}

/**
 * Asks the PlanningAgent for a room estimate (PRD 20 stage 2); null when the route is absent, the
 * call fails, or the reply carries no plausible dimensions, in which case the rule-based estimate stands.
 */
async function estimateWithAgent(projectId: string, text: string, signal: AbortSignal): Promise<RoomEstimate | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}/room-estimate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { estimate?: RoomEstimateData | null } | RoomEstimateData | null;
    const e = json && typeof json === "object" && "estimate" in json ? json.estimate : (json as RoomEstimateData | null);
    if (!e || !(e.width_mm > 0) || !(e.length_mm > 0)) return null;
    return {
      name: e.name || "Living room",
      width_mm: Math.round(e.width_mm),
      length_mm: Math.round(e.length_mm),
      height_mm: e.height_mm ? Math.round(e.height_mm) : null,
      door: readOpening(e.door, DOOR_WIDTH_MM),
      window: readOpening(e.window, WINDOW_WIDTH_MM)
    };
  } catch {
    return null;
  }
}

const WALLS: { value: Wall; label: string }[] = [
  { value: "bottom", label: "Bottom wall" },
  { value: "top", label: "Top wall" },
  { value: "left", label: "Left wall" },
  { value: "right", label: "Right wall" }
];
const SHAPES = ["Rectangle", "L-shape", "T-shape", "Bay"] as const;

/** The board may carry the room sentence as a string or an object field; read it leniently. */
function sentenceFromRequirements(requirements: Requirement[]): string {
  for (const r of requirements) {
    if (r.status !== "agreed") continue;
    const v = r.value_json as { room?: unknown; text?: unknown; description?: unknown } | string | null;
    if (typeof v === "string" && /\d\s*(x|×|by)\s*\d/i.test(v)) return v;
    if (v && typeof v === "object") {
      for (const field of [v.room, v.text, v.description]) if (typeof field === "string" && /\d\s*(x|×|by)\s*\d/i.test(field)) return field;
      const room = v.room as { width_ft?: number; length_ft?: number } | undefined;
      if (room && typeof room.width_ft === "number" && typeof room.length_ft === "number") return `${room.width_ft} by ${room.length_ft} living room`;
    }
  }
  return "";
}

/**
 * Stage 2 (PRD 20): a sentence becomes a rule-based estimate, the person corrects the numbers, and
 * only "Confirm room" writes the Space. Door and window positions stay in this view: Space has no
 * columns for them yet.
 */
export function RoomConfigurator({ projectId, space, requirements }: { projectId: string; space: Space | null; requirements: Requirement[] }) {
  const router = useRouter();
  const initialText = space ? describeSpace(space) : sentenceFromRequirements(requirements);
  const [text, setText] = useState(initialText);
  const [room, setRoom] = useState<RoomEstimate>(() => (initialText ? estimateRoom(initialText) : DEFAULT_ROOM));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The rule-based estimate answers every keystroke; the agent's estimate, asked for after a pause
  // in typing, replaces it when it arrives and the text has not changed since.
  const agentCall = useRef<AbortController | null>(null);
  const agentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    agentCall.current?.abort();
    if (agentTimer.current) clearTimeout(agentTimer.current);
  }, []);

  function describe(next: string) {
    setText(next);
    if (!next.trim()) return;
    setRoom(estimateRoom(next));
    agentCall.current?.abort();
    if (agentTimer.current) clearTimeout(agentTimer.current);
    agentTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      agentCall.current = controller;
      const estimate = await estimateWithAgent(projectId, next, controller.signal);
      if (estimate && !controller.signal.aborted) setRoom(estimate);
    }, 600);
  }
  function setOpening(kind: "door" | "window", patch: Partial<Opening> | null) {
    setRoom((r) => {
      if (patch === null) return { ...r, [kind]: null };
      const current = r[kind] ?? { wall: kind === "door" ? "bottom" : "left", offset_mm: 0, width_mm: kind === "door" ? DOOR_WIDTH_MM : WINDOW_WIDTH_MM };
      return { ...r, [kind]: { ...current, ...patch } };
    });
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/spec`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space: { name: room.name, width_mm: room.width_mm, length_mm: room.length_mm, height_mm: room.height_mm } })
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      window.dispatchEvent(new Event("project:changed"));
      router.push(`/projects/${projectId}/place`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const openingRow = (kind: "door" | "window", o: Opening | null) => (
    <div className={css.opening}>
      <label className={css.row} style={{ gap: 6, height: 32, fontSize: 13, color: "var(--ink)" }}>
        <input type="checkbox" checked={o !== null} onChange={(e) => setOpening(kind, e.target.checked ? {} : null)} />
        {kind === "door" ? "Door" : "Window"}
      </label>
      <select className="select" aria-label={`${kind} wall`} disabled={!o} value={o?.wall ?? "bottom"} onChange={(e) => setOpening(kind, { wall: e.target.value as Wall, offset_mm: 0 })}>
        {WALLS.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </select>
      <div className="field">
        <label>Offset from corner (mm)</label>
        <input className="input" type="number" min={0} disabled={!o} value={o?.offset_mm ?? ""} onChange={(e) => setOpening(kind, { offset_mm: Math.max(0, Number(e.target.value)) })} />
      </div>
      <div className="field">
        <label>Width (mm)</label>
        <input className="input" type="number" min={100} disabled={!o} value={o?.width_mm ?? ""} onChange={(e) => setOpening(kind, { width_mm: Math.max(100, Number(e.target.value)) })} />
      </div>
    </div>
  );

  const openingNote = (o: Opening | null) => {
    if (!o) return null;
    const run = wallLength(o.wall, room.width_mm, room.length_mm);
    return o.offset_mm + o.width_mm > run ? <p className={css.error}>This opening runs past the end of its wall ({run} mm).</p> : null;
  };

  return (
    <>
      <h1 className="page-title">Room</h1>
      <p className="page-summary">Describe the room in a sentence, check the estimate, and confirm it. Nothing is saved until you confirm.</p>
      <div className={css.split}>
        <section className="surface" aria-label="Room configurator">
          <div className={css.stack}>
            <div className="field">
              <label htmlFor="room-text">Describe the room</label>
              <textarea id="room-text" data-testid="room-describe" className="textarea" rows={2} value={text} onChange={(e) => describe(e.target.value)} placeholder="12 by 18 living room, door on the short wall" />
            </div>
            <div>
              <div className="eyebrow">Shape</div>
              <div className={css.presets} style={{ marginTop: 6 }}>
                {SHAPES.map((shape) => (
                  <button key={shape} type="button" className={css.preset} aria-pressed={shape === "Rectangle"} disabled={shape !== "Rectangle"} title={shape === "Rectangle" ? undefined : "Rectangle only in this version"}>
                    {shape}
                  </button>
                ))}
              </div>
              <p className={css.hint}>Rectangle only in this version.</p>
            </div>
            <div>
              <div className="eyebrow">Dimensions</div>
              <div className={css.dims} style={{ marginTop: 6 }}>
                <FeetInchesField label="Width" mm={room.width_mm} onChange={(mm) => setRoom((r) => ({ ...r, width_mm: mm ?? 0 }))} />
                <FeetInchesField label="Length" mm={room.length_mm} onChange={(mm) => setRoom((r) => ({ ...r, length_mm: mm ?? 0 }))} />
                <FeetInchesField label="Height" mm={room.height_mm} optional onChange={(mm) => setRoom((r) => ({ ...r, height_mm: mm }))} />
              </div>
            </div>
            <div>
              <div className="eyebrow">Openings</div>
              <div className={css.openings} style={{ marginTop: 6 }}>
                {openingRow("door", room.door)}
                {openingNote(room.door)}
                {openingRow("window", room.window)}
                {openingNote(room.window)}
              </div>
            </div>
            <div className="field">
              <label htmlFor="room-name">Room name</label>
              <input id="room-name" className="input" value={room.name} onChange={(e) => setRoom((r) => ({ ...r, name: e.target.value }))} />
            </div>
            {error && (
              <p className={css.error} role="alert">
                {error}
              </p>
            )}
            <div className={css.spread}>
              <span className={css.note}>
                {formatFeetInches(room.width_mm)} × {formatFeetInches(room.length_mm)}
                {room.height_mm ? ` × ${formatFeetInches(room.height_mm)}` : ""}
              </span>
              <button className="btn primary focal" type="button" onClick={confirm} disabled={saving || room.width_mm < 500 || room.length_mm < 500} data-testid="confirm-room">
                {saving ? "Saving" : space ? "Update room" : "Confirm room"}
              </button>
            </div>
          </div>
        </section>
        <section className="surface" aria-label="Plan preview">
          <div className="eyebrow">Plan preview</div>
          <div className={css.canvas} style={{ marginTop: 12 }}>
            <PlanView space={room} door={room.door} window={room.window} maxHeight={620} />
          </div>
        </section>
      </div>
    </>
  );
}
