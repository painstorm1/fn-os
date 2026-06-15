import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, automationApiError } from "@/lib/automation-agent-api";
import { upsertAutomationAgentHeartbeat } from "@/lib/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertAutomationAgentAuth(request);
    const body = await request.json().catch(() => ({}));
    const heartbeat = await upsertAutomationAgentHeartbeat(body);
    return NextResponse.json({ ok: true, heartbeat });
  } catch (error) {
    return automationApiError(error, "heartbeat 저장 실패");
  }
}
