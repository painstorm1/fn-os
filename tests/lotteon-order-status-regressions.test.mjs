import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(resolve(projectRoot, relativePath), "utf8");
const lotteonSource = source("src/lib/channels/lotteon/index.ts");
const statusRouteSource = source("src/app/api/fnos/online-orders/status/route.ts");

function transpile(sourceText, filename) {
  return ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: filename,
  }).outputText;
}

function loadLotteonAdapter() {
  const filename = resolve(projectRoot, "src/lib/channels/lotteon/index.ts");
  const compiled = transpile(lotteonSource, filename);
  const cjsModule = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "../common/api-response") {
      return { readJsonApiResponse: async (response) => response.json() };
    }
    return createRequire(filename)(specifier);
  };
  new Function("require", "exports", "module", compiled)(localRequire, cjsModule.exports, cjsModule);
  return cjsModule.exports.LotteonChannelAdapter;
}

function loadStatusRoute(captured) {
  const filename = resolve(projectRoot, "src/app/api/fnos/online-orders/status/route.ts");
  const compiled = transpile(statusRouteSource, filename);
  const cjsModule = { exports: {} };
  const adapters = {
    LOTTEON: {
      dispatchOrders: async (params) => {
        captured.lotteonCalls = [...(captured.lotteonCalls || []), params];
        return captured.lotteonResults?.shift() || { ok: true, data: null, message: "lotte ok" };
      },
    },
    SSG: {
      dispatchOrders: async (params) => {
        captured.ssg = params;
        return { ok: true, data: null, message: "ssg ok" };
      },
    },
  };
  const localRequire = (specifier) => {
    if (specifier === "next/server") {
      return {
        NextRequest: class NextRequest {},
        NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers || {} }) },
      };
    }
    if (specifier === "@/lib/channels/registry") {
      return {
        ONLINE_ORDER_ADAPTERS: adapters,
        onlineOrderAdapterCodeForChannel: (channel) => String(channel.channel_code || "").toUpperCase(),
      };
    }
    if (specifier === "@/lib/automation-jobs") return { createAutomationJob: async () => ({ id: "job-test" }) };
    if (specifier === "@/lib/fnos-db") {
      class FnosDbError extends Error { constructor(message) { super(message); this.status = 500; } }
      return {
        FnosDbError,
        hasDbConfig: () => true,
        patchRows: async (_table, filters, values) => {
          captured.patches = [...(captured.patches || []), { filters, values }];
          return [{ id: String(filters.id || "saved") }];
        },
        selectRows: async (table, query) => {
          if (table === "sales_channels") return [
            { id: "lotte", channel_name: "롯데ON", channel_code: "LOTTEON" },
            { id: "ssg", channel_name: "SSG신세계", channel_code: "SSG" },
          ];
          if (table !== "orders") return [];
          return [
            { id: "lotte-100", channel_name: "롯데ON", order_no: "OD-100", order_status: "주문확인" },
            { id: "lotte-101", channel_name: "롯데ON", order_no: "OD-101", order_status: "주문확인" },
            { id: "ssg-100", channel_name: "SSG신세계", order_no: "SSG-100", order_status: "주문확인" },
          ].filter((row) => String(query.order_no || "").includes(row.order_no));
        },
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

const validDispatchRow = (overrides = {}) => ({
  orderNo: "OD-100",
  productOrderId: "2",
  procSeq: "3",
  quantity: "1",
  deliveryCompanyCode: "HYUNDAI",
  trackingNumber: "AB-123-XY",
  ...overrides,
});

const jsonResponse = (body) => ({ json: async () => body });

async function withFetchMock(mock, run) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("롯데ON 수집은 API140 exact 상태만 권위로 사용하고 odNo별 한 번만 조회한다", async () => {
  const Adapter = loadLotteonAdapter();
  const calls = [];
  const api139Rows = [
    { odNo: "OD-MULTI", odSeq: "1", procSeq: "1", spdNo: "P-1", spdNm: "상품 1", odCmptDttm: "20260714100000" },
    { odNo: "OD-MULTI", odSeq: "2", procSeq: "1", spdNo: "P-2", spdNm: "상품 2", odCmptDttm: "20260714100000" },
    { odNo: "OD-STALE-13", odSeq: "1", procSeq: "1", spdNo: "P-13", spdNm: "stale confirmed", odCmptDttm: "20260714100000" },
    { odNo: "OD-12", odSeq: "1", procSeq: "1", spdNo: "P-12", spdNm: "상품준비", odCmptDttm: "20260714100000" },
    { odNo: "OD-14", odSeq: "1", procSeq: "1", spdNo: "P-14", spdNm: "배송중", odCmptDttm: "20260714100000" },
    { odNo: "OD-15", odSeq: "1", procSeq: "1", spdNo: "P-15", spdNm: "배송완료", odCmptDttm: "20260714100000" },
  ];
  const readbackRows = {
    "OD-MULTI": [
      { odNo: "OD-MULTI", odSeq: 1, procSeq: 1, odPrgsStepCd: "11", invcNbr: 0 },
      { odNo: "OD-MULTI", odSeq: 2, procSeq: 1, odPrgsStepCd: "13", invcNbr: 1 },
    ],
    "OD-STALE-13": [{ odNo: "OD-STALE-13", odSeq: 1, procSeq: 1, odPrgsStepCd: "13", invcNbr: 1 }],
    "OD-12": [{ odNo: "OD-12", odSeq: 1, procSeq: 1, odPrgsStepCd: "12", invcNbr: 0 }],
    "OD-14": [{ odNo: "OD-14", odSeq: 1, procSeq: 1, odPrgsStepCd: "14", invcNbr: 1 }],
    "OD-15": [{ odNo: "OD-15", odSeq: 1, procSeq: 1, odPrgsStepCd: "15", invcNbr: 1 }],
  };

  const result = await withFetchMock(async (url, init = {}) => {
    const call = { url: String(url), body: JSON.parse(String(init.body || "{}")) };
    calls.push(call);
    if (call.url.endsWith("SellerDeliveryProgressStateSearch")) {
      return jsonResponse({ data: { deliveryProgressStateList: readbackRows[call.body.odNo] || [] } });
    }
    return jsonResponse({ returnCode: "0000", deliveryOrderList: call.body.ifCplYN === "Y" ? api139Rows : [] });
  }, () => new Adapter().collectOrders({ api_key: "test-key", from: "20260714", to: "20260714" }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.map(({ orderNo, orderStatus }) => [orderNo, orderStatus]).sort(), [
    ["OD-12", "주문확인"],
    ["OD-MULTI", "신규주문"],
  ]);
  assert.equal(result.data.find((order) => order.orderNo === "OD-MULTI").items.length, 1, "같은 주문의 API140 stage13 상품행은 제외해야 합니다.");
  const readbackCalls = calls.filter((call) => call.url.endsWith("SellerDeliveryProgressStateSearch"));
  assert.equal(readbackCalls.length, 5);
  assert.equal(new Set(readbackCalls.map((call) => call.body.odNo)).size, 5);
});

test("롯데ON 수집은 API140 exact 행이 틀리거나 없으면 API139 후보를 포함하지 않는다", async () => {
  const Adapter = loadLotteonAdapter();
  const result = await withFetchMock(async (url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    if (String(url).endsWith("SellerDeliveryProgressStateSearch")) {
      return jsonResponse({ data: { deliveryProgressStateList: body.odNo === "OD-WRONG"
        ? [{ odNo: "OD-WRONG", odSeq: 999, procSeq: 1, odPrgsStepCd: "11" }]
        : [] } });
    }
    return jsonResponse({ returnCode: "0000", deliveryOrderList: body.ifCplYN ? [] : [
      { odNo: "OD-WRONG", odSeq: "1", procSeq: "1", spdNm: "wrong", odCmptDttm: "20260714100000" },
      { odNo: "OD-MISSING", odSeq: "1", procSeq: "1", spdNm: "missing", odCmptDttm: "20260714100000" },
    ] });
  }, () => new Adapter().collectOrders({ api_key: "test-key", from: "20260714", to: "20260714" }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.data, []);
  assert.match(result.error, /API140.*일치/);
});

test("롯데ON 수집은 API140 조회 실패 시 stale API139 결과 없이 실패한다", async () => {
  const Adapter = loadLotteonAdapter();
  const result = await withFetchMock(async (url, init = {}) => {
    if (String(url).endsWith("SellerDeliveryProgressStateSearch")) throw new Error("API140 unavailable");
    const body = JSON.parse(String(init.body || "{}"));
    return jsonResponse({ returnCode: "0000", deliveryOrderList: body.ifCplYN ? [] : [
      { odNo: "OD-STALE", odSeq: "1", procSeq: "1", spdNm: "stale", odCmptDttm: "20260714100000" },
    ] });
  }, () => new Adapter().collectOrders({ api_key: "test-key", from: "20260714", to: "20260714" }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.data, []);
  assert.match(result.error, /API140 unavailable/);
});

test("롯데ON 주문확인은 API210 ifCompleteList/ifCplYN=Y만 사용한다", async () => {
  const Adapter = loadLotteonAdapter();
  const calls = [];
  const result = await withFetchMock(async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body || "{}")) });
    return jsonResponse({ data: { rsltCd: "0000" } });
  }, () => new Adapter().confirmOrders({
    api_key: "test-key",
    confirm_path: "/legacy-confirm-must-not-run",
    if_complete_path: "/legacy-if-complete-must-not-run",
    confirmProductOrders: [{ orderNo: "OD-100", productOrderId: "2", procSeq: "3" }],
  }));

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /SellerIfCompleteInform$/);
  assert.doesNotMatch(calls[0].url, /SellerDeliveryProgressStateInform/);
  assert.deepEqual(calls[0].body, {
    ifCompleteList: [{ dvRtrvDvsCd: "DV", odNo: "OD-100", odSeq: 2, procSeq: 3, ifCplYN: "Y" }],
  });
});

