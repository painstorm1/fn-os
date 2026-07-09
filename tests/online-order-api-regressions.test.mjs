import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(resolve(projectRoot, relativePath), "utf8");

const pageSource = source("src/app/page.tsx");
const statusRouteSource = source("src/app/api/fnos/online-orders/status/route.ts");
const syncRouteSource = source("src/app/api/fnos/online-orders/sync/route.ts");
const coupangSource = source("src/lib/channels/coupang/index.ts");
const elevenstSource = source("src/lib/channels/elevenst/index.ts");
const ssgSource = source("src/lib/channels/ssg/index.ts");

function assertNotMatch(haystack, pattern, message) {
  assert.equal(pattern.test(haystack), false, message);
}

function loadStatusRouteWithMocks(captured) {
  const filename = resolve(projectRoot, "src/app/api/fnos/online-orders/status/route.ts");
  const compiled = ts.transpileModule(statusRouteSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: filename,
  }).outputText;
  const cjsModule = { exports: {} };
  const adapters = {
    ssg: {
      dispatchOrders: async (params) => {
        captured.ssgDispatch = params;
        return { ok: true, message: "SSG ok", data: null };
      },
    },
    coupang: {
      dispatchOrders: async (params) => {
        captured.coupangDispatch = params;
        return { ok: false, error: "NOT_FOUND_SHIPMENT_BOX", data: null };
      },
    },
  };
  const localRequire = (specifier) => {
    if (specifier === "next/server") {
      return {
        NextRequest: class NextRequest {},
        NextResponse: {
          json(body, init = {}) {
            return { body, status: init.status || 200, headers: init.headers || {} };
          },
        },
      };
    }
    if (specifier === "@/lib/channels/registry") {
      return {
        ONLINE_ORDER_ADAPTERS: adapters,
        onlineOrderAdapterCodeForChannel: (channel) => String(channel.channel_code || ""),
      };
    }
    if (specifier === "@/lib/automation-jobs") {
      return { createAutomationJob: async () => ({ id: "job-test" }) };
    }
    if (specifier === "@/lib/fnos-db") {
      class FnosDbError extends Error { constructor(message) { super(message); this.status = 500; } }
      return {
        FnosDbError,
        hasDbConfig: () => true,
        patchRows: async () => [],
        selectRows: async (table) => (table === "sales_channels"
          ? [
              { id: "ssg", channel_name: "SSG신세계", channel_code: "ssg", is_active: true, api_enabled: true },
              { id: "coupang", channel_name: "쿠팡_WING", channel_code: "coupang", is_active: true, api_enabled: true },
            ]
          : []),
      };
    }
    if (specifier === "@/lib/sales-channel-credentials") {
      return { readChannelCredentials: async () => [{ key: "api_key", value: "test-key" }] };
    }
    return createRequire(filename)(specifier);
  };
  new Function("require", "exports", "module", compiled)(localRequire, cjsModule.exports, cjsModule);
  return cjsModule.exports;
}

function statusAfterRebuild(existingStatus, rebuiltStatus) {
  const rank = { 신규주문: 0, 주문확인: 1, 출고대기: 2, 출고완료: 3 };
  if (!existingStatus) return rebuiltStatus;
  if (!rebuiltStatus) return existingStatus;
  const existingRank = rank[existingStatus];
  const rebuiltRank = rank[rebuiltStatus];
  if (existingRank === undefined || rebuiltRank === undefined) return rebuiltStatus || existingStatus;
  return rebuiltRank >= existingRank ? rebuiltStatus : existingStatus;
}

function propagateByShipment(rows, progressRows, sourceIndex, trackingNo) {
  const sourceShipment = progressRows[sourceIndex]?.apiShipmentId || "";
  if (!sourceShipment) return rows;
  return rows.map((row, index) => {
    if (row.direct || row.trackingNo || progressRows[index]?.apiShipmentId !== sourceShipment) return row;
    return { ...row, trackingNo };
  });
}

