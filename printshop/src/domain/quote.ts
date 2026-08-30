/**
 * The quote (PRD Sections 5, 6): the price band the quantity reaches, tax at the shop's rate,
 * and the ready-by date from the design's lead time in business days. A refusal names its rule.
 */
import { addBusinessDays, isOnOrBefore } from "@webmcp/shopify-ucp";
import type { Design, Quote, Shop } from "./types";

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; rule: "minimum_quantity" | "lead_time" | "ships_to" | "quantity"; reason: string };

export function unitPrice(design: Design, quantity: number): number | null {
  const band = [...design.price_bands].sort((a, b) => b.min_quantity - a.min_quantity).find((b) => quantity >= b.min_quantity);
  return band?.unit_cents ?? null;
}

export function readyBy(design: Design, today: string): string {
  return addBusinessDays(today, design.lead_time_business_days);
}

export function quoteBatch(design: Design, shop: Shop, input: { quantity: number; needed_by: string; country: string; today: string }): QuoteResult {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) return { ok: false, rule: "quantity", reason: "Quantity must be a whole number above zero" };
  if (input.quantity < design.minimum_quantity) return { ok: false, rule: "minimum_quantity", reason: `Minimum ${design.minimum_quantity} units for ${design.title}` };
  if (!shop.ships_to_countries.includes(input.country.toUpperCase())) return { ok: false, rule: "ships_to", reason: `No delivery to ${input.country.toUpperCase()}` };
  const ready = readyBy(design, input.today);
  if (!isOnOrBefore(ready, input.needed_by)) return { ok: false, rule: "lead_time", reason: `Ready by ${ready} after the needed-by date ${input.needed_by}` };
  const unit = unitPrice(design, input.quantity)!;
  const subtotal = unit * input.quantity;
  const tax = Math.round(subtotal * shop.tax_rate);
  return { ok: true, quote: { unit_cents: unit, quantity: input.quantity, subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax, ready_by: ready, currency: shop.currency } };
}
