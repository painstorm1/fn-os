import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function execute(relativePath, mocks = {}) {
  const filename = resolve(root, relativePath);
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (name) => Object.hasOwn(mocks, name) ? mocks[name] : createRequire(filename)(name);
  new Function("require", "exports", "module", compiled)(localRequire, mod.exports, mod);
  return mod.exports;
}

const shared = execute("src/lib/automation-jobs-shared.ts");

function createHarness() {
  const calls = { inserts: [], patches: [], selects: [] };
  class FnosDbError extends Error {
    constructor(message, status = 500) {
      super(message);
      this.status = status;
    }
  }
  const db = {
    FnosDbError,
    hasDbConfig: () => true,
    insertRows: async (table, values) => {
      calls.inserts.push({ table, values });
      return [{ id: "inserted", ...values }];
    },
    patchRows: async (table, filters, values) => {
      calls.patches.push({ table, filters, values });
      if (table === "automation_jobs" && filters.id === "eq.order-job") {
        return [{ id: "order-job", job_type: "online_order_status_update", status: "running", ...values }];
      }
      return [];
    },
    selectRows: async (table, query) => {
      calls.selects.push({ table, query });
      if (table === "automation_jobs" && query.assigned_agent === "eq.worker" && query.status === "eq.queued") {
        return [
          { id: "legacy-job", job_type: "knowledge_action", status: "queued", assigned_agent: "worker" },
          { id: "order-job", job_type: "online_order_status_update", status: "queued", assigned_agent: "worker" },
        ];
      }
      return [];
    },
    upsertRows: async () => [],
  };
  return { calls, automation: execute("src/lib/automation-jobs.ts", { "./fnos-db": db, "./automation-jobs-shared": shared }) };
}

for (const jobType of ["knowledge_daily_capture", "knowledge_action", "product_card_upsert"]) {
  test(`FNOS는 retired Cooljam ${jobType} 생성·직접 claim을 거부한다`, async () => {
    const { calls, automation } = createHarness();
    await assert.rejects(() => automation.createAutomationJob({ job_type: jobType }), /독립 지식센터/);
    await assert.rejects(() => automation.createAutomationRun({ task_type: jobType }), /독립 지식센터/);
    await assert.rejects(() => automation.claimNextAutomationJob({ job_type: jobType, worker_id: "worker" }), /독립 지식센터/);
    assert.equal(calls.inserts.length, 0);
    assert.equal(calls.patches.length, 0);
    assert.equal(calls.selects.length, 0);
  });
}

test("FNOS 직접 claim은 무타입 catch-all을 거부한다", async () => {
  const { calls, automation } = createHarness();
  await assert.rejects(() => automation.claimNextAutomationJob({ worker_id: "worker" }), /작업 유형/);
  assert.equal(calls.selects.length, 0);
});

test("agent claim은 queued Cooljam 이력을 건너뛰고 FNOS 작업만 점유한다", async () => {
  const { calls, automation } = createHarness();
  const claimed = await automation.claimNextAutomationJobForAgent("worker");
  assert.equal(claimed.id, "order-job");
  assert.equal(claimed.job_type, "online_order_status_update");
  assert.deepEqual(calls.patches.map((call) => call.filters.id), ["eq.order-job"]);
});
