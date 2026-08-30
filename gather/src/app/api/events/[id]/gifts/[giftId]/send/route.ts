import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { sendGiftOp } from "../../../../../../../server/cart-api";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** Creates the cart at the shop and returns the gift with the priced proposal. Body: { buyer?: { email, phone_number } }. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await sendGiftOp(id, giftId, body));
  } catch (e) {
    return errorResponse(e);
  }
}
