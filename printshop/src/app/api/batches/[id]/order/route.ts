import { NextResponse } from "next/server";
import { errorResponse, orderBatch } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  try {
    const email = new URL(request.url).searchParams.get("email");
    return NextResponse.json(orderBatch((await params).id, email));
  } catch (e) {
    return errorResponse(e);
  }
}
