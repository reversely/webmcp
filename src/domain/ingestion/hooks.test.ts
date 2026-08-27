import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appState } from "../../server/state";
import type { ThreeDDeps } from "../../server/three-d";
import type { Product } from "../types";
import { startModelGeneration } from "./hooks";

let modelsDir: string;
let product: Product;

beforeEach(async () => {
  modelsDir = await mkdtemp(path.join(tmpdir(), "hooks-"));
  const s = appState();
  product = {
    id: s.store.newId("prod"),
    merchant: "example",
    source_url: "https://example.com/ottoman",
    external_product_id: "ottoman-1",
    title: "Ottoman",
    description: "",
    primary_image_url: "https://cdn.example.com/ottoman.webp",
    price_cents: 20000,
    currency: "USD",
    width_mm: 600,
    depth_mm: 600,
    height_mm: 420,
    dimension_source: null,
    spatial_status: "grounded",
    variant_json: null,
    availability_json: null,
    glb_url: null,
    model_status: "no_model"
  };
  s.store.products.set(product.id, product);
});

afterEach(async () => {
  await rm(modelsDir, { recursive: true, force: true });
  appState().jobs.clear();
});

const jobFor = (productId: string) => [...appState().jobs.values()].find((j) => j.product_id === productId);
const image = async () => ({ bytes: 1024, content_type: "image/webp" });

describe("startModelGeneration", () => {
  it("resolves with the job at once without waiting for the outcome", async () => {
    const deps: ThreeDDeps = { modelsDir, fetchImage: image, fetchGlb: () => new Promise(() => {}) };
    const returned = await startModelGeneration(product, deps);
    const job = jobFor(product.id);
    expect(returned?.id).toBe(job?.id);
    expect(returned?.status).toBe("queued");
    // The detached run may already have moved the row on before this reads it.
    expect(["queued", "generating"]).toContain(job?.status);
    expect(["queued", "generating"]).toContain(appState().store.getProduct(product.id).model_status);
  });

  it("does not throw when generation fails; the product lands at proxy", async () => {
    const deps: ThreeDDeps = { modelsDir, fetchImage: image, fetchGlb: async () => { throw new Error("endpoint down"); } };
    expect(() => startModelGeneration(product, deps)).not.toThrow();
    await vi.waitFor(() => expect(jobFor(product.id)?.status).toBe("proxy"));
    expect(jobFor(product.id)?.error).toBe("endpoint down");
    expect(appState().store.getProduct(product.id).model_status).toBe("proxy");
  });

  it("does not throw for a product that is not in the store", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => startModelGeneration({ ...product, id: "prod_missing" }, { modelsDir, fetchImage: image, fetchGlb: async () => ({ glb: new Uint8Array() }) })).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
