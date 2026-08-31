import { beforeEach, describe, expect, it } from "vitest";
import { designs, resetState, shop } from "../domain/store";
import { getBatch } from "../domain/store";
import { approveProof, batchView, createBatch, orderBatch, postMessage, quote, updateBatch } from "./api";
import { handleRpc, type RpcRequest } from "./mcp";
import { TOOLS } from "../webmcp/tools";

const d = () => designs()[0];
const units = (n: number) => Array.from({ length: n }, (_, i) => ({ recipient_ref: `g${i + 1}`, values: { name: `Guest ${i + 1}` } }));
const addr = { name: "Buyer", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" };
const buyer = { name: "Buyer", email: "buyer@example.com", phone: null };
const PROFILE = "https://vendor.example/profile.json";
const call = (name: string, args: Record<string, unknown>) => handleRpc({ id: 1, method: "tools/call", params: { name, arguments: { ...args, meta: { "ucp-agent": { profile: PROFILE }, buyer_email: buyer.email } } } });
const payload = (r: Record<string, unknown>) => JSON.parse((r.result as { content: { text: string }[] }).content[0].text);
const isError = (r: Record<string, unknown>) => (r.result as { isError?: boolean }).isError === true;

describe("the operations", () => {
  beforeEach(resetState);
  it("quotes, refuses below the minimum, creates, updates with a requote, orders with proofs, and approves", () => {
    const design = d();
    expect(quote({ design_id: design.id, quantity: design.minimum_quantity, needed_by: "2031-01-01", address: addr })).toMatchObject({ quantity: design.minimum_quantity, currency: shop().currency });
    expect(() => quote({ design_id: design.id, quantity: 1, needed_by: "2031-01-01", address: addr })).toThrow(/minimum_quantity/);
    const batch = createBatch({ design_id: design.id, units: units(design.minimum_quantity), address: addr, needed_by: "2031-01-01", buyer });
    expect(batch.status).toBe("quoted");
    expect(batch.thread.map((t) => t.kind)).toEqual(["quoted"]);
    const more = updateBatch(batch.id, buyer.email, { units: units(design.minimum_quantity + 2) });
    expect(more.quote.quantity).toBe(design.minimum_quantity + 2);
    const ordered = orderBatch(batch.id, buyer.email);
    expect(ordered.status).toBe("proofed");
    expect(ordered.proof).toHaveLength(design.minimum_quantity + 2);
    expect(ordered.proof![0].svg).toContain("Guest 1");
    const approved = approveProof(batch.id, buyer.email);
    expect(approved.status).toBe("approved");
    expect(approved.approved_at).not.toBeNull();
    expect(() => orderBatch(batch.id, "other@example.com")).toThrow(/No batch/);
  });
  it("refuses to order a batch with unit issues", () => {
    const design = d();
    const bad = createBatch({ design_id: design.id, units: [...units(design.minimum_quantity - 1), { recipient_ref: "gx", values: { name: "" } }], address: addr, needed_by: "2031-01-01", buyer });
    expect(bad.issues).toHaveLength(1);
    expect(() => orderBatch(bad.id, buyer.email)).toThrow(/issues/);
  });
  it("refuses a scopeless read or mutation and leaves the batch unchanged (issue #128)", () => {
    const design = d();
    const batch = createBatch({ design_id: design.id, units: units(design.minimum_quantity), address: addr, needed_by: "2031-01-01", buyer });
    expect(() => batchView(batch.id, null)).toThrow(/No batch/);
    expect(() => orderBatch(batch.id, null)).toThrow(/No batch/);
    expect(() => postMessage(batch.id, null, { text: "hi" })).toThrow(/No batch/);
    expect(batchView(batch.id, buyer.email).id).toBe(batch.id);
    const after = getBatch(batch.id)!;
    expect(after.status).toBe("quoted");
    expect(after.thread.map((t) => t.kind)).toEqual(["quoted"]);
  });
});

describe("the endpoint", () => {
  beforeEach(resetState);
  it("lists every tool, requires a profile, scopes batches by the buyer email, and runs the flow", async () => {
    const list = await handleRpc({ id: 0, method: "tools/list" });
    expect((list.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    const noProfile = await handleRpc({ id: 1, method: "tools/call", params: { name: "list_designs", arguments: {} } });
    expect(isError(noProfile)).toBe(true);
    const design = d();
    const q = await call("quote_batch", { design_id: design.id, quantity: design.minimum_quantity, needed_by: "2031-01-01", address: addr });
    expect(isError(q)).toBe(false);
    const created = await call("create_batch", { design_id: design.id, units: units(design.minimum_quantity), address: addr, needed_by: "2031-01-01", buyer });
    const id = payload(created).id as string;
    expect(isError(await call("order_batch", { batch_id: id }))).toBe(false);
    const other = await handleRpc({ id: 2, method: "tools/call", params: { name: "get_batch", arguments: { batch_id: id, meta: { "ucp-agent": { profile: PROFILE }, buyer_email: "other@example.com" } } } });
    expect(isError(other)).toBe(true);
    expect(isError(await call("approve_proof", { batch_id: id }))).toBe(false);
    const feed = payload(await call("get_changes", { since_seq: 0 })).entries as { kind: string }[];
    expect(feed.map((e) => e.kind)).toEqual(["quoted", "ordered", "proof", "approved"]);
  });
  it("returns a JSON-RPC error for a non-object body rather than a 500 (issue #132)", async () => {
    for (const bad of [null, 42]) {
      const r = await handleRpc(bad as unknown as RpcRequest);
      expect((r.error as { code: number }).code).toBe(-32600);
      expect(r.result).toBeUndefined();
    }
  });
  it("refuses a batch-scoped call that carries no buyer email (issue #128)", async () => {
    const design = d();
    const created = await call("create_batch", { design_id: design.id, units: units(design.minimum_quantity), address: addr, needed_by: "2031-01-01", buyer });
    const id = payload(created).id as string;
    const noEmail = (name: string, args: Record<string, unknown>) => handleRpc({ id: 9, method: "tools/call", params: { name, arguments: { ...args, meta: { "ucp-agent": { profile: PROFILE } } } } });
    expect(isError(await noEmail("get_batch", { batch_id: id }))).toBe(true);
    expect(isError(await noEmail("order_batch", { batch_id: id }))).toBe(true);
    expect(isError(await noEmail("post_message", { batch_id: id, text: "hi" }))).toBe(true);
  });
});
