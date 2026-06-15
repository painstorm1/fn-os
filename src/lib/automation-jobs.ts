import { FnosDbError, hasDbConfig, insertRows, patchRows, selectRows, upsertRows } from "./fnos-db";
import {
  AUTOMATION_JOB_STATUS_LABELS,
  AUTOMATION_JOB_TYPE_LABELS,
  type AutomationJob,
  type AutomationLog,
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
  assignedAgent?: string;
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
    trigger_type: inputText(row, "trigger_type"),
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

export function normalizeAutomationLog(row: AnyRecord): AutomationLog {
  return {
    id: text(row.id),
    job_id: text(row.job_id),
    agent_name: text(row.agent_name),
    level: text(row.level) || "info",
    event_type: text(row.event_type),
    message: text(row.message),
    payload: maybeJsonColumn(row, "payload", {}),
    created_at: text(row.created_at),
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
  if (filters.assignedAgent) query.assigned_agent = `eq.${filters.assignedAgent}`;
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

export async function listAutomationLogs(jobId: string, limit = 500) {
  if (!hasDbConfig()) return [];
  const id = text(jobId);
  if (!id) return [];
  const rows = await selectRows<AnyRecord>("automation_logs", {
    job_id: `eq.${id}`,
    order: "created_at.asc",
    limit: Math.min(Math.max(Number(limit || 500), 1), 1000),
  });
  return rows.map(normalizeAutomationLog);
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
  if ("trigger_type" in body) values.trigger_type = nullableText(body.trigger_type);
  if ("requested_text" in body) values.requested_text = nullableText(body.requested_text);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const [saved] = await insertRows<AnyRecord>("automation_jobs", values);
      const job = normalizeAutomationJob(saved);
      await createAutomationLog({
        job_id: job.id,
        agent_name: job.assigned_agent,
        event_type: "created",
        message: `job created: ${job.job_type}`,
        payload: { source: job.source, trigger_type: job.trigger_type, requested_text: job.requested_text },
      }).catch(() => null);
      return job;
    } catch (error) {
      const column = missingColumnName(error);
      if (!column || !(column in values) || !["assigned_agent", "source", "trigger_type", "requested_text"].includes(column)) throw error;
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
  if ("trigger_type" in body) values.trigger_type = nullableText(body.trigger_type);
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
  const normalized = normalizeAutomationJob(saved);
  if ("status" in values) {
    await createAutomationLog({
      job_id: normalized.id,
      agent_name: normalized.assigned_agent,
      event_type: "status_changed",
      message: `status changed to ${normalized.status}`,
      payload: { status: normalized.status },
    }).catch(() => null);
  }
  if ("log_text" in values && text(values.log_text)) {
    await createAutomationLog({
      job_id: normalized.id,
      agent_name: normalized.assigned_agent,
      event_type: "log_text_updated",
      message: text(values.log_text).slice(-2000),
    }).catch(() => null);
  }
  if ("error_message" in values && text(values.error_message)) {
    await createAutomationLog({
      job_id: normalized.id,
      agent_name: normalized.assigned_agent,
      level: "error",
      event_type: "error_updated",
      message: text(values.error_message),
    }).catch(() => null);
  }
  return normalized;
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
    if (claimed) {
      const job = normalizeAutomationJob(claimed);
      await createAutomationLog({
        job_id: job.id,
        agent_name: workerId,
        event_type: "claimed",
        message: `claimed by ${workerId}`,
      }).catch(() => null);
      return job;
    }
  }
  return null;
}

function appendLog(current: unknown, addition: unknown) {
  const next = text(addition);
  if (!next) return text(current);
  const timestamped = `[${new Date().toISOString()}] ${next}`;
  return [text(current), timestamped].filter(Boolean).join("\n");
}

async function createAutomationLog(body: AnyRecord = {}) {
  if (!hasDbConfig()) return null;
  const jobId = nullableText(body.job_id || body.jobId);
  const message = text(body.message || body.log_text);
  const payload = jsonValue(body.payload, {}) ?? {};
  const [saved] = await insertRows<AnyRecord>("automation_logs", {
    job_id: jobId,
    agent_name: nullableText(body.agent_name || body.assigned_agent || body.agentName),
    level: text(body.level) || "info",
    event_type: nullableText(body.event_type || body.eventType),
    message,
    payload,
    created_at: new Date().toISOString(),
  });
  return saved;
}

function slackContextFromJob(job: AutomationJob) {
  const input = recordValue(job.input_json);
  const slack = recordValue(input.slack);
  const channel = text(slack.channel_id || slack.channel);
  const threadTs = text(slack.thread_ts || slack.threadTs || slack.message_ts || slack.messageTs || slack.trigger_ts);
  return {
    channel,
    threadTs,
    responseUrl: text(slack.response_url || slack.responseUrl),
  };
}

async function postSlackFollowup(job: AutomationJob, textMessage: string) {
  const { channel, threadTs, responseUrl } = slackContextFromJob(job);
  const botToken = process.env.SLACK_BOT_TOKEN || "";
  if (channel && botToken) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        thread_ts: threadTs || undefined,
        text: textMessage,
        unfurl_links: false,
        unfurl_media: false,
      }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(`Slack chat.postMessage failed: ${data?.error || response.status}`);
    return;
  }
  if (responseUrl) {
    const response = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ response_type: "ephemeral", text: textMessage }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Slack response_url failed: ${response.status}`);
  }
}

export async function reportAutomationJobStart(body: AnyRecord = {}) {
  const jobId = text(body.job_id || body.jobId || body.current_job_id);
  const now = new Date().toISOString();
  if (jobId) {
    const job = await getAutomationJob(jobId);
    const [saved] = await patchRows<AnyRecord>(
      "automation_jobs",
      { id: `eq.${jobId}` },
      {
        status: "running",
        started_at: job.started_at || now,
        assigned_agent: nullableText(body.assigned_agent) || job.assigned_agent || null,
        source: text(body.source) || job.source || "hermes",
        trigger_type: nullableText(body.trigger_type) || job.trigger_type || null,
        input_json: body.input_json === undefined ? job.input_json : jsonValue(body.input_json, {}) ?? {},
        log_text: appendLog(job.log_text, body.log_text || "started"),
      },
    );
    if (!saved) throw new FnosDbError("작업을 찾을 수 없습니다.", 404);
    const normalized = normalizeAutomationJob(saved);
    await createAutomationLog({
      job_id: normalized.id,
      agent_name: normalized.assigned_agent,
      event_type: "started",
      message: text(body.log_text || "started"),
      payload: { trigger_type: normalized.trigger_type, source: normalized.source },
    }).catch(() => null);
    return normalized;
  }
  const created = await createAutomationJob({
    ...body,
    status: "running",
    source: text(body.source) || "hermes",
    started_at: now,
    log_text: body.log_text || "started",
  });
  await createAutomationLog({
    job_id: created.id,
    agent_name: created.assigned_agent,
    event_type: "started",
    message: text(body.log_text || "started"),
    payload: { trigger_type: created.trigger_type, source: created.source },
  }).catch(() => null);
  return created;
}

export async function appendAutomationJobLog(body: AnyRecord = {}) {
  const jobId = text(body.job_id || body.jobId);
  if (!jobId) throw new FnosDbError("작업 ID가 필요합니다.", 400);
  const job = await getAutomationJob(jobId);
  const [saved] = await patchRows<AnyRecord>(
    "automation_jobs",
    { id: `eq.${jobId}` },
    { log_text: appendLog(job.log_text, body.log_text || body.message) },
  );
  if (!saved) throw new FnosDbError("작업을 찾을 수 없습니다.", 404);
  const normalized = normalizeAutomationJob(saved);
  await createAutomationLog({
    job_id: normalized.id,
    agent_name: normalized.assigned_agent,
    level: text(body.level) || "info",
    event_type: text(body.event_type || "log"),
    message: text(body.log_text || body.message),
    payload: body.payload || {},
  }).catch(() => null);
  return normalized;
}

export async function reportAutomationJobSuccess(body: AnyRecord = {}) {
  const jobId = text(body.job_id || body.jobId);
  if (!jobId) throw new FnosDbError("작업 ID가 필요합니다.", 400);
  const job = await getAutomationJob(jobId);
  const now = new Date().toISOString();
  const [saved] = await patchRows<AnyRecord>(
    "automation_jobs",
    { id: `eq.${jobId}` },
    {
      status: "success",
      result_json: jsonValue(body.result_json, {}) ?? {},
      result_file_url: nullableText(body.result_file_url),
      screenshot_url: nullableText(body.screenshot_url),
      log_text: appendLog(job.log_text, body.log_text || "success"),
      finished_at: now,
    },
  );
  if (!saved) throw new FnosDbError("작업을 찾을 수 없습니다.", 404);
  const normalized = normalizeAutomationJob(saved);
  await createAutomationLog({
    job_id: normalized.id,
    agent_name: normalized.assigned_agent,
    event_type: "success",
    message: text(body.log_text || "success"),
    payload: body.result_json || {},
  }).catch(() => null);
  await postSlackFollowup(
    normalized,
    `작업 완료.\n작업 ID: ${normalized.id}\n작업: ${normalized.job_type}\n상태: success`,
  ).catch((error) => createAutomationLog({
    job_id: normalized.id,
    agent_name: normalized.assigned_agent,
    level: "warn",
    event_type: "slack_followup_failed",
    message: error instanceof Error ? error.message : "Slack followup failed",
  }).catch(() => null));
  return normalized;
}

export async function reportAutomationJobFail(body: AnyRecord = {}) {
  const jobId = text(body.job_id || body.jobId);
  if (!jobId) throw new FnosDbError("작업 ID가 필요합니다.", 400);
  const job = await getAutomationJob(jobId);
  const now = new Date().toISOString();
  const [saved] = await patchRows<AnyRecord>(
    "automation_jobs",
    { id: `eq.${jobId}` },
    {
      status: "failed",
      error_message: text(body.error_message || body.error || "failed"),
      screenshot_url: nullableText(body.screenshot_url),
      log_text: appendLog(job.log_text, body.log_text || body.error_message || "failed"),
      finished_at: now,
    },
  );
  if (!saved) throw new FnosDbError("작업을 찾을 수 없습니다.", 404);
  const normalized = normalizeAutomationJob(saved);
  await createAutomationLog({
    job_id: normalized.id,
    agent_name: normalized.assigned_agent,
    level: "error",
    event_type: "failed",
    message: text(body.error_message || body.error || "failed"),
    payload: { screenshot_url: normalized.screenshot_url },
  }).catch(() => null);
  await postSlackFollowup(
    normalized,
    `작업 실패.\n작업 ID: ${normalized.id}\n작업: ${normalized.job_type}\n상태: failed\n오류: ${normalized.error_message || "-"}`,
  ).catch((error) => createAutomationLog({
    job_id: normalized.id,
    agent_name: normalized.assigned_agent,
    level: "warn",
    event_type: "slack_followup_failed",
    message: error instanceof Error ? error.message : "Slack followup failed",
  }).catch(() => null));
  return normalized;
}

export async function claimNextAutomationJobForAgent(agent: string) {
  if (!hasDbConfig()) throw new FnosDbError("Supabase 환경변수가 설정되지 않았습니다.", 503);
  const assignedAgent = text(agent);
  if (!assignedAgent) throw new FnosDbError("agent가 필요합니다.", 400);
  const queued = await selectRows<AnyRecord>("automation_jobs", {
    status: "eq.queued",
    assigned_agent: `eq.${assignedAgent}`,
    order: "created_at.asc",
    limit: 10,
  });
  const now = new Date().toISOString();
  for (const row of queued) {
    const id = text(row.id);
    if (!id) continue;
    const jobType = text(row.job_type);
    if (jobType) {
      const runningSameType = await selectRows<AnyRecord>("automation_jobs", {
        status: "eq.running",
        assigned_agent: `eq.${assignedAgent}`,
        job_type: `eq.${jobType}`,
        limit: 1,
      });
      if (runningSameType.length) continue;
    }
    const [claimed] = await patchRows<AnyRecord>(
      "automation_jobs",
      { id: `eq.${id}`, status: "eq.queued", assigned_agent: `eq.${assignedAgent}` },
      { status: "running", started_at: now, log_text: appendLog(row.log_text, `claimed by ${assignedAgent}`) },
    );
    if (claimed) {
      const job = normalizeAutomationJob(claimed);
      await createAutomationLog({
        job_id: job.id,
        agent_name: assignedAgent,
        event_type: "claimed",
        message: `claimed by ${assignedAgent}`,
      }).catch(() => null);
      return job;
    }
  }
  return null;
}

export async function upsertAutomationAgentHeartbeat(body: AnyRecord = {}) {
  if (!hasDbConfig()) throw new FnosDbError("Supabase 환경변수가 설정되지 않았습니다.", 503);
  const agentName = text(body.agent_name || body.agentName);
  if (!agentName) throw new FnosDbError("agent_name이 필요합니다.", 400);
  const now = new Date().toISOString();
  const [saved] = await upsertRows<AnyRecord>(
    "automation_agent_heartbeats",
    {
      agent_name: agentName,
      status: text(body.status) || "alive",
      current_job_id: nullableText(body.current_job_id || body.currentJobId),
      last_seen_at: body.last_seen_at ? normalizeDate(body.last_seen_at) : now,
      updated_at: now,
    },
    "agent_name",
  );
  return saved;
}
