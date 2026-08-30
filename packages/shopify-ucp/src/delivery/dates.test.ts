import { describe, expect, it } from "vitest";
import { addBusinessDays, addCalendarDays, parseIsoDate } from "./dates";

describe("addBusinessDays", () => {
  it("skips the weekend: Friday plus one business day is Monday", () => {
    expect(addBusinessDays("2026-08-28", 1)).toBe("2026-08-31");
  });

  it("counts five business days as one calendar week", () => {
    expect(addBusinessDays("2026-08-27", 5)).toBe("2026-09-03");
  });

  it("returns the same date for zero days", () => {
    expect(addBusinessDays("2026-08-29", 0)).toBe("2026-08-29");
  });
});

describe("addCalendarDays", () => {
  it("crosses a month boundary", () => {
    expect(addCalendarDays("2026-08-27", 10)).toBe("2026-09-06");
  });
});

describe("parseIsoDate", () => {
  it("rejects a non-ISO string", () => {
    expect(() => parseIsoDate("Sep 9 2026")).toThrow();
  });
});
