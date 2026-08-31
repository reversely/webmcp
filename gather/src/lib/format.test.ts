import { describe, expect, it } from "vitest";
import { dateOnly, dateTime, money } from "./format";

/** Local-time ISO strings keep the expected text stable across the machine's timezone. */
const DATETIME = "2026-09-03T18:05:00";
const DATE = "2026-09-03";

describe("dateOnly", () => {
  it("prints month day year with no comma", () => {
    expect(dateOnly(DATE)).toBe("Sep 3 2026");
  });
  it("accepts a datetime ISO", () => {
    expect(dateOnly(DATETIME)).toBe("Sep 3 2026");
  });
  it("returns empty for null and undefined", () => {
    expect(dateOnly(null)).toBe("");
    expect(dateOnly(undefined)).toBe("");
  });
  it("passes an unparseable string through", () => {
    expect(dateOnly("not-a-date")).toBe("not-a-date");
  });
});

describe("dateTime", () => {
  it("prints weekday date and time with no comma", () => {
    expect(dateTime(DATETIME)).toMatch(/^Thu Sep 3 2026 6:05/);
    expect(dateTime(DATETIME)).not.toContain(",");
  });
  it("returns empty for null and undefined", () => {
    expect(dateTime(null)).toBe("");
    expect(dateTime(undefined)).toBe("");
  });
  it("passes an unparseable string through", () => {
    expect(dateTime("not-a-date")).toBe("not-a-date");
  });
  // #142: a UTC-stamped instant reads as its UTC wall clock on every machine, so the server and
  // client paints match and React logs no hydration mismatch.
  it("pins a zoned instant to its UTC wall clock regardless of the runtime zone", () => {
    expect(dateTime("2030-01-10T19:00:00Z")).toMatch(/^Thu Jan 10 2030 7:00/);
    expect(dateTime("2030-01-10T19:00:00Z")).toBe(dateTime("2030-01-10T19:00:00"));
  });
});

it("no formatter output carries a comma", () => {
  for (const input of [DATE, DATETIME, "2026-12-31", "2026-12-31T09:00:00"]) {
    expect(dateOnly(input)).not.toContain(",");
    expect(dateTime(input)).not.toContain(",");
  }
});

it("prints money above one thousand dollars without a comma", () => {
  expect(money(123456789)).not.toContain(",");
  expect(money(100000)).toBe("$1000");
});
