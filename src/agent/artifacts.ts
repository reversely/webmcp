/**
 * Data shapes of the board artifacts the agent writes into chat messages (PRD 9.2 and 13.1).
 * The UI reads them from `ChatMessage.artifact` and re-renders on every poll.
 */
import type { Category, DeliveryStatus } from "../domain/types";
import { upsertArtifact } from "../server/state";
import type { z } from "zod";

export type CategoryStatus =
  | "searching"
  | "retrieving details"
  | "checking dimensions"
  | "checking visual fit"
  | "checking delivery"
  | "selected"
  | "no match";

export type CategoryProgress = {
  found: number;
  available: number;
  dimensioned: number;
  compatible: number;
  delivery_checked: number;
  status: CategoryStatus;
  selected_product_id?: string;
};

export type SourcingArtifact = {
  categories: Partial<Record<Category, CategoryProgress>>;
  subtotal_cents?: number;
  window?: { min_cents: number; max_cents: number };
};

export type RankingRow = {
  product_id: string;
  title: string;
  image_url: string | null;
  price_cents: number;
  savings_cents: number;
  dims: string | null;
  geometry: "pass" | "fail" | "pending";
  visual: "pass" | "fail" | "pending";
  delivery: z.infer<typeof DeliveryStatus> | "pending";
  status: "evaluating" | "eliminated" | "ranked" | "selected";
  reason?: string;
  rank?: number;
};

export type RankingArtifact = {
  category: Category;
  required_savings_cents: number;
  ceiling_cents: number;
  rows: RankingRow[];
  selected_product_id?: string;
};

export type QuestionArtifact = { run_id: string; field: "delivery_address"; question: string };

export function emptyProgress(): CategoryProgress {
  return { found: 0, available: 0, dimensioned: 0, compatible: 0, delivery_checked: 0, status: "searching" };
}

export function writeSourcingArtifact(projectId: string, id: string, data: SourcingArtifact): void {
  upsertArtifact(projectId, { kind: "sourcing", id, data }, "Finding your living room");
}

export function writeRankingArtifact(projectId: string, id: string, data: RankingArtifact): void {
  upsertArtifact(projectId, { kind: "ranking", id, data }, `Cheaper ${data.category.replace("_", " ")} options`);
}

export function writeQuestionArtifact(projectId: string, id: string, data: QuestionArtifact): void {
  upsertArtifact(projectId, { kind: "question", id, data }, data.question);
}
