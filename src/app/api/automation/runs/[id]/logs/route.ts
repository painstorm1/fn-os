import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { getAutomationRun, listAutomationRunLogs } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    assertAutomationAgentAuth(request);
    const { id } = await context.params;
    const run = await getAutomationRun(id);
    const logs = await listAutomationRunLogs(id, Number(request.nextUrl.searchParams.get("limit") || 500));
    return NextResponse.json({ ok: true, run, logs, total: logs.length });
  } catch (error) {
    return automationApiError(error, "automation run logs lookup failed");
  }
}
