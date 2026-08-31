/**
 * Catalog search and ranking for a card or a sentence (PRD Sections 8, 10, 11). A card's rows in
 * cards.json name the searches (query plus taxonomy id); a sentence runs as typed plus the ids of
 * the cards it names. Every candidate carries its seller, its variants, and a delivery probe.
 * Stage 1 (eligibility) and Stage 2 (scoring) read only those fields and the event.
 */
import { addCalendarDays, deliveryVerdict, isOnOrBefore, parseArrivalWindow, probeCheckout, checkoutOptions, shippingPolicyUrl, type CatalogClient, type CatalogProduct, type CheckoutProbe, type DeliveryVerdict } from "@webmcp/shopify-ucp";
import cardsData from "./cards.json";

export type CardSearch = { query: string; categories?: string[] };
/** A search source: the Shopify catalog, the print shop, or the configured custom shop; a card names its sources, and a card row without them searches the catalog alone. */
export type Source = "shopify" | "printshop" | "customshop";
export const DEFAULT_SOURCES: Source[] = ["shopify"];
export type Card = { key: string; label: string; searches: CardSearch[]; sources?: Source[]; personalized?: boolean };
export type CardsConfig = { cards: Card[]; delivery_buffer_days: number; lead_time_cap_days: number; weights: Record<ScoreTerm, number> };
export type ScoreTerm = "coverage" | "lead_time" | "price_fit" | "delivery_confidence" | "cancellation_terms" | "seller_signal";

export function cardsConfig(): CardsConfig {
  return cardsData as CardsConfig;
}

export type Variant = { id: string; title: string; price_cents: number | null; currency: string | null; available: boolean; options: { name: string; label: string }[] };
/** One value a personalized unit carries, as the vendor's schema states it; domain/types.ts holds the kind list. */
export type { PersonalizationField } from "../domain/types";
import type { PersonalizationField } from "../domain/types";
export type Candidate = {
  product_id: string;
  title: string;
  description: string;
  url: string | null;
  image_url: string | null;
  shop_domain: string;
  shop_name: string;
  shop_url: string | null;
  policy_links: { type: string; url: string }[];
  price_cents: number | null;
  currency: string | null;
  variants: Variant[];
  option_names: string[];
  searches: string[];
  delivery: { window: { earliest: string; latest: string } | null; text: string | null; confidence: "dated" | "duration" | "unknown"; verdict: DeliveryVerdict; error: string | null } | null;
  /** Set on a print-shop design or a configured custom-shop product: the fields each unit carries. */
  personalization?: { fields: PersonalizationField[] };
};

/** What each search returned and how many products each stage kept, for the results screen and the ask bar. */
export type Funnel = { searches: { query: string; categories?: string[]; returned: number; total: number | null; error?: string }[]; merged: number; probed: number; ranked: number; excluded: Record<string, number> };

export type EventContext = {
  /** ISO date of the event. */
  event_date: string;
  /** The venue as a checkout destination. */
  venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string };
  /** The per-gift budget in cents, or null when the organizer set none. */
  budget_cents: number | null;
  /** How many guests would receive one. */
  quantity: number;
  /** ISO date of the run, for the delivery arithmetic. */
  today: string;
  /** True when the request asks for each guest's name on the unit, so only a candidate with a name field covers it. */
  personalized?: boolean;
};

/* ---- Stage 0: search and detail ---- */

