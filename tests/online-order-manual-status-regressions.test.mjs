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
  assert.match(source, /applyOrderProgressStatusChangeToSheets\(prev, statusApplyIndexes, status\)/);
});

function loadChangeSelectedOrderStatusFixture({ selectedIndexes }) {
  const start = pageSource.indexOf("async function changeSelectedOrderStatus(");
  const end = pageSource.indexOf("function deleteSelectedOrderRows(", start);
  assert.ok(start >= 0 && end > start);

  const compiled = ts.transpileModule(`
    ${pageSource.slice(start, end)}
    module.exports = { changeSelectedOrderStatus };
  `, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const headerIndexes = new Map([
    ["쇼핑몰코드", 0],
    ["묶음주문번호", 1],
    ["송장번호", 2],
    ["주문상태", 3],
  ]);
  const progressRows = [
    ["ESM-1", "", "INV-1", "출고대기"],
    ["ESM-2", "", "INV-2", "출고대기"],
  ];
  const sheets = { "발주 진행 단계": progressRows };
  const sheetsRef = { current: sheets };
  const orderProgressStatusChangeInFlight = { current: false };
  const queuedSheetUpdaters = [];
  const queuedCleanupTimers = [];
  const cleanupCalls = [];
  let currentSheets = sheets;
  let appliedSheetUpdaterCount = 0;
  let confirmCallCount = 0;
  const completedPendingOnlineOrderManualFiles = (rows) => {
    if (!rows.every((row) => row[3] === "출고완료")) return [];
    return [rows[1][0] === "ESM-2-EDITED" ? "최신_ESM_주문.xlsx" : "기존_ESM_주문.xlsx"];
  };
  const flushSheetUpdaters = () => {
    while (queuedSheetUpdaters.length) {
      currentSheets = queuedSheetUpdaters.shift()(currentSheets);
      appliedSheetUpdaterCount += 1;
    }
    sheetsRef.current = currentSheets;
  };
  const dependencies = {
    orderProgressStatusFilter: "출고대기",
    orderProgressStatusChangeInFlight,
    setOrderProgressStatusChanging: () => {},
    sheets,
    sheetsRef,
    flushSync: (callback) => {
      callback();
      flushSheetUpdaters();
    },
    canChangeOrderProgressStatusFromFilter: () => true,
    selectedOrderRowIndexes: () => selectedIndexes,
    rowHasValue: (row) => row.some(Boolean),
    salesCellText: (value) => String(value ?? "").trim(),
    progressValue: (row, header) => row[headerIndexes.get(header)] || "",
    setProgressValue: (row, header, value) => { row[headerIndexes.get(header)] = value; },
    groupedUnsupportedStatusApiRows: () => ({ ESM: selectedIndexes.length }),
    onlineOrderStatusApiUnsupportedSite: () => true,
    orderProgressStatusChangeItems: () => [],
    onlineOrderStatusDisplaySiteKey: () => "",
    openOrderProgressStatusPopup: () => {},
    validateAndNormalizeProgressProducts: async () => true,
    setCollectionStatuses: () => {},
    mergeConfirmOrderStatusDisplayItems: (items) => items,
    padSalesRows: (_sheet, rows) => rows,
    setSheets: (updater) => { queuedSheetUpdaters.push(updater); },
    setMessage: () => {},
    applyOrderProgressStatusChangeToSheets: (current, indexes, status) => {
      const rows = current["발주 진행 단계"].map((row) => [...row]);
      indexes.forEach((index) => { if (rows[index]) rows[index][3] = status; });
      const nextSheets = { ...current, "발주 진행 단계": rows };
      return { nextSheets, completedManualFiles: completedPendingOnlineOrderManualFiles(rows) };
    },
    completedPendingOnlineOrderManualFiles,
    cleanupPendingManualOrderFilesAfterCompletion: (files) => { cleanupCalls.push(files); },
    window: {
      alert: () => {},
      confirm: () => {
        confirmCallCount += 1;
        return true;
      },
      setTimeout: (callback, delay) => {
        if (delay === 0) queuedCleanupTimers.push(callback);
        else callback();
      },
    },
  };
  const sourceModule = { exports: {} };
  new Function("module", "exports", ...Object.keys(dependencies), compiled)(
    sourceModule,
    sourceModule.exports,
    ...Object.values(dependencies),
  );
  return {
    changeSelectedOrderStatus: sourceModule.exports.changeSelectedOrderStatus,
    sheetsRef,
    queuedCleanupTimers,
    cleanupCalls,
    queueSheetUpdater: dependencies.setSheets,
    flushSheetUpdaters,
    appliedSheetUpdaterCount: () => appliedSheetUpdaterCount,
    confirmCallCount: () => confirmCallCount,
  };
}

test("앞서 지연된 진행행 편집을 보존하고 최종 행 기준으로 출고완료 cleanup을 예약한다", async () => {
  const fixture = loadChangeSelectedOrderStatusFixture({ selectedIndexes: [0, 1] });
  fixture.queueSheetUpdater((prev) => {
    const rows = prev["발주 진행 단계"].map((row) => [...row]);
    rows[1][0] = "ESM-2-EDITED";
    return { ...prev, "발주 진행 단계": rows };
  });

  await fixture.changeSelectedOrderStatus("출고완료");
  fixture.flushSheetUpdaters();

  assert.equal(fixture.appliedSheetUpdaterCount(), 2, "앞선 편집과 상태변경 updater가 모두 적용돼야 한다");
  assert.deepEqual(fixture.sheetsRef.current["발주 진행 단계"].map((row) => [row[0], row[3]]), [
    ["ESM-1", "출고완료"],
    ["ESM-2-EDITED", "출고완료"],
  ]);
  assert.equal(fixture.queuedCleanupTimers.length, 1);
  fixture.queuedCleanupTimers[0]();
  assert.deepEqual(fixture.cleanupCalls, [["최신_ESM_주문.xlsx"]]);
});

test("ESM 수동파일 일부 행만 출고완료면 cleanup 예약과 호출이 모두 0회다", async () => {
  const fixture = loadChangeSelectedOrderStatusFixture({ selectedIndexes: [0] });

  await fixture.changeSelectedOrderStatus("출고완료");

  assert.deepEqual(fixture.sheetsRef.current["발주 진행 단계"].map((row) => row[3]), ["출고완료", "출고대기"]);
  assert.equal(fixture.queuedCleanupTimers.length, 0);
  assert.deepEqual(fixture.cleanupCalls, []);
});

test("동일 상태변경을 동시에 두 번 호출해도 cleanup은 정확히 한 번만 예약·호출한다", async () => {
  const fixture = loadChangeSelectedOrderStatusFixture({ selectedIndexes: [0, 1] });

  await Promise.all([
    fixture.changeSelectedOrderStatus("출고완료"),
    fixture.changeSelectedOrderStatus("출고완료"),
  ]);

  assert.equal(fixture.confirmCallCount(), 1, "두 번째 재진입은 확인창 전에 차단돼야 한다");
  assert.equal(fixture.queuedCleanupTimers.length, 1);
  fixture.queuedCleanupTimers[0]();
  assert.deepEqual(fixture.cleanupCalls, [["기존_ESM_주문.xlsx"]]);
});

test("수동파일 cleanup fallback도 최신 sheets ref를 사용한다", () => {
  const start = pageSource.indexOf("async function cleanupPendingManualOrderFilesAfterCompletion(");
  const end = pageSource.indexOf("async function changeSelectedOrderStatus(", start);
  assert.ok(start >= 0 && end > start);
  const source = pageSource.slice(start, end);

  assert.match(source, /completedPendingOnlineOrderManualFiles\(sheetsRef\.current\["발주 진행 단계"\]\)/);
  assert.doesNotMatch(source, /completedPendingOnlineOrderManualFiles\(sheets\["발주 진행 단계"\]\)/);
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
