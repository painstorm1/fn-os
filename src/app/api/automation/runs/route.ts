import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { createAutomationRun, listAutomationRuns } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const runs = await listAutomationRuns({
      jobType: request.nextUrl.searchParams.get("task_type") || request.nextUrl.searchParams.get("job_type") || undefined,
      status: request.nextUrl.searchParams.get("status") || undefined,
      assignedAgent: request.nextUrl.searchParams.get("agent") || undefined,
      limit: Number(request.nextUrl.searchParams.get("limit") || 500),
    });
    return NextResponse.json({ ok: true, runs, total: runs.length });
  } catch (error) {
    return automationApiError(error, "automation runs lookup failed");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const body = await request.json().catch(() => ({}));
    const run = await createAutomationRun(body);
    return NextResponse.json({ ok: true, run, job: run });
  } catch (error) {
    return automationApiError(error, "automation run create failed");
  }
}
