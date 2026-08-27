/**
 * Chat artifacts written by the PlanningAgent into ChatMessage.artifact and updated in place by
 * id. Shapes follow the contract in docs/prd.md 9.2 (sourcing), 13.1 (ranking), 5.2 (question),
 * 16 (spec), and 20 (room estimate). The renderers read every field leniently because the agent
 * side is built separately.
 */
import type { Category, Kind, LayoutRule } from "../../../../domain/types";
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
  /** The card's heading, written by the server for this project. */
  title?: string;
  /** Progress per project item, keyed by the item's own phrase. */
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
  /** The project's phrase for the item being replaced. */
  category: Category;
  required_savings_cents: number;
  ceiling_cents: number;
  rows: RankingRow[];
  selected_product_id?: string;
};

export type QuestionData = { run_id: string; field: string; question: string };

/** PRD 16 ProjectSpec as the agent compiles it (src/agent/compile.ts); older artifacts may carry feet and bare item strings. */
export type SpecData = {
  room?: { width_mm?: number; length_mm?: number; width_ft?: number; length_ft?: number } | null;
  room_name?: string | null;
  budget?: { maximum: number; currency: string } | null;
  required_by?: string | null;
  required_items?: (string | { name: string; kind: Kind | null })[];
  visual_direction?: { base?: string[]; accent?: string[] } | null;
  layout_requirements?: (LayoutRule | { relation: string; subject: string; objects: string[]; distance_mm?: number | null })[];
  /** Colours the model read from colour notes, each with the note it came from. */
  suggested_colours?: { hex: string; from_text: string }[];
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
