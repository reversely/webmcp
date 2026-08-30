import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { cartView } from "../../../../../../../server/cart-api";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The dashboard's poll: the cart read back from the shop, the checkout once the cutoff arrives, the order's status once one exists. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return NextResponse.json(await cartView(id, giftId));
  } catch (e) {
    return errorResponse(e);
  }
}
