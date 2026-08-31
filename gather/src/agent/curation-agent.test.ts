/**
 * The CurationAgent over a scripted model (#120), on 3droom-concept's planning-agent test
 * pattern: the script answers each turn from the tool results the previous turns produced, so
 * every id the model uses is a retrieved one, and the assertions check the rows the tools wrote.
 */
import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { beforeEach, describe, expect, it } from "vitest";
import { giftsFor } from "../domain/gifts";
import { publishEvent, resetState } from "../domain/store";
import { createEventFromBody, snapshot, submitRsvp } from "../server/api";
import { runCurationAgent, type SearchFn } from "./curation-agent";
import type { Candidate } from "./search";

type Script = (request: ModelRequest, turn: number) => ModelResponse["output"];

/** A Model that answers from a script and records every request it received. */
function scriptedModel(script: Script): Model & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async getResponse(request) {
      requests.push(request);
      return { usage: new Usage(), output: script(request, requests.length) };
    },
    // eslint-disable-next-line require-yield
    async *getStreamedResponse() {
      throw new Error("streaming is not scripted");
    }
  };
}

const call = (id: string, name: string, args: unknown) => ({ type: "function_call" as const, callId: id, name, status: "completed" as const, arguments: JSON.stringify(args) });
const say = (text: string) => ({ type: "message" as const, role: "assistant" as const, status: "completed" as const, content: [{ type: "output_text" as const, text }] });

/** Every tool result in the request so far, keyed by the tool's name through its callId. */
function outputsByName(request: ModelRequest): Record<string, unknown[]> {
  const items = request.input as { type?: string; name?: string; callId?: string; output?: { text?: string } }[];
  const nameByCall = new Map(items.filter((i) => i.type === "function_call").map((i) => [i.callId, i.name ?? ""]));
  const out: Record<string, unknown[]> = {};
  for (const i of items) {
    if (i.type !== "function_call_result") continue;
    (out[nameByCall.get(i.callId) ?? "unknown"] ??= []).push(JSON.parse(String(i.output?.text ?? "{}")));
  }
  return out;
}

const BODY = {
  title: "Winter gathering",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M6H 2A8", country: "CA" },
  cost_per_person_cents: 5000
};

const SWEATSHIRT: Candidate = {
  product_id: "gid://shopify/Product/10242071789817",
  title: "Star Map Crewneck",
  description: "A garment-dyed crewneck with a printed star map",
  url: null,
  image_url: null,
  shop_domain: "customworks.example",
  shop_name: "Customworks",
  shop_url: null,
  policy_links: [],
  price_cents: 4500,
  currency: "CAD",
  variants: [{ id: "v-m", title: "M", price_cents: 4500, currency: "CAD", available: true, options: [] }],
  option_names: ["Size"],
  searches: ["customshop"],
  delivery: { window: { earliest: "2030-01-02", latest: "2030-01-05" }, text: "Arrives Jan 2 to Jan 5", confidence: "dated", verdict: "quoted", error: null },
  personalization: {
    fields: [
      { key: "caption", label: "Caption", kind: "name", required: true },
      { key: "star_map_date", label: "Star map date", kind: "date", required: true },
      { key: "star_map_location", label: "Star map location", kind: "location", required: true }
    ]
  }
};

const fakeSearch: SearchFn = async () => ({ ranked: [SWEATSHIRT], excluded: [{ product_id: "gid://shopify/Product/999", title: "Late mug", rule: "delivery", reason: "Delivery falls after the event." }] });

/** A published event with a printed-name answer for one going guest and none for the other. */
function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const name = snapshot(event.id).definitions.find((d) => d.key === "printed_name")!;
  submitRsvp(event.id, {
    party: {},
    guests: [
      { display_name: "Guest One", status: "going", answers: { [name.id]: "One" } },
      { display_name: "Guest Two", status: "going" },
      { display_name: "Guest Three", status: "cant_go" }
    ]
  });
  return { event, name };
}