test("롯데ON 주문확인은 공식 data.rsltCd 누락을 성공 처리하지 않는다", async () => {
  const Adapter = loadLotteonAdapter();
  let fetchCalls = 0;
  const result = await withFetchMock(async () => {
    fetchCalls += 1;
    return jsonResponse({ returnCode: "0000", data: {} });
  }, () => new Adapter().confirmOrders({
    api_key: "test-key",
    confirmProductOrders: [{ orderNo: "OD-100", productOrderId: "2", procSeq: "3" }],
  }));

  assert.equal(fetchCalls, 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /data\.rsltCd.*누락/);
});

test("롯데ON 주문확인은 data.rsltCd 실패와 root/data/result 혼합 failList를 모두 실패 처리한다", async () => {
  const Adapter = loadLotteonAdapter();
  const responses = [
    { data: { rsltCd: "9999", rsltMsg: "전체 실패" } },
    {
      data: { rsltCd: "0000", failList: [{ rsltMsg: "data 실패" }] },
      result: { failList: [{ rsltMsg: "result 실패" }] },
      failList: [],
    },
  ];
  const result = await withFetchMock(async () => jsonResponse(responses.shift()), () => new Adapter().confirmOrders({
    api_key: "test-key",
    confirmProductOrders: [
      { orderNo: "OD-100", productOrderId: "1", procSeq: "1" },
      ...Array.from({ length: 100 }, (_, index) => ({ orderNo: `OD-${index + 101}`, productOrderId: "1", procSeq: "1" })),
    ],
  }));

  assert.equal(result.ok, false);
  assert.match(result.error, /전체 실패/);
  assert.match(result.error, /data 실패/);
  assert.match(result.error, /result 실패/);
});

