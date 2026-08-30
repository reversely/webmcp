/** The operations behind the routes and the tools (PRD Section 5); each returns data or throws a typed error `errorResponse` maps. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { advance } from "../domain/clock";
import { renderProof } from "../domain/proof";
import { quoteBatch } from "../domain/quote";
import { batchesFor, changesSince, currentSeq, designs, getBatch, getDesign, newId, putBatch, recordChange, shop } from "../domain/store";
import { Address, Buyer, Unit, type Batch, type ThreadEntry } from "../domain/types";
import { validateUnits } from "../domain/validate";

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}
const today = () => new Date().toISOString().slice(0, 10);
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new BadRequestError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
};

export function listDesigns(filter: { format?: string; max_unit_cents?: number }) {
  return designs().filter((d) => (!filter.format || d.format === filter.format) && (filter.max_unit_cents === undefined || Math.min(...d.price_bands.map((b) => b.unit_cents)) <= filter.max_unit_cents));
}
export function requireDesign(id: string) {
  const d = getDesign(id);
  if (!d) throw new NotFoundError(`No design ${id}`);
  return d;
}
export function requireBatch(id: string, email: string | null): Batch {
  const b = getBatch(id);
  if (!b || (email && b.buyer.email.toLowerCase() !== email.toLowerCase())) throw new NotFoundError(`No batch ${id}`);
  return b;
}

const QuoteBody = z.object({ design_id: z.string(), quantity: z.number().int(), needed_by: z.string(), address: Address });
export function quote(body: unknown) {
  const q = parse(QuoteBody, body);
  const design = requireDesign(q.design_id);
  const result = quoteBatch(design, shop(), { quantity: q.quantity, needed_by: q.needed_by, country: q.address.country, today: today() });
  if (!result.ok) throw new BadRequestError(`${result.rule}: ${result.reason}`);
  return { design_id: design.id, ...result.quote };
}

const ValidateBody = z.object({ design_id: z.string(), units: z.array(Unit) });
export function validate(body: unknown) {
  const v = parse(ValidateBody, body);
  return { design_id: v.design_id, issues: validateUnits(requireDesign(v.design_id), v.units) };
}

function entry(from: ThreadEntry["from"], kind: string, text: string, batchId: string, reference: string | null = null): ThreadEntry {
  const change = recordChange(batchId, kind, text);
  return { seq: change.seq, at: change.at, from, kind, text, reference };
}

const CreateBody = z.object({ design_id: z.string(), units: z.array(Unit).min(1), address: Address, needed_by: z.string(), buyer: Buyer });
export function createBatch(body: unknown): Batch {
  const c = parse(CreateBody, body);
  const design = requireDesign(c.design_id);
  const result = quoteBatch(design, shop(), { quantity: c.units.length, needed_by: c.needed_by, country: c.address.country, today: today() });
  if (!result.ok) throw new BadRequestError(`${result.rule}: ${result.reason}`);
  const id = newId("batch");
  const now = new Date().toISOString();
  const issues = validateUnits(design, c.units);
  const batch: Batch = { id, design_id: design.id, buyer: c.buyer, address: c.address, needed_by: c.needed_by, units: c.units, quote: result.quote, status: "quoted", proof: null, issues, thread: [entry("shop", "quoted", `Quoted ${c.units.length} units at ${result.quote.unit_cents} cents`, id)], approved_at: null, created_at: now, updated_at: now };
  return putBatch(batch);
}

export function updateBatch(id: string, email: string | null, body: unknown): Batch {
  const batch = requireBatch(id, email);
  if (batch.status !== "quoted") throw new BadRequestError(`Batch ${id} is ${batch.status} and takes no unit changes`);
  const { units } = parse(z.object({ units: z.array(Unit).min(1) }), body);
  const design = requireDesign(batch.design_id);
  const result = quoteBatch(design, shop(), { quantity: units.length, needed_by: batch.needed_by, country: batch.address.country, today: today() });
  if (!result.ok) throw new BadRequestError(`${result.rule}: ${result.reason}`);
  return putBatch({ ...batch, units, quote: result.quote, issues: validateUnits(design, units), thread: [...batch.thread, entry("shop", "requoted", `Requoted ${units.length} units`, id)] });
}

export function orderBatch(id: string, email: string | null): Batch {
  const batch = requireBatch(id, email);
  if (batch.status !== "quoted") throw new BadRequestError(`Batch ${id} is ${batch.status}`);
  if (batch.issues.length) throw new BadRequestError(`${batch.issues.length} units have issues`);
  const design = requireDesign(batch.design_id);
  const proof = batch.units.map((u) => ({ recipient_ref: u.recipient_ref, svg: renderProof(design, u) }));
  return putBatch({ ...batch, status: "proofed", proof, thread: [...batch.thread, entry("shop", "ordered", "Ordered", id), entry("shop", "proof", "Proof ready", id)] });
}

export function approveProof(id: string, email: string | null): Batch {
  const batch = requireBatch(id, email);
  if (batch.status !== "proofed") throw new BadRequestError(`Batch ${id} is ${batch.status} and has no proof to approve`);
  return putBatch({ ...batch, status: "approved", approved_at: new Date().toISOString(), thread: [...batch.thread, entry("buyer", "approved", "Proof approved", id)] });
}

export function postMessage(id: string, email: string | null, body: unknown): Batch {
  const batch = requireBatch(id, email);
  const { text, from } = parse(z.object({ text: z.string().min(1), from: z.enum(["shop", "buyer"]).default("buyer") }), body);
  return putBatch({ ...batch, thread: [...batch.thread, entry(from, "message", text, id)] });
}

/** Moves every approved batch through the stages whose minutes have passed; the clock route and the demo call it. */
export function advanceAll(now = new Date()): Batch[] {
  return batchesFor(null).map((b) => (b.approved_at ? advance(b, now) : b));
}

export function batchView(id: string, email: string | null): Batch {
  const batch = requireBatch(id, email);
  return batch.approved_at ? advance(batch, new Date()) : batch;
}

export function changes(since: number, email: string | null) {
  advanceAll();
  return { since, seq: currentSeq(), entries: changesSince(since, email) };
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  if (e instanceof BadRequestError) return NextResponse.json({ error: e.message }, { status: 400 });
  throw e;
}
