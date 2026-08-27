"use client";
import { feetToMm, inchesToMm, MM_PER_INCH } from "../../../../domain/types";
import css from "./stages.module.css";

/** Feet and inches inputs for one length, with the millimetre value underneath. */
export function FeetInchesField({ label, mm, onChange, optional }: { label: string; mm: number | null; onChange: (mm: number | null) => void; optional?: boolean }) {
  // Round to whole inches first so 2743 mm reads 9' 0" rather than 8' 12".
  const totalIn = mm == null ? null : Math.round(mm / MM_PER_INCH);
  const ft = totalIn == null ? "" : String(Math.floor(totalIn / 12));
  const inches = totalIn == null ? "" : String(totalIn % 12);
  function set(nextFt: string, nextIn: string) {
    if (nextFt === "" && nextIn === "") return onChange(optional ? null : 0);
    onChange(feetToMm(Number(nextFt || 0)) + inchesToMm(Number(nextIn || 0)));
  }
  return (
    <div className="field">
      <label>
        {label}
        {optional ? <span className={css.unit}> (optional)</span> : null}
      </label>
      <div className={css.ftin}>
        <input className="input" type="number" min={0} inputMode="numeric" value={ft} placeholder="ft" aria-label={`${label}, feet`} onChange={(e) => set(e.target.value, inches)} />
        <input className="input" type="number" min={0} max={11} inputMode="numeric" value={inches} placeholder="in" aria-label={`${label}, inches`} onChange={(e) => set(ft, e.target.value)} />
      </div>
      <div className={css.mm}>{mm == null ? "not set" : `${mm} mm`}</div>
    </div>
  );
}
