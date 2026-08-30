import { NextResponse } from "next/server";
import { errorResponse, requireDesign } from "../../../../server/api";

type Params = { params: Promise<{ id: string }> };
export async function GET(_: Request, { params }: Params) {
  try {
    return NextResponse.json(requireDesign((await params).id));
  } catch (e) {
    return errorResponse(e);
  }
}
