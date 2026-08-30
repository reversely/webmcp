import { NextResponse } from "next/server";
import { errorResponse, validate } from "../../../server/api";

export async function POST(request: Request) {
  try {
    return NextResponse.json(validate(await request.json()));
  } catch (e) {
    return errorResponse(e);
  }
}
