import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "../../server/state";
import { DeliveryAddress, type ExtractedAddress } from "../types";
import { extractionKey, hasDestination, inferAddress, unreadAddress } from "./address";

const CANADIAN: ExtractedAddress = {
  is_address: true,
  line1: "5 York Garden Way",
  city: "North York",
  region: "ON",
  postal_code: "M6A 0G9",
  country: "CA",
  currency: "CAD",
  stated_fields: ["line1", "city", "region", "postal_code"],
  confidence: 0.95
};

describe("inferAddress from a model reading", () => {
  beforeEach(() => {
    globalThis.__plannerState = undefined;
  });

  it("returns the extracted fields, given when the text stated a street or city, with the filled-in fields listed", () => {
    const address = inferAddress("5 york garden way north york on m6a 0g9", CANADIAN);
    expect(address).toEqual({ line1: "5 York Garden Way", city: "North York", region: "ON", postal_code: "M6A 0G9", country: "CA", currency: "CAD", source: "given", inferred_fields: ["country"] });
    expect(DeliveryAddress.parse(address)).toEqual(address);
    expect(hasDestination(address)).toBe(true);
  });

  it("marks a postal code alone as inferred, with the city, region, and country filled in", () => {
    const reading: ExtractedAddress = { ...CANADIAN, line1: null, stated_fields: ["postal_code"] };
    expect(inferAddress("m6a 0g9", reading)).toMatchObject({ postal_code: "M6A 0G9", country: "CA", source: "inferred", inferred_fields: ["city", "region", "country"] });
  });

  it("reads the cached extraction for the text when none is passed", () => {
    appState().addressExtractions.set(extractionKey("  5 York Garden Way\nNorth York ON M6A 0G9 "), CANADIAN);
    expect(inferAddress("5 york garden way north york on m6a 0g9").country).toBe("CA");
  });

  it("keeps the text verbatim with no destination when the model read no address", () => {
    const address = inferAddress("also make the rug bigger", null);
    expect(address).toEqual(unreadAddress("also make the rug bigger"));
    expect(address).toMatchObject({ line1: "also make the rug bigger", postal_code: "", country: null, source: "given" });
    expect(hasDestination(address)).toBe(false);
    expect(DeliveryAddress.parse(address)).toEqual(address);
  });
});

describe("inferAddress without a reading (no model key)", () => {
  beforeEach(() => {
    globalThis.__plannerState = undefined;
  });

  it.each([
    ["10003", "New York", "NY"],
    ["94110", "San Francisco", "CA"],
    ["60614", "Chicago", "IL"],
    ["02134", "Boston", "MA"],
    ["98101", "Seattle", "WA"],
    ["95014", null, "CA"]
  ])("infers %s as %s, %s", (zip, city, region) => {
    expect(inferAddress(zip)).toMatchObject({ line1: null, city, region, postal_code: zip, country: "US", currency: "USD", source: "inferred" });
  });

  it("keeps country and ZIP for an unknown prefix", () => {
    expect(inferAddress("33101")).toMatchObject({ line1: null, city: null, region: null, postal_code: "33101", country: "US", source: "inferred", inferred_fields: ["country"] });
  });

  it("splits a full address line and marks it given", () => {
    const address = inferAddress("123 E 10th St, Apt 4, New York, NY 10003");
    expect(address).toMatchObject({ line1: "123 E 10th St, Apt 4", city: "New York", region: "NY", postal_code: "10003", country: "US", source: "given" });
    expect(DeliveryAddress.parse(address)).toEqual(address);
  });

  it("keeps text without a postal code verbatim and without a country", () => {
    expect(inferAddress("somewhere in Brooklyn")).toEqual(unreadAddress("somewhere in Brooklyn"));
    expect(inferAddress("5 york garden way north york on m6a 0g9").country).toBeNull();
  });
});
