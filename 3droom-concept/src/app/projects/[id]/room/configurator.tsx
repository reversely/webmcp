"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Space } from "../../../../domain/types";
import { formatFeetInches } from "../../../../domain/types";
import { FeetInchesField } from "../components/feet-inches-field";
import { PlanView } from "../components/plan-view";
import { EMPTY_ROOM, DOOR_WIDTH_MM, WINDOW_WIDTH_MM, wallLength, type Opening, type RoomEstimate, type Wall } from "../components/room-estimate";
import css from "../components/stages.module.css";
import { ANONYMOUS, useIdentity } from "../../../identity";

const WALLS: { value: Wall; label: string }[] = [
  { value: "bottom", label: "Bottom wall" },
  { value: "top", label: "Top wall" },
  { value: "left", label: "Left wall" },
  { value: "right", label: "Right wall" }
];

type Estimate = { name: string; width_mm: number; length_mm: number; height_mm: number | null };

/**
 * Stage 2 (PRD 20): the one place the room's numbers are entered. The fields prefill from the
 * confirmed Space, else from the estimate the board stage carried over, and only "Confirm room"
 * writes the Space. Door and window positions stay in this view: Space has no columns for them yet.
 */
export function RoomConfigurator({ projectId, space, estimate }: { projectId: string; space: Space | null; estimate: Estimate | null }) {
  const router = useRouter();
  const identity = useIdentity(projectId);
  const prefill = space ?? estimate;
  const [room, setRoom] = useState<RoomEstimate>(() => (prefill ? { ...EMPTY_ROOM, name: prefill.name, width_mm: prefill.width_mm, length_mm: prefill.length_mm, height_mm: prefill.height_mm ?? null } : EMPTY_ROOM));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        body: JSON.stringify({ space: { name: room.name, width_mm: room.width_mm, length_mm: room.length_mm, height_mm: room.height_mm }, created_by: identity?.display_name ?? ANONYMOUS })
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

  const sized = room.width_mm >= 500 && room.length_mm >= 500;

  const openingRow = (kind: "door" | "window", o: Opening | null) => (
    <div className={css.opening}>
      <label className={css.openingToggle}>
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
      {o && (
        <>
          <div className="field">
            <label htmlFor={`${kind}-offset`}>Offset from corner (mm)</label>
            <input id={`${kind}-offset`} className="input" type="number" min={0} value={o.offset_mm} onChange={(e) => setOpening(kind, { offset_mm: Math.max(0, Number(e.target.value)) })} />
          </div>
          <div className="field">
            <label htmlFor={`${kind}-width`}>Width (mm)</label>
            <input id={`${kind}-width`} className="input" type="number" min={100} value={o.width_mm} onChange={(e) => setOpening(kind, { width_mm: Math.max(100, Number(e.target.value)) })} />
          </div>
        </>
      )}
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
      <p className="page-summary">{space ? "The room as confirmed. Change any field and confirm again." : estimate ? "The room as the board stated it. Check the numbers, add the openings, and confirm. Nothing is saved until you confirm." : "Enter the room's width and length, add the openings, and confirm. Nothing is saved until you confirm."}</p>
      <div className={css.split}>
        <section className="surface" aria-label="Room configurator">
          <div className={css.stack}>
            <div>
              <div className="eyebrow">Dimensions</div>
              <div className={css.dims} style={{ marginTop: 6 }}>
                <FeetInchesField label="Width" mm={room.width_mm || null} onChange={(mm) => setRoom((r) => ({ ...r, width_mm: mm ?? 0 }))} />
                <FeetInchesField label="Length" mm={room.length_mm || null} onChange={(mm) => setRoom((r) => ({ ...r, length_mm: mm ?? 0 }))} />
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
                {sized ? `${formatFeetInches(room.width_mm)} × ${formatFeetInches(room.length_mm)}${room.height_mm ? ` × ${formatFeetInches(room.height_mm)}` : ""}` : "Width and length not set"}
              </span>
              <button className="btn primary focal" type="button" onClick={confirm} disabled={saving || !sized} data-testid="confirm-room">
                {saving ? "Saving" : space ? "Update room" : "Confirm room"}
              </button>
            </div>
          </div>
        </section>
        <section className="surface" aria-label="Plan preview">
          <div className="eyebrow">Plan preview</div>
          <div className={css.canvas} style={{ marginTop: 12 }}>
            {sized ? <PlanView space={room} door={room.door} window={room.window} maxHeight={620} /> : <div className="empty">The plan draws once the room has a width and a length.</div>}
          </div>
        </section>
      </div>
    </>
  );
}
