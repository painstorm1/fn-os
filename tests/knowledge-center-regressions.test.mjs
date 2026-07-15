import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(resolve(root, path), "utf8");

function execute(relativePath, mocks = {}) {
  const filename = resolve(root, relativePath);
  const compiled = ts.transpileModule(source(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (name) => Object.hasOwn(mocks, name) ? mocks[name] : createRequire(filename)(name);
  new Function("require", "exports", "module", compiled)(localRequire, mod.exports, mod);
  return mod.exports;
}

const dbMock = {
  FnosDbError: class FnosDbError extends Error { constructor(message, status = 500) { super(message); this.status = status; } },
  hasDbConfig: () => true,
  insertRows: async () => [],
  patchRows: async () => [],
  selectRows: async () => [],
  upsertRows: async () => [],
};
const knowledge = execute("src/lib/knowledge-center.ts", {
  "./fnos-db": dbMock,
  "./automation-jobs": { createAutomationJob: async () => ({ id: "job-1" }) },
});

test("지식 판정은 4개 action만 허용하고 상태/확정 방식을 고정한다", () => {
  assert.deepEqual(knowledge.normalizeKnowledgeDecision("pending"), { action: "pending", status: "pending", confirmation_method: null });
  assert.deepEqual(knowledge.normalizeKnowledgeDecision("rejected"), { action: "rejected", status: "rejected", confirmation_method: null });
  assert.deepEqual(knowledge.normalizeKnowledgeDecision("confirm_new"), { action: "confirm_new", status: "confirmed", confirmation_method: "new" });
  assert.deepEqual(knowledge.normalizeKnowledgeDecision("confirm_merge"), { action: "confirm_merge", status: "confirmed", confirmation_method: "merge" });
  assert.throws(() => knowledge.normalizeKnowledgeDecision("delete"), /지원하지 않는/);
});

test("Obsidian 상대 경로는 traversal/절대경로를 거부하고 md만 허용한다", () => {
  assert.equal(knowledge.safeVaultRelativePath("03_INBOX/Resource_Triage_Cards/2026-07-15/card.md"), "03_INBOX/Resource_Triage_Cards/2026-07-15/card.md");
  for (const bad of ["../secret.md", "D:/secret.md", "/secret.md", "folder/file.txt", "folder/../../secret.md", "folder\\..\\secret.md"]) {
    assert.throws(() => knowledge.safeVaultRelativePath(bad), /경로/);
  }
});

test("Supabase 미리보기 계약은 500자로 제한하고 본문/첨부 필드를 만들지 않는다", () => {
  assert.equal(knowledge.truncateKnowledgePreview(" a  b \n c "), "a b c");
  assert.equal(knowledge.truncateKnowledgePreview("가".repeat(600)).length, 500);
  const schema = source("schema_sales_inventory.sql");
  const block = schema.slice(schema.indexOf("create table if not exists knowledge_index"), schema.indexOf("create table if not exists knowledge_daily_entries"));
  assert.match(block, /preview varchar\(500\)/i);
  assert.doesNotMatch(block, /\b(body|content|attachment|file_url)\b/i);
});

test("schema와 shared worker 계약에 daily/knowledge/product job type과 정본 index가 연결된다", () => {
  const schema = source("schema_sales_inventory.sql");
  const migration = source("migrations/20260715_cooljam_knowledge_center.sql");
  const shared = source("src/lib/automation-jobs-shared.ts");
  const worker = source("tools/automation-worker.mjs");
  assert.match(schema, /create table if not exists knowledge_index/i);
  assert.match(schema, /create table if not exists knowledge_daily_entries/i);
  for (const field of ["category", "source_date", "value_score", "target_hint"]) assert.match(schema, new RegExp(`\\b${field}\\b`));
  assert.match(migration, /begin;[\s\S]*knowledge_daily_capture[\s\S]*knowledge_action[\s\S]*product_card_upsert[\s\S]*source_ref[\s\S]*commit;/i);
  assert.equal((schema.match(/'knowledge_action'/g) || []).length, 2);
  assert.match(schema, /'product_card_upsert'/);
  assert.equal((schema.match(/'knowledge_daily_capture'/g) || []).length, 2);
  assert.match(schema, /idx_knowledge_index_source_date/);
  assert.match(schema, /idx_knowledge_index_value_score/);
  assert.match(schema, /source_ref text/);
  assert.match(shared, /"knowledge_action"/);
  assert.match(shared, /"product_card_upsert"/);
  assert.match(shared, /"knowledge_daily_capture"/);
  assert.match(worker, /fnos_knowledge_daily_worker\.py/);
  assert.match(worker, /tools", "fnos_knowledge_action_worker\.py/);
  assert.match(worker, /timeoutMs = 330_000/);
  assert.match(worker, /maxOutput = 1_000_000/);
  assert.match(worker, /spawnFile/);
  const priority = worker.match(/const preferredJobTypes = jobType[\s\S]*?for \(const preferredJobType/)?.[0] || "";
  assert.ok(priority.indexOf("collect_smartstore_orders") < priority.indexOf("knowledge_action"), "주문 작업이 지식 작업보다 먼저 claim되어야 한다");
  assert.doesNotMatch(worker, /exec\(|shell:\s*true/);
});

test("제품 카드 요청은 FNOS 직수입 연결과 판매채널을 권위 원천으로 읽고 MiniPC 큐/지식 색인을 만든다", async () => {
  const jobs = [];
  const inserts = [];
  const productModule = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async (table) => {
        if (table === "products") return [{ id: "product-1", product_code: "FN001", product_name: "직수입 제품", status: "active", is_active: true }];
        if (table === "import_product_sku_links") return [{ id: "link-1", product_id: "product-1", import_product_id: "11", import_option_name: "블랙" }];
        if (table === "import_erp_products") return [{ id: "11", name: "수입품", options: "30cm", product_url: "https://example.com/source" }];
        if (table === "sales_channel_product_mappings") return [{ id: "mapping-1", fn_product_id: "product-1", channel_name: "스마트스토어", mall_product_key: "mall-1" }];
        if (table === "knowledge_index") return inserts.length ? [{ id: "knowledge-product-1", processing_status: "idle", automation_job_id: null }] : [];
        return [];
      },
      insertRows: async (table, values) => { inserts.push({ table, values }); return [{ id: "knowledge-product-1", ...values }]; },
      patchRows: async (_table, _filters, values) => [{ id: "knowledge-product-1", ...values }],
    },
    "./automation-jobs": {
      createAutomationJob: async (values) => { jobs.push(values); return { id: "job-product-1", status: values.status }; },
      updateAutomationJob: async (id, values) => ({ id, ...values }),
    },
  });
  const result = await productModule.createProductCardRequest({ product_id: "product-1", image_source: "D:/FN_images/FN001.png", image_notes: "포장 표시 30cm" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].job_type, "product_card_upsert");
  assert.equal(jobs[0].status, "waiting_approval");
  assert.equal(jobs[0].input_json.product.product_code, "FN001");
  assert.equal(jobs[0].input_json.import_products[0].options, "30cm");
  assert.equal(jobs[0].input_json.sales_mappings[0].channel_name, "스마트스토어");
  assert.equal(inserts[0].values.source_type, "fnos-product");
  assert.equal(inserts[0].values.source_ref, "product-1");
  assert.match(inserts[0].values.obsidian_path, /^50_BUSINESS_KNOWLEDGE\/Products\/Cards\//);
  assert.equal(result.job.id, "job-product-1");
});

test("제품 카드 처리기는 제품 폴더/이미지 허용 루트/readback/사용자 메모 보존 계약을 갖는다", () => {
  const processor = source("tools/fnos_product_card_worker.py");
  const worker = source("tools/automation-worker.mjs");
  assert.match(processor, /50_BUSINESS_KNOWLEDGE\/Products\/Cards/);
  assert.match(processor, /90_RESOURCES\/Product_Images/);
  assert.match(processor, /AUTO_PRODUCT_CARD_START/);
  assert.match(processor, /preserve_manual_tail/);
  assert.match(processor, /readback verification failed/);
  assert.match(processor, /outside the allowed roots/);
  assert.match(worker, /product_card_upsert/);
  assert.match(worker, /fnos_product_card_worker\.py/);
  assert.doesNotMatch(processor, /shell=True|os\.system|subprocess/);
});

test("지식 판정은 knowledge_action 큐를 만든 뒤 같은 항목에 상태/작업 ID를 연결한다", async () => {
  const patches = [];
  const jobs = [];
  const knowledgeModule = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async () => [{ id: "knowledge-1", title: "fixture", source_card_path: "03_INBOX/Resource_Triage_Cards/2026-07-15/card.md" }],
      patchRows: async (_table, filters, values) => { patches.push({ filters, values }); return [{ id: "knowledge-1", ...values }]; },
    },
    "./automation-jobs": {
      createAutomationJob: async (values) => { jobs.push(values); return { id: "job-1", status: values.status }; },
      updateAutomationJob: async (id, values) => ({ id, ...values }),
    },
  });
  const result = await knowledgeModule.decideKnowledgeItem({ id: "knowledge-1", action: "confirm_new", target_path: "20_BUSINESS/Knowledge/new.md" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].job_type, "knowledge_action");
  assert.equal(jobs[0].status, "waiting_approval");
  assert.equal(jobs[0].input_json.source_card_path, "03_INBOX/Resource_Triage_Cards/2026-07-15/card.md");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].values.status, "confirmed");
  assert.equal(patches[0].values.processing_status, "queued");
  assert.equal(patches[0].values.automation_job_id, "job-1");
  assert.equal(result.job.id, "job-1");
});

