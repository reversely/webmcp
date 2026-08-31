import { NextResponse } from "next/server";
import { errorResponse, postMessage } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  try {
    const email = new URL(request.url).searchParams.get("email");
    return NextResponse.json(postMessage((await params).id, email, await request.json()));
  } catch (e) {
    return errorResponse(e);
  }
}
