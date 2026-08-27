import { NextResponse } from "next/server";
import { NotFoundError } from "../../../../domain/bom";
import { requestModel } from "../../../../server/three-d";

/** Starts 3D generation for a product, or returns the cached or in-flight job. Body: { productId }. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { productId?: string };
  if (!body.productId) return NextResponse.json({ error: "productId is required" }, { status: 400 });
  try {
    const job = await requestModel(body.productId);
    return NextResponse.json(job, { status: job.status === "queued" ? 202 : 200 });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
