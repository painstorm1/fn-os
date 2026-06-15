import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAutomationJob } from "@/lib/automation-jobs";
import type { AutomationJob } from "@/lib/automation-jobs-shared";
import { FnosDbError } from "@/lib/fnos-db";
import { buildSlackAutomationJobDraft, parseSlackCommandPayload } from "@/lib/slack-commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_VERSION = "v0";
const MAX_CLOCK_SKEW_SECONDS = 60 * 5;

function slackJson(text: string, status = 200) {
  return NextResponse.json({ response_type: "ephemeral", text }, { status });
}

function slackJobRegistered(job: AutomationJob) {
  return slackJson([
    "작업 등록 완료.",
    `작업 ID: ${job.id}`,
    `작업: ${job.job_type}`,
    `담당: ${job.assigned_agent || "-"}`,
    `상태: ${job.status}`,
  ].join("\n"));
}

function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  if (!signingSecret) throw new FnosDbError("SLACK_SIGNING_SECRET is not configured.", 503);
  if (!timestamp || !signature) return false;

  const requestTime = Number(timestamp);
  if (!Number.isFinite(requestTime)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTime) > MAX_CLOCK_SKEW_SECONDS) return false;

  const baseString = `${SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const expected = `${SIGNATURE_VERSION}=${createHmac("sha256", signingSecret).update(baseString).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

async function createSlackAutomationJob(rawBody: string) {
  const payload = parseSlackCommandPayload(rawBody);
  if (payload.command && payload.command !== "/fn") throw new FnosDbError("지원하지 않는 Slack command입니다.", 400);
  return createAutomationJob(buildSlackAutomationJobDraft(payload));
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/slack/commands",
    job_intake: "automation_jobs",
    slack_signing_secret_configured: Boolean(process.env.SLACK_SIGNING_SECRET),
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const verified = verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature"),
    );
    if (!verified) return slackJson("요청 검증 실패");

    const job = await createSlackAutomationJob(rawBody);
    return slackJobRegistered(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack 명령 처리 실패";
    console.error("Slack command intake failed", error);
    return slackJson(`오류: ${message}`);
  }
}
