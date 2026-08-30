/** The in-memory store on globalThis: the design and shop rows read from src/data, the batches, and the change log. */
import designsData from "../data/designs.json";
import shopData from "../data/shop.json";
import { Batch, Design, Shop, type ChangeEntry } from "./types";

type State = { batches: Map<string, Batch>; changes: ChangeEntry[]; seq: number; ids: number };
declare global {
  // eslint-disable-next-line no-var
  var __printshopState: State | undefined;
}
const fresh = (): State => ({ batches: new Map(), changes: [], seq: 0, ids: 0 });
export function state(): State {
  if (!globalThis.__printshopState) globalThis.__printshopState = fresh();
  return globalThis.__printshopState;
}
export function resetState(): void {
  globalThis.__printshopState = fresh();
}
export function newId(prefix: string): string {
  const s = state();
  s.ids += 1;
  return `${prefix}_${s.ids}`;
}
export function nextSeq(): number {
  const s = state();
  s.seq += 1;
  return s.seq;
}

const DESIGNS: Design[] = Design.array().parse(designsData);
const SHOP: Shop = Shop.parse(shopData);

export function designs(): Design[] {
  return DESIGNS;
}
export function getDesign(id: string): Design | undefined {
  return DESIGNS.find((d) => d.id === id);
}
export function shop(): Shop {
  return SHOP;
}

export function getBatch(id: string): Batch | undefined {
  return state().batches.get(id);
}
export function putBatch(batch: Batch): Batch {
  state().batches.set(batch.id, { ...batch, updated_at: new Date().toISOString() });
  return state().batches.get(batch.id)!;
}
export function batchesFor(email: string | null): Batch[] {
  return [...state().batches.values()].filter((b) => !email || b.buyer.email.toLowerCase() === email.toLowerCase());
}

/** Appends a change entry and returns it; every batch event goes through here (PRD Section 5, get_changes). */
export function recordChange(batchId: string, kind: string, text: string): ChangeEntry {
  const entry: ChangeEntry = { seq: nextSeq(), at: new Date().toISOString(), batch_id: batchId, kind, text };
  state().changes.push(entry);
  return entry;
}
export function changesSince(seq: number, email: string | null): ChangeEntry[] {
  const mine = new Set(batchesFor(email).map((b) => b.id));
  return state().changes.filter((c) => c.seq > seq && (!email || mine.has(c.batch_id)));
}
export function currentSeq(): number {
  return state().seq;
}
