/**
 * The print shop as a search source. The shop answers JSON-RPC at POST {base}/api/mcp for any
 * caller that presents an agent profile; a buyer email in the meta scopes the batches a call may
 * read. `printshopCandidates` turns list_designs and quote_batch into Candidates shaped like the
 * catalog's, so eligibility, scoring, and rank run unchanged over both sources.
 */
import { DEFAULT_AGENT_PROFILE_URL } from "@webmcp/shopify-ucp";
import type { Candidate, EventContext, Funnel, PersonalizationField, Variant } from "./search";

export const PRINTSHOP_SOURCE = "printshop";
const DEFAULT_URL = "http://localhost:3114";

export function printshopUrl(): string {
  return (process.env.PRINTSHOP_URL ?? DEFAULT_URL).replace(/\/+$/, "");
}

/** The host a gift's `shop_domain` carries when its product is one of the shop's designs. */
export function printshopHost(): string {
  return new URL(printshopUrl()).host;
}

/** The shop refused the call and named why; the message is the shop's own. */
export class PrintshopError extends Error {}

export type PrintshopClient = { host: string; url: string; callTool: (name: string, args: Record<string, unknown>) => Promise<unknown> };

type RpcReply = { result?: { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] }; error?: { message?: string } };

export function printshopClient(options: { url?: string; buyerEmail?: string | null; fetchImpl?: typeof fetch } = {}): PrintshopClient {
  const url = (options.url ?? printshopUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  let nextId = 1;
  return {
    host: new URL(url).host,
    url,
    async callTool(name, args) {
      const meta = { "ucp-agent": { profile: DEFAULT_AGENT_PROFILE_URL }, ...(options.buyerEmail ? { buyer_email: options.buyerEmail } : {}) };
      const body = { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: { ...args, meta } } };
      const response = await fetchImpl(`${url}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new PrintshopError(`${name} answered ${response.status} at ${url}`);
      const reply = (await response.json()) as RpcReply;
      if (reply.error) throw new PrintshopError(reply.error.message ?? `${name} failed`);
      const payload = reply.result?.structuredContent ?? JSON.parse(reply.result?.content?.find((c) => c.type === "text")?.text ?? "null");
      if (reply.result?.isError) throw new PrintshopError(String((payload as { error?: string })?.error ?? `${name} failed`));
      return payload;
    }
  };
}

/* ---- The shop's shapes, as its tools return them ---- */

export type Design = { id: string; title: string; format: string; size: string; paper: string; print_method: string; colours: string[]; price_bands: { min_quantity: number; unit_cents: number }[]; lead_time_business_days: number; minimum_quantity: number; fields: PersonalizationField[]; image: string | null };
export type Quote = { design_id?: string; unit_cents: number; quantity: number; subtotal_cents: number; tax_cents: number; total_cents: number; ready_by: string; currency: string };
export type Unit = { recipient_ref: string; values: Record<string, string> };
export type Issue = { recipient_ref: string; field: string; reason: string };
export type ThreadEntry = { seq: number; at: string; from: "shop" | "buyer"; kind: string; text: string; reference: string | null };
export type ShopBatch = { id: string; design_id: string; status: string; units: Unit[]; quote: Quote; proof: { recipient_ref: string; svg: string }[] | null; issues: Issue[]; thread: ThreadEntry[] };
export type Changes = { since: number; seq: number; entries: { seq: number; at: string; batch_id: string; kind: string; text: string }[] };

/** The unit price at the band the quantity reaches; below every band, the lowest band's price, so a small event still sees the design priced. */
export function bandPrice(design: Design, quantity: number): number {
  const bands = [...design.price_bands].sort((a, b) => a.min_quantity - b.min_quantity);
  const reached = bands.filter((b) => quantity >= b.min_quantity).at(-1);
  return (reached ?? bands[0]).unit_cents;
}

export function variantId(designId: string, colour: string): string {
  return `${designId}:${colour}`;
}

async function quoteDelivery(client: PrintshopClient, design: Design, ctx: EventContext): Promise<{ delivery: Candidate["delivery"]; currency: string | null }> {
  try {
    const quote = (await client.callTool("quote_batch", { design_id: design.id, quantity: ctx.quantity, needed_by: ctx.event_date, address: ctx.venue })) as Quote;
    return { delivery: { window: { earliest: quote.ready_by, latest: quote.ready_by }, text: `Ready by ${quote.ready_by}`, confidence: "dated", verdict: "quoted", error: null }, currency: quote.currency };
  } catch (e) {
    if (!(e instanceof PrintshopError)) throw e;
    return { delivery: { window: null, text: null, confidence: "unknown", verdict: "refused", error: e.message }, currency: null };
  }
}

function toCandidate(client: PrintshopClient, design: Design, ctx: EventContext, delivery: Candidate["delivery"], currency: string | null): Candidate {
  const price = bandPrice(design, ctx.quantity);
  const variants: Variant[] = design.colours.map((colour) => ({ id: variantId(design.id, colour), title: colour, price_cents: price, currency, available: true, options: [{ name: "Colour", label: colour }] }));
  return {
    product_id: design.id,
    title: design.title,
    description: `${design.format} ${design.size} on ${design.paper}, ${design.print_method}; minimum ${design.minimum_quantity}, ${design.lead_time_business_days} business days.`,
    url: client.url,
    image_url: design.image,
    shop_domain: client.host,
    shop_name: "Printshop",
    shop_url: client.url,
    policy_links: [],
    price_cents: price,
    currency,
    variants,
    option_names: ["Colour"],
    searches: [PRINTSHOP_SOURCE],
    delivery,
    personalization: { fields: design.fields }
  };
}

/** Every design under the amount per person, priced at the band the going count reaches, with the quote's ready-by as its delivery window or the refusal as its verdict. */
export async function printshopCandidates(ctx: EventContext, client: PrintshopClient = printshopClient(), funnel?: Funnel): Promise<Candidate[]> {
  const args = ctx.budget_cents === null ? {} : { max_unit_cents: ctx.budget_cents };
  const { designs } = (await client.callTool("list_designs", args)) as { designs: Design[] };
  const candidates = await Promise.all(designs.map(async (design) => {
    const { delivery, currency } = await quoteDelivery(client, design, ctx);
    return toCandidate(client, design, ctx, delivery, currency);
  }));
  funnel?.searches.push({ query: PRINTSHOP_SOURCE, returned: designs.length, total: designs.length });
  return candidates;
}
