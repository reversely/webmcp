import { NextResponse } from "next/server";
import { errorResponse, replaceDefinitions } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };

/** Replaces the event's question list with the organizer's: rows keyed by `key`, options in the organizer's words. */
export async function PUT(request: Request, { params }: Params) {
  try {
    return NextResponse.json({ definitions: replaceDefinitions((await params).id, await request.json()) });
  } catch (e) {
    return errorResponse(e);
  }
}
