/**
 * Delivery evidence for one candidate (PRD 10). The primary source is the merchant's UCP
 * `create_checkout`, whose shipping option titles carry the window a shopper sees; the shipping
 * policy page and the product description follow. The checkout is never completed.
 */
import { DEFAULT_AGENT_PROFILE_URL, storefrontEndpoint } from "../commerce";
import { normalizeDeliveryEvidence, parseArrivalWindow, type DeliveryEvidence, type DeliveryStatusValue } from "../domain/delivery";
import { stripHtml } from "../domain/products/normalize";
import type { DeliveryAddress, Product } from "../domain/types";
import { appState, updateCandidate } from "../server/state";

/** Placeholder buyer identity for checkout probes; no order is ever placed with it. */
export const PROBE_BUYER = { email: "planner@example.com", first_name: "Zach", last_name: "Planner" };
/** A merchant checkout requires a phone number; this placeholder is never contacted. */
export const PROBE_PHONE = "+12125551234";
/** Used when the project address carries no street line; the evidence is then `address_partial`. */
export const PLACEHOLDER_STREET = "1 Main St";
export const CHECKOUT_TIMEOUT_MS = 15_000;

export type CheckoutOption = { title?: string; description?: string };
export type CheckoutPayload = {
  status?: string;
  fulfillment?: { methods?: { groups?: { options?: CheckoutOption[] }[] }[] };
  links?: { type?: string; url?: string }[];
  messages?: { code?: string }[];
};

export type DeliverySources = {
  checkout: CheckoutPayload | null;
  checkoutError?: string;
  policyText: string | null;
  description: string;
  addressPartial: boolean;
};

export type DeliveryResult = {
  status: DeliveryStatusValue;
  evidence: DeliveryEvidence;
  /** Every option title seen, so a reader can check the extraction. */
  options: string[];
  checkout_status: string | null;
  checkout_error?: string;
};

const STATUS_ORDER: DeliveryStatusValue[] = ["confirmed", "likely", "fail", "unknown"];

export function checkoutOptions(payload: CheckoutPayload | null): string[] {
  return (payload?.fulfillment?.methods ?? [])
    .flatMap((m) => m.groups ?? [])
    .flatMap((g) => g.options ?? [])
    .map((o) => (o.description && o.description !== o.title ? `${o.title ?? ""} ${o.description}` : o.title ?? "").trim())
    .filter((t) => t.length > 0);
}

export function shippingPolicyUrl(payload: CheckoutPayload | null): string | null {
  return payload?.links?.find((l) => l.type === "shipping_policy" && l.url)?.url ?? null;
}

/**
 * Normalizes evidence in PRD 10 order: checkout options, then the shipping policy, then the
 * description. The first source that yields a status other than `unknown` wins; among several
 * checkout options the best one counts, since a shopper may choose any of them.
 */
export function deliveryFromSources(sources: DeliverySources, ctx: { requiredBy: string; today: string }): DeliveryResult {
  const options = checkoutOptions(sources.checkout);
  const base = {
    options,
    checkout_status: sources.checkout?.status ?? null,
    ...(sources.checkoutError ? { checkout_error: sources.checkoutError } : {})
  };

  let best: { status: DeliveryStatusValue; evidence: DeliveryEvidence } | null = null;
  for (const text of options) {
    if (!parseArrivalWindow(text, ctx.today)) continue;
    // The option text is parsed like merchant prose (dates → confirmed, durations → likely) and
    // recorded under its true source, the checkout, with the address completeness it was probed with.
    const normalized = normalizeDeliveryEvidence({ kind: "duration_text", source: "shipping_policy", text }, ctx);
    const candidate = {
      status: normalized.status,
      evidence: { ...normalized.evidence, source: "checkout_page" as const, address_partial: sources.addressPartial }
    };
    if (!best || STATUS_ORDER.indexOf(candidate.status) < STATUS_ORDER.indexOf(best.status)) best = candidate;
  }
  if (best && best.status !== "unknown") return { ...best, ...base };

  if (sources.policyText) {
    const policy = normalizeDeliveryEvidence({ kind: "duration_text", source: "shipping_policy", text: sources.policyText }, ctx);
    if (policy.status !== "unknown") return { ...policy, ...base };
  }
  if (sources.description) {
    const description = normalizeDeliveryEvidence({ kind: "duration_text", source: "description", text: sources.description }, ctx);
    if (description.status !== "unknown") return { ...description, ...base };
  }
  return { ...(best ?? normalizeDeliveryEvidence({ kind: "none" }, ctx)), ...base };
}

