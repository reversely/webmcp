/**
 * Steps that follow a product landing in the store but are owned by other pipelines.
 * `ingestProductUrl`, `addCatalogProduct`, and sourcing step 13 call them after the store commits
 * so the product card exists before either starts. Neither blocks the caller (PRD 15.1, 17).
 */
import { requestModel, type ThreeDDeps } from "../../server/three-d";
import type { Candidate, Product } from "../types";

/**
 * Starts 3D generation for the product in a detached promise. A failure is logged and the job
 * lands at `proxy` inside `requestModel`; the caller never waits or throws.
 */
export function startModelGeneration(product: Product, deps?: ThreeDDeps): void {
  requestModel(product.id, deps).catch((e: unknown) => {
    console.warn(`3D generation request failed for ${product.id}: ${e instanceof Error ? e.message : String(e)}`);
  });
}

export function startVisualEvaluation(_candidate: Candidate): void {}
