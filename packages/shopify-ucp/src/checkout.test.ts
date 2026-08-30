import { describe, expect, it } from "vitest";
import { checkoutOptions, deliveryVerdict, probeCheckout } from "./checkout";

describe("probeCheckout", () => {
  it("posts create_checkout for the variant and destination, fills the slots it lacks, and reads the option titles", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ status: "incomplete", fulfillment: { methods: [{ type: "shipping", groups: [{ options: [{ title: "Standard (5 to 7 business days)" }, { title: "Express" }] }] }] } }) }] } }), { headers: { "Content-Type": "application/json" } });
    };
    const probe = await probeCheckout("shop.myshopify.com", { variantId: "gid://shopify/ProductVariant/1", destination: { address_locality: "City", address_region: "RG", postal_code: "00000", address_country: "CA" } }, fetchImpl);
    const params = sent.params as { name: string; arguments: { checkout: { line_items: unknown[]; fulfillment: { methods: { destinations: { street_address: string; phone_number: string }[] }[] } } } };
    expect(params.name).toBe("create_checkout");
    expect(params.arguments.checkout.line_items).toEqual([{ item: { id: "gid://shopify/ProductVariant/1" }, quantity: 1 }]);
    expect(params.arguments.checkout.fulfillment.methods[0].destinations[0].street_address).toBe("1 Main St");
    expect(probe.placeholders_used).toEqual(["buyer_email", "buyer_name", "phone", "street"]);
    expect(checkoutOptions(probe.payload)).toEqual(["Standard (5 to 7 business days)", "Express"]);
  });
  it("reports an HTTP failure and a tool error without throwing", async () => {
    const failing: typeof fetch = async () => new Response("no", { status: 429 });
    expect((await probeCheckout("shop.myshopify.com", { variantId: "v", destination: { address_locality: "C", postal_code: "0", address_country: "CA" } }, failing)).error).toBe("HTTP 429");
    const toolError: typeof fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "no shipping to that country" }], isError: true } }), { headers: { "Content-Type": "application/json" } });
    expect((await probeCheckout("shop.myshopify.com", { variantId: "v", destination: { address_locality: "C", postal_code: "0", address_country: "CA" } }, toolError)).error).toBe("no shipping to that country");
  });
});

describe("deliveryVerdict", () => {
  it("reads a quote, a refusal, a buyer step, and an unknown from the reply", async () => {
    const reply = (payload: unknown, isError = false): typeof fetch => async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError } }), { headers: { "Content-Type": "application/json" } });
    const dest = { address_locality: "C", postal_code: "0", address_country: "CA" };
    const quoted = await probeCheckout("s.myshopify.com", { variantId: "v", destination: dest }, reply({ status: "incomplete", fulfillment: { methods: [{ groups: [{ options: [{ title: "Standard (3 to 5 days)" }] }] }] } }));
    expect(deliveryVerdict(quoted).verdict).toBe("quoted");
    const refused = await probeCheckout("s.myshopify.com", { variantId: "v", destination: dest }, reply({ status: "incomplete", fulfillment: { methods: [] }, messages: [{ type: "error", code: "delivery_unavailable", content: "We do not ship to this address." }] }, true));
    expect(deliveryVerdict(refused)).toEqual({ verdict: "refused", detail: "We do not ship to this address." });
    const step = await probeCheckout("s.myshopify.com", { variantId: "v", destination: dest }, reply({ status: "requires_escalation", fulfillment: { methods: [] }, messages: [{ type: "error", code: "customer_account_required", content: "You must sign in to continue." }] }, true));
    expect(step.payload).not.toBeNull();
    expect(deliveryVerdict(step).verdict).toBe("needs_buyer");
    const bare = await probeCheckout("s.myshopify.com", { variantId: "v", destination: dest }, async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "no such variant" }], isError: true } }), { headers: { "Content-Type": "application/json" } }));
    expect(deliveryVerdict(bare)).toEqual({ verdict: "unknown", detail: "no such variant" });
  });
});
