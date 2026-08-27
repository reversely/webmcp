import type { BudgetState } from "../types";
import { z } from "zod";

export type Budget = {
  committed_cents: number;
  budget_cents: number;
  state: z.infer<typeof BudgetState>;
  overage_cents: number;
};

export type DomainEvent =
  | { type: "PRODUCT_ADDED"; project_id: string; product_id: string; candidate_id: string }
  | { type: "BOM_REGENERATED"; project_id: string; inserted_item_ids: string[]; budget: Budget }
  | { type: "BUDGET_VIOLATED"; project_id: string; budget: Budget }
  | {
      type: "PRODUCT_REPLACED";
      project_id: string;
      old_item_id: string;
      new_item_id: string;
      decision_id: string;
    };

export type Emit = (event: DomainEvent) => void;
