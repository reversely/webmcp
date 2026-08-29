/**
 * Steps that follow a product landing in the store but are owned by other pipelines.
 * `ingestProductUrl`, `addCatalogProduct`, and sourcing step 13 call them after the store commits
 * so the product card exists before either starts. Neither blocks the caller (PRD 15.1, 17).
 */
import { awaitJob, requestModel, type ThreeDDeps } from "../../server/three-d";
import type { ModelJob } from "../../server/state";
import { recordIssue, withSpan } from "../../server/trace";
import type { Candidate, Product } from "../types";

/**
 * Starts 3D generation for the product in a detached promise and resolves with the job row as
 * soon as it exists (null when the request failed before one was created). A failure is logged
 * and the job lands at `proxy` inside `requestModel`; the caller never waits for the outcome or
 * throws. The whole job, from request to `ready` or `proxy`, is one `three_d` span with a child
 * span per stage (#49), and a proxy outcome is an issue (PRD 17).
 */
export function startModelGeneration(product: Product, deps?: ThreeDDeps): Promise<ModelJob | null> {
  return new Promise((resolveJob) => {
    withSpan(null, { kind: "three_d", name: "request_model", prd_ref: "PRD 15.1", input: { product_id: product.id, title: product.title, image: product.primary_image_url, box: [product.width_mm, product.depth_mm, product.height_mm] } }, async (span) => {
      const job = await requestModel(product.id, deps);
      resolveJob(job);
      const settled = await awaitJob(job.id);
      span.setOutput({ job_id: settled.id, status: settled.status, glb_url: settled.glb_url, error: settled.error, cache_key: settled.cache_key, elapsed_ms: settled.elapsed_ms, stages: settled.stages.map((s) => s.name) });
      if (settled.status === "proxy") {
        recordIssue(null, { source: "three_d request_model", message: `3D generation for "${product.title}" fell back to a proxy box (${settled.error ?? "no error recorded"}); the room shows its dimensions without the modelled shape.` });
      }
    }).catch((e: unknown) => {
      resolveJob(null);
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`3D generation request failed for ${product.id}: ${message}`);
      recordIssue(null, { source: "three_d request_model", severity: "error", message: `The 3D generation request for "${product.title}" failed before a job was created (${message}); the room keeps the proxy box for it.` });
    });
  });
}

export function startVisualEvaluation(_candidate: Candidate): void {}
