import { NextResponse } from "next/server";
import { errorResponse, setOverride } from "../../../../../../../../server/api";

type Params = { params: Promise<{ id: string; giftId: string; guestId: string }> };

/** Replaces the organizer's override for one guest; an empty body clears it. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id, giftId, guestId } = await params;
    const text = await request.text();
    return NextResponse.json(setOverride(id, giftId, guestId, text ? JSON.parse(text) : {}));
  } catch (e) {
    return errorResponse(e);
  }
}
