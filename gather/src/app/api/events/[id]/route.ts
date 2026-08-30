import { NextResponse } from "next/server";
import { errorResponse, snapshot, updateEventFromBody } from "../../../../server/api";

type Params = { params: Promise<{ id: string }> };

/** The snapshot the dashboard polls: event, definitions, guests with values, counts, follow-ups, seq. */
export async function GET(_: Request, { params }: Params) {
  try {
    return NextResponse.json(snapshot((await params).id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    return NextResponse.json(updateEventFromBody((await params).id, await request.json()));
  } catch (e) {
    return errorResponse(e);
  }
}
