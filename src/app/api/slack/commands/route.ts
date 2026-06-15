import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAutomationJob } from "@/lib/automation-jobs";
import { FnosDbError } from "@/lib/fnos-db";
import { inferSlackAutomationJob, parseSlackCommandPayload } from "@/lib/slack-commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_VERSION = "v0";
const MAX_CLOCK_SKEW_SECONDS = 60 * 5;

function slackJson(text: string, status = 200) {
  return NextResponse.json({ response_type: "ephemeral", text }, { status });
}

function slackAck() {
  return slackJson("FN OS 명령 수신 완료");
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
  if (payload.command && payload.command !== "/fn") return;

  const inference = inferSlackAutomationJob(payload.text);
  const titleText = payload.text || "Slack FN OS 요청";
  await createAutomationJob({
    job_type: inference.jobType,
    title: `[Slack] ${titleText}`,
    status: inference.approvalRequired ? "waiting_approval" : "queued",
    requested_by: `slack:${payload.user_name || payload.user_id || "unknown"}`,
    input_json: {
      source: "slack_slash_command",
      command: payload.command,
      text: payload.text,
      user_id: payload.user_id,
      user_name: payload.user_name,
      channel_id: payload.channel_id,
      channel_name: payload.channel_name,
      team_id: payload.team_id,
      team_domain: payload.team_domain,
      response_url: payload.response_url,
      trigger_id: payload.trigger_id,
      assigned_agent: inference.assignedAgent,
      approval_required: inference.approvalRequired,
      matched_keywords: inference.matchedKeywords,
      risk_keywords: inference.riskKeywords,
    },
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/slack/commands",
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

    void createSlackAutomationJob(rawBody).catch((error) => {
      console.error("Slack command job create failed", error);
    });

    return slackAck();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack 명령 처리 실패";
    console.error("Slack command intake failed", error);
    if (error instanceof FnosDbError && error.status === 503) return slackAck();
    return slackJson(`오류: ${message}`);
  }
}
