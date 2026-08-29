import { describe, expect, it } from "vitest";
import type { DeliveryAddress } from "../domain/types";
import { upsertCandidate } from "./catalog";
import { checkoutOptions, checkoutPlaceholders, deliveryFromSources, probeCheckout, shippingPolicyUrl, type CheckoutPayload } from "./delivery";
import { fakeCatalogProduct, resetState, seedProject } from "./test-helpers";
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
    expect(result.placeholders_used).toEqual(["buyer_email", "buyer_name", "phone", "street"]);
  });

  it("records which checkout placeholders a probe used", () => {
    expect(checkoutPlaceholders(false)).toEqual(["buyer_email", "buyer_name", "phone"]);
    const full = deliveryFromSources({ checkout: CHECKOUTS.nathan_home, policyText: null, description: "", addressPartial: false }, CTX);
    expect(full.placeholders_used).toEqual(["buyer_email", "buyer_name", "phone"]);
    const unprobed = deliveryFromSources({ checkout: null, policyText: null, description: "Delivered in 5 to 7 days.", addressPartial: true }, CTX);
    expect(unprobed.placeholders_used).toEqual([]);
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

describe("probeCheckout destination", () => {
  it("sends the stored country and region as given and keeps the postal code's space", async () => {
    resetState();
    const projectId = seedProject();
    const { product } = upsertCandidate(projectId, fakeCatalogProduct("deep couch", 1, 89900), "deep couch", "seating");
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(CHECKOUTS.nathan_home) }] } }), { headers: { "Content-Type": "application/json" } });
    };
    const address: DeliveryAddress = { line1: "5 York Garden Way", city: "North York", region: "ON", postal_code: "M6A 0G9", country: "CA", currency: "CAD", source: "given" };
    const probe = await probeCheckout(product, address, fetchImpl);
    expect(probe.error).toBeUndefined();
    const checkout = ((bodies[0].params as { arguments: { checkout: { fulfillment: { methods: { destinations: unknown[] }[] } } } }).arguments).checkout;
    expect(checkout.fulfillment.methods[0].destinations[0]).toMatchObject({ street_address: "5 York Garden Way", address_locality: "North York", address_region: "ON", postal_code: "M6A 0G9", address_country: "CA" });
  });

  it("sends no probe for an address without a country", async () => {
    resetState();
    const projectId = seedProject();
    const { product } = upsertCandidate(projectId, fakeCatalogProduct("deep couch", 1, 89900), "deep couch", "seating");
    const calls: unknown[] = [];
    const fetchImpl: typeof fetch = async (url) => (calls.push(url), new Response("{}"));
    const probe = await probeCheckout(product, { line1: "also make the rug bigger", city: null, region: null, postal_code: "", country: null, source: "given" }, fetchImpl);
    expect(calls).toEqual([]);
    expect(probe).toEqual({ payload: null, error: "the address names no country, so no shipping destination was sent" });
  });
});
