import type { AutomationJobType } from "./automation-jobs-shared";

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
  "폐기",
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
