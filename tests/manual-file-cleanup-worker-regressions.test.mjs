import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pageSource = readFileSync(resolve(projectRoot, "src/app/page.tsx"), "utf8");

class TestNextResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.headers = new Headers(init.headers || {});
  }

  static next() { return { kind: "next" }; }
  static json(body, init = {}) { return new TestNextResponse(body, init); }
  static redirect(url) { return { kind: "redirect", url }; }
}

function executeTypeScriptModule(relativePath, mocks = {}) {
  const filename = resolve(projectRoot, relativePath);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const sourceModule = { exports: {} };
  const localRequire = (specifier) => Object.hasOwn(mocks, specifier) ? mocks[specifier] : createRequire(filename)(specifier);
  new Function("require", "module", "exports", compiled)(localRequire, sourceModule, sourceModule.exports);
  return sourceModule.exports;
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function loadCleanupPageFixture(jobStates) {
  const start = pageSource.indexOf("async function cleanupPendingManualOrderFilesAfterCompletion(");
  const end = pageSource.indexOf("async function changeSelectedOrderStatus(", start);
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(`
    ${pageSource.slice(start, end)}
    module.exports = { cleanupPendingManualOrderFilesAfterCompletion };
  `, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const cleared = [];
  const messages = [];
  const requests = [];
  let pollIndex = 0;
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (requests.length === 1) return response({ ok: true, queued: true, job_id: "cleanup-job", results: [] });
    const state = jobStates[Math.min(pollIndex, jobStates.length - 1)];
    pollIndex += 1;
    return response({ ok: true, job: state });
  };
  const dependencies = {
    completedPendingOnlineOrderManualFiles: () => ["fallback.xlsx"],
    normalizePendingOnlineOrderManualFileName: (value) => String(value ?? "").trim(),
    salesCellText: (value) => String(value ?? "").trim(),
    clearPendingOnlineOrderManualFiles: (files) => cleared.push(files),
    sheetsRef: { current: { "발주 진행 단계": [] } },
    setMessage: (updater) => messages.push(updater(messages.at(-1) || "")),
    fetch,
    window: { setTimeout: (callback) => callback() },
  };
  const sourceModule = { exports: {} };
  new Function("module", "exports", ...Object.keys(dependencies), compiled)(
    sourceModule,
    sourceModule.exports,
    ...Object.values(dependencies),
  );
  return {
    cleanup: sourceModule.exports.cleanupPendingManualOrderFilesAfterCompletion,
    cleared,
    messages,
    requests,
  };
}

async function runWorkerOnce(job, localResult) {
  const requests = [];
  let claimed = false;
  const server = createServer(async (request, res) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = bodyText ? JSON.parse(bodyText) : {};
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    res.setHeader("content-type", "application/json");
    if (request.url === "/api/fnos/automation-jobs/claim") {
      res.end(JSON.stringify({ ok: true, job: claimed ? null : job }));
      claimed = true;
      return;
    }
    if (request.url === "/api/fnos/online-orders/manual-files/cleanup" || request.url === "/api/fnos/online-orders/status") {
      res.end(JSON.stringify(localResult));
      return;
    }
    if (request.url === `/api/fnos/automation-jobs/${job.id}` && request.method === "PATCH") {
      res.end(JSON.stringify({ ok: true, job: { ...job, ...body } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "unexpected request" }));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await execFileAsync(process.execPath, [resolve(projectRoot, "tools/automation-worker.mjs"), "--once"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        AUTOMATION_AGENT_TOKEN: "fixture-worker-token",
        FN_OS_API_KEY: "fixture-local-token",
        FN_OS_ORIGIN: origin,
        FN_WORKER_EXECUTION_ORIGIN: origin,
        FN_WORKER_JOB_TYPE: "online_order_status_update",
        FN_WORKER_ONCE: "1",
      },
      timeout: 10_000,
    });
  } finally {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
  return requests;
}

test("Vercel cleanup POST는 basename 검증·중복제거 후 파일 접근 없이 worker job을 한 번 queue한다", async () => {
  const fsCalls = [];
  const jobs = [];
  const cleanupRoute = executeTypeScriptModule("src/app/api/fnos/online-orders/manual-files/cleanup/route.ts", {
    "next/server": { NextRequest: class NextRequest {}, NextResponse: TestNextResponse },
    "child_process": { execFile: () => { fsCalls.push("execFile"); } },
    "fs": { promises: new Proxy({}, { get: (_target, key) => async (...args) => { fsCalls.push([key, ...args]); } }) },
    "util": { promisify: () => async (...args) => { fsCalls.push(["promisified", ...args]); } },
    "@/lib/automation-jobs": { createAutomationJob: async (input) => { jobs.push(input); return { id: "cleanup-job" }; } },
  });
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    const result = await cleanupRoute.POST({ json: async () => ({
      files: ["C:\\outside\\orders.xlsx", "../orders.xlsx", "bad.exe", ".."],
      dry_run: true,
    }) });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, queued: true, job_id: "cleanup-job", results: [] });
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }

  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], {
    job_type: "online_order_status_update",
    title: "수동 주문파일 정리",
    requested_by: "sales_inventory",
    input_json: {
      action: "cleanup_manual_files",
      files: ["orders.xlsx"],
      dry_run: true,
      worker_direct: true,
      use_worker: false,
    },
  });
  assert.deepEqual(fsCalls, []);
});

