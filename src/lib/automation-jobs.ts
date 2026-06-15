import { FnosDbError, hasDbConfig, insertRows, patchRows, selectRows } from "./fnos-db";
import {
  AUTOMATION_JOB_STATUS_LABELS,
  AUTOMATION_JOB_TYPE_LABELS,
  type AutomationJob,
  type AutomationJobStatus,
  type AutomationJobType,
  isAutomationJobStatus,
  isAutomationJobType,
} from "./automation-jobs-shared";

type AnyRecord = Record<string, unknown>;

export type AutomationJobListFilters = {
  id?: string;
  jobType?: string;
  status?: string;
  limit?: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nullableText(value: unknown) {
  const next = text(value);
  return next || null;
}

function jsonValue(value: unknown, fallback: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return value;
  const next = value.trim();
  if (!next) return fallback;
  try {
    return JSON.parse(next) as unknown;
  } catch {
    throw new FnosDbError("JSON 형식이 올바르지 않습니다.", 400);
  }
}

function normalizeJobType(value: unknown): AutomationJobType {
  const next = text(value);
  if (isAutomationJobType(next)) return next;
  throw new FnosDbError("작업 유형을 선택해 주세요.", 400);
}

function normalizeStatus(value: unknown, fallback: AutomationJobStatus = "queued"): AutomationJobStatus {
  const next = text(value);
  if (!next) return fallback;
  if (isAutomationJobStatus(next)) return next;
  throw new FnosDbError("지원하지 않는 작업 상태입니다.", 400);
}

function normalizeDate(value: unknown) {
  const next = text(value);
  if (!next) return null;
  const date = new Date(next);
  if (Number.isNaN(date.getTime())) throw new FnosDbError("날짜 형식이 올바르지 않습니다.", 400);
  return date.toISOString();
}

function maybeJsonColumn(row: AnyRecord, key: string, fallback: unknown) {
  const value = row[key];
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

function recordValue(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function inputText(row: AnyRecord, key: string) {
  const input = recordValue(row.input_json);
  return text(row[key] ?? input[key]);
}

function missingColumnName(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.match(/컬럼 '([^']+)'/)?.[1]
    || message.match(/而щ읆 '([^']+)'/)?.[1]
    || message.match(/Could not find the ['"]?([^'"\s]+)['"]? column/i)?.[1]
    || "";
}

export function automationJobLabel(jobType: AutomationJobType) {
  return AUTOMATION_JOB_TYPE_LABELS[jobType] || jobType;
}

export function automationStatusLabel(status: AutomationJobStatus) {
  return AUTOMATION_JOB_STATUS_LABELS[status] || status;
}

export function normalizeAutomationJob(row: AnyRecord): AutomationJob {
  const jobType = isAutomationJobType(row.job_type) ? row.job_type : "collect_smartstore_orders";
  const status = isAutomationJobStatus(row.status) ? row.status : "queued";
  return {
    id: text(row.id),
    job_type: jobType,
    title: text(row.title) || automationJobLabel(jobType),
    status,
    requested_by: text(row.requested_by) || "manual",
    assigned_agent: inputText(row, "assigned_agent"),
    source: inputText(row, "source") || "manual",
    requested_text: inputText(row, "requested_text"),
    input_json: maybeJsonColumn(row, "input_json", {}),
    result_json: maybeJsonColumn(row, "result_json", {}),
    log_text: text(row.log_text),
    error_message: text(row.error_message),
    result_file_url: text(row.result_file_url),
    screenshot_url: text(row.screenshot_url),
    created_at: text(row.created_at),
    started_at: nullableText(row.started_at),
    finished_at: nullableText(row.finished_at),
  };
}

export async function listAutomationJobs(filters: AutomationJobListFilters = {}) {
  if (!hasDbConfig()) return [];
  const query: Record<string, string | number> = {
    order: "created_at.desc",
    limit: Math.min(Math.max(Number(filters.limit || 500), 1), 1000),
  };
  if (filters.id) query.id = `eq.${filters.id}`;
  if (filters.jobType && isAutomationJobType(filters.jobType)) query.job_type = `eq.${filters.jobType}`;
  if (filters.status && isAutomationJobStatus(filters.status)) query.status = `eq.${filters.status}`;
  const rows = await selectRows<AnyRecord>("automation_jobs", query);
  return rows.map(normalizeAutomationJob);
}

export async function getAutomationJob(id: string) {
  const jobId = text(id);
  if (!jobId) throw new FnosDbError("작업 ID가 필요합니다.", 400);
  const [job] = await listAutomationJobs({ id: jobId, limit: 1 });
  if (!job) throw new FnosDbError("작업을 찾을 수 없습니다.", 404);
  return job;
}

export async function createAutomationJob(body: AnyRecord) {
  if (!hasDbConfig()) throw new FnosDbError("Supabase 환경변수가 설정되지 않았습니다.", 503);
  const jobType = normalizeJobType(body.job_type);
  const status = normalizeStatus(body.status, "queued");
  const now = new Date().toISOString();
  let values: AnyRecord = {
    job_type: jobType,
    title: text(body.title) || automationJobLabel(jobType),
    status,
    requested_by: text(body.requested_by) || "manual",
    input_json: jsonValue(body.input_json, {}) ?? {},
    result_json: jsonValue(body.result_json, {}) ?? {},
    log_text: text(body.log_text),
    error_message: text(body.error_message),
    result_file_url: nullableText(body.result_file_url),
    screenshot_url: nullableText(body.screenshot_url),
    created_at: now,
    started_at: body.started_at ? normalizeDate(body.started_at) : status === "running" ? now : null,
    finished_at: body.finished_at ? normalizeDate(body.finished_at) : ["success", "failed", "cancelled"].includes(status) ? now : null,
  };
  if ("assigned_agent" in body) values.assigned_agent = nullableText(body.assigned_agent);
  if ("source" in body) values.source = text(body.source) || "manual";
  if ("requested_text" in body) values.requested_text = nullableText(body.requested_text);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const [saved] = await insertRows<AnyRecord>("automation_jobs", values);
      return normalizeAutomationJob(saved);
    } catch (error) {
      const column = missingColumnName(error);
      if (!column || !(column in values) || !["assigned_agent", "source", "requested_text"].includes(column)) throw error;
      values = {
        ...values,
        input_json: { ...recordValue(values.input_json), [column]: values[column] },
      };
      delete values[column];
    }
  }
  throw new FnosDbError("?먮룞???묒뾽 ???媛??而щ읆 ?뺤씤???ㅽ뙣?덉뒿?덈떎.");
}

