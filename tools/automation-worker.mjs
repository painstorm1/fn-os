import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const args = new Set(process.argv.slice(2));
const origin = (process.env.FN_OS_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
const workerId = process.env.FN_WORKER_ID || `${os.hostname()}-fn-worker`;
const pollMs = Math.max(5000, Number(process.env.FN_WORKER_POLL_MS || 60_000));
const jobType = process.env.FN_WORKER_JOB_TYPE || "";
const once = args.has("--once") || process.env.FN_WORKER_ONCE === "1";

function now() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function jsonPreview(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function appendLog(job, line) {
  return [text(job?.log_text), `[${now()}] ${line}`].filter(Boolean).join("\n");
}

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `${init.method || "GET"} ${path} failed: ${response.status}`);
  }
  return data;
}

async function patchJob(job, values) {
  return request(`/api/fnos/automation-jobs/${encodeURIComponent(job.id)}`, {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

async function claimJob() {
  const data = await request("/api/fnos/automation-jobs/claim", {
    method: "POST",
    body: JSON.stringify({ worker_id: workerId, ...(jobType ? { job_type: jobType } : {}) }),
  });
  return data.job || null;
}

async function runStubHandler(job) {
  const input = job.input_json && typeof job.input_json === "object" ? job.input_json : {};
  const dryRun = input.dry_run === true || input.mode === "hello";
  const result = {
    worker_id: workerId,
    job_type: job.job_type,
    dry_run: dryRun,
    input,
    handled_at: now(),
  };

  if (dryRun) {
    return {
      status: "success",
      result_json: { ...result, message: "Worker dry-run completed." },
      log_text: appendLog(job, `dry-run completed for ${job.job_type}`),
      error_message: "",
    };
  }

  return {
    status: "waiting_approval",
    result_json: {
      ...result,
      message: "Worker is connected. Real site automation handler is not implemented yet.",
    },
    log_text: appendLog(job, `handler pending for ${job.job_type}`),
    error_message: "",
  };
}

async function processOne() {
  const job = await claimJob();
  if (!job) {
    console.log(`[${now()}] no queued job`);
    return false;
  }

  console.log(`[${now()}] claimed ${job.id} ${job.job_type} "${job.title}"`);
  try {
    const values = await runStubHandler(job);
    const data = await patchJob(job, values);
    console.log(`[${now()}] updated ${job.id} -> ${data.job?.status || values.status}`);
    console.log(jsonPreview(data.job?.result_json || values.result_json));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker execution failed.";
    await patchJob(job, {
      status: "failed",
      error_message: message,
      log_text: appendLog(job, `failed: ${message}`),
    }).catch((patchError) => {
      console.error(`[${now()}] failed to report job failure:`, patchError);
    });
    throw error;
  }
}

async function main() {
  console.log(`[${now()}] FN OS automation worker started`);
  console.log(`origin=${origin} worker_id=${workerId} poll_ms=${pollMs}${jobType ? ` job_type=${jobType}` : ""}`);

  while (true) {
    try {
      await processOne();
    } catch (error) {
      console.error(`[${now()}] worker error:`, error);
      if (once) process.exitCode = 1;
    }
    if (once) break;
    await delay(pollMs);
  }
}

await main();
