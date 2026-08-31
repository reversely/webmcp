import { NextResponse } from "next/server";
import { batchView, errorResponse, updateBatch } from "../../../../server/api";

type Params = { params: Promise<{ id: string }> };
/** The buyer scope the local batch page carries, the same email the MCP path reads (issues #128, #129). */
const scope = (request: Request) => new URL(request.url).searchParams.get("email");
export async function GET(request: Request, { params }: Params) {
  try {
    return NextResponse.json(batchView((await params).id, scope(request)));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PATCH(request: Request, { params }: Params) {
  try {
    return NextResponse.json(updateBatch((await params).id, scope(request), await request.json()));
  } catch (e) {
    return errorResponse(e);
  }
}
