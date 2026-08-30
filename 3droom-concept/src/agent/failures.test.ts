/**
 * PRD 17 failure rows that run in Node (#33): each test injects the fault through a seam (a mocked
 * model client, a fake fetch, injected 3D deps) and checks the degraded behaviour plus the issue
 * the trace drawer shows. The two browser rows (server restart, WebMCP unavailable) live in
 * tests/failures.spec.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as compilePost } from "../app/api/projects/[id]/compile/route";
import { POST as messagesPost } from "../app/api/projects/[id]/messages/route";
import { POST as roomEstimatePost } from "../app/api/projects/[id]/room-estimate/route";
import { CatalogError, catalogClient } from "@webmcp/shopify-ucp";
import { startModelGeneration } from "../domain/ingestion/hooks";
import { appState, snapshot } from "../server/state";
import type { ThreeDDeps } from "../server/three-d";
import { issuesFor, resetTrace, spansFor, withProject } from "../server/trace";
import { RATE_LIMIT_WAITS_MS, searchProducts, upsertCandidate } from "./catalog";
import { compileSpec, estimateRoom } from "./compile";
import { evaluateDelivery } from "./delivery";
import { inferKind } from "./kinds";
import { handleMessage } from "./messages";
import { sourceRoom } from "./sourcing";
import { fakeCatalogProduct, fakeDeps, fakeSearch, resetState, seedProject } from "./test-helpers";
import { evaluateVisualFit } from "./visual";

const { createResponse, runPlanningAgent } = vi.hoisted(() => ({ createResponse: vi.fn(), runPlanningAgent: vi.fn() }));

// The OpenAI SDK is what structuredCall calls; the class stands in for it so no network is touched.
vi.mock("openai", () => ({
  default: class {
    responses = { create: createResponse };
  }
}));
vi.mock("./planning-agent", () => ({ runPlanningAgent }));

const TIMEOUT = Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
const SERVER_ERROR = Object.assign(new Error("500 Internal Server Error"), { status: 500 });

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env.OPENAI_API_KEY;
  // A placeholder so the code takes the model path; the mocked client never uses it.
  process.env.OPENAI_API_KEY = "test-key"; // pragma: allowlist secret
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
});

beforeEach(() => {
  resetState();
  resetTrace();
  createResponse.mockReset();
  runPlanningAgent.mockReset();
});

describe("PRD 17: model call fails or times out", () => {
  it("board compilation answers 200 with a null spec and an issue, so the browser compiles by rule", async () => {
    createResponse.mockRejectedValue(TIMEOUT);
    const projectId = seedProject();
    const res = await compilePost(jsonRequest({ boardText: ["12 x 18", "budget 2500"], swatches: ["#7a5c3e"] }), params(projectId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ spec: null });
    const issue = issuesFor(projectId).find((i) => i.source === "model project_spec");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toBe("The project_spec model call failed (Request timed out.); the caller uses its fallback, so this result is missing until the call is retried.");
    expect(spansFor(projectId).find((s) => s.kind === "model")?.output).toEqual({ failed: "Request timed out." });
  });

  it("the room estimate answers 200 with null on a 5xx, so the browser keeps the regex estimate", async () => {
    createResponse.mockRejectedValue(SERVER_ERROR);
    const projectId = seedProject();
    const res = await roomEstimatePost(jsonRequest({ text: "12 by 18 feet" }), params(projectId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ estimate: null });
    expect(issuesFor(projectId).map((i) => i.message)).toContain("The room_estimate model call failed (500 Internal Server Error); the caller uses its fallback, so this result is missing until the call is retried.");
  });

  it("an off-schema answer is null with an issue naming the schema mismatch", async () => {
    createResponse.mockResolvedValue({ id: "resp_1", output_text: JSON.stringify({ room: "big" }), usage: { input_tokens: 1, output_tokens: 1 } });
    const projectId = seedProject();
    const spec = await withProject(projectId, () => compileSpec(["12 x 18"], []));
    expect(spec).toBeNull();
    expect(await withProject(projectId, () => estimateRoom("12 by 18"))).toBeNull();
    expect(issuesFor(projectId)[0]?.message).toMatch(/^The project_spec model answer did not match its schema \(.+\); the caller uses its fallback for this call\.$/);
  });

  it("kind inference falls back to `other` with the phrase itself as the search query", async () => {
    createResponse.mockRejectedValue(TIMEOUT);
    const projectId = seedProject();
    const guess = await withProject(projectId, () => inferKind("reading nook chair"));
    expect(guess).toEqual({ kind: "other", query: "reading nook chair" });
    expect(createResponse).toHaveBeenCalledTimes(1);
    expect(issuesFor(projectId).map((i) => i.source)).toContain("model item_kind");
  });

  it("visual evaluation ranks the candidate without a score after two attempts and says so", async () => {
    createResponse.mockRejectedValue(SERVER_ERROR);
    const projectId = seedProject();
    const { candidate } = upsertCandidate(projectId, fakeCatalogProduct("deep couch", 1, 89900), "deep couch", "seating");
    const result = await evaluateVisualFit(projectId, candidate.id);
    expect(result).toBeNull();
    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(appState().store.candidates.get(candidate.id)?.visual_evaluation_json).toBeNull();
    const messages = issuesFor(projectId).map((i) => i.message);
    expect(messages.filter((m) => m.startsWith("The visual_evaluation model call failed"))).toHaveLength(2);
    expect(messages).toContain('Visual evaluation for "deep couch 1" returned no verdict after 2 attempts; the candidate ranks without a visual score.');
  });

  it("a PlanningAgent turn that throws answers the messages route with 200, a reply that says so, and an issue", async () => {
    runPlanningAgent.mockRejectedValue(TIMEOUT);
    const projectId = seedProject();
    const res = await messagesPost(jsonRequest({ author: "zach", text: "Find a set" }), params(projectId));
    expect(res.status).toBe(200);
    const messages = (await res.json()) as { role: string; text: string }[];
    expect(messages.map((m) => m.role)).toEqual(["user", "agent"]);
    expect(messages[1].text).toBe("The planning step failed (Request timed out.). Send the message again to retry; the plan and the search panel keep working meanwhile.");
    expect(issuesFor(projectId).map((i) => i.message)).toContain('The PlanningAgent turn for "Find a set" failed (Request timed out.); nothing was recorded for it, so send the message again to retry.');
    expect(appState().activeRuns.has(projectId)).toBe(false);
  });

  it("without OPENAI_API_KEY the chat says the agent cannot run and points to the search panel", async () => {
    delete process.env.OPENAI_API_KEY;
    try {
      const projectId = seedProject();
      const messages = await handleMessage(projectId, "zach", "Find a set");
      expect(messages[1].text).toBe("No OPENAI_API_KEY is set, so the PlanningAgent cannot run. Use the search panel to source products directly.");
      expect(runPlanningAgent).not.toHaveBeenCalled();
    } finally {
      process.env.OPENAI_API_KEY = "test-key"; // pragma: allowlist secret
    }
  });
});

/** A catalog fetch that answers with the given HTTP statuses in order, then 200 with an empty page. */
function statusFetch(statuses: number[]) {
  const calls: number[] = [];
  const fetchImpl: typeof fetch = async () => {
    const status = statuses[calls.length] ?? 200;
    calls.push(status);
    const body = status === 200 ? { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ products: [] }) }] } } : { error: "nope" };
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, calls };
}

