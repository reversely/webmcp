import { describe, expect, it } from "vitest";
import { normalizeDeliveryEvidence, type DeliveryEvidenceInput } from "./evidence";
import { rankDeliveryConfidence } from "./ranking";

// 2026-08-27 is a Thursday; 2026-09-15 is a Tuesday.
const ctx = { today: "2026-08-27", requiredBy: "2026-09-15" };

function fromPolicy(text: string) {
  return normalizeDeliveryEvidence({ kind: "duration_text", source: "shipping_policy", text }, ctx);
}

describe("duration_text phrases", () => {
  it.each([
    // Thu Aug 27 + 5 business days = Thu Sep 3, + 2 buffer = Mon Sep 7.
    ["ships in 3-5 business days", "likely", "2026-09-03", "2026-09-07"],
    // No ship verb, so no buffer: 7 business days from Thu Aug 27 = Mon Sep 7.
    ["5–7 business days", "likely", "2026-09-03", "2026-09-07"],
    // 24 hours rounds to one calendar day (Fri Aug 28), then 2 business days = Tue Sep 1.
    ["ships within 24 hours", "likely", "2026-08-31", "2026-09-01"],
    // Plain days are calendar days and carry no buffer.
    ["delivery in 10-14 days", "likely", "2026-09-06", "2026-09-10"],
    // Weeks are calendar weeks: 14 to 21 days straddles Sep 15, so neither likely nor fail.
    ["2 to 3 weeks", "unknown", "2026-09-10", "2026-09-17"],
    ["ships in 4-6 weeks", "fail", "2026-09-28", "2026-10-12"]
  ])("%s → %s (%s to %s)", (text, status, min, max) => {
    const result = fromPolicy(text);
    expect(result.status).toBe(status);
    expect(result.evidence.arrival_min).toBe(min);
    expect(result.evidence.arrival_max).toBe(max);
    expect(result.evidence.computed_from).toBe(ctx.today);
    expect(result.evidence.source).toBe("shipping_policy");
  });

  it("records the parsed duration and buffer for a ship-verb phrase", () => {
    expect(fromPolicy("Ships in 3-5 business days.").evidence.duration).toEqual({
      min_days: 3,
      max_days: 5,
      unit: "business_days",
      buffer_business_days: 2
    });
  });

  it("records no buffer for a bare duration", () => {
    expect(fromPolicy("5–7 business days").evidence.duration?.buffer_business_days).toBe(0);
  });

  it("treats an explicit delivery date range as confirmed", () => {
    const result = fromPolicy("Estimated delivery Sep 9 – Sep 12");
    expect(result.status).toBe("confirmed");
    expect(result.evidence.arrival_min).toBe("2026-09-09");
    expect(result.evidence.arrival_max).toBe("2026-09-12");
    expect(result.evidence.duration).toBeNull();
    expect(result.evidence.matched_text).toBe("Sep 9 – Sep 12");
  });

  it("treats 'arrives by' as an open-ended window ending on that date", () => {
    const result = fromPolicy("arrives by September 12");
    expect(result.status).toBe("confirmed");
    expect(result.evidence.arrival_min).toBeNull();
    expect(result.evidence.arrival_max).toBe("2026-09-12");
  });

  it("fails an explicit date range that ends after required_by", () => {
    expect(fromPolicy("Estimated delivery Sep 20 – Sep 24").status).toBe("fail");
  });

  it("rolls a month-day before today into the next year", () => {
    expect(fromPolicy("arrives by March 1").evidence.arrival_max).toBe("2027-03-01");
  });

  it("never turns 'in stock' into evidence", () => {
    const result = normalizeDeliveryEvidence(
      { kind: "duration_text", source: "description", text: "In stock" },
      ctx
    );
    expect(result.status).toBe("unknown");
    expect(result.evidence).toMatchObject({
      source: "description",
      matched_text: null,
      arrival_min: null,
      arrival_max: null,
      duration: null
    });
  });

  it("does not read a product count as a duration or a date", () => {
    expect(fromPolicy("Seats 3, in stock, marble 3 finish").status).toBe("unknown");
  });
});

describe("date_range", () => {
  function fromCheckout(min: string | null, max: string | null, addressPartial = false) {
    const input: DeliveryEvidenceInput = { kind: "date_range", source: "checkout_page", min, max, addressPartial };
    return normalizeDeliveryEvidence(input, ctx);
  }

  it("confirms a range ending on required_by", () => {
    expect(fromCheckout("2026-09-09", "2026-09-15").status).toBe("confirmed");
  });

  it("fails a range starting after required_by", () => {
    expect(fromCheckout("2026-09-16", "2026-09-20").status).toBe("fail");
  });

  it("stays unknown when the range straddles required_by", () => {
    expect(fromCheckout("2026-09-10", "2026-09-20").status).toBe("unknown");
  });

  it("stays unknown when both dates are null", () => {
    const result = fromCheckout(null, null);
    expect(result.status).toBe("unknown");
    expect(result.evidence.source).toBe("checkout_page");
  });

  it("carries address completeness into the evidence", () => {
    expect(fromCheckout("2026-09-09", "2026-09-12", true).evidence.address_partial).toBe(true);
  });

  it("keeps a cart_api source", () => {
    const result = normalizeDeliveryEvidence(
      { kind: "date_range", source: "cart_api", min: null, max: "2026-09-12", addressPartial: false },
      ctx
    );
    expect(result.status).toBe("confirmed");
    expect(result.evidence.source).toBe("cart_api");
  });
});

describe("none", () => {
  it("is unknown with empty evidence", () => {
    const result = normalizeDeliveryEvidence({ kind: "none" }, ctx);
    expect(result.status).toBe("unknown");
    expect(result.evidence.source).toBe("none");
  });
});

describe("rankDeliveryConfidence", () => {
  it("orders confirmed > likely > unknown > fail", () => {
    expect(rankDeliveryConfidence("confirmed")).toBe(3);
    expect(rankDeliveryConfidence("likely")).toBe(2);
    expect(rankDeliveryConfidence("unknown")).toBe(1);
    expect(rankDeliveryConfidence("fail")).toBe(0);
    expect(rankDeliveryConfidence(null)).toBe(1);
  });
});