test("지식센터 API의 모든 handler는 body/DB 접근 전 공통 인증을 수행하고 receipt는 agent token을 추가 요구한다", () => {
  const route = source("src/app/api/fnos/knowledge-center/route.ts");
  assert.equal((route.match(/assertAutomationJobAuth\(request\)/g) || []).length, 3);
  for (const method of ["GET", "POST", "PATCH"]) {
    const start = route.indexOf(`export async function ${method}`);
    const end = route.indexOf("\nexport async function ", start + 1);
    const handler = route.slice(start, end < 0 ? route.length : end);
    assert.ok(handler.indexOf("assertAutomationJobAuth(request)") < handler.search(/await (request|listKnowledge|createKnowledge|decideKnowledge|retryKnowledge|applyKnowledge)/));
  }
  assert.match(route, /body\.action === "receipt"[\s\S]*assertAutomationAgentAuth\(request\)[\s\S]*applyKnowledgeReceipt/);
});

test("검색 필터 문법은 PostgREST 예약문자를 제거한다", () => {
  assert.equal(knowledge.normalizeKnowledgeSearch(" 쿠팡),status.eq.confirmed* "), "쿠팡 status eq confirmed");
});

test("개인은 두 전용 루트를 허용하고 회사는 두 루트를 모두 거부한다", async () => {
  const jobs = [];
  const moduleForScope = (scope) => execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async () => [{ id: `knowledge-${scope}`, scope, title: "fixture", source_card_path: "03_INBOX/Resource_Triage_Cards/2026-07-15/card.md" }],
      patchRows: async (_table, _filters, values) => [{ id: `knowledge-${scope}`, ...values }],
    },
    "./automation-jobs": {
      createAutomationJob: async (values) => { jobs.push(values); return { id: `job-${jobs.length}`, status: values.status }; },
      updateAutomationJob: async (id, values) => ({ id, ...values }),
    },
  });
  await assert.rejects(() => moduleForScope("company").decideKnowledgeItem({ id: "knowledge-company", action: "confirm_new", target_path: "99_PRIVATE/secret.md" }), /99_PRIVATE/);
  await assert.rejects(() => moduleForScope("company").decideKnowledgeItem({ id: "knowledge-company", action: "confirm_new", target_path: "99_private/secret.md" }), /99_PRIVATE/);
  await assert.rejects(() => moduleForScope("company").decideKnowledgeItem({ id: "knowledge-company", action: "confirm_new", target_path: "80_PERSONAL_EXECUTION/private.md" }), /80_PERSONAL_EXECUTION/);
  await assert.rejects(() => moduleForScope("personal").decideKnowledgeItem({ id: "knowledge-personal", action: "confirm_new", target_path: "10_FN_OS/public.md" }), /80_PERSONAL_EXECUTION/);
  await moduleForScope("personal").decideKnowledgeItem({ id: "knowledge-personal", action: "confirm_new", target_path: "80_PERSONAL_EXECUTION/notes/one.md" });
  await moduleForScope("personal").decideKnowledgeItem({ id: "knowledge-personal", action: "confirm_new", target_path: "99_PRIVATE/notes/two.md" });
  assert.equal(jobs.length, 2);
});

