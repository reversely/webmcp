import { NextResponse } from "next/server";
import { approveProof, errorResponse } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  try {
    const email = new URL(request.url).searchParams.get("email");
    return NextResponse.json(approveProof((await params).id, email));
  } catch (e) {
    return errorResponse(e);
  }
}
