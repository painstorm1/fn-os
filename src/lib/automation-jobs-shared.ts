export const AUTOMATION_JOB_TYPES = [
  "collect_smartstore_orders",
  "collect_coupang_orders",
  "online_order_status_update",
  "generate_invoice_file",
  "download_ads_report",
  "download_accounting_report",
  "create_detail_page_draft",
  "ads_collect",
  "ads_analyze",
  "coupang_report_reservation",
  "orders_collect",
  "invoice_prepare",
  "fnos_report",
  "content_draft",
  "accounting_collect",
  "sourcing_research",
  "knowledge_daily_capture",
  "knowledge_action",
  "product_card_upsert",
] as const;

export type AutomationJobType = (typeof AUTOMATION_JOB_TYPES)[number];

export const CREATABLE_AUTOMATION_JOB_TYPES = [
  "collect_smartstore_orders",
  "collect_coupang_orders",
  "online_order_status_update",
  "generate_invoice_file",
  "download_ads_report",
  "download_accounting_report",
  "ads_collect",
  "ads_analyze",
  "coupang_report_reservation",
  "orders_collect",
  "invoice_prepare",
  "accounting_collect",
] as const satisfies readonly AutomationJobType[];

export const AUTOMATION_JOB_TYPE_LABELS: Record<AutomationJobType, string> = {
  online_order_status_update: "온라인 주문 상태 변경",
  collect_smartstore_orders: "스마트스토어 주문 수집",
  collect_coupang_orders: "쿠팡 주문 수집",
  generate_invoice_file: "송장 파일 생성",
  download_ads_report: "광고자료 다운로드",
  download_accounting_report: "회계자료 다운로드",
  create_detail_page_draft: "상세페이지 초안 생성",
  ads_collect: "광고자료 수집",
  ads_analyze: "광고성과 분석",
  coupang_report_reservation: "쿠팡 월간 리포트 예약",
  orders_collect: "주문/발주 수집",
  invoice_prepare: "송장 준비",
  fnos_report: "FN OS 보고",
  content_draft: "콘텐츠 초안",
  accounting_collect: "회계자료 수집",
  sourcing_research: "소싱 리서치",
  knowledge_daily_capture: "오늘 입력 Obsidian 저장",
  knowledge_action: "지식센터 처리",
  product_card_upsert: "제품 지식카드 생성/갱신",
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
  assigned_agent: string;
  source: string;
  trigger_type: string;
  requested_text: string;
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

export type AutomationLog = {
  id: string;
  run_id?: string;
  job_id: string;
  agent_name: string;
  level: string;
  event_type: string;
  message: string;
  payload: unknown;
  created_at: string;
};

export type AutomationRun = {
  id: string;
  source: "cron" | "manual_auto" | "agent" | string;
  agent: string;
  task_type: AutomationJobType | string;
  title: string;
  status: "running" | "success" | "failed" | string;
  requested_by: string;
  summary: string;
  input_json: unknown;
  result_json: unknown;
  error_message: string;
  result_file_url: string;
  screenshot_url: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export function isAutomationJobType(value: unknown): value is AutomationJobType {
  return AUTOMATION_JOB_TYPES.includes(value as AutomationJobType);
}

export function isAutomationJobStatus(value: unknown): value is AutomationJobStatus {
  return AUTOMATION_JOB_STATUSES.includes(value as AutomationJobStatus);
}
