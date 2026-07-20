import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pageSource = readFileSync(resolve(projectRoot, "src/app/page.tsx"), "utf8");

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

function loadManualCompletionHelpers() {
  const start = pageSource.indexOf("function normalizePendingOnlineOrderManualFileName(");
  const end = pageSource.indexOf("function setSalesSheetCell(", start);
  assert.ok(start >= 0 && end > start);
  assert.match(pageSource.slice(start, end), /function applyOrderProgressStatusChangeToSheets\(/);
  const compiled = ts.transpileModule(`
    const ONLINE_ORDER_MANUAL_FILES_KEY = "fnos.salesInventory.onlineOrderManualFiles.v1";
    const ONLINE_ORDER_MANUAL_FILE_ROWS_KEY = "fnos.salesInventory.onlineOrderManualFileRows.v1";
    function salesCellText(value) { return String(value ?? "").trim(); }
    function rowHasValue(row) { return Boolean(row?.[0]); }
    function progressValue(row, key) { return key === "쇼핑몰코드" ? row[0] : key === "주문상태" ? row[1] : ""; }
    function setProgressValue(row, key, value) { if (key === "주문상태") row[1] = value; }
    function padSalesRows(_sheet, rows) { return rows; }
    ${pageSource.slice(start, end)}
    module.exports = { applyOrderProgressStatusChangeToSheets };
  `, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const sourceModule = { exports: {} };
  new Function("module", "exports", compiled)(sourceModule, sourceModule.exports);
  return sourceModule.exports;
}

function localStorageFixture(values) {
  const data = new Map(Object.entries(values));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

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

test("API 미연동 쇼핑몰은 공백·alias·실코드와 무관하게 FNOS-only로 분류된다", () => {
  const start = pageSource.indexOf("function onlineOrderStatusApiUnsupportedSite(");
  const end = pageSource.indexOf("function groupedUnsupportedStatusApiRows(", start);
  assert.ok(start >= 0 && end > start);

  const compiled = ts.transpileModule(`
    function orderProgressSiteName(row) { return row.site; }
    function progressValue(row, key) { return key === "쇼핑몰코드" ? row.code : ""; }
    ${pageSource.slice(start, end)}
    module.exports = { onlineOrderStatusApiUnsupportedSite };
  `, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const sourceModule = { exports: {} };
  new Function("module", "exports", compiled)(sourceModule, sourceModule.exports);
  const { onlineOrderStatusApiUnsupportedSite } = sourceModule.exports;

  const manualRows = [
    "ESM", "지마켓", "G마켓", "GMARKET", "옥션", "AUCTION",
    "KAKAO", "카카오", "톡스토어", "선물하기",
    "오늘의 집", "오늘 의 집", "TODAYHOUSE", "OHOU",
    "현대이지웰", "이지웰", "EZWEL", "O.RORA", "ORORA",
  ].map((site) => ({ site, code: "" })).concat([
    { site: "알 수 없는 이름", code: "2208183676" },
    { site: "알 수 없는 이름", code: "8918800985" },
    { site: "알 수 없는 이름", code: "1198691245" },
  ]);
  const apiRows = [
    { site: "NAVER 네이버", code: "" },
    { site: "COUPANG 쿠팡", code: "" },
    { site: "십일번가", code: "" },
    { site: "쓱", code: "" },
    { site: "커스텀 거래처명", code: "CUSTOM" },
  ];

  assert.ok(manualRows.every(onlineOrderStatusApiUnsupportedSite));
  assert.ok(apiRows.every((row) => !onlineOrderStatusApiUnsupportedSite(row)));
});

test("API 혼합 선택이 실패해도 미연동 행은 FNOS 상태 적용 대상으로 남는다", () => {
  const start = pageSource.indexOf("async function changeSelectedOrderStatus(");
  const end = pageSource.indexOf("function deleteSelectedOrderRows(", start);
  assert.ok(start >= 0 && end > start);
  const source = pageSource.slice(start, end);

  assert.match(source, /const apiIndexes = eligibleIndexes\.filter\(\(index\) => !unsupportedIndexes\.has\(index\)\)/);
  assert.match(source, /callOnlineOrderStatusApi\("confirm", apiIndexes/);
  assert.match(source, /callOnlineOrderStatusApi\("dispatch", apiIndexes/);
  assert.match(source, /if \(!unsupportedIndexes\.size\) \{[\s\S]*?window\.alert\(message\);[\s\S]*?return;/);
  assert.match(source, /statusApplyIndexes = eligibleIndexes\.filter\(\(index\) => unsupportedIndexes\.has\(index\)\);/);
  assert.match(source, /applyOrderProgressStatusChangeToSheets\(sheetsRef\.current, statusApplyIndexes, status\)/);
});

test("ESM→EZWEL split-step 최종 완료는 updater 지연과 무관하게 cleanup을 정확히 한 번 계산한다", () => {
  const { applyOrderProgressStatusChangeToSheets } = loadManualCompletionHelpers();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: localStorageFixture({
    "fnos.salesInventory.onlineOrderManualFiles.v1": JSON.stringify(["split-orders.xlsx"]),
    "fnos.salesInventory.onlineOrderManualFileRows.v1": JSON.stringify({ "split-orders.xlsx": ["ESM-1", "EZWEL-1"] }),
  }) };
  try {
    const initialSheets = {
      "발주 진행 단계": [
        ["ESM-1", "주문확인"],
        ["EZWEL-1", "주문확인"],
      ],
    };
    const deferredStateUpdates = [];
    const cleanupCalls = [];
    const setSheets = (next) => deferredStateUpdates.push(next);

    const first = applyOrderProgressStatusChangeToSheets(initialSheets, [0], "출고완료");
    setSheets(first.nextSheets);
    if (first.completedManualFiles.length) cleanupCalls.push(first.completedManualFiles);
    assert.deepEqual(first.completedManualFiles, []);

    const second = applyOrderProgressStatusChangeToSheets(first.nextSheets, [1], "출고완료");
    setSheets(second.nextSheets);
    if (second.completedManualFiles.length) cleanupCalls.push(second.completedManualFiles);

    assert.equal(deferredStateUpdates.length, 2, "React state updater가 아직 적용되지 않은 상황을 유지합니다.");
    assert.deepEqual(cleanupCalls, [["split-orders.xlsx"]]);
    assert.deepEqual(second.nextSheets["발주 진행 단계"].map((row) => row[1]), ["출고완료", "출고완료"]);

    const changeStart = pageSource.indexOf("async function changeSelectedOrderStatus(");
    const changeEnd = pageSource.indexOf("function deleteSelectedOrderRows(", changeStart);
    const finalApply = pageSource.slice(pageSource.indexOf("applyOrderProgressStatusChangeToSheets(", changeStart), changeEnd);
    assert.match(finalApply, /sheetsRef\.current = nextSheets;[\s\S]*setSheets\(nextSheets\)/);
    assert.doesNotMatch(finalApply, /setSheets\(\(prev\)|setTimeout/);

    const normalizeStart = pageSource.indexOf("async function validateAndNormalizeProgressProducts(");
    const normalizeEnd = pageSource.indexOf("async function cleanupPendingManualOrderFilesAfterCompletion(", normalizeStart);
    const normalizeSource = pageSource.slice(normalizeStart, normalizeEnd);
    assert.match(normalizeSource, /const next = \{ \.\.\.sheetsRef\.current \};[\s\S]*sheetsRef\.current = next;[\s\S]*setSheets\(next\)/, "품목 정규화 snapshot이 후속 출고완료 계산 전에 ref/state에 함께 반영되어야 합니다.");
    assert.doesNotMatch(normalizeSource, /setSheets\(\(prev\)/, "비동기 React updater 뒤에 stale sheetsRef를 읽는 경로를 남기면 안 됩니다.");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("수동 파일 metadata 누락 또는 부분 완료는 cleanup 대상이 아니다", () => {
  const { applyOrderProgressStatusChangeToSheets } = loadManualCompletionHelpers();
  const previousWindow = globalThis.window;
  try {
    for (const fileRows of [{}, { "orders.xlsx": ["ESM-1", "EZWEL-1"] }]) {
      globalThis.window = { localStorage: localStorageFixture({
        "fnos.salesInventory.onlineOrderManualFiles.v1": JSON.stringify(["orders.xlsx"]),
        "fnos.salesInventory.onlineOrderManualFileRows.v1": JSON.stringify(fileRows),
      }) };
      const result = applyOrderProgressStatusChangeToSheets({
        "발주 진행 단계": [
          ["ESM-1", "주문확인"],
          ["EZWEL-1", "주문확인"],
        ],
      }, [0], "출고완료");
      assert.deepEqual(result.completedManualFiles, []);
    }
  } finally {
    globalThis.window = previousWindow;
  }
});

test("production Origin의 exact cleanup OPTIONS만 auth를 통과해 route CORS 204에 도달한다", async () => {
  const nextServer = { NextRequest: class NextRequest {}, NextResponse: TestNextResponse };
  const { proxy } = executeTypeScriptModule("proxy.ts", { "next/server": nextServer });
  const cleanupRoute = executeTypeScriptModule("src/app/api/fnos/online-orders/manual-files/cleanup/route.ts", { "next/server": nextServer });
  const exactUrl = "http://127.0.0.1:3000/api/fnos/online-orders/manual-files/cleanup";
  const makeRequest = (overrides = {}) => ({
    method: overrides.method || "OPTIONS",
    nextUrl: new URL(overrides.url || exactUrl),
    headers: new Headers({
      Origin: overrides.origin || "https://fn-os.vercel.app",
      "Access-Control-Request-Method": overrides.requestMethod || "POST",
      "Access-Control-Request-Headers": overrides.requestHeaders || "content-type, x-fnos-local-bridge",
    }),
    cookies: { get: () => undefined },
  });

  assert.equal(proxy(makeRequest()).kind, "next");
  const response = await cleanupRoute.OPTIONS();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://fn-os.vercel.app");
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type, X-FNOS-Local-Bridge");

  for (const overrides of [
    { url: "http://127.0.0.1:3000/api/fnos/online-orders/status" },
    { origin: "https://evil.example" },
    { requestMethod: "GET" },
    { requestHeaders: "content-type" },
  ]) {
    assert.equal(proxy(makeRequest(overrides)).status, 401, JSON.stringify(overrides));
  }
});
