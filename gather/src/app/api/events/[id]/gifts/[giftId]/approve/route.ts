import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { approveGiftOp } from "../../../../../../../server/cart-api";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** Records the organizer's approval of the priced cart and sets the cutoff. Body: { delivery_window?: { earliest, latest } }. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await approveGiftOp(id, giftId, body));
  } catch (e) {
    return errorResponse(e);
  }
}
