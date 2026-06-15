"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActionButton,
  Card,
  EmptyState,
  FormField,
  FormModal,
  KpiCard,
  PageHeader,
  SectionHeader,
  StatusBadge,
  modalInputClass,
  modalSelectClass,
  modalTextareaClass,
} from "@/components/fn-ui";
import {
  AUTOMATION_JOB_STATUSES,
  AUTOMATION_JOB_STATUS_LABELS,
  CREATABLE_AUTOMATION_JOB_TYPES,
  AUTOMATION_JOB_TYPE_LABELS,
  type AutomationJob,
  type AutomationLog,
  type AutomationJobStatus,
  type AutomationJobType,
} from "@/lib/automation-jobs-shared";

type AutomationJobFilter = "all" | "orders" | "invoice" | "ads" | "accounting";

type CreateDraft = {
  job_type: AutomationJobType;
  title: string;
  requested_by: string;
  input_json: string;
};

type DetailDraft = {
  title: string;
  status: AutomationJobStatus;
  requested_by: string;
  input_json: string;
  result_json: string;
  log_text: string;
  error_message: string;
  result_file_url: string;
  screenshot_url: string;
};

const API_ENDPOINT = "/api/fnos/automation-jobs";

const jobFilterOptions: Array<{ value: AutomationJobFilter; label: string }> = [
  { value: "all", label: "전체 작업" },
  { value: "orders", label: "주문 수집" },
  { value: "invoice", label: "송장 파일 생성" },
  { value: "ads", label: "광고자료 수집" },
  { value: "accounting", label: "회계자료 수집" },
];

const summaryStatuses: AutomationJobStatus[] = ["queued", "running", "success", "failed", "waiting_approval"];

function parseJsonField(value: string, fallback: unknown) {
  const next = value.trim();
  if (!next) return fallback;
  return JSON.parse(next) as unknown;
}

function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusTone(status: AutomationJobStatus) {
  if (status === "success") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "running") return "info" as const;
  if (status === "waiting_approval") return "warning" as const;
  if (status === "cancelled") return "muted" as const;
  return "primary" as const;
}

function jobMatchesFilter(job: AutomationJob, filter: AutomationJobFilter) {
  if (filter === "all") return true;
  if (filter === "orders") return ["collect_smartstore_orders", "collect_coupang_orders", "orders_collect"].includes(job.job_type);
  if (filter === "invoice") return ["generate_invoice_file", "invoice_prepare"].includes(job.job_type);
  if (filter === "ads") return ["download_ads_report", "ads_collect", "ads_analyze", "coupang_report_reservation"].includes(job.job_type);
  if (filter === "accounting") return ["download_accounting_report", "accounting_collect"].includes(job.job_type);
  return true;
}

function createInitialDraft(): CreateDraft {
  return {
    job_type: "collect_smartstore_orders",
    title: "",
    requested_by: "manual",
    input_json: "{\n  \"date_range\": \"today\"\n}",
  };
}

function detailDraftFromJob(job: AutomationJob): DetailDraft {
  return {
    title: job.title,
    status: job.status,
    requested_by: job.requested_by,
    input_json: stringifyJson(job.input_json),
    result_json: stringifyJson(job.result_json),
    log_text: job.log_text,
    error_message: job.error_message,
    result_file_url: job.result_file_url,
    screenshot_url: job.screenshot_url,
  };
}

async function readJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.error || "요청 처리 실패"));
  }
  return data;
}

