import { describe, expect, it } from "vitest";
import { PendingChanges, type BoardRecord, type Diff } from "./board-sync";

const rec = (id: string, x: number): BoardRecord => ({ id, typeName: "shape", x });
const diff = (d: Partial<Diff>): Diff => ({ added: {}, updated: {}, removed: {}, ...d });

describe("PendingChanges", () => {
  it("collapses adds, updates, and removes per id and takes them once", () => {
    const p = new PendingChanges();
    p.record(diff({ added: { "shape:a": rec("shape:a", 1) } }), 1000);
    p.record(diff({ updated: { "shape:a": [rec("shape:a", 1), rec("shape:a", 2)] } }), 1100);
    p.record(diff({ added: { "shape:b": rec("shape:b", 0) }, removed: { "shape:c": rec("shape:c", 0) } }), 1200);
    expect(p.take()).toEqual({ put: [rec("shape:a", 2), rec("shape:b", 0)], remove: ["shape:c"] });
    expect(p.empty).toBe(true);
  });

  it("skips remote records the local user touched inside the poll window or still has pending", () => {
    const p = new PendingChanges();
    p.record(diff({ added: { "shape:a": rec("shape:a", 1) } }), 1000);
    p.record(diff({ added: { "shape:b": rec("shape:b", 1) } }), 1000);
    p.take();
    p.record(diff({ added: { "shape:p": rec("shape:p", 1) } }), 5000);
    const delta = { version: 9, put: [rec("shape:a", 7), rec("shape:p", 7), rec("shape:z", 7)], remove: ["shape:b", "shape:q"] };
    // At 2500 ms both a and b are inside a 2000 ms window; p is pending; z and q are free to apply.
    expect(p.filterRemote(delta, 2500, 2000)).toEqual({ version: 9, put: [rec("shape:z", 7)], remove: ["shape:q"] });
    // At 5000 ms the window has passed for a and b.
    expect(p.filterRemote(delta, 5000, 2000)).toEqual({ version: 9, put: [rec("shape:a", 7), rec("shape:z", 7)], remove: ["shape:b", "shape:q"] });
  });

  it("restores a failed PUT under later local changes", () => {
    const p = new PendingChanges();
    p.record(diff({ added: { "shape:a": rec("shape:a", 1), "shape:b": rec("shape:b", 1) } }), 0);
    const taken = p.take();
    p.record(diff({ updated: { "shape:a": [rec("shape:a", 1), rec("shape:a", 3)] } }), 10);
    p.restore(taken);
    expect(p.take()).toEqual({ put: [rec("shape:a", 3), rec("shape:b", 1)], remove: [] });
  });
});