test("롯데ON 발송은 공식 API298 V2 필드와 영문/하이픈 송장 원문만 보내고 API140 exact stage13을 확인한다", async () => {
  const Adapter = loadLotteonAdapter();
  const calls = [];
  const result = await withFetchMock(async (url, init = {}) => {
    const call = { url: String(url), body: JSON.parse(String(init.body || "{}")) };
    calls.push(call);
    if (calls.length === 1) return jsonResponse({ data: { rsltCd: "0000" } });
    return jsonResponse({
      data: {
        deliveryProgressStateList: [{
          odNo: "OD-100",
          odSeq: 2,
          procSeq: 3,
          odPrgsStepCd: "13",
          invcNoList: ["AB-123-XY"],
        }],
      },
    });
  }, () => new Adapter().dispatchOrders({
    api_key: "test-key",
    status_path: "/legacy-mutation-must-not-run",
    status_search_path: "/legacy-readback-must-not-run",
    dispatchProductOrders: [validDispatchRow({ spdNo: "FORBIDDEN-SPD", sitmNo: "FORBIDDEN-SITM" })],
  }));

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/v1\/openapi\/delivery\/v2\/SellerDeliveryProgressStateInform$/);
  assert.match(calls[1].url, /\/v1\/openapi\/delivery\/v1\/SellerDeliveryProgressStateSearch$/);
  assert.deepEqual(calls[1].body, { odNo: "OD-100" });
  const mutationRow = calls[0].body.deliveryProgressStateList[0];
  assert.deepEqual(Object.keys(mutationRow).sort(), [
    "dvCoCd", "dvRtrvDvsCd", "dvTrcStatDttm", "invcNbr", "invcNoList", "odNo", "odPrgsStepCd", "odSeq", "procSeq", "slQty",
  ].sort());
  assert.equal(mutationRow.invcNbr, 1);
  assert.deepEqual(mutationRow.invcNoList, ["AB-123-XY"]);
  assert.equal(mutationRow.dvCoCd, "0001");
  assert.equal("spdNo" in mutationRow, false);
  assert.equal("sitmNo" in mutationRow, false);
});

