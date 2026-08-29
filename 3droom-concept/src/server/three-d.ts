/**
 * 3D generation pipeline (PRD section 15.1): product image and box → Modal GPU endpoint → raw GLB
 * → normalizeGlb to the merchant box → verifyBounds → public/models/{hash}.glb.
 *
 * `requestModel` never blocks: it returns a job row at once and the work runs in a detached
 * promise. Any failure ends the job and the product at `model_status = proxy` with the error
 * recorded (PRD section 17), so the room renders the dimensional proxy instead.
 *
 * Every step the job reaches is recorded on the row as a stage with a timestamp and a detail line
 * (#49), and runs as a `three_d` child span under whatever span requested the model, so the UI
 * strip and the trace panel show the same progression.
 */
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeGlb, verifyBounds, type Bounds, type NormalizeReport } from "../domain/three/glb";
import type { Box, Product } from "../domain/types";
import { appState, updateJob, type ModelJob, type ModelStage, type ModelStageName } from "./state";
import { withSpan } from "./trace";

export const MODELS_URL_PREFIX = "/models";
const ENDPOINT_TIMEOUT_MS = 170_000;
const IMAGE_TIMEOUT_MS = 15_000;

/** What the server learns by fetching the product image before it pays for a GPU call. */
export type ImageProbe = { bytes: number; content_type: string | null };

/** A raw mesh from the generator plus whatever it measured about itself (modal/README.md). */
export type MeshResult = { glb: Uint8Array; vertices?: number; faces?: number; timings?: Record<string, number> };

/** Seams for tests: where GLBs land, how the image is probed, and what produces a raw GLB for it. */
export type ThreeDDeps = {
  modelsDir: string;
  fetchImage: (imageUrl: string) => Promise<ImageProbe>;
  fetchGlb: (imageUrl: string) => Promise<MeshResult>;
};

/** Job ids whose detached run is still in flight, so a repeat request joins it instead of paying twice. */
const inFlight = new Map<string, Promise<ModelJob>>();

/** Cache key from the inputs that determine the output (PRD 15.1): image, width, depth, height. */
export function modelCacheKey(imageUrl: string, widthMm: number, depthMm: number, heightMm: number): string {
  return createHash("sha256").update(JSON.stringify([imageUrl, widthMm, depthMm, heightMm])).digest("hex").slice(0, 32);
}

export function defaultDeps(): ThreeDDeps {
  return { modelsDir: path.join(process.cwd(), "public", "models"), fetchImage: probeImage, fetchGlb: fetchGlbFromModal };
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
    return finish(job.id, "proxy", { error: inputs.error });
  }
  const key = modelCacheKey(inputs.imageUrl, inputs.box.width_mm, inputs.box.depth_mm, inputs.box.height_mm);
  const existing = [...s.jobs.values()].find((j) => j.cache_key === key && j.status !== "proxy" && j.status !== "failed");
  if (existing) return existing;

  const job = createJob(product.id, key);
  const target = path.join(deps.modelsDir, `${key}.glb`);
  if (await exists(target)) return finish(job.id, "ready", { glb_url: `${MODELS_URL_PREFIX}/${key}.glb`, detail: "cached" });

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

/** Milliseconds between the first stage and the last; 0 for a job with one stage. */
export function elapsedFromStages(stages: ModelStage[]): number {
  if (stages.length < 2) return 0;
  return Math.max(0, Date.parse(stages[stages.length - 1].at) - Date.parse(stages[0].at));
}

/** Appends a stage to the job and refreshes `elapsed_ms`; returns the new row. */
export function recordStage(jobId: string, name: ModelStageName, detail?: string): ModelJob {
  const job = appState().jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const stages = [...job.stages, { name, at: new Date().toISOString(), ...(detail ? { detail } : {}) }];
  return updateJob(jobId, { stages, elapsed_ms: elapsedFromStages(stages) });
}