describe("CurationAgent proposes from retrieved context (#120)", () => {
  beforeEach(resetState);

  it("reads the event and the definitions, selects the searched product, stores valid mappings, and reports the incomplete coverage", async () => {
    const { event, name } = seed();
    const model = scriptedModel((request, turn) => {
      const results = outputsByName(request);
      if (turn === 1) return [call("c1", "read_event", {}), call("c2", "read_definitions", {})];
      if (turn === 2) {
        const definitions = (results.read_definitions![0] as { definitions: { id: string; key: string }[] }).definitions;
        expect(definitions.some((d) => d.id === name.id && d.key === "printed_name")).toBe(true);
        expect((results.read_event![0] as { counts: { going: number } }).counts.going).toBe(2);
        return [call("c3", "search_gifts", { query: "personalized sweatshirts with each guest's name" })];
      }
      if (turn === 3) {
        const ranked = (results.search_gifts![0] as { ranked: { product_id: string }[] }).ranked;
        return [call("c4", "select_gift", { product_id: ranked[0].product_id, gift_id: null })];
      }
      if (turn === 4) {
        const giftId = (results.select_gift![0] as { gift_id: string }).gift_id;
        const mappings = [
          { vendor_field_key: "caption", source: { type: "definition", definition_id: name.id, subject_scope: "guest" } },
          { vendor_field_key: "star_map_date", source: { type: "event", key: "starts_at" }, transform: "date_only" },
          { vendor_field_key: "star_map_location", source: { type: "event", key: "venue" }, transform: "location_query" }
        ];
        return [call("c5", "set_mappings", { gift_id: giftId, mappings: JSON.stringify(mappings) })];
      }
      if (turn === 5) return [call("c6", "read_manifest", { gift_id: (results.select_gift![0] as { gift_id: string }).gift_id })];
      expect(results.read_manifest![0]).toMatchObject({ ready: 1, incomplete: 1, excluded: 0 });
      return [say("Proposed the Star Map Crewneck with the caption from the printed name and one guest missing it.")];
    });

    const result = await runCurationAgent({ eventId: event.id }, "Create personalized sweatshirts for everyone going.", { model, search: fakeSearch });

    // The instructions demand reading the context first, and every tool of the run is offered.
    const first = model.requests[0];
    expect(first.systemInstructions).toMatch(/call read_event and read_definitions first/);
    expect(first.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["read_event", "read_definitions", "read_missing_values", "search_gifts", "read_personalization_schema", "select_gift", "set_mappings", "read_manifest", "prepare_handoff"]));

    // The gift the run created carries the searched product and the validated mapping rows.
    const gift = giftsFor(event.id)[0];
    expect(gift).toMatchObject({ product_id: SWEATSHIRT.product_id, product_title: "Star Map Crewneck", shop_domain: "customworks.example" });
    expect(gift.personalization_mappings).toHaveLength(3);
    expect(gift.personalization_mappings![0]).toEqual({ vendor_field_key: "caption", source: { type: "definition", definition_id: name.id, subject_scope: "guest" } });

    // The proposal is built from state: the product, the rows, and the deterministic coverage.
    expect(result.response).toMatch(/Star Map Crewneck/);
    expect(result.proposal).toMatchObject({ gift_id: gift.id, product: { product_id: SWEATSHIRT.product_id, title: "Star Map Crewneck" }, manifest_summary: { ready: 1, incomplete: 1, excluded: 0 } });
    expect(result.proposal!.issues).toEqual([expect.objectContaining({ vendor_field_key: "caption", code: "missing_value" })]);
    expect(result.tool_calls.map((c) => c.tool)).toEqual(["read_event", "read_definitions", "search_gifts", "select_gift", "set_mappings", "read_manifest"]);
    expect(result.tool_calls[2].label).toBe("Searching products");
  });

  it("returns validation errors for an invented definition id instead of storing the rows", async () => {
    const { event } = seed();
    const model = scriptedModel((request, turn) => {
      const results = outputsByName(request);
      if (turn === 1) return [call("c1", "search_gifts", { query: "sweatshirts" })];
      if (turn === 2) return [call("c2", "select_gift", { product_id: SWEATSHIRT.product_id, gift_id: null })];
      if (turn === 3) {
        const giftId = (results.select_gift![0] as { gift_id: string }).gift_id;
        return [call("c3", "set_mappings", { gift_id: giftId, mappings: JSON.stringify([{ vendor_field_key: "caption", source: { type: "definition", definition_id: "def-invented", subject_scope: "guest" } }]) })];
      }
      expect(results.set_mappings![0]).toMatchObject({ errors: expect.stringContaining("unknown_definition") });
      return [say("The caption needs a real RSVP field; which one holds the name?")];
    });
    const result = await runCurationAgent({ eventId: event.id }, "Sweatshirts with names.", { model, search: fakeSearch });
    expect(giftsFor(event.id)[0].personalization_mappings ?? null).toBeNull();
    expect(result.proposal!.manifest_summary.ready).toBe(0);
    expect(result.response).toMatch(/which one holds the name/);
  });

  it("rejects a product id no search returned", async () => {
    const { event } = seed();
    const model = scriptedModel((request, turn) => {
      const results = outputsByName(request);
      if (turn === 1) return [call("c1", "select_gift", { product_id: "gid://shopify/Product/invented", gift_id: null })];
      expect(results.select_gift![0]).toMatchObject({ error: expect.stringContaining("call search_gifts first") });
      return [say("Nothing selected yet; searching next.")];
    });
    const result = await runCurationAgent({ eventId: event.id }, "Sweatshirts.", { model, search: fakeSearch });
    expect(giftsFor(event.id)).toHaveLength(0);
    expect(result.proposal).toBeUndefined();
  });

  it("offers no cart, checkout, or approval tool, and the handoff tool only reports the next step", async () => {
    const { event } = seed();
    const model = scriptedModel((request, turn) => {
      const results = outputsByName(request);
      if (turn === 1) return [call("c1", "search_gifts", { query: "sweatshirts" })];
      if (turn === 2) return [call("c2", "select_gift", { product_id: SWEATSHIRT.product_id, gift_id: null })];
      if (turn === 3) return [call("c3", "prepare_handoff", { gift_id: (results.select_gift![0] as { gift_id: string }).gift_id })];
      expect(results.prepare_handoff![0]).toMatchObject({ units: 2, next_step: expect.stringContaining("organizer sends") });
      return [say("Ready for the organizer to send from the dashboard.")];
    });
    await runCurationAgent({ eventId: event.id }, "Sweatshirts.", { model, search: fakeSearch });
    const tools = model.requests[0].tools.map((t) => t.name);
    for (const forbidden of ["send", "approve", "checkout", "lock", "cart", "pay"]) expect(tools.some((t) => t.includes(forbidden))).toBe(false);
    const gift = giftsFor(event.id)[0];
    expect(gift.cart_id).toBeNull();
    expect(gift.checkout_id).toBeNull();
    expect(gift.locked_at).toBeNull();
  });
});

/** Runs only with LIVE_OPENAI=1 and an OPENAI_API_KEY: one real model turn over the fake search. */
describe.skipIf(process.env.LIVE_OPENAI !== "1")("live curation run", () => {
  beforeEach(resetState);

  it("selects the searched sweatshirt and maps the star map and the caption in one real run", async () => {
    const { event } = seed();
    const result = await runCurationAgent({ eventId: event.id }, "Create personalized sweatshirts for everyone going. Use the event location and date for the star map and put each guest's printed name underneath.", { search: fakeSearch });
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.tool_calls.length).toBeGreaterThan(0);
    expect(result.proposal?.product.product_id).toBe(SWEATSHIRT.product_id);
    expect(giftsFor(event.id)[0]?.personalization_mappings?.length ?? 0).toBeGreaterThan(0);
  }, 300_000);
});