test("롯데ON 발송은 필수 ID 누락/비정수면 fetch 전에 실패한다", async () => {
  const Adapter = loadLotteonAdapter();
  for (const row of [
    validDispatchRow({ orderNo: "" }),
    validDispatchRow({ productOrderId: "" }),
    validDispatchRow({ procSeq: "" }),
    validDispatchRow({ productOrderId: "x" }),
    validDispatchRow({ procSeq: "0" }),
  ]) {
    let fetchCalls = 0;
    const result = await withFetchMock(async () => { fetchCalls += 1; return jsonResponse({}); }, () => new Adapter().dispatchOrders({ api_key: "test-key", dispatchProductOrders: [row] }));
    assert.equal(result.ok, false);
    assert.equal(fetchCalls, 0);
  }
});

test("롯데ON 발송은 배송사/송장 누락·unknown·송장 30자 초과를 fetch 전에 실패한다", async () => {
  const Adapter = loadLotteonAdapter();
  for (const row of [
    validDispatchRow({ deliveryCompanyCode: "" }),
    validDispatchRow({ deliveryCompanyCode: "UNKNOWN" }),
    validDispatchRow({ deliveryCompanyCode: "1234" }),
    validDispatchRow({ trackingNumber: "" }),
    validDispatchRow({ trackingNumber: "X".repeat(31) }),
  ]) {
    let fetchCalls = 0;
    const result = await withFetchMock(async () => { fetchCalls += 1; return jsonResponse({}); }, () => new Adapter().dispatchOrders({ api_key: "test-key", dispatchProductOrders: [row] }));
    assert.equal(result.ok, false);
    assert.equal(fetchCalls, 0);
  }
});

test("롯데ON 발송 입력이 2행 이상이면 partial mutation 방지를 위해 fetch 0회로 거부한다", async () => {
  const Adapter = loadLotteonAdapter();
  let fetchCalls = 0;
  const result = await withFetchMock(async () => { fetchCalls += 1; return jsonResponse({}); }, () => new Adapter().dispatchOrders({
    api_key: "test-key",
    dispatchProductOrders: [validDispatchRow(), validDispatchRow({ productOrderId: "4" })],
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /1건|단일|여러/);
  assert.equal(fetchCalls, 0);
});

test("롯데ON API298의 top/data/result 실패 gate는 API140 readback 전에 중단한다", async () => {
  const Adapter = loadLotteonAdapter();
  let fetchCalls = 0;
  const result = await withFetchMock(async () => {
    fetchCalls += 1;
    return jsonResponse({ data: { rsltCd: "0000" }, result: { failList: [{ rsltMsg: "mutation 실패" }] } });
  }, () => new Adapter().dispatchOrders({ api_key: "test-key", dispatchProductOrders: [validDispatchRow()] }));
  assert.equal(result.ok, false);
  assert.match(result.error, /mutation 실패/);
  assert.equal(fetchCalls, 1);
});

test("롯데ON API140 stage11/12는 최대 3회 readback 후 실패하며 mutation은 재시도하지 않는다", async () => {
  const Adapter = loadLotteonAdapter();
  const calls = [];
  const stages = ["11", "12", "12"];
  const result = await withFetchMock(async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return jsonResponse({ data: { rsltCd: "0000" } });
    return jsonResponse({ data: { deliveryProgressStateList: [{ odNo: "OD-100", odSeq: 2, procSeq: 3, odPrgsStepCd: stages.shift() }] } });
  }, () => new Adapter().dispatchOrders({ api_key: "test-key", dispatchProductOrders: [validDispatchRow()] }));

  assert.equal(result.ok, false);
  assert.equal(calls.filter((url) => url.includes("SellerDeliveryProgressStateInform")).length, 1);
  assert.equal(calls.filter((url) => url.includes("SellerDeliveryProgressStateSearch")).length, 3);
  assert.match(result.error, /11|12|확인/);
});

test("롯데ON API140 wrong exact row는 3회 후 실패한다", async () => {
  const Adapter = loadLotteonAdapter();
  let fetchCalls = 0;
  const result = await withFetchMock(async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return jsonResponse({ data: { rsltCd: "0000" } });
    return jsonResponse({ data: { deliveryProgressStateList: [{ odNo: "OD-100", odSeq: 999, procSeq: 3, odPrgsStepCd: "13" }] } });
  }, () => new Adapter().dispatchOrders({ api_key: "test-key", dispatchProductOrders: [validDispatchRow()] }));
  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 4);
  assert.match(result.error, /일치|식별/);
});

