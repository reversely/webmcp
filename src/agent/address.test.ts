import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedAddress } from "../domain/types";
import { appState } from "../server/state";
import { extractAddress, primeAddressReply, resolveAddress } from "./address";
import { requestInput, startRun } from "../domain/agent-run";
import { resetState } from "./test-helpers";

const { structuredCall } = vi.hoisted(() => ({ structuredCall: vi.fn() }));
vi.mock("./model", () => ({ structuredCall, hasModelKey: () => true }));

const reading = (fields: Partial<ExtractedAddress>): ExtractedAddress => ({
  is_address: true,
  line1: null,
  city: null,
  region: null,
  postal_code: null,
  country: null,
  currency: null,
  stated_fields: [],
  confidence: 0.9,
  ...fields
});

const CANADIAN_LINE = "5 york garden way north york on m6a 0g9";
const CANADIAN = reading({ line1: "5 York Garden Way", city: "North York", region: "ON", postal_code: "M6A 0G9", country: "CA", currency: "CAD", stated_fields: ["line1", "city", "region", "postal_code"] });
const UK = reading({ line1: "10 Downing Street", city: "London", region: "England", postal_code: "SW1A 2AA", country: "GB", currency: "GBP", stated_fields: ["line1", "city", "postal_code"] });
const US_ZIP = reading({ city: "New York", region: "NY", postal_code: "10003", country: "US", currency: "USD", stated_fields: ["postal_code"] });
const NOT_AN_ADDRESS = reading({ is_address: false, confidence: 0.99 });

describe("extractAddress", () => {
  beforeEach(() => {
    resetState();
    structuredCall.mockReset();
  });

  it("reads the Canadian line with its country, currency, and spaced postal code", async () => {
    structuredCall.mockResolvedValueOnce(CANADIAN);
    expect(await extractAddress(CANADIAN_LINE)).toEqual(CANADIAN);
    expect(structuredCall).toHaveBeenCalledWith(expect.anything(), "extract_address", expect.stringContaining("ISO 3166-1"), [{ type: "input_text", text: CANADIAN_LINE }]);
    expect(await resolveAddress(CANADIAN_LINE)).toEqual({ line1: "5 York Garden Way", city: "North York", region: "ON", postal_code: "M6A 0G9", country: "CA", currency: "CAD", source: "given", inferred_fields: ["country"] });
  });

  it("reads a UK line", async () => {
    structuredCall.mockResolvedValueOnce(UK);
    expect(await resolveAddress("10 Downing Street, London SW1A 2AA")).toMatchObject({ postal_code: "SW1A 2AA", country: "GB", currency: "GBP", region: "England", source: "given", inferred_fields: ["region", "country"] });
  });

  it("reads a bare US ZIP as inferred", async () => {
    structuredCall.mockResolvedValueOnce(US_ZIP);
    expect(await resolveAddress("10003")).toMatchObject({ city: "New York", region: "NY", postal_code: "10003", country: "US", currency: "USD", source: "inferred", inferred_fields: ["city", "region", "country"] });
  });

  it("returns null for a message that is not an address and keeps the text as the line", async () => {
    structuredCall.mockResolvedValueOnce(NOT_AN_ADDRESS);
    expect(await extractAddress("also make the rug bigger")).toBeNull();
    expect(await resolveAddress("also make the rug bigger")).toMatchObject({ line1: "also make the rug bigger", postal_code: "", country: null, source: "given" });
    expect(structuredCall).toHaveBeenCalledTimes(1);
  });

  it("caches one reading per text, whatever its spacing and case", async () => {
    structuredCall.mockResolvedValueOnce(CANADIAN);
    await extractAddress(CANADIAN_LINE);
    expect(await extractAddress("  5 York Garden Way   North York ON M6A 0G9 ")).toEqual(CANADIAN);
    expect(structuredCall).toHaveBeenCalledTimes(1);
    expect(appState().addressExtractions.size).toBe(1);
  });

  it("caches nothing when the model call yields nothing, so the ZIP fallback still applies", async () => {
    structuredCall.mockResolvedValueOnce(null);
    expect(await resolveAddress("10003")).toMatchObject({ city: "New York", country: "US", source: "inferred" });
    expect(appState().addressExtractions.size).toBe(0);
  });

  it("primes the cache only while the project's run waits for the address", async () => {
    structuredCall.mockResolvedValue(CANADIAN);
    const s = appState();
    await primeAddressReply("p", CANADIAN_LINE);
    expect(structuredCall).not.toHaveBeenCalled();
    const run = startRun(s.runs, { projectId: "p", goal: "g" });
    s.activeRuns.set("p", run.id);
    requestInput(s.runs, run.id, { field: "delivery_address", question: "Where?" });
    await primeAddressReply("p", CANADIAN_LINE);
    expect(structuredCall).toHaveBeenCalledTimes(1);
  });
});