test("Vercel cleanup POST는 direct 플래그와 무관하게 항상 queue하고 FS에 접근하지 않는다", async () => {
  const fsCalls = [];
  const jobs = [];
  const cleanupRoute = executeTypeScriptModule("src/app/api/fnos/online-orders/manual-files/cleanup/route.ts", {
    "next/server": { NextRequest: class NextRequest {}, NextResponse: TestNextResponse },
    "child_process": { execFile: () => { fsCalls.push("execFile"); } },
    "fs": { promises: new Proxy({}, { get: (_target, key) => async (...args) => { fsCalls.push([key, ...args]); } }) },
    "util": { promisify: () => async (...args) => { fsCalls.push(["promisified", ...args]); } },
    "@/lib/automation-jobs": { createAutomationJob: async (input) => { jobs.push(input); return { id: `cleanup-job-${jobs.length}` }; } },
  });
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    for (const flags of [
      { worker_direct: true },
      { run_direct: true },
      { use_worker: false },
    ]) {
      const result = await cleanupRoute.POST({ json: async () => ({ files: ["orders.xlsx"], ...flags }) });
      assert.equal(result.status, 200);
      assert.equal(result.body.queued, true);
    }
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }

  assert.equal(jobs.length, 3);
  assert.deepEqual(fsCalls, []);
});

test("worker cleanup action은 execution origin cleanup route를 호출하고 기존 status action은 status route를 유지한다", async () => {
  const cleanupRequests = await runWorkerOnce({
    id: "cleanup-worker-job",
    job_type: "online_order_status_update",
    title: "cleanup",
    input_json: { action: "cleanup_manual_files", files: ["orders.xlsx"], worker_direct: true, use_worker: false },
  }, { ok: true, results: [{ fileName: "orders.xlsx", status: "missing" }] });
  const cleanupCall = cleanupRequests.find(({ url }) => url === "/api/fnos/online-orders/manual-files/cleanup");
  assert.ok(cleanupCall);
  assert.equal(cleanupCall.headers["x-fnos-worker-direct"], "1");
  assert.equal(cleanupCall.body.worker_direct, true);
  assert.equal(cleanupCall.body.use_worker, false);
  assert.equal(cleanupRequests.filter(({ url }) => url === "/api/fnos/online-orders/status").length, 0);

  const statusRequests = await runWorkerOnce({
    id: "status-worker-job",
    job_type: "online_order_status_update",
    title: "status",
    input_json: { action: "confirm", rows: [{ orderId: "fixture" }], worker_direct: true, use_worker: false },
  }, { ok: true, results: [] });
  assert.equal(statusRequests.filter(({ url }) => url === "/api/fnos/online-orders/status").length, 1);
  assert.equal(statusRequests.filter(({ url }) => url === "/api/fnos/online-orders/manual-files/cleanup").length, 0);
});

