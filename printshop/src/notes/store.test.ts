import { beforeEach, describe, expect, it } from "vitest";
import { addNote, listNotes, resetNotes, subscribe } from "./store";

describe("notes store", () => {
  beforeEach(resetNotes);

  it("adds a trimmed note with a rising id and tells subscribers", () => {
    let calls = 0;
    const stop = subscribe(() => calls++);
    const first = addNote("  buy a lamp ");
    const second = addNote("measure the rug");
    stop();
    expect(listNotes().map((n) => n.text)).toEqual(["buy a lamp", "measure the rug"]);
    expect([first.id, second.id]).toEqual([1, 2]);
    expect(calls).toBe(2);
  });

  it("refuses an empty note", () => {
    expect(() => addNote("   ")).toThrow(/needs some text/);
    expect(listNotes()).toEqual([]);
  });
});