describe("PRD 17: Shopify search failure", () => {
  afterEach(() => vi.useRealTimers());

  it("retries a 429 after 2 s and again after 6 s, then succeeds", async () => {
    vi.useFakeTimers();
    const { fetchImpl, calls } = statusFetch([429, 429]);
    const pending = searchProducts(catalogClient({ fetchImpl }), "three seat sofa", { country: "US" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toEqual([429]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([429, 429]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await pending).toEqual([]);
    expect(calls).toEqual([429, 429, 200]);
  });

  it("propagates a 429 that outlasts every retry wait as a CatalogError naming the tool and host", async () => {
    vi.useFakeTimers();
    const { fetchImpl, calls } = statusFetch(Array(RATE_LIMIT_WAITS_MS.length + 1).fill(429));
    const pending = searchProducts(catalogClient({ fetchImpl }), "three seat sofa", { country: "US" });
    const settled = pending.then(() => null, (e: unknown) => e);
    for (const wait of RATE_LIMIT_WAITS_MS) await vi.advanceTimersByTimeAsync(wait);
    const error = (await settled) as CatalogError;
    expect(error).toBeInstanceOf(CatalogError);
    expect(error.code).toBe(429);
    expect(error.message).toBe("search_catalog: HTTP 429 from https://catalog.shopify.com/api/ucp/mcp");
    expect(calls).toEqual(Array(RATE_LIMIT_WAITS_MS.length + 1).fill(429));
  });

  it("a 5xx from the catalog ends that item as `no match` with an issue, and the run completes with the rest", async () => {
    const projectId = seedProject({ address: true });
    const { fetchImpl } = statusFetch([503, 503, 503]);
    const client = catalogClient({ fetchImpl });
    const deps = fakeDeps({ search: async (item) => (item.name === "big rug" ? searchProducts(client, item.query, { country: "US" }) : fakeSearch(item.name)) });
    const outcome = await sourceRoom(projectId, "Find a set", deps);
    expect(outcome).toMatchObject({ status: "no_match", categories: ["big rug"] });
    if (outcome.status !== "no_match") throw new Error("unreachable");
    const s = appState();
    expect(s.runs.get(outcome.artifact_id.replace("sourcing_", ""))?.status).toBe("complete");
    expect(s.activeRuns.has(projectId)).toBe(false);
    const issue = issuesFor(projectId).find((i) => i.source === "step search");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toBe('The catalog search for "big rug" failed (search_catalog: HTTP 503 from https://catalog.shopify.com/api/ucp/mcp); the item ends with no match in this run, so search for it in the search panel or ask again later.');
    expect(issuesFor(projectId).filter((i) => i.source === "step search")).toHaveLength(1);
    const artifact = snapshot(projectId).messages.flatMap((m) => (m.artifact?.kind === "sourcing" ? [m.artifact.data as { categories: Record<string, { status: string; found: number }> }] : []))[0];
    expect(artifact.categories["big rug"]).toMatchObject({ status: "no match", found: 0 });
    // The other items were searched; the failure did not stop them.
    expect(artifact.categories["deep couch"].found).toBe(3);
    expect(spansFor(projectId).find((sp) => sp.name === "search big rug")?.status).toBe("error");
  });
});

describe("PRD 17: product without dimensions", () => {
  it("stays visual_only, is excluded from the geometry check and the selection, and is counted in an issue", async () => {
    const projectId = seedProject({ address: true });
    const noDims = fakeCatalogProduct("deep couch", 9, 79900, { metadata: {}, title: "deep couch 9 (no size listed)" });
    const deps = fakeDeps({ search: async (item) => (item.name === "deep couch" ? [noDims, ...fakeSearch(item.name)] : fakeSearch(item.name)) });
    const outcome = await sourceRoom(projectId, "Find a set", deps);
    expect(outcome.status).toBe("complete");
    const s = appState();
    const product = [...s.store.products.values()].find((p) => p.title === "deep couch 9 (no size listed)")!;
    expect(product.spatial_status).toBe("visual_only");
    expect([product.width_mm, product.depth_mm, product.height_mm]).toEqual([null, null, null]);
    const candidate = [...s.store.candidates.values()].find((c) => c.product_id === product.id)!;
    expect(candidate.ranking_state).toBe("eliminated");
    expect(candidate.hard_constraint_results_json).toEqual({ passed: false, reason: "geometry_failure" });
    expect(snapshot(projectId).bom.some((b) => b.product_id === product.id)).toBe(false);
    expect(issuesFor(projectId).map((i) => i.message)).toContain('1 of 4 available deep couch products have no parsable dimensions ("deep couch 9 (no size listed)"); they are excluded from the geometry check and cannot be selected.');
  });
});

describe("PRD 17: 3D generation failure", () => {
  let modelsDir: string;
  const noWrite = (overrides: Partial<ThreeDDeps>): ThreeDDeps => ({
    modelsDir,
    fetchImage: async () => ({ bytes: 1024, content_type: "image/jpeg" }),
    fetchGlb: async () => ({ glb: new Uint8Array() }),
    ...overrides
  });

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    modelsDir = await mkdtemp(`${tmpdir()}/failures-3d-`);
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(modelsDir, { recursive: true, force: true });
  });

  it("a dead image URL ends the job as proxy with the error as its last stage, and the room keeps the box", async () => {
    const projectId = seedProject();
    const { product } = upsertCandidate(projectId, fakeCatalogProduct("deep couch", 1, 89900), "deep couch", "seating");
    const job = await withProject(projectId, () => startModelGeneration(product, noWrite({ fetchImage: async () => { throw new Error("image fetch returned 404"); } })));
    expect(job?.status).toBe("queued");
    const { awaitJob } = await import("../server/three-d");
    const done = await awaitJob(job!.id);
    expect(done.status).toBe("proxy");
    expect(done.stages.at(-1)).toMatchObject({ name: "proxy", detail: "image fetch returned 404" });
    expect(appState().store.getProduct(product.id)).toMatchObject({ model_status: "proxy", glb_url: null });
    // The issue is written after the detached run settles; give the span's continuation a tick.
    await vi.waitFor(() => expect(issuesFor(projectId).map((i) => i.message)).toContain('3D generation for "deep couch 1" fell back to a proxy box (image fetch returned 404); the room shows its dimensions without the modelled shape.'));
  });

  it("an endpoint 5xx ends the job as proxy after the image stage, with the endpoint error recorded", async () => {
    const projectId = seedProject();
    const { product } = upsertCandidate(projectId, fakeCatalogProduct("big rug", 1, 39900), "big rug", "soft_floor");
    const job = await withProject(projectId, () => startModelGeneration(product, noWrite({ fetchGlb: async () => { throw new Error("Modal endpoint returned 503: cold start timed out"); } })));
    const { awaitJob } = await import("../server/three-d");
    const done = await awaitJob(job!.id);
    expect(done.status).toBe("proxy");
    expect(done.stages.map((s) => s.name)).toEqual(["queued", "image_fetched", "proxy"]);
    expect(done.error).toBe("Modal endpoint returned 503: cold start timed out");
    await vi.waitFor(() => expect(issuesFor(projectId).some((i) => i.source === "three_d request_model" && i.message.includes("Modal endpoint returned 503"))).toBe(true));
  });
});

describe("PRD 17: delivery evidence unavailable", () => {
  it("a checkout probe that times out leaves the status unknown, keeps the candidate, and records the timeout", async () => {
    const projectId = seedProject({ address: true });
    // No shipping text anywhere, so nothing after the checkout can supply a date.
    const raw = fakeCatalogProduct("leather ottoman", 1, 24900, { description: { plain: "Full-grain leather over a hardwood frame." } });
    const { candidate, product } = upsertCandidate(projectId, raw, "leather ottoman", "decor");
    const timedOut: typeof fetch = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    const result = await evaluateDelivery(projectId, candidate.id, { fetchImpl: timedOut, today: "2026-08-27" });
    expect(result.status).toBe("unknown");
    expect(result.checkout_error).toBe("The operation was aborted due to timeout");
    expect(result.placeholders_used).toEqual(["buyer_email", "buyer_name", "phone", "street"]);
    const stored = appState().store.candidates.get(candidate.id)!;
    expect(stored.delivery_status).toBe("unknown");
    expect(stored.ranking_state).toBe("pending");
    expect(issuesFor(projectId).map((i) => i.message)).toContain(`The checkout probe for "${product.title}" at ${product.merchant} timed out after 15 s; delivery evidence for it comes from the shipping policy and description instead, so its status may stay unknown.`);
    expect(spansFor(projectId).find((s) => s.name === "create_checkout")?.status).toBe("error");
  });

  it("a checkout probe that errors falls through to the description when it names a window", async () => {
    const projectId = seedProject({ address: true });
    const { candidate } = upsertCandidate(projectId, fakeCatalogProduct("big rug", 2, 39900), "big rug", "soft_floor");
    const failing: typeof fetch = async () => new Response("bad gateway", { status: 502 });
    const result = await evaluateDelivery(projectId, candidate.id, { fetchImpl: failing, today: "2026-08-27" });
    expect(result.status).toBe("likely");
    expect(result.evidence.source).toBe("description");
    expect(result.checkout_error).toBe("HTTP 502");
    expect(issuesFor(projectId).some((i) => i.message.includes("failed (HTTP 502)"))).toBe(true);
  });
});