function toCandidate(product: CatalogProduct, search: string): Candidate | null {
  const variants = (product.variants ?? []) as CatalogProduct["variants"];
  const first = variants?.find((v) => v.availability?.available) ?? variants?.[0];
  const seller = first?.seller as { domain?: string; name?: string; url?: string; links?: { type?: string; url?: string }[] } | undefined;
  if (!seller?.domain) return null;
  const desc = typeof product.description === "string" ? product.description : ((product.description as { plain?: string } | undefined)?.plain ?? "");
  const pr = product.price_range as { min?: { amount?: number | string; currency?: string } } | undefined;
  const media = (product.media as { url?: string }[] | undefined) ?? [];
  return {
    product_id: product.id,
    title: product.title,
    description: desc,
    url: (first?.url as string | undefined) ?? (product.url as string | undefined) ?? null,
    image_url: media[0]?.url ?? null,
    shop_domain: seller.domain,
    shop_name: seller.name ?? seller.domain,
    shop_url: seller.url ?? null,
    policy_links: (seller.links ?? []).filter((l): l is { type: string; url: string } => !!l.type && !!l.url),
    price_cents: pr?.min?.amount !== undefined ? Number(pr.min.amount) : (first?.price?.amount !== undefined ? Number(first.price.amount) : null),
    currency: pr?.min?.currency ?? first?.price?.currency ?? null,
    variants: (variants ?? []).map((v) => ({ id: v.id, title: v.title ?? "", price_cents: v.price?.amount !== undefined ? Number(v.price.amount) : null, currency: v.price?.currency ?? null, available: v.availability?.available !== false, options: (v.options ?? []).map((o) => ({ name: String(o.name), label: String(o.label) })) })),
    option_names: [...new Set((variants ?? []).flatMap((v) => (v.options ?? []).map((o) => String(o.name))))],
    searches: [search],
    delivery: null
  };
}

/** Runs every search of a card (or the sentence's searches) and merges the products by id; a product found twice keeps both search labels. */
export async function searchCandidates(client: CatalogClient, searches: CardSearch[], ctx: EventContext, options: { limit?: number; pages?: number; sleepMs?: number; funnel?: Funnel } = {}): Promise<Candidate[]> {
  const merged = new Map<string, Candidate>();
  for (const s of searches) {
    // The catalog reads the price ceiling in minor units (cents), the same unit it returns prices in.
    const filters: Record<string, unknown> = { ships_to: { country: ctx.venue.country, region: ctx.venue.region, postal_code: ctx.venue.postal_code }, ships_from: [{ country: ctx.venue.country }], available: true };
    if (s.categories?.length) filters.categories = s.categories;
    if (ctx.budget_cents !== null) filters.price = { max: ctx.budget_cents };
    let cursor: string | undefined;
    let returned = 0;
    let total: number | null = null;
    for (let page = 0; page < (options.pages ?? 1); page++) {
      const result = await client.searchCatalog({ query: s.query, filters: filters as never, context: { address_country: ctx.venue.country, address_region: ctx.venue.region, postal_code: ctx.venue.postal_code } as never, pagination: { limit: options.limit ?? 50, ...(cursor ? { cursor } : {}) } });
      const pg = result.pagination as { has_next_page?: boolean; cursor?: string; next_cursor?: string; total_count?: number } | undefined;
      total = pg?.total_count ?? total;
      for (const product of result.products ?? []) {
        returned++;
        const c = toCandidate(product, s.categories?.length ? `${s.query} [${s.categories.join(",")}]` : s.query);
        if (!c) continue;
        const seen = merged.get(c.product_id);
        if (seen) seen.searches.push(...c.searches);
        else merged.set(c.product_id, c);
      }
      cursor = pg?.next_cursor ?? pg?.cursor;
      if (!pg?.has_next_page || !cursor) break;
      if (options.sleepMs) await new Promise((r) => setTimeout(r, options.sleepMs));
    }
    options.funnel?.searches.push({ query: s.query, categories: s.categories, returned, total });
    if (options.sleepMs) await new Promise((r) => setTimeout(r, options.sleepMs));
  }
  if (options.funnel) options.funnel.merged = merged.size;
  return [...merged.values()];
}

/** The searches a sentence maps to: the sentence as typed plus the searches of every card whose label it names. */
export function searchesForSentence(sentence: string, config = cardsConfig()): CardSearch[] {
  return [{ query: sentence }, ...cardsNamed(sentence, config).flatMap((c) => c.searches)];
}

function cardsNamed(sentence: string, config: CardsConfig): Card[] {
  const lower = sentence.toLowerCase();
  return config.cards.filter((c) => c.label.toLowerCase().split(/\s*&\s*|\s+/).some((w) => w.length > 3 && lower.includes(w)));
}