test("page.tsx는 아카이브 중복 메뉴 없이 knowledge와 archive alias를 같은 workspace로 연다", () => {
  const page = source("src/app/page.tsx");
  assert.match(page, /import\("\.\/knowledge-center-workspace"\)/);
  assert.match(page, /"Cooljam 지식센터"/);
  assert.match(page, /"Cooljam 지식센터": "knowledge"/);
  assert.match(page, /activeSlug === "knowledge" \|\| activeSlug === "archive"/);
  assert.doesNotMatch(page.slice(page.indexOf("const mainMenus"), page.indexOf("const importSubMenus")), /"아카이브"/);
});

test("Cooljam 제품 리스트 도구는 직수입 FNOS 데이터·판매채널·이미지→카드 큐와 readback 상태를 연결한다", () => {
  const workspace = source("src/app/knowledge-center-workspace.tsx");
  const products = source("src/app/product-knowledge-workspace.tsx");
  const master = source("src/app/api/fnos/products/master/route.ts");
  const mappingsRoute = source("src/app/api/fnos/sales-channel-product-mappings/route.ts");
  assert.match(workspace, /\["products", "제품 리스트"\]/);
  assert.match(workspace, /ProductKnowledgeWorkspace/);
  assert.match(products, /relation=import/);
  assert.match(products, /sales-channel-product-mappings/);
  assert.match(products, /action: "product_card_request"/);
  assert.match(products, /옵시디언에 아이템 등록해줘/);
  assert.match(products, /카드 등록 완료/);
  for (const field of ["product_url", "options", "hs_code", "moq", "source_price"]) assert.match(master, new RegExp(`${field}:`));
  for (const functionName of ["importLinkRows", "importProductRows"]) {
    const block = master.slice(master.indexOf(`async function ${functionName}`), master.indexOf("\n}", master.indexOf(`async function ${functionName}`)) + 2);
    assert.doesNotMatch(block, /\.catch\(\(\) => \[\]\)/);
  }
  for (const functionName of ["activeChannelLookup", "activeProductLookup"]) {
    const block = mappingsRoute.slice(mappingsRoute.indexOf(`async function ${functionName}`), mappingsRoute.indexOf("\n}", mappingsRoute.indexOf(`async function ${functionName}`)) + 2);
    assert.doesNotMatch(block, /\.catch\(\(\) => \[\]\)/);
  }
});

