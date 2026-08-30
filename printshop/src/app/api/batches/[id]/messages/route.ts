import { NextResponse } from "next/server";
import { errorResponse, postMessage } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  try {
    return NextResponse.json(postMessage((await params).id, null, await request.json()));
  } catch (e) {
    return errorResponse(e);
  }
}
