import { expect, it } from "vitest";
import { minute, money } from "./format";

/** No rendered string carries a comma (PRD Section 2; same rule as gather's issue #114). */
it("minute and money print no comma", () => {
  expect(minute("2026-09-03T18:05:00Z")).toBe("2026-09-03 18:05");
  expect(minute("2026-09-03T18:05:00Z")).not.toContain(",");
  expect(money(123456789, "CAD")).toBe("1234567.89 CAD");
  expect(money(123456789, "CAD")).not.toContain(",");
});
