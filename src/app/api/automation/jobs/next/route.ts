import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { claimNextAutomationJobForAgent } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const agent = request.nextUrl.searchParams.get("agent") || "";
    const job = await claimNextAutomationJobForAgent(agent);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return automationApiError(error, "queued 작업 조회 실패");
  }
}
