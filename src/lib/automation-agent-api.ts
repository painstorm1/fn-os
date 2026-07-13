import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "./fnos-db";

const FNOS_SESSION_COOKIE = "fnos_session";

function safeTokenEqual(actual: string, expected: string) {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function automationTokenFromRequest(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return [bearer, request.headers.get("x-automation-agent-token") || ""].filter(Boolean);
}

export function assertAutomationAgentAuth(request: NextRequest) {
  const token = process.env.AUTOMATION_AGENT_TOKEN || "";
  if (!token) throw new FnosDbError("자동화 agent 인증이 설정되지 않았습니다.", 503);
  if (!automationTokenFromRequest(request).some((candidate) => safeTokenEqual(candidate, token))) {
    throw new FnosDbError("자동화 agent 인증 실패", 401);
  }
}

export function assertAutomationJobAuth(request: NextRequest) {
  const sessionToken = process.env.FN_OS_AUTH_TOKEN || process.env.FN_OS_PASSWORD || "fnos-local-dev";
  const session = request.cookies.get(FNOS_SESSION_COOKIE)?.value || "";
  if (session && safeTokenEqual(session, sessionToken)) return;
  assertAutomationAgentAuth(request);
}

export function automationApiError(error: unknown, fallback: string) {
  const status = error instanceof FnosDbError ? error.status : 500;
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status });
}