test("cleanup page는 same-origin queue를 poll하고 실제 resolved 파일만 pending에서 지운다", async () => {
  const fixture = loadCleanupPageFixture([
    { status: "queued" },
    {
      status: "success",
      result_json: {
        ok: true,
        recycled: ["done.xlsx"],
        archived: [],
        results: [
          { fileName: "done.xlsx", status: "recycled" },
          { fileName: "retry.xlsx", status: "failed" },
          { fileName: "unexpected.xlsx", status: "missing" },
        ],
      },
    },
  ]);

  await fixture.cleanup(["done.xlsx", "retry.xlsx"]);

  assert.deepEqual(fixture.cleared, [["done.xlsx"]]);
  assert.equal(fixture.requests[0].url, "/api/fnos/online-orders/manual-files/cleanup");
  assert.equal(fixture.requests[0].init.mode, "same-origin");
  assert.equal(fixture.requests[0].init.credentials, "include");
  assert.deepEqual(JSON.parse(fixture.requests[0].init.body), { files: ["done.xlsx", "retry.xlsx"] });
  assert.equal(fixture.requests[1].url, "/api/fnos/automation-jobs/cleanup-job");
  assert.ok(fixture.requests.every(({ url }) => !String(url).includes("127.0.0.1:3000")));
});

test("cleanup job 실패·취소·승인대기·timeout·resolved 0건은 pending을 보존한다", async (t) => {
  for (const status of ["failed", "cancelled", "waiting_approval"]) {
    await t.test(status, async () => {
      const fixture = loadCleanupPageFixture([{ status, error_message: `${status} fixture` }]);
      await fixture.cleanup(["keep.xlsx"]);
      assert.deepEqual(fixture.cleared, []);
      assert.match(fixture.messages.at(-1), /자동 정리 실패/);
    });
  }

  await t.test("timeout", async () => {
    const fixture = loadCleanupPageFixture([{ status: "queued" }]);
    await fixture.cleanup(["keep.xlsx"]);
    assert.deepEqual(fixture.cleared, []);
    assert.equal(fixture.requests.length, 181);
    assert.match(fixture.messages.at(-1), /자동 정리 실패/);
  });

  await t.test("success with zero resolved", async () => {
    const fixture = loadCleanupPageFixture([{ status: "success", result_json: { ok: true, results: [] } }]);
    await fixture.cleanup(["keep.xlsx"]);
    assert.deepEqual(fixture.cleared, []);
    assert.match(fixture.messages.at(-1), /자동 정리 실패/);
  });

  await t.test("success status with failed result", async () => {
    const fixture = loadCleanupPageFixture([{
      status: "success",
      result_json: {
        ok: false,
        error: "malformed terminal failure",
        results: [{ fileName: "keep.xlsx", status: "missing" }],
      },
    }]);
    await fixture.cleanup(["keep.xlsx"]);
    assert.deepEqual(fixture.cleared, []);
    assert.match(fixture.messages.at(-1), /malformed terminal failure/);
  });
});

