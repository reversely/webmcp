import { NextResponse } from "next/server";
import { createEventFromBody, errorResponse } from "../../../server/api";

/** Creates a draft event with the seeded questions (PRD Section 8, Draft). */
export async function POST(request: Request) {
  try {
    return NextResponse.json(createEventFromBody(await request.json()), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
