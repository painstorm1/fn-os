import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { listAutomationJobs } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const jobs = await listAutomationJobs({
      jobType: request.nextUrl.searchParams.get("job_type") || undefined,
      status: request.nextUrl.searchParams.get("status") || undefined,
      assignedAgent: request.nextUrl.searchParams.get("agent") || request.nextUrl.searchParams.get("assigned_agent") || undefined,
      limit: Number(request.nextUrl.searchParams.get("limit") || 500),
    });
    return NextResponse.json({ ok: true, jobs, total: jobs.length });
  } catch (error) {
    return automationApiError(error, "automation jobs lookup failed");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    await request.json().catch(() => ({}));
    return NextResponse.json({
      ok: false,
      error: "automation_jobs intake is disabled. Use /api/automation/runs/start for real automation execution logs.",
    }, { status: 410 });
  } catch (error) {
    return automationApiError(error, "automation jobs intake disabled");
  }
}