async function generate(jobId: string, imageUrl: string, box: Box, target: string, deps: ThreeDDeps): Promise<ModelJob> {
  const span = (name: string, input?: unknown) => ({ kind: "three_d" as const, name, prd_ref: "PRD 15.1", input });
  try {
    setStatus(jobId, "generating");
    const image = await withSpan(null, span("fetch_image", { image: imageUrl }), () => deps.fetchImage(imageUrl));
    recordStage(jobId, "image_fetched", describeImage(image));

    const mesh = await withSpan(null, span("generate_mesh", { image: imageUrl }), async (h) => {
      const m = await deps.fetchGlb(imageUrl);
      h.setOutput({ bytes: m.glb.byteLength, vertices: m.vertices, faces: m.faces, timings: m.timings });
      return m;
    });
    recordStage(jobId, "mesh_generated", describeMesh(mesh));

    const { glb, report } = await withSpan(null, span("normalize", { box }), async (h) => {
      const r = await normalizeGlb(mesh.glb, box);
      h.setOutput(r.report);
      return r;
    });
    recordStage(jobId, "normalized", describeNormalize(report));

    const bounds = await withSpan(null, span("verify_bounds", { box }), () => verifyBounds(glb, box));
    recordStage(jobId, "verified", describeBounds(bounds));

    await withSpan(null, span("write_glb", { file: path.basename(target) }), async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, glb);
      return { bytes: glb.byteLength };
    });
    return finish(jobId, "ready", { glb_url: `${MODELS_URL_PREFIX}/${path.basename(target)}`, detail: `${kb(glb.byteLength)} written` });
  } catch (e) {
    return finish(jobId, "proxy", { error: e instanceof Error ? e.message : String(e) });
  }
}

/** GETs the product image so a dead URL fails in seconds rather than after a GPU cold start. */
async function probeImage(imageUrl: string): Promise<ImageProbe> {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`image fetch returned ${response.status}`);
  const bytes = (await response.arrayBuffer()).byteLength;
  return { bytes, content_type: response.headers.get("content-type") };
}

/** POSTs to the Modal endpoint (env MODAL_IMAGE_TO_3D_URL, read per call) and decodes the base64 GLB. */
async function fetchGlbFromModal(imageUrl: string): Promise<MeshResult> {
  const url = process.env.MODAL_IMAGE_TO_3D_URL;
  if (!url) throw new Error("MODAL_IMAGE_TO_3D_URL is not set");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl }),
    signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Modal endpoint returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { glb_base64?: string; error?: string; vertices?: number; faces?: number; timings?: Record<string, number> };
  if (!body.glb_base64) throw new Error(`Modal endpoint returned no GLB: ${body.error ?? "empty response"}`);
  return { glb: new Uint8Array(Buffer.from(body.glb_base64, "base64")), vertices: body.vertices, faces: body.faces, timings: body.timings };
}

function kb(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function describeImage(image: ImageProbe): string {
  return `${kb(image.bytes)} ${image.content_type ?? "unknown type"}`;
}

/** "118,011 vertices, 235,714 faces; load 100.7 s, fetch 0.2 s, infer 7.3 s, peak_gpu 4.15 GiB". */
function describeMesh(mesh: MeshResult): string {
  const parts: string[] = [];
  if (mesh.vertices !== undefined) parts.push(`${mesh.vertices.toLocaleString("en-US")} vertices`);
  if (mesh.faces !== undefined) parts.push(`${mesh.faces.toLocaleString("en-US")} faces`);
  const timings = Object.entries(mesh.timings ?? {}).map(([key, value]) => {
    if (key.endsWith("_s")) return `${key.slice(0, -2)} ${value} s`;
    if (key.endsWith("_gib")) return `${key.slice(0, -4)} ${value} GiB`;
    return `${key} ${value}`;
  });
  const head = parts.join(", ") || `${kb(mesh.glb.byteLength)} GLB`;
  return timings.length ? `${head}; ${timings.join(", ")}` : head;
}

function describeNormalize(report: NormalizeReport): string {
  const [x, y, z] = report.scale.map((v) => v.toFixed(3));
  return `scale ${x} × ${y} × ${z}, rotation ${report.rotationApplied}°`;
}

function describeBounds(bounds: Bounds): string {
  const size = [0, 1, 2].map((axis) => (bounds.max[axis] - bounds.min[axis]).toFixed(3));
  return `bounds ${size[0]} × ${size[1]} × ${size[2]} m match the box`;
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
    stages: [{ name: "queued", at: now }],
    elapsed_ms: 0,
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

/** Ends the job: records the terminal stage (the error is the proxy stage's detail), then the product. */
function finish(jobId: string, status: "ready" | "proxy", fields: { glb_url?: string; error?: string; detail?: string }): ModelJob {
  recordStage(jobId, status, fields.error ?? fields.detail);
  const next = updateJob(jobId, { status, glb_url: fields.glb_url ?? null, error: fields.error ?? null });
  setProduct(next.product_id, { model_status: status, glb_url: next.glb_url });
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
