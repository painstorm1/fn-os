import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { reportAutomationJobSuccess } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const body = await request.json().catch(() => ({}));
    const job = await reportAutomationJobSuccess(body);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return automationApiError(error, "작업 성공 보고 실패");
  }
}
