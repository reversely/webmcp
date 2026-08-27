import { describe, expect, it } from "vitest";
import { checkoutOptions, deliveryFromSources, shippingPolicyUrl, type CheckoutPayload } from "./delivery";
import fixtures from "./fixtures/checkout-responses.json";

const CHECKOUTS = fixtures as Record<string, CheckoutPayload>;
const CTX = { requiredBy: "2026-09-15", today: "2026-08-27" };

describe("deliveryFromSources", () => {
  it("reads an explicit date range from a checkout option title as confirmed", () => {
    const result = deliveryFromSources({ checkout: CHECKOUTS.tresings, policyText: null, description: "", addressPartial: true }, CTX);
    expect(result.status).toBe("confirmed");
    expect(result.evidence).toMatchObject({ source: "checkout_page", arrival_min: "2026-09-01", arrival_max: "2026-09-02", address_partial: true });
    expect(result.options).toEqual(["Standard (Tuesday, September 1–Wednesday, September 2 via Standard)"]);
    expect(result.checkout_status).toBe("requires_escalation");
  });

  it("reads a calendar-day duration as likely and a business-day duration too", () => {
    const nathan = deliveryFromSources({ checkout: CHECKOUTS.nathan_home, policyText: null, description: "", addressPartial: false }, CTX);
    expect(nathan.status).toBe("likely");
    expect(nathan.evidence.duration).toMatchObject({ min_days: 8, max_days: 11, unit: "calendar_days" });
    const modway = deliveryFromSources({ checkout: CHECKOUTS.modway, policyText: null, description: "", addressPartial: false }, CTX);
    expect(modway.status).toBe("likely");
    expect(modway.evidence.duration).toMatchObject({ min_days: 3, max_days: 12, unit: "business_days" });
  });

  it("marks a duration that overshoots the required date as fail", () => {
    const late = deliveryFromSources({ checkout: CHECKOUTS.nathan_home, policyText: null, description: "", addressPartial: false }, { requiredBy: "2026-09-01", today: "2026-08-27" });
    expect(late.status).toBe("fail");
  });

  it("falls through an option without a window to the shipping policy, then the description", () => {
    const policy = deliveryFromSources(
      { checkout: CHECKOUTS.english_elm, policyText: "Orders ship within 2 business days.", description: "", addressPartial: false },
      CTX
    );
    expect(policy.status).toBe("likely");
    expect(policy.evidence.source).toBe("shipping_policy");
    const description = deliveryFromSources(
      { checkout: CHECKOUTS.english_elm, policyText: "Free returns.", description: "Delivered in 5 to 7 days.", addressPartial: false },
      CTX
    );
    expect(description.evidence.source).toBe("description");
    const nothing = deliveryFromSources({ checkout: CHECKOUTS.english_elm, policyText: null, description: "Solid oak.", addressPartial: false }, CTX);
    expect(nothing.status).toBe("unknown");
    expect(nothing.options).toEqual(["Free Shipping"]);
  });

  it("keeps the checkout failure reason when the probe returned nothing", () => {
    const result = deliveryFromSources({ checkout: null, checkoutError: "HTTP 500", policyText: null, description: "", addressPartial: false }, CTX);
    expect(result).toMatchObject({ status: "unknown", checkout_error: "HTTP 500", options: [] });
  });

  it("finds the shipping policy link and flattens option groups", () => {
    expect(shippingPolicyUrl(CHECKOUTS.modway)).toBe("https://modway-dev.myshopify.com/policies/shipping-policy");
    expect(checkoutOptions({ fulfillment: { methods: [{ groups: [{ options: [{ title: "A", description: "B" }, { title: "C", description: "C" }] }] }] } })).toEqual(["A B", "C"]);
  });
});
