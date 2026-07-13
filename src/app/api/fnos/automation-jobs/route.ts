import { NextRequest, NextResponse } from "next/server";
import { assertAutomationJobAuth, automationApiError } from "@/lib/automation-agent-api";
import { createAutomationRun, listAutomationRunsAsJobs } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertAutomationJobAuth(request);
    const jobs = await listAutomationRunsAsJobs({
      jobType: request.nextUrl.searchParams.get("job_type") || undefined,
      status: request.nextUrl.searchParams.get("status") || undefined,
      limit: Number(request.nextUrl.searchParams.get("limit") || 500),
    });
    return NextResponse.json({ ok: true, jobs, total: jobs.length });
  } catch (error) {
    return automationApiError(error, "자동화 작업 조회 실패");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAutomationJobAuth(request);
    const body = await request.json().catch(() => ({}));
    const run = await createAutomationRun({
      ...body,
      source: body.source || "manual_auto",
      agent: body.agent || body.assigned_agent || "fnos-manual",
      task_type: body.task_type || body.job_type,
      status: body.status || "running",
    });
    const jobs = await listAutomationRunsAsJobs({ id: run.id, limit: 1 });
    const job = jobs[0];
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return automationApiError(error, "자동화 작업 생성 실패");
  }
}
