import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogClient } from "@webmcp/shopify-ucp";
import type { DeliveryAddress } from "../domain/types";
import { catalogDestination, RATE_LIMIT_WAITS_MS, searchProducts, shipsToFor } from "./catalog";

const CANADIAN: DeliveryAddress = { line1: "5 York Garden Way", city: "North York", region: "ON", postal_code: "M6A 0G9", country: "CA", currency: "CAD", source: "given" };

function capturingClient() {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ products: [] }) }] } }), { headers: { "Content-Type": "application/json" } });
  };
  return { client: catalogClient({ fetchImpl }), bodies };
}

describe("shipsToFor", () => {
  it("carries the address's country, region, postal code with its space, and currency", () => {
    expect(shipsToFor({ delivery_address_json: CANADIAN })).toEqual({ country: "CA", region: "ON", postal_code: "M6A 0G9", currency: "CAD" });
    expect(catalogDestination(shipsToFor({ delivery_address_json: CANADIAN }))).toEqual({
      ships_to: { country: "CA", region: "ON", postal_code: "M6A 0G9" },
      context: { address_country: "CA", address_region: "ON", postal_code: "M6A 0G9", currency: "CAD" }
    });
  });

  it("is undefined without an address or with one that names no country", () => {
    expect(shipsToFor({ delivery_address_json: null })).toBeUndefined();
    expect(shipsToFor({ delivery_address_json: { ...CANADIAN, country: null, postal_code: "" } })).toBeUndefined();
    expect(catalogDestination(undefined)).toEqual({});
  });
});

describe("searchProducts destination", () => {
  it("sends ships_to and the buyer context from the address", async () => {
    const { client, bodies } = capturingClient();
    await searchProducts(client, "sofa", shipsToFor({ delivery_address_json: CANADIAN }));
    const args = (bodies[0].params as { arguments: { catalog: Record<string, unknown> } }).arguments.catalog;
    expect(args.filters).toEqual({ ships_to: { country: "CA", region: "ON", postal_code: "M6A 0G9" }, available: true });
    expect(args.context).toEqual({ address_country: "CA", address_region: "ON", postal_code: "M6A 0G9", currency: "CAD" });
  });

  it("sends no ships_to and no context without an address", async () => {
    const { client, bodies } = capturingClient();
    await searchProducts(client, "sofa", shipsToFor({ delivery_address_json: null }));
    const args = (bodies[0].params as { arguments: { catalog: Record<string, unknown> } }).arguments.catalog;
    expect(args.filters).toEqual({ available: true });
    expect(args).not.toHaveProperty("context");
  });
});

describe("searchProducts under a rate limit (#75)", () => {
  afterEach(() => vi.useRealTimers());

  function limitedClient(failures: number) {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls <= failures) return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ products: [] }) }] } }), { headers: { "Content-Type": "application/json" } });
    };
    return { client: catalogClient({ fetchImpl }), calls: () => calls };
  }

  it("retries once per wait and returns the products when the catalog answers before the waits run out", async () => {
    vi.useFakeTimers();
    const { client, calls } = limitedClient(RATE_LIMIT_WAITS_MS.length);
    const pending = searchProducts(client, "big rug", undefined);
    for (const wait of RATE_LIMIT_WAITS_MS) await vi.advanceTimersByTimeAsync(wait);
    expect(await pending).toEqual([]);
    expect(calls()).toBe(RATE_LIMIT_WAITS_MS.length + 1);
  });

  it("throws the 429 once every wait is spent", async () => {
    vi.useFakeTimers();
    const { client, calls } = limitedClient(RATE_LIMIT_WAITS_MS.length + 1);
    const pending = searchProducts(client, "big rug", undefined).catch((e: Error) => e);
    for (const wait of RATE_LIMIT_WAITS_MS) await vi.advanceTimersByTimeAsync(wait);
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/429/);
    expect(calls()).toBe(RATE_LIMIT_WAITS_MS.length + 1);
  });
});
