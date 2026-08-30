import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { lockGiftOp } from "../../../../../../../server/cart-api";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** Creates the checkout from the cart now and locks the gift. */
export async function POST(_: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return NextResponse.json(await lockGiftOp(id, giftId));
  } catch (e) {
    return errorResponse(e);
  }
}
