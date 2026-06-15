import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { reportAutomationRunFail, reportAutomationRunSuccess } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    assertAutomationAgentAuth(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const status = String(body.status || "").trim();
    const run = status === "failed"
      ? await reportAutomationRunFail({ ...body, run_id: id })
      : await reportAutomationRunSuccess({ ...body, run_id: id });
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return automationApiError(error, "automation run complete failed");
  }
}
