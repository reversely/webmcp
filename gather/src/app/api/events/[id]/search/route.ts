import { NextResponse } from "next/server";
import { catalogClient } from "@webmcp/shopify-ucp";
import { BadRequestError, errorResponse, requireEvent } from "../../../../../server/api";
import { guestsFor } from "../../../../../domain/store";
import { cardsConfig, rank, searchCandidates, searchesForSentence, withDelivery, withDetail, type EventContext } from "../../../../../agent/search";

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
    const found = await searchCandidates(client, searches, ctx, { limit: 25, sleepMs: 1500 });
    // The cheapest dozen by price get the detail and the probe; the rest rank with delivery unknown.
    const shortlist = [...found].sort((a, b) => (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity)).slice(0, Math.max(1, Math.min(body.probe ?? 12, 25)));
    const probed = await Promise.all(shortlist.map(async (c) => withDelivery(await withDetail(client, c), ctx)));
    const probedIds = new Set(probed.map((c) => c.product_id));
    const all = [...probed, ...found.filter((c) => !probedIds.has(c.product_id))];
    const { ranked, excluded } = rank(all, ctx, config);
    return NextResponse.json({ searches, context: ctx, found: found.length, probed: probed.length, ranked: ranked.slice(0, 10), excluded: excluded.map((e) => ({ product_id: e.product_id, title: e.title, shop_name: e.shop_name, rule: e.verdict.rule, reason: e.verdict.reason })), duration_ms: Date.now() - started });
  } catch (e) {
    return errorResponse(e);
  }
}