test("worker-direct local cleanup은 허용 폴더 basename만 dry-run 조회하고 파일 mutation은 하지 않는다", async () => {
  const previousDir = process.env.FNOS_MANUAL_ORDER_DIR;
  const previousVercel = process.env.VERCEL;
  process.env.FNOS_MANUAL_ORDER_DIR = resolve(projectRoot, ".fixture-manual-files");
  delete process.env.VERCEL;
  const calls = [];
  try {
    const cleanupRoute = executeTypeScriptModule("src/app/api/fnos/online-orders/manual-files/cleanup/route.ts", {
      "next/server": { NextRequest: class NextRequest {}, NextResponse: TestNextResponse },
      "child_process": { execFile: () => calls.push("execFile") },
      "fs": { promises: {
        stat: async (filePath) => { calls.push(["stat", filePath]); return { isFile: () => true }; },
        mkdir: async (...args) => calls.push(["mkdir", ...args]),
        rename: async (...args) => calls.push(["rename", ...args]),
      } },
      "util": { promisify: () => async (...args) => calls.push(["promisified", ...args]) },
      "@/lib/automation-jobs": { createAutomationJob: async () => { throw new Error("must not queue"); } },
    });
    const result = await cleanupRoute.POST({ json: async () => ({
      action: "cleanup_manual_files",
      files: ["..\\outside\\orders.xlsx", "../../bad.exe"],
      dry_run: true,
      worker_direct: true,
      use_worker: false,
    }) });
    assert.equal(result.body.ok, true);
    assert.deepEqual(result.body.results, [{ fileName: "orders.xlsx", status: "dry_run" }]);
    assert.deepEqual(calls, [["stat", resolve(process.env.FNOS_MANUAL_ORDER_DIR, "orders.xlsx")]]);
  } finally {
    if (previousDir === undefined) delete process.env.FNOS_MANUAL_ORDER_DIR;
    else process.env.FNOS_MANUAL_ORDER_DIR = previousDir;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("worker-direct cleanup 중복 요청은 두 번째 mutation 없이 missing으로 멱등 처리한다", async () => {
  const previousDir = process.env.FNOS_MANUAL_ORDER_DIR;
  const previousVercel = process.env.VERCEL;
  process.env.FNOS_MANUAL_ORDER_DIR = resolve(projectRoot, ".fixture-manual-files");
  delete process.env.VERCEL;
  let statCalls = 0;
  let recycleCalls = 0;
  try {
    const cleanupRoute = executeTypeScriptModule("src/app/api/fnos/online-orders/manual-files/cleanup/route.ts", {
      "next/server": { NextRequest: class NextRequest {}, NextResponse: TestNextResponse },
      "child_process": { execFile: () => {} },
      "fs": { promises: {
        stat: async () => {
          statCalls += 1;
          if (statCalls === 1) return { isFile: () => true };
          const error = new Error("already removed");
          error.code = "ENOENT";
          throw error;
        },
        mkdir: async () => { throw new Error("archive must not run"); },
        rename: async () => { throw new Error("archive must not run"); },
      } },
      "util": { promisify: () => async () => { recycleCalls += 1; } },
      "@/lib/automation-jobs": { createAutomationJob: async () => { throw new Error("must not queue"); } },
    });
    const request = () => ({ json: async () => ({
      action: "cleanup_manual_files",
      files: ["orders.xlsx"],
      worker_direct: true,
      use_worker: false,
    }) });

    const first = await cleanupRoute.POST(request());
    const second = await cleanupRoute.POST(request());

    assert.deepEqual(first.body.results, [{ fileName: "orders.xlsx", status: "recycled", message: "휴지통으로 이동" }]);
    assert.deepEqual(second.body.results, [{ fileName: "orders.xlsx", status: "missing", message: "이미 정리되었거나 파일이 없습니다." }]);
    assert.equal(recycleCalls, 1);
    assert.equal(statCalls, 2);
  } finally {
    if (previousDir === undefined) delete process.env.FNOS_MANUAL_ORDER_DIR;
    else process.env.FNOS_MANUAL_ORDER_DIR = previousDir;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("production browser용 cleanup loopback CORS 예외는 제거되고 worker direct만 proxy를 통과한다", () => {
  const { proxy } = executeTypeScriptModule("proxy.ts", {
    "next/server": { NextRequest: class NextRequest {}, NextResponse: TestNextResponse },
  });
  const makeRequest = ({ method = "POST", workerDirect = false } = {}) => ({
    method,
    nextUrl: new URL("http://127.0.0.1:3000/api/fnos/online-orders/manual-files/cleanup"),
    headers: new Headers(workerDirect ? { "x-fnos-worker-direct": "1" } : {
      Origin: "https://fn-os.vercel.app",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type, x-fnos-local-bridge",
    }),
    cookies: { get: () => undefined },
  });

  assert.equal(proxy(makeRequest({ method: "OPTIONS" })).status, 401);
  assert.equal(proxy({
    ...makeRequest(),
    headers: new Headers({ Origin: "https://fn-os.vercel.app", "x-fnos-local-bridge": "1" }),
  }).status, 401);
  assert.equal(proxy(makeRequest({ workerDirect: true })).kind, "next");
});
