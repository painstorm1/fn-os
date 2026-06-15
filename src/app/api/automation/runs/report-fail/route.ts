import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { reportAutomationRunFail } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const body = await request.json().catch(() => ({}));
    const run = await reportAutomationRunFail(body);
    return NextResponse.json({ ok: true, run, job: run });
  } catch (error) {
    return automationApiError(error, "automation run fail report failed");
  }
}
