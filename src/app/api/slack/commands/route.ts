import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAutomationJob } from "@/lib/automation-jobs";
import type { AutomationJob, AutomationJobType } from "@/lib/automation-jobs-shared";
import { FnosDbError } from "@/lib/fnos-db";
import { inferSlackAutomationJob, parseSlackCommandPayload } from "@/lib/slack-commands";

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

function inferPeriod(text: string) {
  const normalized = text.toLowerCase();
  if (/\byesterday\b|어제/.test(normalized)) return "yesterday";
  if (/\btoday\b|오늘/.test(normalized)) return "today";
  if (/\btomorrow\b|내일/.test(normalized)) return "tomorrow";
  return normalized.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
    || normalized.match(/\b\d{4}-\d{2}\b/)?.[0]
    || normalized.match(/\b(last|this|next)\s+(week|month|quarter|year)\b/)?.[0]
    || "";
}

function slackJobTitle(jobType: AutomationJobType, text: string, period: string) {
  if (jobType === "ads_collect") return `광고자료 수집${period ? ` - ${period}` : ""}`;
  if (jobType === "ads_analyze") return `광고성과 분석${period ? ` - ${period}` : ""}`;
  if (jobType === "orders_collect") return `주문/발주 수집${period ? ` - ${period}` : ""}`;
  if (jobType === "invoice_prepare") return `송장 준비${period ? ` - ${period}` : ""}`;
  if (jobType === "accounting_collect") return `회계자료 수집${period ? ` - ${period}` : ""}`;
  if (jobType === "content_draft") return "콘텐츠 초안";
  if (jobType === "sourcing_research") return "소싱 리서치";
  return text ? `FN OS 보고 - ${text}` : "FN OS 보고";
}

async function createSlackAutomationJob(rawBody: string) {
  const payload = parseSlackCommandPayload(rawBody);
  if (payload.command && payload.command !== "/fn") throw new FnosDbError("지원하지 않는 Slack command입니다.", 400);

  const inference = inferSlackAutomationJob(payload.text);
  const period = inferPeriod(payload.text);
  return createAutomationJob({
    job_type: inference.jobType,
    title: slackJobTitle(inference.jobType, payload.text, period),
    status: inference.approvalRequired ? "waiting_approval" : "queued",
    requested_by: "slack",
    assigned_agent: inference.assignedAgent,
    source: "slack",
    requested_text: payload.text,
    input_json: {
      period,
      raw_text: payload.text,
      slack: {
        command: payload.command,
        user_id: payload.user_id,
        user_name: payload.user_name,
        channel_id: payload.channel_id,
        channel_name: payload.channel_name,
        team_id: payload.team_id,
        team_domain: payload.team_domain,
        trigger_id: payload.trigger_id,
      },
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

    const job = await createSlackAutomationJob(rawBody);
    return slackJobRegistered(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack 명령 처리 실패";
    console.error("Slack command intake failed", error);
    return slackJson(`오류: ${message}`);
  }
}
