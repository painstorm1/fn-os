import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { reportAutomationJobFail } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const body = await request.json().catch(() => ({}));
    const job = await reportAutomationJobFail(body);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return automationApiError(error, "작업 실패 보고 실패");
  }
}
