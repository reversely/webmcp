import { NextResponse } from "next/server";
import { NotFoundError } from "../../../../domain/bom";
import { startModelGeneration } from "../../../../domain/ingestion/hooks";
import { appState } from "../../../../server/state";
import { withProject } from "../../../../server/trace";

/**
 * Starts 3D generation for a product, or returns the cached or in-flight job. Body: { productId,
 * projectId? }. A product whose job landed as proxy gets a fresh job (the "Generate 3D" retry,
 * #49); `projectId` files the job's spans under that project's trace.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { productId?: string; projectId?: string };
  if (!body.productId) return NextResponse.json({ error: "productId is required" }, { status: 400 });
  try {
    const product = appState().store.getProduct(body.productId);
    const start = () => startModelGeneration(product);
    const job = await (body.projectId ? withProject(body.projectId, start) : start());
    if (!job) return NextResponse.json({ error: "the generation request failed before a job was created" }, { status: 500 });
    return NextResponse.json(job, { status: job.status === "queued" ? 202 : 200 });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
