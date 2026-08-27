/**
 * 3D generation pipeline (PRD section 15.1): product image and box → Modal GPU endpoint → raw GLB
 * → normalizeGlb to the merchant box → verifyBounds → public/models/{hash}.glb.
 *
 * `requestModel` never blocks: it returns a job row at once and the work runs in a detached
 * promise. Any failure ends the job and the product at `model_status = proxy` with the error
 * recorded (PRD section 17), so the room renders the dimensional proxy instead.
 */
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeGlb, verifyBounds } from "../domain/three/glb";
import type { Box, Product } from "../domain/types";
import { appState, updateJob, type ModelJob } from "./state";

export const MODELS_URL_PREFIX = "/models";
const ENDPOINT_TIMEOUT_MS = 170_000;

/** Seams for tests: where GLBs land and what produces a raw GLB for an image. */
export type ThreeDDeps = {
  modelsDir: string;
  fetchGlb: (imageUrl: string) => Promise<Uint8Array>;
};

/** Job ids whose detached run is still in flight, so a repeat request joins it instead of paying twice. */
const inFlight = new Map<string, Promise<ModelJob>>();

/** Cache key from the inputs that determine the output (PRD 15.1): image, width, depth, height. */
export function modelCacheKey(imageUrl: string, widthMm: number, depthMm: number, heightMm: number): string {
  return createHash("sha256").update(JSON.stringify([imageUrl, widthMm, depthMm, heightMm])).digest("hex").slice(0, 32);
}

export function defaultDeps(): ThreeDDeps {
  return { modelsDir: path.join(process.cwd(), "public", "models"), fetchGlb: fetchGlbFromModal };
}

/**
 * Starts generation for a product, or returns the job that already covers its cache key.
 *
 * A product without an image or a full box cannot be generated and lands at `proxy` at once.
 */
export async function requestModel(productId: string, deps: ThreeDDeps = defaultDeps()): Promise<ModelJob> {
  const s = appState();
  const product = s.store.getProduct(productId);
  const inputs = generationInputs(product);
  if ("error" in inputs) {
    const job = createJob(product.id, "none");
    return finish(job, "proxy", { error: inputs.error });
  }
  const key = modelCacheKey(inputs.imageUrl, inputs.box.width_mm, inputs.box.depth_mm, inputs.box.height_mm);
  const existing = [...s.jobs.values()].find((j) => j.cache_key === key && j.status !== "proxy" && j.status !== "failed");
  if (existing) return existing;

  const job = createJob(product.id, key);
  const target = path.join(deps.modelsDir, `${key}.glb`);
  if (await exists(target)) return finish(job, "ready", { glb_url: `${MODELS_URL_PREFIX}/${key}.glb` });

  const run = generate(job.id, inputs.imageUrl, inputs.box, target, deps).finally(() => inFlight.delete(job.id));
  inFlight.set(job.id, run);
  return job;
}

/** Resolves when the job's detached run has settled; returns the current row at once if none is running. */
export async function awaitJob(jobId: string): Promise<ModelJob> {
  await inFlight.get(jobId);
  const job = appState().jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  return job;
}

async function generate(jobId: string, imageUrl: string, box: Box, target: string, deps: ThreeDDeps): Promise<ModelJob> {
  try {
    setStatus(jobId, "generating");
    const raw = await deps.fetchGlb(imageUrl);
    const { glb } = await normalizeGlb(raw, box);
    await verifyBounds(glb, box);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, glb);
    return finish(appState().jobs.get(jobId)!, "ready", { glb_url: `${MODELS_URL_PREFIX}/${path.basename(target)}` });
  } catch (e) {
    return finish(appState().jobs.get(jobId)!, "proxy", { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POSTs to the Modal endpoint (env MODAL_IMAGE_TO_3D_URL, read per call) and decodes the base64 GLB. */
async function fetchGlbFromModal(imageUrl: string): Promise<Uint8Array> {
  const url = process.env.MODAL_IMAGE_TO_3D_URL;
  if (!url) throw new Error("MODAL_IMAGE_TO_3D_URL is not set");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl }),
    signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Modal endpoint returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { glb_base64?: string; error?: string };
  if (!body.glb_base64) throw new Error(`Modal endpoint returned no GLB: ${body.error ?? "empty response"}`);
  return new Uint8Array(Buffer.from(body.glb_base64, "base64"));
}

function generationInputs(product: Product): { imageUrl: string; box: Box } | { error: string } {
  if (!product.primary_image_url) return { error: "product has no primary image" };
  if (product.width_mm == null || product.depth_mm == null || product.height_mm == null) {
    return { error: "product has no width, depth, and height" };
  }
  return {
    imageUrl: product.primary_image_url,
    box: { width_mm: product.width_mm, depth_mm: product.depth_mm, height_mm: product.height_mm }
  };
}

function createJob(productId: string, cacheKey: string): ModelJob {
  const s = appState();
  const now = new Date().toISOString();
  const job: ModelJob = {
    id: s.store.newId("job"),
    product_id: productId,
    cache_key: cacheKey,
    status: "queued",
    glb_url: null,
    error: null,
    created_at: now,
    updated_at: now
  };
  s.jobs.set(job.id, job);
  setProduct(productId, { model_status: "queued" });
  return job;
}

function setStatus(jobId: string, status: Product["model_status"]): ModelJob {
  const job = updateJob(jobId, { status });
  setProduct(job.product_id, { model_status: status });
  return job;
}

function finish(job: ModelJob, status: "ready" | "proxy", fields: { glb_url?: string; error?: string }): ModelJob {
  const next = updateJob(job.id, { status, glb_url: fields.glb_url ?? null, error: fields.error ?? null });
  setProduct(job.product_id, { model_status: status, glb_url: next.glb_url });
  return next;
}

function setProduct(productId: string, patch: Partial<Pick<Product, "model_status" | "glb_url">>): void {
  const s = appState();
  const product = s.store.products.get(productId);
  if (product) s.store.products.set(productId, { ...product, ...patch });
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(() => true, () => false);
}
