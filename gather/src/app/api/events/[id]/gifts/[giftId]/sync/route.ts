import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { syncGiftOp } from "../../../../../../../server/cart-api";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** Recomputes the quantities and rewrites the cart when they differ from its lines. */
export async function POST(_: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return NextResponse.json(await syncGiftOp(id, giftId));
  } catch (e) {
    return errorResponse(e);
  }
}
