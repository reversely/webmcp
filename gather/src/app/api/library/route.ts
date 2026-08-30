import { NextResponse } from "next/server";
import { library } from "../../../domain/store";

/** The question library and event defaults the draft page offers (library.json). */
export async function GET() {
  return NextResponse.json(library());
}
