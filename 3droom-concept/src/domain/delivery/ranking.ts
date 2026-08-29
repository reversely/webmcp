import type { DeliveryStatusValue } from "./evidence";

const CONFIDENCE: Record<DeliveryStatusValue, number> = {
  confirmed: 3,
  likely: 2,
  unknown: 1,
  fail: 0
};

/** Higher is better; a candidate not yet evaluated ranks as unknown. */
export function rankDeliveryConfidence(status: DeliveryStatusValue | null): number {
  return CONFIDENCE[status ?? "unknown"];
}