/** A sentence asks for personalization when it names a name or a personalized item. */
export function personalizedRequest(sentence: string): boolean {
  return /\bnames?\b|personali[sz]/i.test(sentence);
}

/** The sources a sentence searches: the catalog, plus the sources of every card it names, plus the print shop when it asks for cards and the custom shop when it asks for sweatshirts. */
export function sourcesForSentence(sentence: string, config = cardsConfig()): Source[] {
  const sources = new Set<Source>(DEFAULT_SOURCES);
  for (const card of cardsNamed(sentence, config)) for (const s of card.sources ?? []) sources.add(s);
  if (/\bcards?\b/i.test(sentence)) sources.add("printshop");
  if (/\bsweatshirts?\b|\bcrewnecks?\b/i.test(sentence)) sources.add("customshop");
  return [...sources];
}

/** Fills a candidate's variants and option values from get_product when the search left them thin. */
export async function withDetail(client: CatalogClient, candidate: Candidate): Promise<Candidate> {
  try {
    const detail = await client.getProduct(candidate.product_id);
    const product = (detail as { product?: CatalogProduct }).product ?? (detail as unknown as CatalogProduct);
    const filled = toCandidate(product, candidate.searches[0]);
    if (!filled) return candidate;
    return { ...candidate, description: filled.description || candidate.description, variants: filled.variants.length ? filled.variants : candidate.variants, option_names: filled.option_names.length ? filled.option_names : candidate.option_names, image_url: candidate.image_url ?? filled.image_url };
  } catch {
    return candidate;
  }
}

/* ---- Stage 0b: the delivery probe ---- */

export async function withDelivery(candidate: Candidate, ctx: EventContext, fetchImpl: typeof fetch = fetch): Promise<Candidate> {
  const variant = candidate.variants.find((v) => v.available) ?? candidate.variants[0];
  if (!variant) return { ...candidate, delivery: { window: null, text: null, confidence: "unknown", verdict: "unknown", error: "the product has no variant to price" } };
  const probe: CheckoutProbe = await probeCheckout(candidate.shop_domain, { variantId: variant.id, destination: { address_locality: ctx.venue.city, address_region: ctx.venue.region, postal_code: ctx.venue.postal_code, address_country: ctx.venue.country, street_address: ctx.venue.line1 || undefined }, quantity: 1 }, fetchImpl);
  const { verdict, detail } = deliveryVerdict(probe);
  if (!probe.payload) return { ...candidate, delivery: { window: null, text: null, confidence: "unknown", verdict: "unknown", error: probe.error ?? detail } };
  const titles = checkoutOptions(probe.payload);
  for (const title of titles) {
    const window = parseArrivalWindow(title, ctx.today);
    if (window) return { ...candidate, delivery: { window: { earliest: window.arrival_min ?? window.arrival_max, latest: window.arrival_max }, text: title, confidence: window.duration ? "duration" : "dated", verdict: "quoted", error: null } };
  }
  const policy = shippingPolicyUrl(probe.payload);
  return { ...candidate, delivery: { window: null, text: titles[0] ?? detail, confidence: "unknown", verdict, error: verdict === "refused" ? detail : policy || titles.length ? null : (detail ?? "the checkout returned no delivery option") } };
}

/* ---- Stage 1: eligibility ---- */

export type Verdict = { eligible: boolean; rule: string | null; reason: string | null };

