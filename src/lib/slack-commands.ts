import type { AutomationJobStatus, AutomationJobType } from "./automation-jobs-shared";

export type SlackCommandPayload = {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  team_id: string;
  response_url?: string;
  trigger_id?: string;
  channel_name?: string;
  team_domain?: string;
};

export type SlackCommandInference = {
  jobType: AutomationJobType;
  assignedAgent: string;
  approvalRequired: boolean;
  matchedKeywords: string[];
  riskKeywords: string[];
};

export type SlackAutomationJobDraft = {
  job_type: AutomationJobType;
  title: string;
  status: AutomationJobStatus;
  requested_by: string;
  assigned_agent: string;
  source: string;
  requested_text: string;
  input_json: Record<string, unknown>;
};

const ROUTES: Array<{
  assignedAgent: string;
  keywords: string[];
  jobType: (text: string) => AutomationJobType;
}> = [
  {
    assignedAgent: "ads-agent",
    keywords: ["ads", "광고", "메타", "네이버광고", "쿠팡광고"],
    jobType: (text) => (/analy[sz]e|analysis|분석|성과/.test(text) ? "ads_analyze" : "ads_collect"),
  },
  {
    assignedAgent: "order-agent",
    keywords: ["order", "orders", "주문", "발주", "송장"],
    jobType: (text) => (/invoice|송장/.test(text) ? "invoice_prepare" : "orders_collect"),
  },
  {
    assignedAgent: "fnos-manager",
    keywords: ["report", "status", "상태", "보고"],
    jobType: () => "fnos_report",
  },
  {
    assignedAgent: "content-agent",
    keywords: ["content", "상세페이지", "소재", "숏츠"],
    jobType: () => "content_draft",
  },
  {
    assignedAgent: "accounting-agent",
    keywords: ["accounting", "회계", "정산", "카드", "은행"],
    jobType: () => "accounting_collect",
  },
  {
    assignedAgent: "sourcing-agent",
    keywords: ["sourcing", "소싱", "제품추천"],
    jobType: () => "sourcing_research",
  },
];

const RISK_KEYWORDS = [
  "delete",
  "drop",
  "truncate",
  "remove",
  "reset",
  "erase",
  "execute",
  "run now",
  "삭제",
  "삭제해",
  "초기화",
  "제거",
  "지우기",
  "실행",
  "바로 실행",
  "결제",
  "송금",
  "출금",
  "환불",
  "취소",
  "확정",
];

function includesKeyword(text: string, keyword: string) {
  return text.includes(keyword.toLowerCase());
}

export function parseSlackCommandPayload(rawBody: string): SlackCommandPayload {
  const params = new URLSearchParams(rawBody);
  return {
    command: String(params.get("command") || "").trim(),
    text: String(params.get("text") || "").trim(),
    user_id: String(params.get("user_id") || "").trim(),
    user_name: String(params.get("user_name") || "").trim(),
    channel_id: String(params.get("channel_id") || "").trim(),
    team_id: String(params.get("team_id") || "").trim(),
    response_url: String(params.get("response_url") || "").trim() || undefined,
    trigger_id: String(params.get("trigger_id") || "").trim() || undefined,
    channel_name: String(params.get("channel_name") || "").trim() || undefined,
    team_domain: String(params.get("team_domain") || "").trim() || undefined,
  };
}

export function inferSlackAutomationJob(text: string): SlackCommandInference {
  const normalized = text.toLowerCase();
  const route = ROUTES.find((candidate) => candidate.keywords.some((keyword) => includesKeyword(normalized, keyword)));
  const matchedKeywords = route?.keywords.filter((keyword) => includesKeyword(normalized, keyword)) || [];
  const riskKeywords = RISK_KEYWORDS.filter((keyword) => includesKeyword(normalized, keyword));
  return {
    jobType: route?.jobType(normalized) || "fnos_report",
    assignedAgent: route?.assignedAgent || "fnos-manager",
    approvalRequired: riskKeywords.length > 0,
    matchedKeywords,
    riskKeywords,
  };
}

export function inferSlackPeriod(text: string) {
  const normalized = text.toLowerCase();
  if (/\byesterday\b|어제/.test(normalized)) return "yesterday";
  if (/\btoday\b|오늘/.test(normalized)) return "today";
  if (/\btomorrow\b|내일/.test(normalized)) return "tomorrow";
  if (/\blatest\b|최근|최신/.test(normalized)) return "latest";
  return normalized.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
    || normalized.match(/\b\d{4}-\d{2}\b/)?.[0]
    || normalized.match(/\b(last|this|next)\s+(week|month|quarter|year)\b/)?.[0]
    || "";
}

export function inferSlackAction(text: string) {
  const normalized = text.toLowerCase();
  if (/\bupload\b|업로드/.test(normalized)) return "upload";
  if (/\bcollect\b|수집/.test(normalized)) return "collect";
  if (/\breport\b|보고|morning/.test(normalized)) return "report";
  if (/\border|orders\b|주문/.test(normalized)) return "orders";
  return "";
}

export function slackJobTitle(jobType: AutomationJobType, text: string, period: string, action: string) {
  if (jobType === "ads_collect" && action === "upload") return `광고자료 업로드${period ? ` - ${period}` : ""}`;
  if (jobType === "ads_collect") return `광고자료 수집${period ? ` - ${period}` : ""}`;
  if (jobType === "ads_analyze") return `광고성과 분석${period ? ` - ${period}` : ""}`;
  if (jobType === "orders_collect") return `주문/발주 수집${period ? ` - ${period}` : ""}`;
  if (jobType === "invoice_prepare") return `송장 준비${period ? ` - ${period}` : ""}`;
  if (jobType === "accounting_collect") return `회계자료 수집${period ? ` - ${period}` : ""}`;
  if (jobType === "content_draft") return "콘텐츠 초안";
  if (jobType === "sourcing_research") return "소싱 리서치";
  return period ? `FN OS 보고 - ${period}` : text ? `FN OS 보고 - ${text}` : "FN OS 보고";
}

export function buildSlackAutomationJobDraft(payload: SlackCommandPayload): SlackAutomationJobDraft {
  const inference = inferSlackAutomationJob(payload.text);
  const period = inferSlackPeriod(payload.text);
  const action = inferSlackAction(payload.text);
  return {
    job_type: inference.jobType,
    title: slackJobTitle(inference.jobType, payload.text, period, action),
    status: inference.approvalRequired ? "waiting_approval" : "queued",
    requested_by: "slack",
    assigned_agent: inference.assignedAgent,
    source: "slack",
    requested_text: payload.text,
    input_json: {
      period,
      raw_text: payload.text,
      action,
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
  };
}
