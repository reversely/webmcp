/**
 * Printshop's records (PRD Section 4). Designs and the shop are rows in src/data; batches live
 * in the store. Money in cents, dates ISO. Every list of statuses or field kinds is data, so a
 * new design or stage needs no code.
 */
import { z } from "zod";

export const Address = z.object({ name: z.string(), line1: z.string(), city: z.string(), region: z.string(), postal_code: z.string(), country: z.string() });
export type Address = z.infer<typeof Address>;

export const Field = z.object({ key: z.string(), label: z.string(), kind: z.enum(["text", "name", "monogram"]), max_length: z.number().int(), required: z.boolean() });
export type Field = z.infer<typeof Field>;

export const PriceBand = z.object({ min_quantity: z.number().int(), unit_cents: z.number().int() });
export const Template = z.object({ width: z.number(), height: z.number(), background: z.string(), ink: z.string(), heading: z.string(), name_y: z.number(), line_y: z.number() });

export const Design = z.object({
  id: z.string(),
  title: z.string(),
  format: z.string(),
  size: z.string(),
  paper: z.string(),
  print_method: z.string(),
  colours: z.array(z.string()),
  price_bands: z.array(PriceBand).min(1),
  lead_time_business_days: z.number().int(),
  minimum_quantity: z.number().int(),
  fields: z.array(Field),
  template: Template,
  image: z.string().nullable()
});
export type Design = z.infer<typeof Design>;

export const Stage = z.object({ status: z.string(), after_minutes: z.number(), text: z.string(), reference_prefix: z.string().optional() });
export const Shop = z.object({ name: z.string(), address: Address, currency: z.string(), tax_rate: z.number(), ships_to_countries: z.array(z.string()), profile_url: z.string(), stages: z.array(Stage) });
export type Shop = z.infer<typeof Shop>;

export const Unit = z.object({ recipient_ref: z.string(), values: z.record(z.string(), z.string()) });
export type Unit = z.infer<typeof Unit>;

export const Quote = z.object({ unit_cents: z.number().int(), quantity: z.number().int(), subtotal_cents: z.number().int(), tax_cents: z.number().int(), total_cents: z.number().int(), ready_by: z.string(), currency: z.string() });
export type Quote = z.infer<typeof Quote>;

export const Buyer = z.object({ name: z.string(), email: z.string(), phone: z.string().nullable() });
export type Buyer = z.infer<typeof Buyer>;

export const ThreadEntry = z.object({ seq: z.number().int(), at: z.string(), from: z.enum(["shop", "buyer"]), kind: z.string(), text: z.string(), reference: z.string().nullable() });
export type ThreadEntry = z.infer<typeof ThreadEntry>;

export const Issue = z.object({ recipient_ref: z.string(), field: z.string(), reason: z.string() });
export type Issue = z.infer<typeof Issue>;

export const Batch = z.object({
  id: z.string(),
  design_id: z.string(),
  buyer: Buyer,
  address: Address,
  needed_by: z.string(),
  units: z.array(Unit),
  quote: Quote,
  /** quoted, ordered, proofed, approved, then the shop's stages from shop.json, or held. */
  status: z.string(),
  proof: z.array(z.object({ recipient_ref: z.string(), svg: z.string() })).nullable(),
  issues: z.array(Issue),
  thread: z.array(ThreadEntry),
  approved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});
export type Batch = z.infer<typeof Batch>;

export const ChangeEntry = z.object({ seq: z.number().int(), at: z.string(), batch_id: z.string(), kind: z.string(), text: z.string() });
export type ChangeEntry = z.infer<typeof ChangeEntry>;
