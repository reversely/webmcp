import { NextResponse } from "next/server";
import { createBatch, errorResponse } from "../../../server/api";

export async function POST(request: Request) {
  try {
    return NextResponse.json(createBatch(await request.json()), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