test("검토함은 날짜·카테고리·추천순·일괄 판정과 readback 성공 지식만 노출한다", () => {
  const workspace = source("src/app/knowledge-center-workspace.tsx");
  assert.match(workspace, /aria-label="자료 날짜"/);
  assert.match(workspace, /aria-label="카테고리"/);
  assert.match(workspace, /중요도·추천순/);
  assert.match(workspace, /bulkDecision\("pending"\)/);
  assert.match(workspace, /bulkDecision\("rejected"\)/);
  assert.match(workspace, /item\.status === "confirmed" && item\.processing_status === "success"/);
  assert.match(workspace, /action: "update_title"/);
});

test("KST 오늘 경계와 오늘 입력 목록 쿼리를 고정한다", async () => {
  assert.equal(knowledge.knowledgeTodayKst(new Date("2026-07-15T14:59:59.999Z")), "2026-07-15");
  assert.equal(knowledge.knowledgeTodayKst(new Date("2026-07-15T15:00:00.000Z")), "2026-07-16");
  const queries = [];
  const todayModule = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": { ...dbMock, selectRows: async (table, query) => { queries.push({ table, query }); return []; } },
    "./automation-jobs": { createAutomationJob: async () => ({ id: "job-1" }), updateAutomationJob: async () => null },
  });
  await todayModule.listKnowledgeCenter();
  const dailyQuery = queries.find(({ table }) => table === "knowledge_daily_entries")?.query;
  assert.match(dailyQuery.entry_date, /^eq\.\d{4}-\d{2}-\d{2}$/);
  assert.equal(dailyQuery.order, "created_at.desc");
  const workspace = source("src/app/knowledge-center-workspace.tsx");
  const route = source("src/app/api/fnos/knowledge-center/route.ts");
  assert.match(workspace, /entry\.processing_status === "success"[\s\S]*Obsidian 열기/);
  assert.match(route, /body\.daily_id[\s\S]*applyKnowledgeDailyReceipt/);
});

test("Windows/UNC/colon/traversal vault escape를 서버 공통 경로 검증에서 거부한다", () => {
  for (const bad of [
    "../secret.md",
    "C:/secret.md",
    "C:secret.md",
    "\\\\server\\share\\secret.md",
    "folder/name:secret.md",
    "folder/../../secret.md",
    "folder\\..\\secret.md",
    "folder/nul\0secret.md",
  ]) assert.throws(() => knowledge.safeVaultRelativePath(bad), /경로/);
});

