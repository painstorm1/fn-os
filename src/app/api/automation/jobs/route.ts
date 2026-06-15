import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { createAutomationJob, listAutomationJobs } from "@/lib/automation-jobs";

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
    return automationApiError(error, "automation jobs 조회 실패");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const body = await request.json().catch(() => ({}));
    const inputJson = body.input_json && typeof body.input_json === "object" ? body.input_json : {};
    const slack = body.slack && typeof body.slack === "object" ? body.slack : undefined;
    const job = await createAutomationJob({
      ...body,
      status: body.status === "pending" ? "queued" : body.status || "queued",
      requested_by: body.requested_by || "slack",
      source: body.source || "slack_agent",
      trigger_type: body.trigger_type || "slack",
      input_json: slack ? { ...inputJson, slack } : inputJson,
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return automationApiError(error, "automation job 생성 실패");
  }
}