export default function AutomationCenter() {
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [jobFilter, setJobFilter] = useState<AutomationJobFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => createInitialDraft());
  const [detailJob, setDetailJob] = useState<AutomationJob | null>(null);
  const [detailDraft, setDetailDraft] = useState<DetailDraft | null>(null);
  const [detailLogs, setDetailLogs] = useState<AutomationLog[]>([]);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await readJsonResponse(await fetch(`${API_ENDPOINT}?limit=500`, { cache: "no-store" }));
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "자동화 작업 조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs]);

  const summary = useMemo(() => {
    return Object.fromEntries(AUTOMATION_JOB_STATUSES.map((status) => [status, jobs.filter((job) => job.status === status).length])) as Record<AutomationJobStatus, number>;
  }, [jobs]);

  const filteredJobs = useMemo(() => jobs.filter((job) => jobMatchesFilter(job, jobFilter)), [jobFilter, jobs]);

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        ...createDraft,
        input_json: parseJsonField(createDraft.input_json, {}),
      };
      const data = await readJsonResponse(await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }));
      setJobs((prev) => [data.job as AutomationJob, ...prev]);
      setCreateOpen(false);
      setMessage("자동화 작업을 대기열에 등록했습니다.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "자동화 작업 생성 실패");
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(job: AutomationJob) {
    setError("");
    setMessage("");
    try {
      const data = await readJsonResponse(await fetch(`${API_ENDPOINT}/${encodeURIComponent(job.id)}`, { cache: "no-store" }));
      const nextJob = data.job as AutomationJob;
      setDetailJob(nextJob);
      setDetailDraft(detailDraftFromJob(nextJob));
      setDetailLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "자동화 작업 상세 조회 실패");
    }
  }

  async function patchJob(jobId: string, payload: Record<string, unknown>) {
    const data = await readJsonResponse(await fetch(`${API_ENDPOINT}/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const nextJob = data.job as AutomationJob;
    setJobs((prev) => prev.map((job) => (job.id === nextJob.id ? nextJob : job)));
    if (detailJob?.id === nextJob.id) {
      setDetailJob(nextJob);
      setDetailDraft(detailDraftFromJob(nextJob));
      if (Array.isArray(data.logs)) setDetailLogs(data.logs);
    }
    return nextJob;
  }

  async function quickStatus(job: AutomationJob, status: AutomationJobStatus) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await patchJob(job.id, { status });
      setMessage(`작업 상태를 ${AUTOMATION_JOB_STATUS_LABELS[status]}(으)로 변경했습니다.`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "작업 상태 업데이트 실패");
    } finally {
      setSaving(false);
    }
  }

  async function saveDetail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detailJob || !detailDraft) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await patchJob(detailJob.id, {
        title: detailDraft.title,
        status: detailDraft.status,
        requested_by: detailDraft.requested_by,
        input_json: parseJsonField(detailDraft.input_json, {}),
        result_json: parseJsonField(detailDraft.result_json, {}),
        log_text: detailDraft.log_text,
        error_message: detailDraft.error_message,
        result_file_url: detailDraft.result_file_url,
        screenshot_url: detailDraft.screenshot_url,
      });
      setMessage("자동화 작업 상세 정보를 저장했습니다.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "자동화 작업 저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const tableRows = filteredJobs;

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        title="자동화센터"
        description={<span>에르메스 자동 실행 기록과 상태를 확인합니다.</span>}
        actions={(
          <>
            <ActionButton type="button" variant="secondary" onClick={() => void loadJobs()} disabled={loading || saving}>새로고침</ActionButton>
          </>
        )}
      />

      {(message || error) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {message && <StatusBadge tone="success">{message}</StatusBadge>}
          {error && <StatusBadge tone="danger">{error}</StatusBadge>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {summaryStatuses.map((status) => (
          <KpiCard
            key={status}
            label={`${AUTOMATION_JOB_STATUS_LABELS[status]} 작업 수`}
            value={summary[status].toLocaleString("ko-KR")}
            tone={status === "failed" ? "danger" : status === "success" ? "success" : status === "queued" ? "orange" : "default"}
          />
        ))}
      </div>

      <Card className="mt-5 rounded-lg p-5">
        <SectionHeader
          title="작업 목록"
          description={<span>{tableRows.length.toLocaleString("ko-KR")}건</span>}
          actions={(
            <select
              className={`${modalSelectClass} h-9 w-52 text-sm`}
              value={jobFilter}
              onChange={(event) => setJobFilter(event.target.value as AutomationJobFilter)}
            >
              {jobFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
        />
        <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full table-fixed text-left text-sm">
            <thead className="bg-gray-50 text-xs font-bold text-gray-500">
              <tr>
                <th className="w-[132px] px-3 py-3">생성시간</th>
                <th className="w-[190px] px-3 py-3">작업명</th>
                <th className="w-[170px] px-3 py-3">작업유형</th>
                <th className="w-[110px] px-3 py-3">상태</th>
                <th className="w-[100px] px-3 py-3">요청자</th>
                <th className="w-[132px] px-3 py-3">시작시간</th>
                <th className="w-[132px] px-3 py-3">종료시간</th>
                <th className="w-[254px] px-3 py-3">관리</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((job) => (
                <tr key={job.id} className="border-t border-gray-100 hover:bg-orange-50/60">
                  <td className="px-3 py-3 font-semibold text-gray-700">{formatTime(job.created_at)}</td>
                  <td className="truncate px-3 py-3 font-bold text-gray-900" title={job.title}>{job.title}</td>
                  <td className="px-3 py-3 text-gray-600">{AUTOMATION_JOB_TYPE_LABELS[job.job_type]}</td>
                  <td className="px-3 py-3"><StatusBadge tone={statusTone(job.status)}>{AUTOMATION_JOB_STATUS_LABELS[job.status]}</StatusBadge></td>
                  <td className="px-3 py-3 text-gray-600">{job.requested_by || "-"}</td>
                  <td className="px-3 py-3 text-gray-600">{formatTime(job.started_at)}</td>
                  <td className="px-3 py-3 text-gray-600">{formatTime(job.finished_at)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" className="h-8 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50" onClick={() => void openDetail(job)}>상세</button>
                      <button type="button" className="h-8 rounded-md border border-sky-200 bg-sky-50 px-2.5 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-40" disabled={job.status === "running" || saving} onClick={() => void quickStatus(job, "running")}>실행중</button>
                      <button type="button" className="h-8 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40" disabled={job.status === "success" || saving} onClick={() => void quickStatus(job, "success")}>성공</button>
                      <button type="button" className="h-8 rounded-md border border-red-200 bg-red-50 px-2.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-40" disabled={job.status === "failed" || saving} onClick={() => void quickStatus(job, "failed")}>실패</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tableRows.length && <EmptyState className="mt-4" title={loading ? "작업을 불러오는 중입니다." : "작업이 없습니다."} />}
        </div>
      </Card>

      {createOpen && (
        <FormModal
          title="작업 생성"
          onClose={() => setCreateOpen(false)}
          size="lg"
          footer={(
            <>
              <ActionButton type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>닫기</ActionButton>
              <ActionButton type="submit" form="automation-create-form" disabled={saving}>등록</ActionButton>
            </>
          )}
        >
          <form id="automation-create-form" className="space-y-4" onSubmit={createJob}>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="작업유형" required>
                <select
                  className={modalSelectClass}
                  value={createDraft.job_type}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, job_type: event.target.value as AutomationJobType }))}
                >
                  {CREATABLE_AUTOMATION_JOB_TYPES.map((type) => (
                    <option key={type} value={type}>{AUTOMATION_JOB_TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="요청자">
                <select className={modalSelectClass} value={createDraft.requested_by} onChange={(event) => setCreateDraft((prev) => ({ ...prev, requested_by: event.target.value }))}>
                  <option value="manual">manual</option>
                  <option value="voice">voice</option>
                  <option value="system">system</option>
                </select>
              </FormField>
            </div>
            <FormField label="작업명">
              <input
                className={modalInputClass}
                value={createDraft.title}
                placeholder={AUTOMATION_JOB_TYPE_LABELS[createDraft.job_type]}
                onChange={(event) => setCreateDraft((prev) => ({ ...prev, title: event.target.value }))}
              />
            </FormField>
            <FormField label="input_json">
              <textarea
                className={`${modalTextareaClass} min-h-36 font-mono text-xs`}
                value={createDraft.input_json}
                onChange={(event) => setCreateDraft((prev) => ({ ...prev, input_json: event.target.value }))}
              />
            </FormField>
          </form>
        </FormModal>
      )}

      {detailJob && detailDraft && (
        <FormModal
          title="작업 상세"
          onClose={() => {
            setDetailJob(null);
            setDetailDraft(null);
            setDetailLogs([]);
          }}
          size="xl"
          footer={(
            <>
              <ActionButton type="button" variant="secondary" onClick={() => {
                setDetailJob(null);
                setDetailDraft(null);
              }} disabled={saving}>닫기</ActionButton>
              <ActionButton type="submit" form="automation-detail-form" disabled={saving}>저장</ActionButton>
            </>
          )}
        >
          <form id="automation-detail-form" className="space-y-4" onSubmit={saveDetail}>
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-bold text-gray-500">ID</p>
                <p className="mt-1 break-all font-semibold text-gray-800">{detailJob.id}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-bold text-gray-500">작업유형</p>
                <p className="mt-1 font-semibold text-gray-800">{AUTOMATION_JOB_TYPE_LABELS[detailJob.job_type]}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-bold text-gray-500">시간</p>
                <p className="mt-1 font-semibold text-gray-800">{formatTime(detailJob.started_at)} / {formatTime(detailJob.finished_at)}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <FormField label="작업명">
                <input className={modalInputClass} value={detailDraft.title} onChange={(event) => setDetailDraft((prev) => prev ? { ...prev, title: event.target.value } : prev)} />
              </FormField>
              <FormField label="상태">
                <select className={modalSelectClass} value={detailDraft.status} onChange={(event) => setDetailDraft((prev) => prev ? { ...prev, status: event.target.value as AutomationJobStatus } : prev)}>
                  {AUTOMATION_JOB_STATUSES.map((status) => (
                    <option key={status} value={status}>{AUTOMATION_JOB_STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="요청자">
                <input className={modalInputClass} value={detailDraft.requested_by} onChange={(event) => setDetailDraft((prev) => prev ? { ...prev, requested_by: event.target.value } : prev)} />
              </FormField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="result_file_url">
                <input className={modalInputClass} value={detailDraft.result_file_url} onChange={(event) => setDetailDraft((prev) => prev ? { ...prev, result_file_url: event.target.value } : prev)} />
              </FormField>
              <FormField label="screenshot_url">
                <input className={modalInputClass} value={detailDraft.screenshot_url} onChange={(event) => setDetailDraft((prev) => prev ? { ...prev, screenshot_url: event.target.value } : prev)} />
              </FormField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="input_json">
                <textarea className={`${modalTextareaClass} min-h-44 font-mono text-xs`} value={detailDraft.input_json} onChange={(event) => setDetailDraft((prev) => prev ? { ...prev, input_json: event.target.value } : prev)} />
              </FormField>
              <FormField label="result_json">
                <textarea className={`${modalTextareaClass} min-h-44 font-mono text-xs`} value={detailDraft.result_json} onChange={(event) => setDetailDraft((prev) => prev ? { ...prev, result_json: event.target.value } : prev)} />
              </FormField>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-black text-slate-600">automation_logs</p>
                <StatusBadge>{detailLogs.length.toLocaleString("ko-KR")} logs</StatusBadge>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {detailLogs.map((log) => (
                  <div key={log.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-slate-500">
                      <span className="font-bold text-slate-700">{formatTime(log.created_at)}</span>
                      <StatusBadge tone={log.level === "error" ? "danger" : log.level === "warn" ? "warning" : "muted"}>{log.level || "info"}</StatusBadge>
                      <span className="font-semibold">{log.event_type || "log"}</span>
                      <span>{log.agent_name || "-"}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-slate-800">{log.message || "-"}</p>
                  </div>
                ))}
                {!detailLogs.length && <p className="py-4 text-center text-xs font-semibold text-slate-400">No automation_logs yet.</p>}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="log_text">
                <textarea className={`${modalTextareaClass} min-h-36 font-mono text-xs`} value={detailDraft.log_text} onChange={(event) => setDetailDraft((prev) => prev ? { ...prev, log_text: event.target.value } : prev)} />
              </FormField>
              <FormField label="error_message">
                <textarea className={`${modalTextareaClass} min-h-36`} value={detailDraft.error_message} onChange={(event) => setDetailDraft((prev) => prev ? { ...prev, error_message: event.target.value } : prev)} />
              </FormField>
            </div>
          </form>
        </FormModal>
      )}
    </div>
  );
}
