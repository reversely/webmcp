import { NextResponse } from "next/server";
import { advance } from "../../../../../domain/clock";
import { errorResponse, requireBatch } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };
/** Moves the batch to the stages due at `at` (ISO, default now); a recording sets `at` ahead to show the stages. */
export async function POST(request: Request, { params }: Params) {
  try {
    const body = (await request.json().catch(() => ({}))) as { at?: string };
    const email = new URL(request.url).searchParams.get("email");
    return NextResponse.json(advance(requireBatch((await params).id, email), body.at ? new Date(body.at) : new Date()));
  } catch (e) {
    return errorResponse(e);
  }
}
