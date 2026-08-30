import { NextResponse } from "next/server";
import { createGiftFromBody, errorResponse, requireEvent } from "../../../../../server/api";
import { giftsFor, quantities } from "../../../../../domain/gifts";

type Params = { params: Promise<{ id: string }> };

/** Every gift on the event with its derived quantities. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    requireEvent(id);
    return NextResponse.json({ gifts: giftsFor(id).map((g) => ({ ...g, quantities: quantities(g) })) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Stores a gift plan (set_gift_plan) and returns it with the quantities per variant. */
export async function POST(request: Request, { params }: Params) {
  try {
    return NextResponse.json(createGiftFromBody((await params).id, await request.json()), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
