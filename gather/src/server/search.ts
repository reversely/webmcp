/**
 * The gift search the search route and the curation agent share (#120): a card or a sentence
 * becomes searches, each shortlisted product gets its detail and a delivery probe, and Stage 1
 * and 2 rank the result (PRD Sections 8, 10, 11). Extracted from the search route so both access
 * paths run one code path.
 */
import { catalogClient } from "@webmcp/shopify-ucp";
import { CUSTOMSHOP_SOURCE, customshopCandidates } from "../agent/customshop";
import { PRINTSHOP_SOURCE, printshopCandidates } from "../agent/printshop";
import {
  DEFAULT_SOURCES,
  cardsConfig,
  emptyFunnel,
  personalizedRequest,
  priceFit,
  rank,
  searchCandidates,
  searchesForSentence,
  sourcesForSentence,
  withDelivery,
  withDetail,
  type Candidate,
  type CardSearch,
  type EventContext,
  type Funnel,
  type Scored,
  type Source
} from "../agent/search";
import { guestsFor } from "../domain/store";
import { deliveryTarget } from "../lib/delivery";
import { BadRequestError, requireEvent } from "./api";

export type GiftSearchBody = { card?: string; sentence?: string; probe?: number };
export type GiftSearchReply = {
  searches: CardSearch[];
  sources: Source[];
  context: EventContext;
  funnel: Funnel;
  found: number;
  probed: number;
  ranked: Scored[];
  excluded: { product_id: string; title: string; shop_name: string; rule: string | null; reason: string | null }[];
  duration_ms: number;
};

/** The shop's designs beside the catalog's products; a shop that does not answer leaves a funnel row naming the error and no candidates. */
async function printshopRows(ctx: EventContext, funnel: Funnel): Promise<Candidate[]> {
  try {
    return await printshopCandidates(ctx, undefined, funnel);
  } catch (e) {
    funnel.searches.push({ query: PRINTSHOP_SOURCE, returned: 0, total: null, error: (e as Error).message });
    return [];
  }
}

/** The custom shop's products beside the catalog's; a shop that does not answer leaves a funnel row naming the error and no candidates. */
async function customshopRows(ctx: EventContext, funnel: Funnel): Promise<Candidate[]> {
  try {
    return await customshopCandidates(ctx, { funnel });
  } catch (e) {
    funnel.searches.push({ query: CUSTOMSHOP_SOURCE, returned: 0, total: null, error: (e as Error).message });
    return [];
  }
}

/**
 * A card or a sentence becomes searches, each shortlisted product gets its detail and a delivery
 * probe, and Stage 1 and 2 rank the result. A card or a sentence that names cards also lists the
 * print shop's designs, each with its quote as the delivery window; `probe` caps how many
 * candidates get a checkout probe.
 */
export async function giftSearch(eventId: string, body: GiftSearchBody): Promise<GiftSearchReply> {
  const event = requireEvent(eventId);
  const config = cardsConfig();
  const card = body.card ? config.cards.find((c) => c.key === body.card) : undefined;
  if (body.card && !card) throw new BadRequestError(`No card ${body.card}; the cards are ${config.cards.map((c) => c.key).join(", ")}.`);
  const searches = card ? card.searches : body.sentence?.trim() ? searchesForSentence(body.sentence, config) : null;
  if (!searches) throw new BadRequestError("Send a card key or a sentence.");
  const sources = card ? (card.sources ?? DEFAULT_SOURCES) : sourcesForSentence(body.sentence ?? "", config);
  const going = guestsFor(event.id).filter((g) => g.status === "going").length;
  const target = deliveryTarget(event);
  if (!target.needed_by) throw new BadRequestError("Set where the gifts are delivered and by when before searching.");
  const ctx: EventContext = { event_date: target.needed_by, venue: target.address, budget_cents: event.cost_per_person_cents, quantity: going, today: new Date().toISOString().slice(0, 10), personalized: card ? !!card.personalized : personalizedRequest(body.sentence ?? "") };
  const started = Date.now();
  const client = catalogClient();
  const funnel = emptyFunnel();
  const found = await searchCandidates(client, searches, ctx, { limit: 50, pages: 2, sleepMs: 1500, funnel });
  const designs = sources.includes(PRINTSHOP_SOURCE) ? await printshopRows(ctx, funnel) : [];
  const custom = sources.includes(CUSTOMSHOP_SOURCE) ? await customshopRows(ctx, funnel) : [];
  // The candidates that use the budget best and offer the most variants get the detail and a
  // delivery probe, a few shops at a time; the probe cap keeps a broad search inside a minute.
  const cap = Math.max(1, Math.min(body.probe ?? 30, 60));
  const preScore = (c: (typeof found)[number]) => priceFit(c.price_cents, ctx.budget_cents) * 2 + Math.min(c.variants.length, 6) / 6;
  const shortlist = [...found].filter((c) => ctx.budget_cents === null || c.price_cents === null || c.price_cents <= ctx.budget_cents).sort((a, b) => preScore(b) - preScore(a)).slice(0, cap);
  const probed: typeof shortlist = [];
  for (let i = 0; i < shortlist.length; i += 6) probed.push(...(await Promise.all(shortlist.slice(i, i + 6).map(async (c) => withDelivery(await withDetail(client, c), ctx)))));
  funnel.probed = probed.length;
  const probedIds = new Set(probed.map((c) => c.product_id));
  const all = [...probed, ...found.filter((c) => !probedIds.has(c.product_id)), ...designs, ...custom];
  const { ranked, excluded } = rank(all, ctx, config, funnel);
  return {
    searches,
    sources,
    context: ctx,
    funnel,
    found: all.length,
    probed: probed.length,
    ranked: ranked.slice(0, 15),
    excluded: excluded.map((e) => ({ product_id: e.product_id, title: e.title, shop_name: e.shop_name, rule: e.verdict.rule, reason: e.verdict.reason })),
    duration_ms: Date.now() - started
  };
}
