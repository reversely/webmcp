import { NextResponse } from "next/server";
import { errorResponse, importGuests } from "../../../../../../server/api";

type Params = { params: Promise<{ id: string }> };

/** The guest list: { text } with one guest per line, or { lines }. */
export async function POST(request: Request, { params }: Params) {
  try {
    return NextResponse.json(importGuests((await params).id, await request.json()), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