test("receipt는 현재 automation_job_id와 결합되고 조건부 patch로 race를 방어한다", async () => {
  const patches = [];
  const receiptModule = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async () => [{ id: "knowledge-1", scope: "company", automation_job_id: "job-current", obsidian_path: "20_BUSINESS/current.md" }],
      patchRows: async (_table, filters, values) => { patches.push({ filters, values }); return [{ id: "knowledge-1", ...values }]; },
    },
    "./automation-jobs": { createAutomationJob: async () => ({ id: "job-1" }), updateAutomationJob: async () => null },
  });
  await assert.rejects(
    () => receiptModule.applyKnowledgeReceipt({ id: "knowledge-1", receipt: { job_id: "job-stale" } }),
    (error) => error.status === 409,
  );
  assert.equal(patches.length, 0);
  await receiptModule.applyKnowledgeReceipt({ id: "knowledge-1", receipt: { job_id: "job-current", target_path: "20_BUSINESS/current.md" } });
  assert.deepEqual(patches[0].filters, { id: "eq.knowledge-1", automation_job_id: "eq.job-current" });

  const racedModule = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async () => [{ id: "knowledge-1", scope: "company", automation_job_id: "job-current" }],
      patchRows: async () => [],
    },
    "./automation-jobs": { createAutomationJob: async () => ({ id: "job-1" }), updateAutomationJob: async () => null },
  });
  await assert.rejects(
    () => racedModule.applyKnowledgeReceipt({ id: "knowledge-1", receipt: { job_id: "job-current" } }),
    (error) => error.status === 409,
  );
});

test("queue/index 연결 실패는 지식과 생성된 작업을 failed로 보상한다", async () => {
  const patches = [];
  const jobUpdates = [];
  const compensationModule = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async () => [{ id: "knowledge-1", scope: "company", title: "fixture", source_card_path: "03_INBOX/Resource_Triage_Cards/2026-07-15/card.md" }],
      patchRows: async (_table, filters, values) => {
        patches.push({ filters, values });
        return patches.length === 1 ? [] : [{ id: "knowledge-1", ...values }];
      },
    },
    "./automation-jobs": {
      createAutomationJob: async () => ({ id: "job-orphan" }),
      updateAutomationJob: async (id, values) => { jobUpdates.push({ id, values }); },
    },
  });
  await assert.rejects(
    () => compensationModule.decideKnowledgeItem({ id: "knowledge-1", action: "pending" }),
    (error) => error.status === 409,
  );
  assert.equal(jobUpdates[0].id, "job-orphan");
  assert.equal(jobUpdates[0].values.status, "failed");
  assert.equal(patches[0].filters.processing_status, "eq.idle");
  assert.equal(patches[0].filters.automation_job_id, "is.null");
  assert.equal(patches[1].filters.automation_job_id, "eq.job-orphan");
  assert.equal(patches[1].values.processing_status, "failed");
  assert.equal(patches[1].values.automation_job_id, undefined);
});

test("제품 카드 queue/index 연결 실패도 idle 색인과 failed 작업으로 보상한다", async () => {
  const inserts = [];
  const patches = [];
  const jobUpdates = [];
  const productCompensation = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async (table) => {
        if (table === "products") return [{ id: "product-1", product_code: "FN001", product_name: "직수입 제품", status: "active", is_active: true }];
        if (table === "import_product_sku_links") return [{ import_product_id: "import-1" }];
        if (table === "knowledge_index") return inserts.length ? [{ id: "knowledge-product-1", processing_status: "idle", automation_job_id: null }] : [];
        return [];
      },
      insertRows: async (_table, values) => { inserts.push(values); return [{ id: "knowledge-product-1", ...values }]; },
      patchRows: async (_table, filters, values) => {
        patches.push({ filters, values });
        return patches.length === 1 ? [] : [{ id: "knowledge-product-1", ...values }];
      },
    },
    "./automation-jobs": {
      createAutomationJob: async () => ({ id: "job-product-orphan" }),
      updateAutomationJob: async (id, values) => { jobUpdates.push({ id, values }); },
    },
  });
  await assert.rejects(
    () => productCompensation.createProductCardRequest({ product_id: "product-1" }),
    (error) => error.status === 409,
  );
  assert.equal(inserts[0].processing_status, "idle");
  assert.equal(inserts[0].automation_job_id, null);
  assert.equal(jobUpdates[0].id, "job-product-orphan");
  assert.equal(jobUpdates[0].values.status, "failed");
  assert.equal(patches[0].filters.processing_status, "eq.idle");
  assert.equal(patches[0].filters.automation_job_id, "is.null");
  assert.equal(patches[1].filters.automation_job_id, "eq.job-product-orphan");
  assert.equal(patches[1].values.processing_status, "failed");
});

