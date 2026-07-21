import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { envValue, loadEnvFiles } from "./env-utils.mjs";

const args = new Set(process.argv.slice(2));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
loadEnvFiles(repoRoot);
const origin = (process.env.FN_OS_ORIGIN || "https://fn-os.vercel.app").replace(/\/$/, "");
const executionOrigin = (process.env.FN_WORKER_EXECUTION_ORIGIN || process.env.FN_OS_EXECUTION_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
const workerId = process.env.FN_WORKER_ID || `${os.hostname()}-fn-worker`;
const pollMs = Math.max(1000, Number(process.env.FN_WORKER_POLL_MS || 5_000));
const jobType = process.env.FN_WORKER_JOB_TYPE || "";
const once = args.has("--once") || process.env.FN_WORKER_ONCE === "1";
const automationAgentToken = envValue("AUTOMATION_AGENT_TOKEN");
const localApiKey = envValue("FN_OS_API_KEY") || envValue("FN_OS_AUTH_TOKEN") || envValue("FN_OS_PASSWORD") || "fnos-local-dev";
const productionEnv = readEnvFile(path.join(repoRoot, ".env.vercel.production.local"));
const remoteApiKey = text(productionEnv.FN_OS_API_KEY || productionEnv.FN_OS_AUTH_TOKEN || productionEnv.FN_OS_PASSWORD) || localApiKey;

function now() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function appendLog(job, line) {
  return [text(job?.log_text), `[${now()}] ${line}`].filter(Boolean).join("\n");
}

async function request(path, init = {}) {
  return requestFrom(origin, path, {
    ...init,
    headers: {
      "x-automation-agent-token": automationAgentToken,
      ...(init.headers || {}),
    },
  });
}

async function requestFrom(baseUrl, path, init = {}) {
  const isExecutionOrigin = baseUrl === executionOrigin;
  const requestApiKey = isExecutionOrigin ? localApiKey : remoteApiKey;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(requestApiKey ? { "x-fnos-api-key": requestApiKey } : {}),
      ...(init.headers || {}),
    },
  });
  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {};
  }
  if (!response.ok || data?.ok === false) {
    const statusMessages = Array.isArray(data?.statuses)
      ? data.statuses.map((item) => text(item?.message)).filter(Boolean).join(" / ")
      : "";
    const resultMessages = Array.isArray(data?.results)
      ? data.results.map((item) => text(item?.message || item?.error)).filter(Boolean).join(" / ")
      : "";
    const fallbackMessage = responseText
      ? `${init.method || "GET"} ${path} failed: ${response.status} ${responseText.slice(0, 500)}`
      : `${init.method || "GET"} ${path} failed: ${response.status}`;
    throw new Error(data?.error || resultMessages || statusMessages || fallbackMessage);
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
  const preferredJobTypes = jobType
    ? [jobType]
    : ["collect_smartstore_orders", "collect_coupang_orders", "online_order_status_update"];
  for (const preferredJobType of preferredJobTypes) {
    const data = await request("/api/fnos/automation-jobs/claim", {
      method: "POST",
      body: JSON.stringify({ worker_id: workerId, ...(preferredJobType ? { job_type: preferredJobType } : {}) }),
    });
    if (data.job) return data.job;
  }
  return null;
}

async function runStubHandler(job) {
  const input = job.input_json && typeof job.input_json === "object" ? job.input_json : {};
  if (job.job_type === "collect_smartstore_orders" || job.job_type === "collect_coupang_orders") {
    const requestedChannelCode = text(input.channel_code);
    const data = await requestFrom(executionOrigin, "/api/fnos/online-orders/sync", {
      method: "POST",
      headers: { "x-fnos-worker-direct": "1" },
      body: JSON.stringify({
        ...input,
        ...(requestedChannelCode ? { channel_code: requestedChannelCode } : {}),
        worker_direct: true,
        use_worker: false,
      }),
    });
    const ok = data.ok !== false;
    const count = Number(data.count || (Array.isArray(data.orders) ? data.orders.length : 0));
    return {
      status: ok ? "success" : "failed",
      result_json: {
        ...data,
        worker_id: workerId,
        execution_origin: executionOrigin,
        handled_at: now(),
      },
      log_text: appendLog(job, `order collection ${ok ? "completed" : "failed"} via ${executionOrigin}: ${count} orders`),
      error_message: ok ? "" : text(data.error || data.message || "Order collection failed."),
    };
  }

  if (job.job_type === "online_order_status_update" && text(input.action) === "cleanup_manual_files") {
    const data = await requestFrom(executionOrigin, "/api/fnos/online-orders/manual-files/cleanup", {
      method: "POST",
      headers: { "x-fnos-worker-direct": "1" },
      body: JSON.stringify({
        ...input,
        worker_direct: true,
        use_worker: false,
      }),
    });
    const ok = data.ok !== false;
    return {
      status: ok ? "success" : "failed",
      result_json: {
        ...data,
        worker_id: workerId,
        execution_origin: executionOrigin,
        handled_at: now(),
      },
      log_text: appendLog(job, `manual order file cleanup ${ok ? "completed" : "failed"} via ${executionOrigin}`),
      error_message: ok ? "" : text(data.error || data.message || "Manual order file cleanup failed."),
    };
  }

  if (job.job_type === "online_order_status_update") {
    const data = await requestFrom(executionOrigin, "/api/fnos/online-orders/status", {
      method: "POST",
      headers: { "x-fnos-worker-direct": "1" },
      body: JSON.stringify({
        ...input,
        worker_direct: true,
        use_worker: false,
      }),
    });
    const ok = data.ok !== false;
    return {
      status: ok ? "success" : "failed",
      result_json: {
        ...data,
        worker_id: workerId,
        execution_origin: executionOrigin,
        handled_at: now(),
      },
      log_text: appendLog(job, `online order status update ${ok ? "completed" : "failed"} via ${executionOrigin}`),
      error_message: ok ? "" : text(data.error || data.message || "Online order status update failed."),
    };
  }

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
    const result = data.job?.result_json || values.result_json || {};
    const count = Number(result.count || (Array.isArray(result.orders) ? result.orders.length : 0));
    const itemCount = Number(result.item_count || 0);
    console.log(`[${now()}] updated ${job.id} -> ${data.job?.status || values.status} count=${count} item_count=${itemCount}`);
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
  console.log(`origin=${origin} execution_origin=${executionOrigin} worker_id=${workerId} poll_ms=${pollMs}${jobType ? ` job_type=${jobType}` : ""}`);

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

if (!automationAgentToken) {
  throw new Error("AUTOMATION_AGENT_TOKEN is required before automation worker polling can start.");
}

await main();
