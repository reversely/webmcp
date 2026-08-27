/**
 * Chat artifacts written by the PlanningAgent into ChatMessage.artifact and updated in place by
 * id. Shapes follow the contract in docs/prd.md 9.2 (sourcing), 13.1 (ranking), 5.2 (question),
 * 16 (spec), and 20 (room estimate). The renderers read every field leniently because the agent
 * side is built separately.
 */
import type { Category } from "../../../../domain/types";
import type { ChatMessage } from "../../../../server/state";

export type SourcingStatus = "searching" | "retrieving details" | "checking dimensions" | "checking visual fit" | "checking delivery" | "selected" | "no match";

export type SourcingCategory = {
  found: number;
  available: number;
  dimensioned: number;
  compatible: number;
  delivery_checked: number;
  status: SourcingStatus | string;
  selected_product_id?: string;
};

export type SourcingData = {
  categories: Partial<Record<Category, SourcingCategory>>;
  subtotal_cents?: number;
  window?: { min_cents?: number; max_cents?: number } | null;
  notes?: string[];
};

export type RankingRow = {
  product_id: string;
  title: string;
  image_url?: string | null;
  price_cents: number;
  savings_cents: number;
  dims?: string | { width_mm?: number | null; depth_mm?: number | null; height_mm?: number | null } | null;
  geometry?: string | { status?: string; result?: string } | null;
  visual?: string | { status?: string; result?: string; score?: number } | null;
  delivery?: string | { status?: string; result?: string } | null;
  status: string;
  reason?: string;
  rank?: number | null;
};

export type RankingData = {
  category: Category | string;
  required_savings_cents: number;
  ceiling_cents: number;
  rows: RankingRow[];
  selected_product_id?: string;
};

export type QuestionData = { run_id: string; field: string; question: string };

/** PRD 16 ProjectSpec. */
export type SpecData = {
  room?: { width_ft: number; length_ft: number } | null;
  budget?: { maximum: number; currency: string } | null;
  required_by?: string | null;
  required_items?: string[];
  /** The board form writes hex lists as { base, accent }; the agent compiler writes colour names as { base_colors, accent_colors }. */
  visual_direction?: { base?: string[]; accent?: string[]; base_colors?: string[]; accent_colors?: string[] } | null;
  layout_requirements?: { type: string; items: string[] }[];
};

export type RoomEstimateData = {
  width_mm: number;
  length_mm: number;
  height_mm?: number | null;
  name: string;
  door?: { wall: string; offset_mm: number; width_mm: number } | null;
  window?: { wall: string; offset_mm: number; width_mm: number } | null;
};

export type Artifact =
  | { kind: "sourcing"; id: string; data: SourcingData }
  | { kind: "ranking"; id: string; data: RankingData }
  | { kind: "question"; id: string; data: QuestionData }
  | { kind: "spec"; id: string; data: SpecData }
  | { kind: "room_estimate"; id: string; data: RoomEstimateData };

export type ArtifactMessage = ChatMessage & { artifact?: Artifact };

export const CATEGORY_LABEL: Record<string, string> = {
  sofa: "Sofa",
  coffee_table: "Coffee table",
  ottoman: "Ottoman",
  rug: "Rug",
  side_table: "Side table"
};

export const dollars = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Reads a status-like value that the agent may send as a string or as an object with a status field. */
export function statusText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as { status?: unknown; result?: unknown; score?: unknown };
    if (typeof o.status === "string") return o.status;
    if (typeof o.result === "string") return o.result;
    if (typeof o.score === "number") return `${Math.round(o.score * 100)}%`;
  }
  return "";
}

/** Returns the newest artifact of one kind in a message list, or null. */
export function latestArtifact<K extends Artifact["kind"]>(messages: ArtifactMessage[] | undefined, kind: K): Extract<Artifact, { kind: K }> | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const a = messages[i].artifact;
    if (a && a.kind === kind) return a as Extract<Artifact, { kind: K }>;
  }
  return null;
}
