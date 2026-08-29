import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxyToGlb, verifyBounds } from "../domain/three/glb";
import type { Box, Product } from "../domain/types";
import { appState } from "./state";
import { awaitJob, elapsedFromStages, modelCacheKey, requestModel, type ThreeDDeps } from "./three-d";
import { resetTrace, spansFor, withSpan } from "./trace";

const BOX: Box = { width_mm: 2200, depth_mm: 950, height_mm: 800 };
const IMAGE = "https://cdn.example.com/sofa.webp";

let modelsDir: string;
let productId: string;

/** Fake endpoint: a probe that finds a small webp and a generator that returns `raw` with the README's timings shape. */
function fakeDeps(raw: Uint8Array, overrides: Partial<ThreeDDeps> = {}): ThreeDDeps {
  return {
    modelsDir,
    fetchImage: async () => ({ bytes: 320 * 1024, content_type: "image/webp" }),
    fetchGlb: async () => ({ glb: raw, vertices: 118011, faces: 235714, timings: { load_s: 0.4, fetch_s: 0.2, infer_s: 7.3, peak_gpu_gib: 4.15 } }),
    ...overrides
  };
}

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
  resetTrace();
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
    const raw = await proxyToGlb("seating", { width_mm: 500, depth_mm: 1200, height_mm: 300 });
    const job = await requestModel(productId, fakeDeps(raw));
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
    const raw = await proxyToGlb("seating", BOX);
    let calls = 0;
    const deps = fakeDeps(raw, { fetchGlb: async () => (calls++, { glb: raw }) });
    await awaitJob((await requestModel(productId, deps)).id);
    appState().jobs.clear();

    const second = await requestModel(productId, deps);
    expect(second.status).toBe("ready");
    expect(calls).toBe(1);
    expect(second.stages.map((s) => s.name)).toEqual(["queued", "ready"]);
    expect(second.stages[1].detail).toBe("cached");
  });

  it("lands as proxy with the error recorded when the endpoint fails", async () => {
    const deps = fakeDeps(new Uint8Array(), { fetchGlb: async () => { throw new Error("endpoint unreachable"); } });
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
    const job = await requestModel(productId, fakeDeps(new Uint8Array()));
    expect(job.status).toBe("proxy");
    expect(job.error).toMatch(/width, depth, and height/);
    expect(job.stages.map((s) => s.name)).toEqual(["queued", "proxy"]);
    expect(job.stages[1].detail).toBe(job.error);
  });
});

describe("job stages (#49)", () => {
  it("records every stage in order with a timestamp and what the step measured", async () => {
    const raw = await proxyToGlb("seating", { width_mm: 500, depth_mm: 1200, height_mm: 300 });
    const job = await requestModel(productId, fakeDeps(raw));
    expect(job.stages).toEqual([{ name: "queued", at: job.created_at }]);

    const done = await awaitJob(job.id);
    expect(done.stages.map((s) => s.name)).toEqual(["queued", "image_fetched", "mesh_generated", "normalized", "verified", "ready"]);
    for (const stage of done.stages) expect(Number.isNaN(Date.parse(stage.at))).toBe(false);
    const at = done.stages.map((s) => Date.parse(s.at));
    expect([...at].sort((a, b) => a - b)).toEqual(at);

    const detail = Object.fromEntries(done.stages.map((s) => [s.name, s.detail ?? ""]));
    expect(detail.image_fetched).toBe("320 KB image/webp");
    expect(detail.mesh_generated).toBe("118,011 vertices, 235,714 faces; load 0.4 s, fetch 0.2 s, infer 7.3 s, peak_gpu 4.15 GiB");
    // The raw proxy is 500 wide by 1200 deep, closer to the box's aspect turned 90°, so the
    // normalizer rotates it and scales 1200 → 2200, 300 → 800, 500 → 950.
    expect(detail.normalized).toBe("scale 1.833 × 2.667 × 1.900, rotation 90°");
    expect(detail.verified).toBe("bounds 2.200 × 0.800 × 0.950 m match the box");
    expect(detail.ready).toMatch(/^\d+ KB written$/);
  });

  it("records the failure as a proxy stage carrying the error, after the stages that did complete", async () => {
    const deps = fakeDeps(new Uint8Array(), { fetchGlb: async () => { throw new Error("Modal endpoint returned 503: cold start timed out"); } });
    const done = await awaitJob((await requestModel(productId, deps)).id);
    expect(done.stages.map((s) => s.name)).toEqual(["queued", "image_fetched", "proxy"]);
    expect(done.stages[2].detail).toBe("Modal endpoint returned 503: cold start timed out");
    expect(done.error).toBe(done.stages[2].detail);
  });

  it("records a dead image URL as proxy before the generator is called", async () => {
    let generated = 0;
    const deps = fakeDeps(new Uint8Array(), {
      fetchImage: async () => { throw new Error("image fetch returned 404"); },
      fetchGlb: async () => (generated++, { glb: new Uint8Array() })
    });
    const done = await awaitJob((await requestModel(productId, deps)).id);
    expect(done.stages.map((s) => s.name)).toEqual(["queued", "proxy"]);
    expect(done.error).toBe("image fetch returned 404");
    expect(generated).toBe(0);
  });

  it("computes elapsed_ms from the first and last stage timestamps", async () => {
    expect(elapsedFromStages([])).toBe(0);
    expect(elapsedFromStages([{ name: "queued", at: "2026-08-27T10:00:00.000Z" }])).toBe(0);
    expect(
      elapsedFromStages([
        { name: "queued", at: "2026-08-27T10:00:00.000Z" },
        { name: "image_fetched", at: "2026-08-27T10:00:00.300Z" },
        { name: "ready", at: "2026-08-27T10:00:12.400Z" }
      ])
    ).toBe(12400);

    const raw = await proxyToGlb("seating", BOX);
    const done = await awaitJob((await requestModel(productId, fakeDeps(raw))).id);
    expect(done.elapsed_ms).toBe(Date.parse(done.stages[done.stages.length - 1].at) - Date.parse(done.stages[0].at));
  });

  it("emits one three_d child span per stage under the requesting span", async () => {
    const raw = await proxyToGlb("seating", BOX);
    const projectId = "proj_stages";
    let parentId = "";
    await withSpan(projectId, { kind: "three_d", name: "request_model" }, async (h) => {
      parentId = h.id;
      await awaitJob((await requestModel(productId, fakeDeps(raw))).id);
    });
    const children = spansFor(projectId).filter((s) => s.parent_id === parentId);
    expect(children.map((s) => s.name)).toEqual(["fetch_image", "generate_mesh", "normalize", "verify_bounds", "write_glb"]);
    expect(children.every((s) => s.kind === "three_d" && s.status === "ok")).toBe(true);
    expect((children[1].output as { vertices: number }).vertices).toBe(118011);
  });

  it("ends the failing step's span as error and records no later stage", async () => {
    const projectId = "proj_fail";
    const deps = fakeDeps(new Uint8Array(), { fetchGlb: async () => { throw new Error("endpoint unreachable"); } });
    await withSpan(projectId, { kind: "three_d", name: "request_model" }, async () => {
      await awaitJob((await requestModel(productId, deps)).id);
    });
    const names = spansFor(projectId).map((s) => `${s.name}:${s.status}`);
    expect(names).toEqual(["request_model:ok", "fetch_image:ok", "generate_mesh:error"]);
  });
});
