import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { appendAutomationRunLog } from "@/lib/automation-jobs";

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
    const run = await appendAutomationRunLog({ ...body, run_id: id });
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return automationApiError(error, "automation run log failed");
  }
}