test("롯데ON API140 invoice가 반환되면 송장 원문 불일치는 3회 후 실패한다", async () => {
  const Adapter = loadLotteonAdapter();
  let fetchCalls = 0;
  const result = await withFetchMock(async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return jsonResponse({ data: { rsltCd: "0000" } });
    return jsonResponse({ data: { deliveryProgressStateList: [{ odNo: "OD-100", odSeq: 2, procSeq: 3, odPrgsStepCd: "14", invcNoList: ["DIFFERENT"] }] } });
  }, () => new Adapter().dispatchOrders({ api_key: "test-key", dispatchProductOrders: [validDispatchRow()] }));
  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 4);
  assert.match(result.error, /송장/);
});

test("상태 route는 롯데ON 복수행만 순차 단일행 호출하고 다른 채널 batch 경로는 유지한다", async () => {
  const captured = {};
  const route = loadStatusRoute(captured);
  const response = await route.POST({
    json: async () => ({
      action: "dispatch",
      use_worker: false,
      rows: [
        { channelName: "롯데ON", persistedOrderNo: "OD-100", orderId: "OD-100", productOrderId: "2", procSeq: "3", trackingNumber: "LOTTE-TRACK" },
        { channelName: "롯데ON", persistedOrderNo: "OD-101", orderId: "OD-101", productOrderId: "4", procSeq: "5", trackingNumber: "" },
        { channelName: "SSG신세계", persistedOrderNo: "SSG-100", orderId: "SSG-100", productOrderId: "SSG-2", trackingNumber: "SSG-TRACK" },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(captured.lotteonCalls.length, 2);
  assert.deepEqual(captured.lotteonCalls.map((call) => call.dispatchProductOrders.length), [1, 1]);
  assert.equal(captured.lotteonCalls[0].dispatchProductOrders[0].deliveryCompanyCode, "");
  assert.equal(captured.ssg.dispatchProductOrders[0].deliveryCompanyCode, "CJGLS");
  assert.equal("spdNo" in captured.lotteonCalls[0].dispatchProductOrders[0], false);
  assert.equal("sitmNo" in captured.lotteonCalls[0].dispatchProductOrders[0], false);
});

test("상태 route는 롯데ON 행별 실패를 부분결과로 반환하고 모든 행이 성공한 주문만 출고완료 저장한다", async () => {
  const captured = {
    lotteonResults: [
      { ok: true, data: { row: 1 }, message: "first ok" },
      { ok: false, data: { row: 2 }, error: "second failed" },
      { ok: true, data: { row: 3 }, message: "third ok" },
    ],
  };
  const route = loadStatusRoute(captured);
  const response = await route.POST({
    json: async () => ({
      action: "dispatch",
      use_worker: false,
      rows: [
        { channelName: "롯데ON", persistedOrderNo: "OD-100", orderId: "OD-100", productOrderId: "2", procSeq: "3", trackingNumber: "TRACK-1" },
        { channelName: "롯데ON", persistedOrderNo: "OD-100", orderId: "OD-100", productOrderId: "4", procSeq: "5", trackingNumber: "TRACK-2" },
        { channelName: "롯데ON", persistedOrderNo: "OD-101", orderId: "OD-101", productOrderId: "6", procSeq: "7", trackingNumber: "TRACK-3" },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.partial, true);
  assert.match(response.body.error, /second failed/);
  assert.equal(captured.lotteonCalls.length, 3);
  assert.deepEqual(captured.lotteonCalls.map((call) => call.dispatchProductOrders.length), [1, 1, 1]);
  assert.equal(response.body.results[0].ok, false);
  assert.equal(response.body.results[0].partial, true);
  assert.equal(response.body.results[0].success_count, 2);
  assert.equal(response.body.results[0].failed_count, 1);
  assert.equal(response.body.results[0].persisted_count, 1);
  assert.match(response.body.results[0].message, /2\/3건 성공.*second failed/);
  assert.deepEqual(response.body.results[0].raw.map((result) => result.ok), [true, false, true]);
  assert.deepEqual(captured.patches.map((patch) => patch.filters.id), ["eq.lotte-101"]);
});
