import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("shows cents when the amount is not a whole dollar", () => {
    expect(formatMoney(37499)).toBe("$374.99");
  });
  it("drops cents for a whole-dollar amount", () => {
    expect(formatMoney(37500)).toBe("$375");
  });
  it("groups thousands", () => {
    expect(formatMoney(250000)).toBe("$2,500");
  });
  it("uses the product's currency symbol when it is not USD", () => {
    expect(formatMoney(29500, "EUR")).toBe("€295");
  });
  it("keeps the sign on a negative amount", () => {
    expect(formatMoney(-1250)).toBe("-$12.50");
  });
});
