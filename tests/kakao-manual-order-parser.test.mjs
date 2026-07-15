import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const XLSX = require("xlsx");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadPrivate(relativePath, names) {
  const filename = resolve(projectRoot, relativePath);
  const source = `${readFileSync(filename, "utf8")}\nexport { ${names.join(", ")} };`;
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, strict: true },
    fileName: filename,
  }).outputText;
  const cjsModule = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "next/server") return { NextRequest: class NextRequest {}, NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } };
    if (specifier === "@/lib/channels/common/order-status") return { normalizeCollectableOnlineOrders: (orders) => orders };
    if (specifier === "@/lib/channels/registry") return { ONLINE_ORDER_UNSUPPORTED_MESSAGE: "unsupported", onlineOrderAdapterCodeForChannel: () => "", onlineOrderAdapterForChannel: () => null };
    if (specifier === "@/lib/channels/ssg") return { applyCurrentSsgOrderStatuses: async (_key, _url, orders) => orders };
    if (specifier === "@/lib/automation-jobs") return { createAutomationJob: async () => ({ id: "test" }) };
    if (specifier === "@/lib/sales-channel-credentials") return { readChannelCredentials: async () => [] };
    if (specifier === "@/lib/fnos-db") {
      class FnosDbError extends Error { constructor(message) { super(message); this.status = 500; } }
      return { FnosDbError, hasDbConfig: () => false, deleteRows: async () => [], insertRows: async () => [], patchRows: async () => [], selectRows: async () => [], upsertRows: async () => [] };
    }
    return createRequire(filename)(specifier);
  };
  new Function("require", "exports", "module", compiled)(localRequire, cjsModule.exports, cjsModule);
  return cjsModule.exports;
}

const syntheticRow = {
  결제번호: "PAY-FAKE-1",
  주문번호: "ORDER-FAKE-1",
  채널상품번호: "CHANNEL-PRODUCT-1",
  판매자상품번호: "SELLER-PRODUCT-1",
  옵션코드: "OPTION-1",
  상품명: "합성 상품",
  옵션: "합성 옵션",
  수량: "1",
  수령인명: "테스트 수령인",
  수령인연락처1: "010-0000-0000",
  배송지주소: "테스트 주소",
  우편번호: "00000",
  배송메세지: "테스트 메시지",
  주문일: "2026-07-15 10:00:00",
  상품금액: "20000",
  정산기준금액: "15000",
  채널: "톡스토어",
};

function workbookBuffer(row = syntheticRow) {
  const sheet = XLSX.utils.json_to_sheet([row]);
  return XLSX.write({ SheetNames: ["합성주문"], Sheets: { 합성주문: sheet } }, { type: "buffer", bookType: "xlsx" });
}

test("숫자 타임스탬프와 톡스토어 시그니처가 함께 있을 때만 카카오 수동 주문으로 파싱한다", async () => {
  const { parseManualOrderFile } = loadPrivate("src/app/api/fnos/online-orders/sync/route.ts", ["parseManualOrderFile"]);
  const parsed = await parseManualOrderFile("20260715103413.xlsx", workbookBuffer());
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source, "kakao");
  assert.equal(parsed[0].siteName, "카카오 스토어");
  const order = parsed[0].orders[0];
  assert.deepEqual(
    [order.customerCode, order.customerName, order.orderNo, order.bundleOrderNo, order.items[0].qty, order.items[0].salesAmount, order.items[0].settlementAmount],
    ["8918800985", "카카오 스토어", "ORDER-FAKE-1", "PAY-FAKE-1", 1, 20000, 15000],
  );
  assert.equal(order.raw.__manualSource, "kakao");
  assert.equal(order.raw.__manualFileName, "20260715103413.xlsx");
  assert.equal(order.raw.__sheetName, "합성주문");
  assert.equal(order.raw.__sourceRow, 2);

  assert.deepEqual(await parseManualOrderFile("kakao-orders.xlsx", workbookBuffer()), []);
  assert.deepEqual(await parseManualOrderFile("20260715103413.xlsx", workbookBuffer({ ...syntheticRow, 채널: "다른채널" })), []);
});

test("카카오 업로드 파서는 원본 정산값과 DB 거래처 identity를 판매/송장 파이프라인에 유지한다", () => {
  const { isKakaoOrderFile, toCanonicalRows, buildFromDownRows } = loadPrivate("src/app/api/sales/order-files/parse/route.ts", ["isKakaoOrderFile", "toCanonicalRows", "buildFromDownRows"]);
  assert.equal(isKakaoOrderFile("20260715103413.xlsx", syntheticRow), true);
  assert.equal(isKakaoOrderFile("12345.xlsx", syntheticRow), false);
  const canonical = toCanonicalRows([syntheticRow], "kakao");
  assert.deepEqual(
    [canonical[0].거래처코드, canonical[0].거래처명, canonical[0].주문번호, canonical[0].묶음주문번호, canonical[0].판매금액, canonical[0].정산예정금액],
    ["8918800985", "카카오 스토어", "ORDER-FAKE-1", "PAY-FAKE-1", "20000", "15000"],
  );
  const converted = buildFromDownRows(canonical);
  assert.equal(converted.shipping.length, 1);
  assert.equal(converted.invoice.length, 1);
  assert.deepEqual(converted.sale[0].slice(1, 3), ["8918800985", "카카오 스토어"]);
  assert.equal(converted.sale[0][11], "15,000");
  assert.equal(converted.shipping[0][10], "15,000");
});