function statusOutcome(indexes, rows, results) {
  const failed = results.filter((result) => !result.ok);
  if (!results.length || !failed.length) return { successIndexes: indexes, failedIndexes: [] };
  const succeeded = results.filter((result) => result.ok);
  const matches = (left, right) => {
    const a = String(left || "").trim().toLowerCase();
    const b = String(right || "").trim().toLowerCase();
    return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
  };
  return {
    successIndexes: indexes.filter((index) => succeeded.some((result) => matches(result.channel_name, rows[index].channelName))),
    failedIndexes: indexes.filter((index) => failed.some((result) => matches(result.channel_name, rows[index].channelName))),
  };
}

function ssgShippingIds(row) {
  const text = (value) => String(value ?? "").trim();
  const firstText = (...values) => values.map(text).find(Boolean) || "";
  const productOrderId = firstText(row.productOrderId, row.product_order_id);
  const productOrderIdSeparator = productOrderId.lastIndexOf("-");
  const [fromProductShppNo, fromProductShppSeq] = productOrderIdSeparator > 0 && productOrderIdSeparator < productOrderId.length - 1
    ? [productOrderId.slice(0, productOrderIdSeparator), productOrderId.slice(productOrderIdSeparator + 1)]
    : ["", ""];
  return {
    shppNo: firstText(row.shppNo, row.shpp_no, fromProductShppNo, row.shipmentBoxId, row.shipment_box_id, row.bundleOrderNo, row.bundle_order_no, row.orderId, row.order_id, row.orderNo, row.order_no),
    shppSeq: firstText(row.shppSeq, row.shpp_seq, fromProductShppSeq, row.productOrderId, row.product_order_id) || "1",
  };
}

function ssgOrderStatus(row) {
  const firstText = (...values) => values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
  const newCodes = ["11", "011", "PAYED", "PAID", "PAYMENTCOMPLETED", "PAYMENTCOMPLETE", "ORDERPAID", "NEW", "NEWORDER", "NOTYET", "NOTYETPLACE", "결제완료", "신규주문", "발주전"];
  const confirmedCodes = ["12", "012", "20", "020", "21", "021", "PLACEORDEROK", "PLACEORDER", "ORDERCONFIRMED", "CONFIRMED", "READYTOSHIP", "READYFORDISPATCH", "READYFORDELIVERY", "SHIPPINGREADY", "DELIVERYREADY", "WAITINGDELIVERY", "발주확인", "주문확인", "발송대기", "배송준비", "출고대기"];
  const detailCode = firstText(row.shppProgStatDtlCd).replace(/[\s_()/.-]+/g, "").toUpperCase();
  if (detailCode) {
    if (newCodes.includes(detailCode)) return "신규주문";
    if (confirmedCodes.includes(detailCode)) return "주문확인";
  }
  return firstText(row.shppProgStatDtlNm, row.ordItemStatNm, row.ordStatNm, row.statusName) || "신규주문";
}