/** Each rule names its source (PRD Section 10). A product passes when every rule holds; the first failing rule is the reason. */
export function eligibility(c: Candidate, ctx: EventContext, config = cardsConfig()): Verdict {
  if (c.delivery?.verdict === "refused") return { eligible: false, rule: "ships_to_venue", reason: `The shop's checkout refused the venue: ${c.delivery.error ?? c.delivery.text ?? "no delivery to the address"}.` };
  if (c.delivery?.window) {
    const latest = addCalendarDays(c.delivery.window.latest, config.delivery_buffer_days);
    if (!isOnOrBefore(latest, ctx.event_date)) return { eligible: false, rule: "delivery", reason: `Delivery by ${c.delivery.window.latest} plus ${config.delivery_buffer_days} days falls after the event.` };
  }
  if (ctx.budget_cents !== null && c.price_cents !== null && c.price_cents > ctx.budget_cents) return { eligible: false, rule: "price", reason: `The unit price is above the budget of ${ctx.budget_cents} cents.` };
  if (!c.variants.some((v) => v.available)) return { eligible: false, rule: "availability", reason: "No variant is available." };
  return { eligible: true, rule: null, reason: null };
}

/* ---- Stage 2: scoring ---- */

export type Scored = Candidate & { score: number; terms: Record<ScoreTerm, number>; verdict: Verdict };

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/**
 * How well a unit price uses the amount the organizer set per person: 1 from 60% to 100% of it,
 * falling to 0 at a price of nothing, and 0 above it. A gift budget is an amount to spend, so a
 * cheaper product does not outrank one that uses it.
 */
export function priceFit(price_cents: number | null, budget_cents: number | null): number {
  if (budget_cents === null || budget_cents <= 0 || price_cents === null) return 0.5;
  if (price_cents > budget_cents) return 0;
  const share = price_cents / budget_cents;
  return share >= 0.6 ? 1 : share / 0.6;
}

/** Each term is normalized to 0 to 1 and weighted by the configuration row. Coverage: for a personalized request a candidate with a name field covers it and any other candidate scores 0; otherwise the given value (1 until a dietary mapping exists; Section 9 supplies it later). */
export function score(c: Candidate, ctx: EventContext, config = cardsConfig(), coverage = 1): Scored {
  const verdict = eligibility(c, ctx, config);
  if (ctx.personalized) coverage = c.personalization?.fields.some((f) => f.kind === "name") ? 1 : 0;
  const lead = c.delivery?.window ? Math.max(0, Math.min(config.lead_time_cap_days, daysBetween(c.delivery.window.latest, ctx.event_date))) / config.lead_time_cap_days : 0;
  const fit = priceFit(c.price_cents, ctx.budget_cents);
  const confidence = c.delivery?.confidence === "dated" ? 1 : c.delivery?.confidence === "duration" ? 0.5 : 0;
  const refund = c.policy_links.some((l) => l.type === "refund_policy") ? 0.5 : 0;
  const seller = (c.shop_url ? 0.4 : 0) + (c.policy_links.length >= 4 ? 0.3 : 0) + (c.delivery?.window ? 0.3 : 0);
  const terms: Record<ScoreTerm, number> = { coverage, lead_time: lead, price_fit: fit, delivery_confidence: confidence, cancellation_terms: refund, seller_signal: seller };
  const total = (Object.keys(terms) as ScoreTerm[]).reduce((s, k) => s + terms[k] * config.weights[k], 0) / (Object.values(config.weights).reduce((a, b) => a + b, 0) || 1);
  return { ...c, score: Math.round(total * 1000) / 1000, terms, verdict };
}

/** The eligible candidates by score, best first; the excluded ones follow with their rule, so the assistant can say why a product is missing. */
export function rank(candidates: Candidate[], ctx: EventContext, config = cardsConfig(), funnel?: Funnel): { ranked: Scored[]; excluded: Scored[] } {
  const scored = candidates.map((c) => score(c, ctx, config));
  const ranked = scored.filter((s) => s.verdict.eligible).sort((a, b) => b.score - a.score);
  const excluded = scored.filter((s) => !s.verdict.eligible);
  if (funnel) {
    funnel.ranked = ranked.length;
    funnel.excluded = {};
    for (const e of excluded) funnel.excluded[e.verdict.rule ?? "other"] = (funnel.excluded[e.verdict.rule ?? "other"] ?? 0) + 1;
  }
  return { ranked, excluded };
}

export function emptyFunnel(): Funnel {
  return { searches: [], merged: 0, probed: 0, ranked: 0, excluded: {} };
}
