import { NextResponse } from "next/server";
import { errorResponse, orderBatch } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };
export async function POST(_: Request, { params }: Params) {
  try {
    return NextResponse.json(orderBatch((await params).id, null));
  } catch (e) {
    return errorResponse(e);
  }
}
