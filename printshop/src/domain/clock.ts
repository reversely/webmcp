/**
 * The shop's stages after approval (PRD Section 3): shop.json lists each status and how many
 * minutes after approval it begins. `advance` moves a batch to every stage whose time has come
 * and posts each into the thread; the demo calls it on a schedule or on demand.
 */
import { putBatch, recordChange, shop } from "./store";
import type { Batch } from "./types";

export function dueStages(batch: Batch, now: Date): { status: string; text: string; reference_prefix?: string }[] {
  if (!batch.approved_at) return [];
  const minutes = (now.getTime() - Date.parse(batch.approved_at)) / 60_000;
  const stages = shop().stages;
  const reached = stages.filter((s) => minutes >= s.after_minutes);
  const current = stages.findIndex((s) => s.status === batch.status);
  return reached.slice(current + 1);
}

export function advance(batch: Batch, now: Date): Batch {
  let next = batch;
  for (const stage of dueStages(batch, now)) {
    const reference = stage.reference_prefix ? `${stage.reference_prefix}${now.getTime().toString(36).toUpperCase().slice(-6)}` : null;
    const entry = { seq: recordChange(batch.id, stage.status, stage.text).seq, at: now.toISOString(), from: "shop" as const, kind: stage.status, text: stage.text, reference };
    next = putBatch({ ...next, status: stage.status, thread: [...next.thread, entry] });
  }
  return next;
}
