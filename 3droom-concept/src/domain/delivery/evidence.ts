/**
 * Normalizes raw delivery evidence into a `Candidate.delivery_status` plus the evidence record
 * stored in `Candidate.delivery_evidence_json`.
 *
 * A checkout page or cart API gives dates, so a fitting window is `confirmed`. Merchant prose gives
 * durations, so a fitting window is only `likely`. Either source yields `fail` when even the earliest
 * arrival lands after `required_by`. A window that straddles `required_by`, or that has no usable
 * edge, stays `unknown`: the evidence is kept so a reader can see the straddle, and the candidate
 * ranks below a fitting one instead of being eliminated on a guess.
 */
import type { DeliveryStatus } from "../types";
import { isAfter, isOnOrBefore } from "@webmcp/shopify-ucp";
import { parseArrivalWindow, type ParsedDuration } from "@webmcp/shopify-ucp";

export type DeliveryStatusValue = (typeof DeliveryStatus)["options"][number];

export type DeliveryEvidenceInput =
  | {
      kind: "date_range";
      source: "checkout_page" | "cart_api";
      min: string | null;
      max: string | null;
      addressPartial: boolean;
    }
  | { kind: "duration_text"; source: "shipping_policy" | "description"; text: string }
  | { kind: "none" };

export interface DeliveryContext {
  requiredBy: string;
  today: string;
}

export interface DeliveryEvidence {
  source: "checkout_page" | "cart_api" | "shipping_policy" | "description" | "none";
  matched_text: string | null;
  arrival_min: string | null;
  arrival_max: string | null;
  duration: ParsedDuration | null;
  computed_from: string | null;
  address_partial: boolean;
}

export interface NormalizedDelivery {
  status: DeliveryStatusValue;
  evidence: DeliveryEvidence;
}

function statusForWindow(
  arrivalMin: string | null,
  arrivalMax: string | null,
  requiredBy: string,
  fitStatus: "confirmed" | "likely"
): DeliveryStatusValue {
  if (arrivalMax !== null && isOnOrBefore(arrivalMax, requiredBy)) return fitStatus;
  if (arrivalMin !== null && isAfter(arrivalMin, requiredBy)) return "fail";
  return "unknown";
}

export function normalizeDeliveryEvidence(
  input: DeliveryEvidenceInput,
  ctx: DeliveryContext
): NormalizedDelivery {
  const empty: DeliveryEvidence = {
    source: "none",
    matched_text: null,
    arrival_min: null,
    arrival_max: null,
    duration: null,
    computed_from: null,
    address_partial: false
  };

  switch (input.kind) {
    case "none":
      return { status: "unknown", evidence: empty };
    case "date_range":
      return {
        status: statusForWindow(input.min, input.max, ctx.requiredBy, "confirmed"),
        evidence: {
          ...empty,
          source: input.source,
          arrival_min: input.min,
          arrival_max: input.max,
          address_partial: input.addressPartial
        }
      };
    case "duration_text": {
      const window = parseArrivalWindow(input.text, ctx.today);
      if (!window) return { status: "unknown", evidence: { ...empty, source: input.source } };
      // Explicit dates in prose are the merchant's own estimate, so they count as confirmed;
      // a duration is an inference from today and only ever reaches likely.
      const fitStatus = window.duration === null ? "confirmed" : "likely";
      return {
        status: statusForWindow(window.arrival_min, window.arrival_max, ctx.requiredBy, fitStatus),
        evidence: {
          ...empty,
          source: input.source,
          matched_text: window.matched_text,
          arrival_min: window.arrival_min,
          arrival_max: window.arrival_max,
          duration: window.duration,
          computed_from: window.duration === null ? null : ctx.today
        }
      };
    }
  }
}
