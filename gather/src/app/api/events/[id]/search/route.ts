import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../server/api";
import { giftSearch, type GiftSearchBody } from "../../../../../server/search";

type Params = { params: Promise<{ id: string }> };

/** Body: { card?: string, sentence?: string, probe?: number }; the search itself lives in server/search.ts so the curation agent runs the same code path (#120). */
export async function POST(request: Request, { params }: Params) {
  try {
    return NextResponse.json(await giftSearch((await params).id, (await request.json()) as GiftSearchBody));
  } catch (e) {
    return errorResponse(e);
  }
}
