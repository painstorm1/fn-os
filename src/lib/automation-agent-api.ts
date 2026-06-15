import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "./fnos-db";

export function assertAutomationAgentAuth(request: NextRequest) {
  const token = process.env.AUTOMATION_AGENT_TOKEN || "";
  if (!token) return;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const headerToken = request.headers.get("x-automation-agent-token") || "";
  if (bearer !== token && headerToken !== token) throw new FnosDbError("자동화 agent 인증 실패", 401);
}

export function automationApiError(error: unknown, fallback: string) {
  const status = error instanceof FnosDbError ? error.status : 500;
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status });
}
