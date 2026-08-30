import { NextResponse } from "next/server";
import { approveProof, errorResponse } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };
export async function POST(_: Request, { params }: Params) {
  try {
    return NextResponse.json(approveProof((await params).id, null));
  } catch (e) {
    return errorResponse(e);
  }
}
