import { NextResponse } from "next/server";
import { errorResponse, inviteView } from "../../../../server/api";

type Params = { params: Promise<{ code: string }> };

/** What the invite page shows: the event and the questions guests answer. */
export async function GET(_: Request, { params }: Params) {
  try {
    return NextResponse.json(inviteView((await params).code));
  } catch (e) {
    return errorResponse(e);
  }
}