test("오늘 입력은 DB idle→daily queue CAS→고정 경로 receipt readback으로 완료되고 active 재요청을 막는다", async () => {
  let row = null;
  const jobs = [];
  const patches = [];
  const dailyModule = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      insertRows: async (table, values) => {
        assert.equal(table, "knowledge_daily_entries");
        row = { id: "daily-1", ...values };
        return [row];
      },
      selectRows: async (table) => table === "knowledge_daily_entries" && row ? [row] : [],
      patchRows: async (table, filters, values) => {
        patches.push({ table, filters, values });
        if (filters.automation_job_id === "is.null" && row.automation_job_id !== null) return [];
        if (String(filters.automation_job_id || "").startsWith("eq.") && filters.automation_job_id !== `eq.${row.automation_job_id}`) return [];
        row = { ...row, ...values };
        return [row];
      },
    },
    "./automation-jobs": {
      createAutomationJob: async (values) => { jobs.push(values); return { id: "job-daily-1" }; },
      updateAutomationJob: async (id, values) => ({ id, ...values }),
    },
  });
  const queued = await dailyModule.createKnowledgeDailyEntry({ title: "오늘 메모", preview: "입력 원문", entry_date: "2026-07-16", scope: "company" });
  assert.equal(queued.saved.processing_status, "queued");
  assert.equal(jobs[0].job_type, "knowledge_daily_capture");
  assert.equal(jobs[0].status, "waiting_approval");
  assert.equal(jobs[0].input_json.target_path, "03_INBOX/Daily_Inbox/2026-07-16/FNOS-daily-1.md");
  assert.deepEqual(patches[0].filters, { id: "eq.daily-1", processing_status: "eq.idle", automation_job_id: "is.null" });
  await assert.rejects(() => dailyModule.createKnowledgeDailyEntry({ daily_id: "daily-1" }), (error) => error.status === 409);
  assert.equal(jobs.length, 1);
  const saved = await dailyModule.applyKnowledgeDailyReceipt({
    daily_id: "daily-1",
    receipt: { job_id: "job-daily-1", target_path: jobs[0].input_json.target_path, readback_verified: true },
  });
  assert.equal(saved.processing_status, "success");
  assert.equal(saved.obsidian_path, jobs[0].input_json.target_path);
  assert.deepEqual(patches[1].filters, { id: "eq.daily-1", automation_job_id: "eq.job-daily-1" });
});

test("권위 제품 데이터 조회 오류는 0건으로 축소하지 않고 enqueue 전에 전파한다", async () => {
  for (const failingTable of ["import_product_sku_links", "import_erp_products", "sales_channel_product_mappings"]) {
    const jobs = [];
    const authorityError = new Error(`authority read failed: ${failingTable}`);
    const authorityModule = execute("src/lib/knowledge-center.ts", {
      "./fnos-db": {
        ...dbMock,
        selectRows: async (table) => {
          if (table === "products") return [{ id: "product-1", product_code: "FN001", product_name: "직수입 제품", status: "active", is_active: true }];
          if (table === failingTable) throw authorityError;
          if (table === "import_product_sku_links") return [{ import_product_id: "import-1" }];
          if (table === "import_erp_products") return [{ id: "import-1" }];
          if (table === "sales_channel_product_mappings") return [];
          return [];
        },
      },
      "./automation-jobs": { createAutomationJob: async (values) => { jobs.push(values); return { id: "should-not-exist" }; } },
    });
    await assert.rejects(() => authorityModule.createProductCardRequest({ product_id: "product-1" }), authorityError);
    assert.equal(jobs.length, 0);
  }
});