test("F2/F5 송장업로드는 기존 진행상태/API 식별자를 보존하고 직접 재빌드로 덮지 않는다", () => {
  assert.match(pageSource, /function preserveExistingOrderProgressFields\(/);
  assert.match(pageSource, /const orderProgressPreservedHeaders = \["직송거래처", "API주문ID", "API상품주문ID", "API배송묶음ID", "API보조ID"\]/);
  assert.match(pageSource, /mergedOrderProgressStatus\(progressValue\(existing, "주문상태"\), progressValue\(row, "주문상태"\)\)/);
  assertNotMatch(pageSource, /nextSheets\["발주 진행 단계"\]\s*=\s*buildOrderProgressRows\(/, "발주 진행 단계 직접 재빌드 덮어쓰기 경로가 남아있습니다.");
  assertNotMatch(pageSource, /orderProgressStatusByMallCode|preserveExistingOrderProgressStatuses/, "상태만 보존하던 구 helper가 남아있습니다.");

  assert.equal(statusAfterRebuild("주문확인", "신규주문"), "주문확인");
  assert.equal(statusAfterRebuild("출고대기", "신규주문"), "출고대기");
  assert.equal(statusAfterRebuild("주문확인", "출고대기"), "출고대기");
});

test("11번가 등 합포장 행은 같은 API배송묶음ID 기준으로 빈 송장번호를 전파한다", () => {
  assert.match(pageSource, /const progressShipmentKey = \(index: number\) => salesCellText\(progressValue\(progressRows\[index\] \|\| \[\], "API배송묶음ID"\)\)/);
  assert.match(pageSource, /function applyInvoiceTrackingToSheets\([\s\S]*applyTrackingToSameShipment/);
  assert.match(pageSource, /applyTrackingToSameShipment\(alreadyIndex, trackingNo\)/);
  assert.match(pageSource, /applyTrackingToSameShipment\(shippingIndex, trackingNo\)/);

  const rows = [
    { trackingNo: "", direct: false },
    { trackingNo: "", direct: false },
    { trackingNo: "", direct: false },
    { trackingNo: "", direct: true },
  ];
  const progressRows = [
    { apiShipmentId: "DLV-1" },
    { apiShipmentId: "DLV-1" },
    { apiShipmentId: "DLV-2" },
    { apiShipmentId: "DLV-1" },
  ];
  const next = propagateByShipment(rows, progressRows, 0, "1234567890");
  assert.equal(next[0].trackingNo, "1234567890");
  assert.equal(next[1].trackingNo, "1234567890");
  assert.equal(next[2].trackingNo, "");
  assert.equal(next[3].trackingNo, "");
});

test("상태 API route는 채널별 native ID와 송장번호 원문을 adapter까지 보존한다", () => {
  for (const nativeKey of ["vendorItemId", "shppNo", "shppSeq", "ordNo", "ordPrdSeq", "dlvNo", "odNo", "odSeq", "procSeq"]) {
    assert.match(statusRouteSource, new RegExp(`${nativeKey}:`), `${nativeKey} 전달이 누락되었습니다.`);
  }
  assertNotMatch(statusRouteSource, /trackingNumber:\s*text\([^\n]+\)\.replace\(\/\\D\/g,\s*""\)/, "공통 route에서 송장번호 비숫자 문자를 제거하고 있습니다.");
  assert.match(statusRouteSource, /const partial = failedResults\.length > 0 && succeededResults\.length > 0/);
  assert.match(statusRouteSource, /ok: failedResults\.length === 0 \|\| partial/);

  assert.equal(String("AB-123-XY").trim(), "AB-123-XY");
});

test("상태 API route 실행 시 SSG native ID와 쿠팡 shipmentBoxId 누락을 adapter payload에서 구분한다", async () => {
  const captured = {};
  const route = loadStatusRouteWithMocks(captured);
  const response = await route.POST({
    json: async () => ({
      action: "dispatch",
      use_worker: false,
      rows: [
        {
          channelName: "SSG신세계",
          orderId: "ORDER-FALLBACK",
          productOrderId: "PRODUCT-FALLBACK",
          shppNo: "SSG-SHPP-NO",
          shppSeq: "7",
          odNo: "SSG-OD-NO",
          odSeq: "SSG-OD-SEQ",
          procSeq: "SSG-PROC-SEQ",
          trackingNumber: "AB-123-XY",
          deliveryCompanyCode: "CJGLS",
        },
        {
          channelName: "쿠팡_WING",
          orderId: "COUPANG-ORDER-ONLY",
          productOrderId: "COUPANG-PRODUCT",
          trackingNumber: "99887766",
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.partial, true);
  assert.equal(captured.ssgDispatch.dispatchProductOrders[0].shppNo, "SSG-SHPP-NO");
  assert.equal(captured.ssgDispatch.dispatchProductOrders[0].shppSeq, "7");
  assert.equal(captured.ssgDispatch.dispatchProductOrders[0].odNo, "SSG-OD-NO");
  assert.equal(captured.ssgDispatch.dispatchProductOrders[0].procSeq, "SSG-PROC-SEQ");
  assert.equal(captured.ssgDispatch.dispatchProductOrders[0].trackingNumber, "AB-123-XY");
  assert.equal(captured.coupangDispatch.dispatchProductOrders[0].orderId, "COUPANG-ORDER-ONLY");
  assert.equal(captured.coupangDispatch.dispatchProductOrders[0].shipmentBoxId, "");
});

test("부분 실패 응답은 성공 채널 행만 FNOS 상태 반영 대상으로 분리한다", () => {
  assert.match(pageSource, /function onlineOrderStatusApiOutcome\(/);
  assert.match(pageSource, /const applySet = new Set<number>\(\[\.\.\.Array\.from\(unsupportedIndexes\), \.\.\.successfulApiIndexes\]\)/);

  const rows = [{ channelName: "11번가" }, { channelName: "쿠팡_WING" }, { channelName: "SSG신세계" }];
  const outcome = statusOutcome([0, 1, 2], rows, [
    { channel_name: "11번가", ok: true },
    { channel_name: "쿠팡", ok: false, message: "NOT_FOUND_SHIPMENT_BOX" },
    { channel_name: "SSG", ok: true },
  ]);
  assert.deepEqual(outcome.successIndexes, [0, 2]);
  assert.deepEqual(outcome.failedIndexes, [1]);
});

test("쿠팡 출고완료는 shipmentBoxId가 없을 때 orderId로 fallback하지 않는다", () => {
  assert.match(coupangSource, /const shipmentBoxId = text\(row\.shipmentBoxId \|\| row\.shipment_box_id \|\| row\.bundleOrderNo \|\| row\.bundle_order_no \|\| row\.bundleNo \|\| row\.bundle_no\);/);
  assertNotMatch(coupangSource, /const shipmentBoxId =[^;]+\|\| orderId;/, "Coupang shipmentBoxId가 orderId로 fallback하고 있습니다.");
  assertNotMatch(coupangSource, /confirmRows\.map\(\(row\) => text\([^\n]+row\.orderId/, "Coupang confirm shipmentBoxId가 orderId로 fallback하고 있습니다.");
});

test("11번가 배송처리 -3313 이미 배송중 응답은 멱등 성공으로 취급한다", () => {
  assert.match(elevenstSource, /function isIdempotentElevenstDispatchStatus/);
  assert.match(elevenstSource, /code === "-3313"/);
  assert.match(elevenstSource, /message\.includes\("배송중"\)/);
  assert.match(elevenstSource, /mode === "dispatch" && isIdempotentElevenstDispatchStatus\(status\)/);
});

test("SSG 주문확인/출고완료는 shppNo/shppSeq native ID를 우선 사용하고 실제 신규주문 코드를 과상향하지 않는다", () => {
  assert.match(ssgSource, /shppNo: firstText\(row\.shppNo, row\.shpp_no, fromProductShppNo,/);
  assert.match(ssgSource, /shppSeq: firstText\(row\.shppSeq, row\.shpp_seq, fromProductShppSeq,/);
  assert.match(ssgSource, /const detailCode = firstText\(row\.shppProgStatDtlCd\)/);
  assert.match(ssgSource, /const named = firstText\(row\.ordItemStatNm, row\.ordStatNm, row\.statusName\)/);

  assert.deepEqual(ssgShippingIds({ shppNo: "SHP-REAL", shppSeq: "3", orderId: "ORD-FALLBACK", productOrderId: "PROD" }), { shppNo: "SHP-REAL", shppSeq: "3" });
  assert.deepEqual(ssgShippingIds({ productOrderId: "SHP-FROM-PRODUCT-7", orderId: "ORD-FALLBACK" }), { shppNo: "SHP-FROM-PRODUCT", shppSeq: "7" });
  assert.equal(ssgOrderStatus({ shppProgStatDtlCd: "011", ordStatCd: 120, shppStatCd: 10, shppStatNm: "정상" }), "신규주문");
  assert.equal(ssgOrderStatus({ shppProgStatDtlCd: "012", ordItemStatNm: "신규주문" }), "주문확인");
});

test("온라인 주문 sync 저장/최근 출고 필터는 낮은 수집상태와 partial 실패로 기존 상태를 역행시키지 않는다", () => {
  assert.match(syncRouteSource, /const existingByNo = await existingOrdersByNo\(channel, orders\.map\(\(order\) => order\.orderNo\)\)/);
  assert.match(syncRouteSource, /orderStatusAdvanceRank\(existingStatus\) > orderStatusAdvanceRank\(collectedStatus\)/);
  assert.match(syncRouteSource, /function statusJobChannelSucceeded\(/);
  assert.match(syncRouteSource, /if \(!statusJobChannelSucceeded\(job, channelName\)\) return;/);

  assert.equal(statusAfterRebuild("출고완료", "주문확인"), "출고완료");
  assert.equal(statusAfterRebuild("출고대기", "신규주문"), "출고대기");
});
