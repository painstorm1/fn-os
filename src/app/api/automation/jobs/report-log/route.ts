import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { appendAutomationJobLog } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const body = await request.json().catch(() => ({}));
    const job = await appendAutomationJobLog(body);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return automationApiError(error, "작업 로그 보고 실패");
  }
}