test("knowledge/product active 중복 enqueue는 job 생성 전에 거부한다", async () => {
  const jobs = [];
  const activeKnowledge = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async () => [{ id: "knowledge-1", processing_status: "queued", automation_job_id: "job-live", source_card_path: "03_INBOX/Resource_Triage_Cards/card.md" }],
    },
    "./automation-jobs": { createAutomationJob: async (values) => { jobs.push(values); return { id: "new-job" }; } },
  });
  await assert.rejects(() => activeKnowledge.decideKnowledgeItem({ id: "knowledge-1", action: "pending" }), (error) => error.status === 409);

  const activeProduct = execute("src/lib/knowledge-center.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async (table) => {
        if (table === "products") return [{ id: "product-1", product_code: "FN001", product_name: "제품", status: "active", is_active: true }];
        if (table === "import_product_sku_links") return [{ import_product_id: "import-1" }];
        if (table === "import_erp_products" || table === "sales_channel_product_mappings") return [];
        if (table === "knowledge_index") return [{ id: "knowledge-product-1", processing_status: "running", automation_job_id: "job-live" }];
        return [];
      },
    },
    "./automation-jobs": { createAutomationJob: async (values) => { jobs.push(values); return { id: "new-job" }; } },
  });
  await assert.rejects(() => activeProduct.createProductCardRequest({ product_id: "product-1" }), (error) => error.status === 409);
  assert.equal(jobs.length, 0);
});

test("claim은 queued 조건부 PATCH가 진 경합 후보를 건너뛰고 다음 작업을 원자적으로 점유한다", async () => {
  const patchCalls = [];
  const automation = execute("src/lib/automation-jobs.ts", {
    "./fnos-db": {
      ...dbMock,
      selectRows: async (table) => table === "automation_jobs"
        ? [{ id: "job-lost", job_type: "knowledge_action", status: "queued" }, { id: "job-won", job_type: "knowledge_action", status: "queued" }]
        : [],
      patchRows: async (_table, filters, values) => {
        patchCalls.push({ filters, values });
        return filters.id === "eq.job-lost" ? [] : [{ id: "job-won", job_type: "knowledge_action", status: "running", ...values }];
      },
    },
    "./automation-jobs-shared": {
      AUTOMATION_JOB_STATUS_LABELS: {},
      AUTOMATION_JOB_TYPE_LABELS: {},
      isAutomationJobStatus: (value) => ["queued", "running", "success", "failed", "cancelled"].includes(value),
      isAutomationJobType: () => true,
    },
  });
  const claimed = await automation.claimNextAutomationJob({ job_type: "knowledge_action", worker_id: "worker-1" });
  assert.equal(claimed.id, "job-won");
  assert.equal(patchCalls.length, 2);
  assert.ok(patchCalls.every(({ filters }) => filters.status === "eq.queued"));
});

test("knowledge 테이블은 RLS와 anon/authenticated 직접 권한 회수를 정본 SQL 모두에 선언한다", () => {
  for (const sql of [source("schema_sales_inventory.sql"), source("migrations/20260715_cooljam_knowledge_center.sql")]) {
    for (const table of ["knowledge_index", "knowledge_daily_entries"]) {
      assert.match(sql, new RegExp(`alter table ${table} enable row level security`, "i"));
      assert.match(sql, new RegExp(`revoke all privileges on table ${table} from anon, authenticated`, "i"));
    }
  }
});

test("지식센터 내부 메뉴는 승인된 5개 순서이고 Archive는 검토함 안에만 둔다", () => {
  const workspace = source("src/app/knowledge-center-workspace.tsx");
  assert.match(workspace, /\[\["today", "오늘"\], \["review", "검토함\/원자료"\], \["company", "회사·업무"\], \["personal", "개인"\], \["products", "제품 리스트"\]\]/);
  assert.match(workspace, /view === "review"[\s\S]*기존 원자료 관리 \(Archive\)/);
});

test("worker receipt job binding과 제품 이미지 private-root 기본 제외 계약을 선언한다", () => {
  const worker = source("tools/automation-worker.mjs");
  const productWorker = source("tools/fnos_product_card_worker.py");
  assert.match(worker, /job_id: text\(job\.id\)/);
  assert.match(productWorker, /FNOS_ALLOWED_PRODUCT_IMAGE_ROOTS/);
  const rootsBlock = productWorker.slice(productWorker.indexOf("def allowed_image_roots"), productWorker.indexOf("def copy_image"));
  assert.match(rootsBlock, /D:\/FN_images/);
  assert.match(rootsBlock, /IMAGE_ROOT/);
  assert.doesNotMatch(rootsBlock, /\bVAULT\b|hermes\/profiles|AppData\/Local\/Temp/);
});
