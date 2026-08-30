import { NextResponse } from "next/server";
import { batchView, errorResponse, updateBatch } from "../../../../server/api";

type Params = { params: Promise<{ id: string }> };
export async function GET(_: Request, { params }: Params) {
  try {
    return NextResponse.json(batchView((await params).id, null));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PATCH(request: Request, { params }: Params) {
  try {
    return NextResponse.json(updateBatch((await params).id, null, await request.json()));
  } catch (e) {
    return errorResponse(e);
  }
}
