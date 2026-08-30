import { NextResponse } from "next/server";
import { errorResponse, submitRsvp } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    return NextResponse.json(submitRsvp((await params).id, await request.json()), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
