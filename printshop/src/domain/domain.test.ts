import { beforeEach, describe, expect, it } from "vitest";
import { advance, dueStages } from "./clock";
import { renderProof } from "./proof";
import { quoteBatch, unitPrice } from "./quote";
import { designs, getBatch, newId, putBatch, resetState, shop } from "./store";
import { validateUnits } from "./validate";
import type { Batch } from "./types";

const design = () => designs()[0];

describe("quote", () => {
  it("picks the band the quantity reaches and adds tax", () => {
    const d = design();
    expect(unitPrice(d, d.minimum_quantity)).toBe(d.price_bands[0].unit_cents);
    const big = d.price_bands[d.price_bands.length - 1];
    const q = quoteBatch(d, shop(), { quantity: big.min_quantity, needed_by: "2031-01-01", country: "CA", today: "2030-01-01" });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.quote.unit_cents).toBe(big.unit_cents);
    expect(q.quote.subtotal_cents).toBe(big.unit_cents * big.min_quantity);
    expect(q.quote.tax_cents).toBe(Math.round(q.quote.subtotal_cents * shop().tax_rate));
    expect(q.quote.total_cents).toBe(q.quote.subtotal_cents + q.quote.tax_cents);
  });
  it("refuses below the minimum, past the lead time, and outside the delivery countries, naming the rule", () => {
    const d = design();
    expect(quoteBatch(d, shop(), { quantity: d.minimum_quantity - 1, needed_by: "2031-01-01", country: "CA", today: "2030-01-01" })).toMatchObject({ ok: false, rule: "minimum_quantity" });
    expect(quoteBatch(d, shop(), { quantity: d.minimum_quantity, needed_by: "2030-01-02", country: "CA", today: "2030-01-01" })).toMatchObject({ ok: false, rule: "lead_time" });
    expect(quoteBatch(d, shop(), { quantity: d.minimum_quantity, needed_by: "2031-01-01", country: "FR", today: "2030-01-01" })).toMatchObject({ ok: false, rule: "ships_to" });
  });
});

describe("validateUnits", () => {
  it("names a missing required field, an over-long value, a bad monogram, an unknown field, and a duplicate", () => {
    const d = designs().find((x) => x.fields.some((f) => f.kind === "monogram"))!;
    const issues = validateUnits(d, [
      { recipient_ref: "g1", values: { name: "" } },
      { recipient_ref: "g2", values: { name: "x".repeat(d.fields[0].max_length + 1) } },
      { recipient_ref: "g3", values: { name: "Ok", monogram: "1234" } },
      { recipient_ref: "g3", values: { name: "Ok", other: "y" } }
    ]);
    expect(issues.map((i) => `${i.recipient_ref}:${i.field}`)).toEqual(["g1:name", "g2:name", "g3:monogram", "g3:recipient_ref", "g3:other"]);
  });
});

describe("renderProof", () => {
  it("renders an SVG with the heading, the name, and the line, escaped", () => {
    const svg = renderProof(design(), { recipient_ref: "g1", values: { name: "A & B", line: "<thanks>" } });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("A &amp; B");
    expect(svg).toContain("&lt;thanks&gt;");
    expect(svg).toContain(design().template.heading);
  });
});

describe("the clock", () => {
  beforeEach(resetState);
  it("moves an approved batch through the shop's stages as their minutes pass and posts each", () => {
    const d = design();
    const batch: Batch = { id: newId("batch"), design_id: d.id, buyer: { name: "B", email: "b@example.com", phone: null }, address: shop().address, needed_by: "2031-01-01", units: [], quote: { unit_cents: 1, quantity: 1, subtotal_cents: 1, tax_cents: 0, total_cents: 1, ready_by: "2030-02-01", currency: "CAD" }, status: "approved", proof: null, issues: [], thread: [], approved_at: "2030-01-01T00:00:00Z", created_at: "2030-01-01T00:00:00Z", updated_at: "2030-01-01T00:00:00Z" };
    putBatch(batch);
    expect(dueStages(batch, new Date("2030-01-01T00:00:30Z"))).toEqual([]);
    const stages = shop().stages;
    const after = advance(batch, new Date(Date.parse(batch.approved_at!) + stages[1].after_minutes * 60_000));
    expect(after.status).toBe(stages[1].status);
    expect(after.thread.map((t) => t.kind)).toEqual([stages[0].status, stages[1].status]);
    expect(after.thread[1].reference).toMatch(new RegExp(`^${stages[1].reference_prefix}`));
    expect(advance(getBatch(batch.id)!, new Date(Date.parse(batch.approved_at!) + stages[1].after_minutes * 60_000)).thread).toHaveLength(2);
  });
});
