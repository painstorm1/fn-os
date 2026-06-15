export const AUTOMATION_JOB_TYPES = [
  "collect_smartstore_orders",
  "collect_coupang_orders",
  "generate_invoice_file",
  "download_ads_report",
  "download_accounting_report",
  "create_detail_page_draft",
  "ads_collect",
  "ads_analyze",
  "orders_collect",
  "invoice_prepare",
  "fnos_report",
  "content_draft",
  "accounting_collect",
  "sourcing_research",
] as const;

export type AutomationJobType = (typeof AUTOMATION_JOB_TYPES)[number];

export const AUTOMATION_JOB_TYPE_LABELS: Record<AutomationJobType, string> = {
  collect_smartstore_orders: "스마트스토어 주문 수집",
  collect_coupang_orders: "쿠팡 주문 수집",
  generate_invoice_file: "송장 파일 생성",
  download_ads_report: "광고자료 다운로드",
  download_accounting_report: "회계자료 다운로드",
  create_detail_page_draft: "상세페이지 초안 생성",
  ads_collect: "광고자료 수집",
  ads_analyze: "광고성과 분석",
  orders_collect: "주문/발주 수집",
  invoice_prepare: "송장 준비",
  fnos_report: "FN OS 보고",
  content_draft: "콘텐츠 초안",
  accounting_collect: "회계자료 수집",
  sourcing_research: "소싱 리서치",
};

export const AUTOMATION_JOB_STATUSES = [
  "queued",
  "running",
  "success",
  "failed",
  "waiting_approval",
  "cancelled",
] as const;

export type AutomationJobStatus = (typeof AUTOMATION_JOB_STATUSES)[number];

export const AUTOMATION_JOB_STATUS_LABELS: Record<AutomationJobStatus, string> = {
  queued: "대기",
  running: "실행중",
  success: "성공",
  failed: "실패",
  waiting_approval: "승인대기",
  cancelled: "취소",
};

export type AutomationJob = {
  id: string;
  job_type: AutomationJobType;
  title: string;
  status: AutomationJobStatus;
  requested_by: string;
  input_json: unknown;
  result_json: unknown;
  log_text: string;
  error_message: string;
  result_file_url: string;
  screenshot_url: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export function isAutomationJobType(value: unknown): value is AutomationJobType {
  return AUTOMATION_JOB_TYPES.includes(value as AutomationJobType);
}

export function isAutomationJobStatus(value: unknown): value is AutomationJobStatus {
  return AUTOMATION_JOB_STATUSES.includes(value as AutomationJobStatus);
}
