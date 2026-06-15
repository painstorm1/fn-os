const ROUTES = [
  {
    agent: "ads-agent",
    keywords: ["ads", "광고", "메타", "네이버광고", "쿠팡광고"],
    jobType(text) {
      if (/\b(upload|latest)\b|업로드|최신/.test(text)) return "ads_collect";
      if (/\b(analy[sz]e|analysis)\b|분석|성과/.test(text)) return "ads_analyze";
      return "ads_collect";
    },
  },
  {
    agent: "order-agent",
    keywords: ["order", "orders", "주문", "발주", "송장"],
    jobType(text) {
      return /\binvoice\b|송장/.test(text) ? "invoice_prepare" : "orders_collect";
    },
  },
  {
    agent: "fnos-manager",
    keywords: ["report", "status", "상태", "보고"],
    jobType() {
      return "fnos_report";
    },
  },
  {
    agent: "content-agent",
    keywords: ["content", "상세페이지", "소재", "숏츠"],
    jobType() {
      return "content_draft";
    },
  },
  {
    agent: "accounting-agent",
    keywords: ["accounting", "회계", "정산", "카드", "은행"],
    jobType() {
      return "accounting_collect";
    },
  },
  {
    agent: "sourcing-agent",
    keywords: ["sourcing", "소싱", "제품추천"],
    jobType() {
      return "sourcing_research";
    },
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

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function inferPeriod(text) {
  if (/\byesterday\b|어제/.test(text)) return "yesterday";
  if (/\btoday\b|오늘/.test(text)) return "today";
  if (/\btomorrow\b|내일/.test(text)) return "tomorrow";
  if (/\blatest\b|최근|최신/.test(text)) return "latest";
  return text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
    || text.match(/\b\d{4}-\d{2}\b/)?.[0]
    || text.match(/\b(last|this|next)\s+(week|month|quarter|year)\b/)?.[0]
    || "";
}

export function inferAction(text) {
  if (/\bupload\b|업로드/.test(text)) return "upload";
  if (/\bcollect\b|수집/.test(text)) return "collect";
  if (/\breport\b|보고|morning/.test(text)) return "report";
  if (/\border|orders\b|주문/.test(text)) return "orders";
  return "";
}

function titleFor(jobType, period, action, rawText) {
  if (jobType === "ads_collect" && action === "upload") return `광고자료 업로드${period ? ` - ${period}` : ""}`;
  if (jobType === "ads_collect") return `광고자료 수집${period ? ` - ${period}` : ""}`;
  if (jobType === "ads_analyze") return `광고성과 분석${period ? ` - ${period}` : ""}`;
  if (jobType === "orders_collect") return `주문/발주 수집${period ? ` - ${period}` : ""}`;
  if (jobType === "invoice_prepare") return `송장 준비${period ? ` - ${period}` : ""}`;
  if (jobType === "accounting_collect") return `회계자료 수집${period ? ` - ${period}` : ""}`;
  if (jobType === "content_draft") return "콘텐츠 초안";
  if (jobType === "sourcing_research") return "소싱 리서치";
  return period ? `FN OS 보고 - ${period}` : rawText ? `FN OS 보고 - ${rawText}` : "FN OS 보고";
}

export function parseHermesCommand(rawText) {
  const text = String(rawText || "").replace(/<@[A-Z0-9]+>/g, "").trim();
  const normalized = text.toLowerCase();
  const route = ROUTES.find((candidate) => includesAny(normalized, candidate.keywords)) || ROUTES[2];
  const jobType = route.jobType(normalized);
  const period = inferPeriod(normalized);
  const action = inferAction(normalized);
  const riskKeywords = RISK_KEYWORDS.filter((keyword) => normalized.includes(keyword.toLowerCase()));

  return {
    job_type: jobType,
    title: titleFor(jobType, period, action, text),
    assigned_agent: route.agent,
    status: riskKeywords.length ? "waiting_approval" : "queued",
    requested_text: text,
    input_json: {
      period,
      raw_text: text,
      action,
      risk_keywords: riskKeywords,
    },
  };
}
