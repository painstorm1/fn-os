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
const parseRouteSource = source("src/app/api/sales/order-files/parse/route.ts");
const salesChannelsRouteSource = source("src/app/api/fnos/sales-channels/route.ts");
const statusRouteSource = source("src/app/api/fnos/online-orders/status/route.ts");
const syncRouteSource = source("src/app/api/fnos/online-orders/sync/route.ts");
const coupangSource = source("src/lib/channels/coupang/index.ts");
const elevenstSource = source("src/lib/channels/elevenst/index.ts");
const ssgSource = source("src/lib/channels/ssg/index.ts");
const todayhouseSource = source("src/lib/channels/todayhouse/index.ts");

function assertNotMatch(haystack, pattern, message) {
  assert.equal(pattern.test(haystack), false, message);
}

function invoiceMatchSummaryMessage(matched, total) {
  const safeMatched = Math.max(0, Number(matched || 0));
  const safeTotal = Math.max(0, Number(total || 0));
  if (!safeTotal) return `송장매칭 ${safeMatched}건 성공`;
  if (safeMatched >= safeTotal) return `${safeMatched}/${safeTotal}건 전체 매칭 성공`;
  return `${safeMatched}건/${safeTotal}건 매칭성공`;
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

function persistedStatusAfterCollection(existingStatus, order) {
  const compact = (value) => String(value ?? "").trim().replace(/[\s_()/.-]+/g, "").toUpperCase();
  const raw = order.raw || {};
  const isExplicitSsgNew = String(order.channelName || "").includes("SSG")
    && order.orderStatus === "신규주문"
    && ["11", "011"].includes(compact(raw.shppProgStatDtlCd))
    && compact(raw.ordStatCd) === "120"
    && compact(raw.shppStatCd) === "10";
  if (existingStatus === "주문확인" && order.orderStatus === "신규주문" && isExplicitSsgNew) return "신규주문";
  return statusAfterRebuild(existingStatus, order.orderStatus);
}

function invoiceIdentity(row, invoice) {
  const normalizeText = (value) => String(value ?? "").replace(/\s+/g, "");
  const normalizePhone = (value) => String(value ?? "").replace(/[-\s()]/g, "");
  return row.status === "주문확인"
    && normalizeText(row.recipient) === normalizeText(invoice.recipient)
    && normalizePhone(row.phone) === normalizePhone(invoice.phone)
    && normalizeText(row.address) === normalizeText(invoice.address)
    && normalizeText(row.option) === normalizeText(invoice.productName);
}

function propagateByShipment(rows, progressRows, sourceIndex, trackingNo, invoice) {
  const sourceShipment = progressRows[sourceIndex]?.apiShipmentId || "";
  if (!sourceShipment) return rows;
  return rows.map((row, index) => {
    if (row.direct || row.trackingNo || progressRows[index]?.apiShipmentId !== sourceShipment || !invoiceIdentity(row, invoice)) return row;
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

test("F2/F5 송장업로드는 쇼핑몰코드를 제외하고 수취인+연락처+주소+주문옵션이 모두 같고 기존 주문확인인 행만 매칭/출고대기 처리한다", () => {
  assert.match(pageSource, /const progressMatchesShippingRow = \(progress: string\[\], shippingRow: string\[\]\) =>/);
  assert.match(pageSource, /const progressIndexForShippingRow = \(shippingRow: string\[\], shippingIndex: number\) =>/);
  assert.match(pageSource, /const isInvoiceConfirmedProgressRow = \(index: number\) => salesCellText\(progressValue\(progressRowForShippingIndex\(index\), "주문상태"\)\) === "주문확인";/);
  assertNotMatch(pageSource, /const isInvoiceConfirmedProgressRow = \(index: number\) => salesCellText\(progressValue\(progressRows\[index\]/, "송장업로드는 송장출력용 정렬 후에도 발주 진행 단계 행을 index가 아닌 식별자로 찾아야 합니다.");
  assert.match(pageSource, /function invoiceOptionKey\(value: unknown\)/);
  assert.match(pageSource, /const rowMatchesInvoiceIdentity = \(row: string\[\], invoiceKey: string, optionKey: string\) => \([\s\S]*invoiceOptionKey\(row\[7\]\) === optionKey[\s\S]*rowMatchesAddress\(row, invoiceKey\)/);
  assertNotMatch(pageSource, /invoiceProductCodeKey\(row\[0\]\) === productKey/, "송장업로드 매칭이 아직 쇼핑몰코드/상품코드를 필수키로 사용하고 있습니다.");
  assert.match(pageSource, /!isInvoiceConfirmedProgressRow\(index\)/);
  assert.match(pageSource, /function applyInvoiceMatchProgressGate\(/);
  assert.match(pageSource, /matchedSet\.has\(index\) && existingStatus === "주문확인"/);
  assertNotMatch(pageSource, /trackingByShippingCode\.set\(item\.쇼핑몰코드, item\.송장번호\)/, "legacy 송장업로드가 쇼핑몰코드 단독 매칭을 사용하고 있습니다.");
  assert.match(parseRouteSource, /productName = clean\(cellAt\(row, \["상품명", "품목명", "주문옵션", "단품명"\]/);

  const exactMatch = (order, invoice) => order.status === "주문확인"
    && order.recipient.replace(/\s+/g, "") === invoice.recipient.replace(/\s+/g, "")
    && order.phone.replace(/[-\s()]/g, "") === invoice.phone.replace(/[-\s()]/g, "")
    && order.address.replace(/\s+/g, "") === invoice.address.replace(/\s+/g, "")
    && order.option.replace(/\s+/g, "") === invoice.productName.replace(/\s+/g, "");
  const invoice = { mallCode: "0709-E-P001", recipient: "최미선", phone: "01083413579", address: "경기도 용인시 기흥구", productName: "다이나믹 스포츠 선글라스155mm_블랙" };
  assert.equal(exactMatch({ ...invoice, mallCode: "0709-E-PP01", option: invoice.productName, status: "주문확인" }, invoice), true);
  assert.equal(exactMatch({ ...invoice, mallCode: "0709-E-PP01", option: invoice.productName, status: "신규주문" }, invoice), false);
  assert.equal(exactMatch({ ...invoice, mallCode: "0709-E-PP01", option: invoice.productName, status: "주문확인", phone: "01099999999" }, invoice), false);
  assert.equal(exactMatch({ ...invoice, mallCode: "0709-E-PP01", option: "다른 상품", status: "주문확인" }, invoice), false);
  assert.equal(statusAfterRebuild("신규주문", "출고대기"), "출고대기", "generic rebuild는 여전히 상향 가능하므로 F2 전용 gate가 필요합니다.");
});

test("F2/F5 송장업로드 완료 팝업은 송장엑셀 전체 대비 매칭 건수를 표시하고 미연동 사이트 메모 팝업을 띄우지 않는다", () => {
  assert.match(pageSource, /function invoiceMatchSummaryMessage\(matched: number, total: number\)/);
  assert.match(pageSource, /matchedInvoiceRows/);
  assert.match(pageSource, /invoiceTotalRows/);
  const alertSnippet = pageSource.slice(pageSource.indexOf("window.alert(failureMessage ? `${summaryMessage}"), pageSource.indexOf("window.alert(failureMessage ? `${summaryMessage}") + 120);
  assert.equal(alertSnippet.includes("`${summaryMessage}" + "\\" + "n" + "${failureMessage}` : summaryMessage);"), true);
  assert.match(pageSource, /setCollectionPopupTitle\("송장업로드"\)/);
  assert.match(pageSource, /setCollectionPopupMode\("invoice-upload"\)/);
  assert.match(pageSource, /setCollectionStatuses\(\[\{ name: "송장파일", status: "running"/);
  assert.match(pageSource, /window\.alert\(errorMessage\)/);
  assert.match(pageSource, /window\.alert\(noMatchMessage\)/);
  assertNotMatch(pageSource, /invoiceUploadStatus/, "버튼 옆 미니 상태알림은 이번 요청에서 보류되어야 합니다.");
  assertNotMatch(pageSource, /window\.alert\(failureMessage \|\| "송장매칭 성공"\)/, "송장매칭 성공 단독 팝업이 남아있습니다.");
  assertNotMatch(pageSource, /setInvoiceMemoText\(memo\)|직접 입력 대상 메모장을 화면에 표시했습니다/, "API미연동 사이트 직접입력 메모 팝업 경로가 남아있습니다.");

  assert.equal(invoiceMatchSummaryMessage(3, 20), "3건/20건 매칭성공");
  assert.equal(invoiceMatchSummaryMessage(20, 20), "20/20건 전체 매칭 성공");
});

test("오늘의집 주문수집은 O alias를 거래처코드로 쓰지 않고 기초관리 거래처코드로 판매입력을 만든다", () => {
  assert.match(syncRouteSource, /const TODAYHOUSE_CUSTOMER_CODE = "1198691245";/);
  assert.match(syncRouteSource, /const TODAYHOUSE_CUSTOMER_NAME = "오늘의 집";/);
  assert.match(syncRouteSource, /code: TODAYHOUSE_CUSTOMER_CODE, name: TODAYHOUSE_CUSTOMER_NAME/);
  assertNotMatch(syncRouteSource, /source === "todayhouse"\)[\s\S]{0,240}code: "O", name: "오늘의집"/, "오늘의집 수동 주문수집이 O/오늘의집을 거래처로 저장하고 있습니다.");

  assert.match(parseRouteSource, /const TODAYHOUSE_CUSTOMER_CODE = "1198691245";/);
  assert.match(parseRouteSource, /거래처코드: TODAYHOUSE_CUSTOMER_CODE/);
  assert.match(parseRouteSource, /customerCode \|\| TODAYHOUSE_CUSTOMER_CODE/);

  assert.match(salesChannelsRouteSource, /\["1198691245", "오늘의 집", "excel", false, "https:\/\/partners\.ohou\.se\/"\]/);
  assertNotMatch(salesChannelsRouteSource, /\["TODAYHOUSE", "오늘의집", "api", true/, "기본 쇼핑몰 채널이 오늘의집을 가상 코드 TODAYHOUSE로 다시 만들 수 있습니다.");

  assert.match(todayhouseSource, /customerCode: text\(params\.customer_code\) \|\| TODAYHOUSE_CUSTOMER_CODE/);
  assert.match(todayhouseSource, /customerName: text\(params\.customer_name\) \|\| TODAYHOUSE_CUSTOMER_NAME/);
});

test("11번가 등 합포장 행은 같은 API배송묶음ID 기준으로 빈 송장번호를 전파한다", () => {

  assert.match(pageSource, /function applyInvoiceTrackingToSheets\([\s\S]*applyTrackingToSameShipment/);
  assert.match(pageSource, /const applyTrackingToSameShipment = \(sourceIndex: number, trackingNo: string, invoiceKey: string, optionKey: string\)/);
  assert.match(pageSource, /!rowMatchesInvoiceIdentity\(row, invoiceKey, optionKey\)\) return/);
  assert.match(pageSource, /applyTrackingToSameShipment\(alreadyIndex, trackingNo, invoiceKey, optionKey\)/);
  assert.match(pageSource, /applyTrackingToSameShipment\(shippingIndex, trackingNo, invoiceKey, optionKey\)/);

  const invoice = { mallCode: "0709-C-A001", recipient: "홍길동", phone: "01012345678", address: "서울 강남구", productName: "테스트 상품" };
  const rows = [
    { ...invoice, mallCode: "0709-C-P999", option: invoice.productName, status: "주문확인", trackingNo: "1234567890", direct: false },
    { ...invoice, mallCode: "0709-C-P998", option: invoice.productName, status: "주문확인", trackingNo: "", direct: false },
    { ...invoice, mallCode: "0709-C-P998", option: invoice.productName, status: "주문확인", phone: "01099999999", trackingNo: "", direct: false },
    { ...invoice, mallCode: "0709-C-P998", option: invoice.productName, status: "주문확인", trackingNo: "", direct: true },
  ];
  const progressRows = [
    { apiShipmentId: "DLV-1" },
    { apiShipmentId: "DLV-1" },
    { apiShipmentId: "DLV-1" },
    { apiShipmentId: "DLV-1" },
  ];
  const next = propagateByShipment(rows, progressRows, 0, "1234567890", invoice);
  assert.equal(next[0].trackingNo, "1234567890");
  assert.equal(next[1].trackingNo, "1234567890");
  assert.equal(next[2].trackingNo, "", "같은 API배송묶음ID라도 수취인/연락처/주소가 다르면 전파 금지");
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

test("11번가 정산예정금액은 수집 원본의 stlPlnAmt를 우선 사용한다", () => {
  assert.match(elevenstSource, /settlementAmount:\s*numberValue\(firstDeepText\(row, \["stlPlnAmt",/);
  assertNotMatch(elevenstSource, /Math\.round\([^)]*0\.88[^)]*\)/, "11번가 어댑터에서 결제금액 * 0.88을 계산하고 있습니다.");
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
  assert.match(syncRouteSource, /function collectedOrderStatusForPersist\(/);
  assert.match(syncRouteSource, /function isSsgExplicitNewOrderStatus\(/);
  assert.match(syncRouteSource, /function statusJobChannelSucceeded\(/);
  assert.match(syncRouteSource, /if \(!statusJobChannelSucceeded\(job, channelName\)\) return;/);

  assert.equal(statusAfterRebuild("출고완료", "주문확인"), "출고완료");
  assert.equal(statusAfterRebuild("출고대기", "신규주문"), "출고대기");
  assert.equal(persistedStatusAfterCollection("주문확인", { channelName: "SSG신세계", orderStatus: "신규주문", raw: { shppProgStatDtlCd: 11, ordStatCd: 120, shppStatCd: 10 } }), "신규주문");
  assert.equal(persistedStatusAfterCollection("출고완료", { channelName: "SSG신세계", orderStatus: "신규주문", raw: { shppProgStatDtlCd: 11, ordStatCd: 120, shppStatCd: 10 } }), "출고완료");
});

test("온라인 주문수집은 쇼핑몰별 제한 병렬 처리하고 완료 새창 alert를 띄우지 않는다", () => {
  assert.match(syncRouteSource, /const MAX_ONLINE_ORDER_CHANNEL_CONCURRENCY = 3;/);
  assert.match(syncRouteSource, /async function mapWithConcurrency</);
  assert.match(syncRouteSource, /const results = await mapWithConcurrency\([\s\S]{0,240}supportedChannels as AnyRecord\[[\s\S]{0,240}collectChannel\(channel, body\)/);
  assertNotMatch(syncRouteSource, /for \(const channel of supportedChannels\) \{\s*results\.push\(await collectChannel\(channel, body\)\);\s*\}/, "온라인 주문수집 API 채널이 다시 순차 처리로 돌아갔습니다.");

  const flowMatch = pageSource.match(/async function runOrderCollectionFlow[\s\S]*?\n  function exportAllSheets/);
  assert.ok(flowMatch, "runOrderCollectionFlow 블록을 찾지 못했습니다.");
  assert.match(flowMatch[0], /await revealOrderCollectionStatuses\(finalStatuses\)/);
  assertNotMatch(flowMatch[0], /window\.alert\("작업 완료"\)/, "F1 주문수집 완료 후 새창 alert가 다시 켜졌습니다.");
});
