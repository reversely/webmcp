import { beforeEach, describe, expect, it } from "vitest";
import { designs, resetState } from "../../../../domain/store";
import { createBatch } from "../../../../server/api";
import { GET, PATCH } from "./route";
import { POST as messages } from "./messages/route";
import { POST as order } from "./order/route";

/**
 * The REST batch surface is local-only: it backs the shop's own batch page. It still carries the
 * buyer scope (an `email` query param) that the MCP path reads, so a scopeless call is refused the
 * same way rather than serving as an unauthenticated bypass of the ownership guard (issues #128, #129).
 */
const design = () => designs()[0];
const units = (n: number) => Array.from({ length: n }, (_, i) => ({ recipient_ref: `g${i + 1}`, values: { name: `Guest ${i + 1}` } }));
const addr = { name: "Buyer", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" };
const owner = "owner@example.com";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);
const seed = () => createBatch({ design_id: design().id, units: units(design().minimum_quantity), address: addr, needed_by: "2031-01-01", buyer: { name: "Owner", email: owner, phone: null } }).id;

describe("the REST batch routes enforce the buyer scope", () => {
  beforeEach(resetState);
  it("refuses a scopeless read, update, message, and order and lets the owner through", async () => {
    const id = seed();
    expect((await GET(req(`/api/batches/${id}`), params(id))).status).toBe(404);
    expect((await PATCH(req(`/api/batches/${id}`, { method: "PATCH", body: JSON.stringify({ units: units(design().minimum_quantity) }) }), params(id))).status).toBe(404);
    expect((await messages(req(`/api/batches/${id}/messages`, { method: "POST", body: JSON.stringify({ text: "hi" }) }), params(id))).status).toBe(404);
    expect((await order(req(`/api/batches/${id}/order`, { method: "POST" }), params(id))).status).toBe(404);
    expect((await GET(req(`/api/batches/${id}?email=${owner}`), params(id))).status).toBe(200);
  });
  it("refuses a call scoped to another buyer's email", async () => {
    const id = seed();
    expect((await GET(req(`/api/batches/${id}?email=other@example.com`), params(id))).status).toBe(404);
    expect((await order(req(`/api/batches/${id}/order?email=other@example.com`, { method: "POST" }), params(id))).status).toBe(404);
  });
});
