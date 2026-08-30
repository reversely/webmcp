import { NextResponse } from "next/server";
import { catalogClient } from "@webmcp/shopify-ucp";
import { BadRequestError, errorResponse, requireEvent } from "../../../../../server/api";
import { guestsFor } from "../../../../../domain/store";
import { cardsConfig, emptyFunnel, rank, searchCandidates, searchesForSentence, withDelivery, withDetail, type EventContext } from "../../../../../agent/search";

type Params = { params: Promise<{ id: string }> };

/**
 * A card or a sentence becomes searches, each shortlisted product gets its detail and a delivery
 * probe, and Stage 1 and 2 rank the result (PRD Sections 8, 10, 11). Body: { card?: string,
 * sentence?: string, probe?: number } where probe caps how many candidates get a checkout probe.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const event = requireEvent((await params).id);
    const body = (await request.json()) as { card?: string; sentence?: string; probe?: number };
    const config = cardsConfig();
    const card = body.card ? config.cards.find((c) => c.key === body.card) : undefined;
    if (body.card && !card) throw new BadRequestError(`No card ${body.card}; the cards are ${config.cards.map((c) => c.key).join(", ")}.`);
    const searches = card ? card.searches : body.sentence?.trim() ? searchesForSentence(body.sentence, config) : null;
    if (!searches) throw new BadRequestError("Send a card key or a sentence.");
    const going = guestsFor(event.id).filter((g) => g.status === "going").length;
    const ctx: EventContext = { event_date: event.starts_at.slice(0, 10), venue: event.venue, budget_cents: event.cost_per_person_cents, quantity: going, today: new Date().toISOString().slice(0, 10) };
    const started = Date.now();
    const client = catalogClient();
    const funnel = emptyFunnel();
    const found = await searchCandidates(client, searches, ctx, { limit: 50, pages: 2, sleepMs: 1500, funnel });
    // Every candidate with a price under the budget gets the detail and a delivery probe, a few
    // shops at a time; the probe cap keeps a broad search inside a minute.
    const cap = Math.max(1, Math.min(body.probe ?? 30, 60));
    const shortlist = [...found].filter((c) => ctx.budget_cents === null || c.price_cents === null || c.price_cents <= ctx.budget_cents).sort((a, b) => (b.variants.length - a.variants.length) || ((a.price_cents ?? Infinity) - (b.price_cents ?? Infinity))).slice(0, cap);
    const probed: typeof shortlist = [];
    for (let i = 0; i < shortlist.length; i += 6) probed.push(...(await Promise.all(shortlist.slice(i, i + 6).map(async (c) => withDelivery(await withDetail(client, c), ctx)))));
    funnel.probed = probed.length;
    const probedIds = new Set(probed.map((c) => c.product_id));
    const all = [...probed, ...found.filter((c) => !probedIds.has(c.product_id))];
    const { ranked, excluded } = rank(all, ctx, config, funnel);
    return NextResponse.json({ searches, context: ctx, funnel, found: found.length, probed: probed.length, ranked: ranked.slice(0, 15), excluded: excluded.map((e) => ({ product_id: e.product_id, title: e.title, shop_name: e.shop_name, rule: e.verdict.rule, reason: e.verdict.reason })), duration_ms: Date.now() - started });
  } catch (e) {
    return errorResponse(e);
  }
}
