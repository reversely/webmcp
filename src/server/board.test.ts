import { describe, expect, it } from "vitest";
import { applyBoardChanges, boardChangesSince, boardSnapshot, emptyBoard, type BoardRecord } from "./board";

const shape = (id: string, x: number): BoardRecord => ({ id, typeName: "shape", type: "note", x, y: 0 });

describe("board merge", () => {
  it("last writer wins on the same record id, in arrival order", () => {
    const doc = emptyBoard();
    applyBoardChanges(doc, { put: [shape("shape:a", 10)] });
    applyBoardChanges(doc, { put: [shape("shape:a", 20)] });
    const v3 = applyBoardChanges(doc, { put: [shape("shape:a", 30)] });
    expect(v3).toBe(3);
    expect(boardSnapshot(doc).records).toEqual([shape("shape:a", 30)]);
  });

  it("a remove after a put drops the record, and a put after a remove brings it back", () => {
    const doc = emptyBoard();
    applyBoardChanges(doc, { put: [shape("shape:a", 1), shape("shape:b", 2)] });
    applyBoardChanges(doc, { remove: ["shape:a"] });
    expect(boardSnapshot(doc).records.map((r) => r.id)).toEqual(["shape:b"]);
    expect(boardChangesSince(doc, 1)).toEqual({ version: 2, put: [], remove: ["shape:a"] });
    applyBoardChanges(doc, { put: [shape("shape:a", 5)] });
    expect(boardChangesSince(doc, 2)).toEqual({ version: 3, put: [shape("shape:a", 5)], remove: [] });
  });

  it("since filtering returns only the records written after the version the client holds", () => {
    const doc = emptyBoard();
    applyBoardChanges(doc, { put: [shape("shape:a", 1)] }); // v1
    applyBoardChanges(doc, { put: [shape("shape:b", 2)] }); // v2
    applyBoardChanges(doc, { put: [shape("shape:a", 3)], remove: ["shape:b"] }); // v3
    expect(boardChangesSince(doc, 0)).toEqual({ version: 3, put: [shape("shape:a", 3)], remove: ["shape:b"] });
    expect(boardChangesSince(doc, 2)).toEqual({ version: 3, put: [shape("shape:a", 3)], remove: ["shape:b"] });
    expect(boardChangesSince(doc, 3)).toEqual({ version: 3, put: [], remove: [] });
  });

  it("empty or malformed changes leave the version alone", () => {
    const doc = emptyBoard();
    expect(applyBoardChanges(doc, {})).toBe(0);
    expect(applyBoardChanges(doc, { put: [{ nope: true } as unknown as BoardRecord], remove: [42 as unknown as string] })).toBe(0);
    expect(doc.records.size).toBe(0);
  });
});