export async function updateAutomationJob(id: string, body: AnyRecord) {
  if (!hasDbConfig()) throw new FnosDbError("Supabase 환경변수가 설정되지 않았습니다.", 503);
  const jobId = text(id);
  if (!jobId) throw new FnosDbError("작업 ID가 필요합니다.", 400);

  const values: AnyRecord = {};
  if ("job_type" in body) values.job_type = normalizeJobType(body.job_type);
  if ("title" in body) values.title = text(body.title) || (values.job_type ? automationJobLabel(values.job_type as AutomationJobType) : undefined);
  if ("requested_by" in body) values.requested_by = text(body.requested_by) || "manual";
  if ("assigned_agent" in body) values.assigned_agent = nullableText(body.assigned_agent);
  if ("source" in body) values.source = text(body.source) || "manual";
  if ("requested_text" in body) values.requested_text = nullableText(body.requested_text);
  if ("input_json" in body) values.input_json = jsonValue(body.input_json, {});
  if ("result_json" in body) values.result_json = jsonValue(body.result_json, {});
  if ("log_text" in body) values.log_text = text(body.log_text);
  if ("error_message" in body) values.error_message = text(body.error_message);
  if ("result_file_url" in body) values.result_file_url = nullableText(body.result_file_url);
  if ("screenshot_url" in body) values.screenshot_url = nullableText(body.screenshot_url);
  if ("started_at" in body) values.started_at = normalizeDate(body.started_at);
  if ("finished_at" in body) values.finished_at = normalizeDate(body.finished_at);

  if ("status" in body) {
    const status = normalizeStatus(body.status);
    values.status = status;
    const now = new Date().toISOString();
    if (status === "queued") {
      if (!("started_at" in body)) values.started_at = null;
      if (!("finished_at" in body)) values.finished_at = null;
    }
    if (status === "running" && !("started_at" in body)) values.started_at = now;
    if (["success", "failed", "cancelled"].includes(status) && !("finished_at" in body)) values.finished_at = now;
  }

  if (!Object.keys(values).length) return getAutomationJob(jobId);
  const [saved] = await patchRows<AnyRecord>("automation_jobs", { id: `eq.${jobId}` }, values);
  if (!saved) throw new FnosDbError("작업을 찾을 수 없습니다.", 404);
  return normalizeAutomationJob(saved);
}

export async function claimNextAutomationJob(body: AnyRecord = {}) {
  if (!hasDbConfig()) throw new FnosDbError("Supabase 환경변수가 설정되지 않았습니다.", 503);
  const jobType = text(body.job_type);
  const workerId = text(body.worker_id || body.workerId || "mini-pc-worker");
  const query: Record<string, string | number> = {
    status: "eq.queued",
    order: "created_at.asc",
    limit: 10,
  };
  if (jobType && isAutomationJobType(jobType)) query.job_type = `eq.${jobType}`;
  const queued = await selectRows<AnyRecord>("automation_jobs", query);
  const now = new Date().toISOString();
  for (const row of queued) {
    const id = text(row.id);
    if (!id) continue;
    const currentLog = text(row.log_text);
    const nextLog = [currentLog, `[${now}] claimed by ${workerId}`].filter(Boolean).join("\n");
    const [claimed] = await patchRows<AnyRecord>(
      "automation_jobs",
      { id: `eq.${id}`, status: "eq.queued" },
      { status: "running", started_at: now, log_text: nextLog },
    );
    if (claimed) return normalizeAutomationJob(claimed);
  }
  return null;
}