function destinationFor(address: DeliveryAddress) {
  return {
    first_name: PROBE_BUYER.first_name,
    last_name: PROBE_BUYER.last_name,
    phone_number: PROBE_PHONE,
    street_address: address.line1 ?? PLACEHOLDER_STREET,
    address_locality: address.city ?? "",
    address_region: address.region ?? "",
    postal_code: address.postal_code,
    address_country: address.country
  };
}

function variantIdOf(product: Product): string | null {
  const variant = product.variant_json as { id?: string | number } | null;
  return variant?.id !== undefined ? String(variant.id) : null;
}

/** One `create_checkout` on the seller's storefront MCP, time-boxed; never `complete_checkout`. */
export async function probeCheckout(
  product: Product,
  address: DeliveryAddress,
  fetchImpl: typeof fetch = fetch
): Promise<{ payload: CheckoutPayload | null; error?: string }> {
  const variantId = variantIdOf(product);
  if (!variantId) return { payload: null, error: "product has no variant id" };
  const checkout = {
    line_items: [{ item: { id: variantId }, quantity: 1 }],
    buyer: PROBE_BUYER,
    fulfillment: { methods: [{ type: "shipping", destinations: [destinationFor(address)] }] }
  };
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "create_checkout", arguments: { meta: { "ucp-agent": { profile: DEFAULT_AGENT_PROFILE_URL } }, checkout } }
  };
  try {
    const res = await fetchImpl(storefrontEndpoint(product.merchant), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHECKOUT_TIMEOUT_MS)
    });
    if (!res.ok) return { payload: null, error: `HTTP ${res.status}` };
    const envelope = (await res.json()) as { result?: { content?: { text?: string }[] }; error?: { message?: string } };
    if (envelope.error) return { payload: null, error: envelope.error.message ?? "rpc error" };
    const text = envelope.result?.content?.[0]?.text;
    return { payload: text ? (JSON.parse(text) as CheckoutPayload) : null };
  } catch (e) {
    return { payload: null, error: (e as Error).message };
  }
}

export async function fetchPolicyText(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(CHECKOUT_TIMEOUT_MS), redirect: "follow" });
    if (!res.ok) return null;
    return stripHtml(await res.text()).slice(0, 20_000);
  } catch {
    return null;
  }
}

export type EvaluateDeliveryOptions = { today?: string; fetchImpl?: typeof fetch };

/**
 * Evaluates one candidate and stores `delivery_status` and `delivery_evidence_json` on it.
 *
 * Raises:
 *   Error("MISSING_PARAMETER(delivery_address)") when the project has no address; the caller
 *   (sourceRoom) gates on the address before reaching here.
 */
export async function evaluateDelivery(projectId: string, candidateId: string, options: EvaluateDeliveryOptions = {}): Promise<DeliveryResult> {
  const s = appState();
  const project = s.store.getProject(projectId);
  const candidate = s.store.candidates.get(candidateId);
  if (!candidate) throw new Error(`Candidate ${candidateId} not found`);
  const address = project.delivery_address_json;
  if (!address) throw new Error("MISSING_PARAMETER(delivery_address)");
  const product = s.store.getProduct(candidate.product_id);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const ctx = { requiredBy: project.required_by ?? "9999-12-31", today };

  const probe = await probeCheckout(product, address, options.fetchImpl);
  const policyUrl = shippingPolicyUrl(probe.payload);
  const policyText = policyUrl ? await fetchPolicyText(policyUrl, options.fetchImpl) : null;
  const result = deliveryFromSources(
    { checkout: probe.payload, checkoutError: probe.error, policyText, description: product.description, addressPartial: !address.line1 },
    ctx
  );
  updateCandidate(candidateId, { delivery_status: result.status, delivery_evidence_json: result });
  return result;
}
