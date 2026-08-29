import { NextResponse } from "next/server";
import { appState } from "../../../../../server/state";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_: Request, { params }: Params) {
  const { jobId } = await params;
  const job = appState().jobs.get(jobId);
  if (!job) return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });
  return NextResponse.json(job);
}
