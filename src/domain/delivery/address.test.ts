import { describe, expect, it } from "vitest";
import { DeliveryAddress } from "../types";
import { inferAddress } from "./address";

describe("inferAddress", () => {
  it.each([
    ["10003", "New York", "NY"],
    ["94110", "San Francisco", "CA"],
    ["60614", "Chicago", "IL"],
    ["02134", "Boston", "MA"],
    ["98101", "Seattle", "WA"],
    ["95014", null, "CA"]
  ])("infers %s as %s, %s", (zip, city, region) => {
    expect(inferAddress(zip)).toEqual({
      line1: null,
      city,
      region,
      postal_code: zip,
      country: "US",
      source: "inferred"
    });
  });

  it("keeps country and ZIP for an unknown prefix", () => {
    expect(inferAddress("33101")).toEqual({
      line1: null,
      city: null,
      region: null,
      postal_code: "33101",
      country: "US",
      source: "inferred"
    });
  });

  it("splits a full address line and marks it given", () => {
    const address = inferAddress("123 E 10th St, Apt 4, New York, NY 10003");
    expect(address).toEqual({
      line1: "123 E 10th St, Apt 4",
      city: "New York",
      region: "NY",
      postal_code: "10003",
      country: "US",
      source: "given"
    });
    expect(DeliveryAddress.parse(address)).toEqual(address);
  });

  it("throws when no postal code is present", () => {
    expect(() => inferAddress("somewhere in Brooklyn")).toThrow(/postal code/);
  });
});
