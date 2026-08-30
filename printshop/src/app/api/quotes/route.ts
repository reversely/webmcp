import { NextResponse } from "next/server";
import { errorResponse, quote } from "../../../server/api";

export async function POST(request: Request) {
  try {
    return NextResponse.json(quote(await request.json()));
  } catch (e) {
    return errorResponse(e);
  }
}
