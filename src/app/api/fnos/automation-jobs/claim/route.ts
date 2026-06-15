import { NextRequest, NextResponse } from "next/server";
import { claimNextAutomationJob } from "@/lib/automation-jobs";
import { FnosDbError } from "@/lib/fnos-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const job = await claimNextAutomationJob(body);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "대기 작업 가져오기 실패" }, { status });
  }
}
