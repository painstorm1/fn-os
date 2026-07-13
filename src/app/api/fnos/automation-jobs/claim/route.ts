import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { claimNextAutomationJob } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const body = await request.json().catch(() => ({}));
    const job = await claimNextAutomationJob(body);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return automationApiError(error, "대기 작업 가져오기 실패");
  }
}
