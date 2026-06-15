import { NextRequest, NextResponse } from "next/server";
import { createAutomationJob, listAutomationJobs } from "@/lib/automation-jobs";
import { FnosDbError } from "@/lib/fnos-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const jobs = await listAutomationJobs({
      jobType: request.nextUrl.searchParams.get("job_type") || undefined,
      status: request.nextUrl.searchParams.get("status") || undefined,
      limit: Number(request.nextUrl.searchParams.get("limit") || 500),
    });
    return NextResponse.json({ ok: true, jobs, total: jobs.length });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "자동화 작업 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const job = await createAutomationJob(body);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "자동화 작업 생성 실패" }, { status });
  }
}
