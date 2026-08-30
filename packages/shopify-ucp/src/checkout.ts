/**
 * A delivery probe: one `create_checkout` at a shop's endpoint for one variant and one
 * destination, time-boxed and never completed. The reply's fulfillment option titles carry the
 * delivery window a shopper sees. Shopify refuses a rate quote without a buyer email, a buyer
 * name, a phone number, and a street line; the placeholders below fill the slots a caller does
 * not have, and the result names which were used.
 */
import { DEFAULT_AGENT_PROFILE_URL, storefrontEndpoint } from "./client";

export const CHECKOUT_PLACEHOLDER_BUYER = { email: "planner@example.com", first_name: "Planning", last_name: "Agent" };
export const CHECKOUT_PLACEHOLDER_PHONE = "+12125550100";
export const CHECKOUT_PLACEHOLDER_STREET = "1 Main St";
export const CHECKOUT_TIMEOUT_MS = 15_000;
export type CheckoutPlaceholder = "buyer_email" | "buyer_name" | "phone" | "street";

export type CheckoutDestination = { first_name?: string; last_name?: string; phone_number?: string; street_address?: string; extended_address?: string; address_locality: string; address_region?: string; postal_code: string; address_country: string };
export type CheckoutOption = { id?: string; title?: string; description?: string; totals?: unknown };
export type CheckoutPayload = {
  id?: string;
  status?: string;
  fulfillment?: { methods?: { type?: string; groups?: { options?: CheckoutOption[] }[] }[] };
  links?: { type?: string; url?: string }[];
  messages?: { type?: string; code?: string; content?: string }[];
  totals?: unknown;
  [key: string]: unknown;
};
export type CheckoutProbe = { payload: CheckoutPayload | null; error?: string; placeholders_used: CheckoutPlaceholder[] };

/** What a checkout reply says about delivery to the destination, read from its messages and status. */
export type DeliveryVerdict = "quoted" | "refused" | "needs_buyer" | "unknown";

/**
 * Reads the reply's messages: a code or content that says the shop cannot deliver to the
 * destination is a refusal; an account, address-detail, or extension requirement is a step a
 * buyer completes and says nothing about delivery; a quoted option is a quote.
 */
export function deliveryVerdict(probe: CheckoutProbe): { verdict: DeliveryVerdict; detail: string | null } {
  const payload = probe.payload;
  if (!payload) return { verdict: "unknown", detail: probe.error ?? null };
  if (checkoutOptions(payload).length > 0) return { verdict: "quoted", detail: null };
  const messages = payload.messages ?? [];
  const refusal = messages.find((m) => /delivery_unavailable|shipping_unavailable|no_shipping|not_available|does_not_ship|country/i.test(m.code ?? "") || /(does not|doesn't|cannot|can't|no) (ship|deliver)|not available (in|to|for)|no shipping (rates|methods|options)/i.test(m.content ?? ""));
  if (refusal) return { verdict: "refused", detail: refusal.content ?? refusal.code ?? null };
  const buyer = messages.find((m) => /required|sign in|account|extension|detail_changed|address/i.test(`${m.code ?? ""} ${m.content ?? ""}`));
  if (buyer) return { verdict: "needs_buyer", detail: buyer.content ?? buyer.code ?? null };
  return { verdict: "unknown", detail: messages[0]?.content ?? payload.status ?? null };
}

/** The fulfillment option titles in the reply, in order; empty when the reply carried none. */
export function checkoutOptions(payload: CheckoutPayload | null): string[] {
  const out: string[] = [];
  for (const method of payload?.fulfillment?.methods ?? []) for (const group of method.groups ?? []) for (const option of group.options ?? []) if (option.title) out.push(option.title);
  return out;
}

/** The shop's shipping policy link when the reply carries one. */
export function shippingPolicyUrl(payload: CheckoutPayload | null): string | null {
  return payload?.links?.find((l) => l.type === "shipping_policy")?.url ?? null;
}

export async function probeCheckout(
  shopHost: string,
  input: { variantId: string; destination: CheckoutDestination; buyer?: { email?: string; first_name?: string; last_name?: string }; quantity?: number },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = CHECKOUT_TIMEOUT_MS
): Promise<CheckoutProbe> {
  const used: CheckoutPlaceholder[] = [];
  const buyer = { email: input.buyer?.email ?? (used.push("buyer_email"), CHECKOUT_PLACEHOLDER_BUYER.email), first_name: input.buyer?.first_name ?? (used.push("buyer_name"), CHECKOUT_PLACEHOLDER_BUYER.first_name), last_name: input.buyer?.last_name ?? CHECKOUT_PLACEHOLDER_BUYER.last_name };
  const d = input.destination;
  const destination = {
    first_name: d.first_name ?? buyer.first_name,
    last_name: d.last_name ?? buyer.last_name,
    phone_number: d.phone_number ?? (used.push("phone"), CHECKOUT_PLACEHOLDER_PHONE),
    street_address: d.street_address ?? (used.push("street"), CHECKOUT_PLACEHOLDER_STREET),
    ...(d.extended_address ? { extended_address: d.extended_address } : {}),
    address_locality: d.address_locality,
    ...(d.address_region ? { address_region: d.address_region } : {}),
    postal_code: d.postal_code,
    address_country: d.address_country
  };
  const checkout = { line_items: [{ item: { id: input.variantId }, quantity: input.quantity ?? 1 }], buyer, fulfillment: { methods: [{ type: "shipping", destinations: [destination] }] } };
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_checkout", arguments: { meta: { "ucp-agent": { profile: DEFAULT_AGENT_PROFILE_URL } }, checkout } } };
  try {
    const res = await fetchImpl(storefrontEndpoint(shopHost), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { payload: null, error: `HTTP ${res.status}`, placeholders_used: used };
    const envelope = (await res.json()) as { result?: { content?: { text?: string }[]; structuredContent?: CheckoutPayload; isError?: boolean }; error?: { message?: string } };
    if (envelope.error) return { payload: null, error: envelope.error.message ?? "rpc error", placeholders_used: used };
    const text = envelope.result?.content?.[0]?.text;
    let parsed: CheckoutPayload | null = envelope.result?.structuredContent ?? null;
    if (!parsed && text) {
      try {
        parsed = JSON.parse(text) as CheckoutPayload;
      } catch {
        parsed = null;
      }
    }
    // A tool result marked isError still carries the checkout when the shop answered with one
    // (status requires_escalation, a sign-in step); only a bare message is an error.
    if (envelope.result?.isError && !(parsed && typeof parsed === "object" && ("status" in parsed || "messages" in parsed))) return { payload: null, error: text ?? "tool error", placeholders_used: used };
    return { payload: parsed, ...(envelope.result?.isError ? { error: undefined } : {}), placeholders_used: used };
  } catch (e) {
    return { payload: null, error: (e as Error).message, placeholders_used: used };
  }
}
