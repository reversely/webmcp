import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxyToGlb, verifyBounds } from "../domain/three/glb";
import type { Box, Product } from "../domain/types";
import { appState } from "./state";
import { awaitJob, modelCacheKey, requestModel, type ThreeDDeps } from "./three-d";

const BOX: Box = { width_mm: 2200, depth_mm: 950, height_mm: 800 };
const IMAGE = "https://cdn.example.com/sofa.webp";

let modelsDir: string;
let productId: string;

beforeEach(async () => {
  modelsDir = await mkdtemp(path.join(tmpdir(), "three-d-"));
  const s = appState();
  productId = s.store.newId("prod");
  const product: Product = {
    id: productId,
    merchant: "example",
    source_url: "https://example.com/sofa",
    external_product_id: "sofa-1",
    title: "Sofa",
    description: "",
    primary_image_url: IMAGE,
    price_cents: 100000,
    currency: "USD",
    width_mm: BOX.width_mm,
    depth_mm: BOX.depth_mm,
    height_mm: BOX.height_mm,
    dimension_source: null,
    spatial_status: "grounded",
    variant_json: null,
    availability_json: null,
    glb_url: null,
    model_status: "no_model"
  };
  s.store.products.set(productId, product);
});

afterEach(async () => {
  await rm(modelsDir, { recursive: true, force: true });
  appState().jobs.clear();
});

describe("modelCacheKey", () => {
  it("is stable for the same inputs", () => {
    expect(modelCacheKey(IMAGE, 2200, 950, 800)).toBe(modelCacheKey(IMAGE, 2200, 950, 800));
  });

  it("changes with any input", () => {
    const base = modelCacheKey(IMAGE, 2200, 950, 800);
    expect(modelCacheKey(IMAGE + "?v=2", 2200, 950, 800)).not.toBe(base);
    expect(modelCacheKey(IMAGE, 2201, 950, 800)).not.toBe(base);
    expect(modelCacheKey(IMAGE, 2200, 951, 800)).not.toBe(base);
    expect(modelCacheKey(IMAGE, 2200, 950, 801)).not.toBe(base);
    // Width and depth are distinct inputs, so swapping them must not collide.
    expect(modelCacheKey(IMAGE, 950, 2200, 800)).not.toBe(base);
  });
});

describe("requestModel", () => {
  it("normalizes a raw GLB to the product box and lands as ready with bounds verified", async () => {
    // A raw mesh at a different size and aspect than the box, as a GPU model would return.
    const raw = await proxyToGlb("sofa", { width_mm: 500, depth_mm: 1200, height_mm: 300 });
    const deps: ThreeDDeps = { modelsDir, fetchGlb: async () => raw };

    const job = await requestModel(productId, deps);
    expect(job.status).toBe("queued");
    // The detached run may already have moved the product on before the caller reads it.
    expect(["queued", "generating"]).toContain(appState().store.getProduct(productId).model_status);

    const done = await awaitJob(job.id);
    expect(done.status).toBe("ready");
    expect(done.error).toBeNull();
    expect(done.glb_url).toBe(`/models/${job.cache_key}.glb`);
    const product = appState().store.getProduct(productId);
    expect(product.model_status).toBe("ready");
    expect(product.glb_url).toBe(done.glb_url);

    const written = new Uint8Array(await readFile(path.join(modelsDir, `${job.cache_key}.glb`)));
    const bounds = await verifyBounds(written, BOX);
    expect(bounds.max[1]).toBeCloseTo(0.8, 3);
  });

  it("returns the cached file without calling the endpoint", async () => {
    const raw = await proxyToGlb("sofa", BOX);
    let calls = 0;
    const deps: ThreeDDeps = { modelsDir, fetchGlb: async () => (calls++, raw) };
    await awaitJob((await requestModel(productId, deps)).id);
    appState().jobs.clear();

    const second = await requestModel(productId, deps);
    expect(second.status).toBe("ready");
    expect(calls).toBe(1);
  });

  it("lands as proxy with the error recorded when the endpoint fails", async () => {
    const deps: ThreeDDeps = { modelsDir, fetchGlb: async () => { throw new Error("endpoint unreachable"); } };
    const job = await requestModel(productId, deps);
    const done = await awaitJob(job.id);
    expect(done.status).toBe("proxy");
    expect(done.error).toBe("endpoint unreachable");
    expect(done.glb_url).toBeNull();
    expect(appState().store.getProduct(productId).model_status).toBe("proxy");
  });

  it("lands as proxy at once for a product without dimensions", async () => {
    const s = appState();
    s.store.products.set(productId, { ...s.store.getProduct(productId), height_mm: null });
    const job = await requestModel(productId, { modelsDir, fetchGlb: async () => new Uint8Array() });
    expect(job.status).toBe("proxy");
    expect(job.error).toMatch(/width, depth, and height/);
  });
});
