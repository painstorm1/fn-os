import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadNaverAdapterWithMocks(fetch, recordWait) {
  const filename = resolve(projectRoot, "src/lib/channels/naver/index.ts");
  const waitPattern = /function wait\(ms: number\) \{\r?\n  return new Promise\(\(resolve\) => setTimeout\(resolve, ms\)\);\r?\n\}/g;
  const trappedWaitSource = `function wait(ms: number) {
  __recordWait(ms);
  return Promise.resolve();
}`;
  const original = readFileSync(filename, "utf8");
  assert.equal(original.match(waitPattern)?.length, 1, "expected to trap the production wait function exactly once");
  const compiled = ts.transpileModule(original.replace(waitPattern, trappedWaitSource), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: filename,
  }).outputText;
  const cjsModule = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "bcryptjs") return { hashSync: () => "signed-client-secret" };
    if (specifier === "../common/order-status") return { normalizeCollectableOnlineOrders: (orders) => orders };
    return createRequire(filename)(specifier);
  };
  new Function("require", "exports", "module", "fetch", "__recordWait", compiled)(
    localRequire,
    cjsModule.exports,
    cjsModule,
    fetch,
    recordWait,
  );
  return cjsModule.exports.NaverChannelAdapter;
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

test("네이버 4일 빈 주문 수집은 8개 조건 요청 사이에서만 500ms 대기한다", async () => {
  const events = [];
  const requests = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const request = { url, method: init.method || "GET", headers: init.headers || {} };
    requests.push(request);
    if (url.pathname.endsWith("/v1/oauth2/token")) {
      events.push({ type: "token" });
      return jsonResponse({ access_token: "test-token" });
    }
    events.push({
      type: "conditional",
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      status: url.searchParams.get("placeOrderStatusType"),
    });
    return jsonResponse({ data: { contents: [] } });
  };
  const NaverChannelAdapter = loadNaverAdapterWithMocks(fetch, (ms) => events.push({ type: "wait", ms }));

  const result = await new NaverChannelAdapter().collectOrders({
    api_client_id: "client-id",
    api_client_secret: "client-secret",
    from: "2026-07-13",
    to: "2026-07-16",
  });

  assert.deepEqual(result, {
    ok: true,
    data: [],
    message: "네이버 신규/주문확인 주문이 없습니다.",
  });

  const tokenRequests = requests.filter(({ url }) => url.pathname.endsWith("/v1/oauth2/token"));
  const conditionalRequests = requests.filter(({ url }) => url.pathname.endsWith("/v1/pay-order/seller/product-orders"));
  assert.equal(tokenRequests.length, 1);
  assert.equal(tokenRequests[0].method, "POST");
  assert.equal(conditionalRequests.length, 8);
  for (const request of conditionalRequests) {
    assert.equal(request.method, "GET");
    assert.equal(request.headers.Authorization, "Bearer test-token");
    assert.equal(request.url.searchParams.get("rangeType"), "PAYED_DATETIME");
    assert.equal(request.url.searchParams.get("productOrderStatuses"), "PAYED");
    assert.equal(request.url.searchParams.get("pageSize"), "300");
    assert.equal(request.url.searchParams.get("page"), "1");
    assert.equal(request.url.searchParams.get("quantityClaimCompatibility"), "true");
  }

  const expectedRanges = ["13", "14", "15", "16"].map((day) => ({
    from: `2026-07-${day}T00:00:00.000+09:00`,
    to: `2026-07-${day}T23:59:59.999+09:00`,
  }));
  const conditionalEvents = events.filter(({ type }) => type === "conditional");
  assert.deepEqual(
    conditionalEvents,
    expectedRanges.flatMap((range) => [
      { type: "conditional", ...range, status: "NOT_YET" },
      { type: "conditional", ...range, status: "OK" },
    ]),
  );

  const waits = events.filter(({ type }) => type === "wait");
  assert.deepEqual(waits, Array.from({ length: 7 }, () => ({ type: "wait", ms: 500 })));
  assert.deepEqual(
    events.slice(1).map(({ type, status }) => type === "wait" ? "wait:500" : `${type}:${status}`),
    [
      "conditional:NOT_YET", "wait:500", "conditional:OK", "wait:500",
      "conditional:NOT_YET", "wait:500", "conditional:OK", "wait:500",
      "conditional:NOT_YET", "wait:500", "conditional:OK", "wait:500",
      "conditional:NOT_YET", "wait:500", "conditional:OK",
    ],
  );
  assert.deepEqual(events.at(-1), { type: "conditional", ...expectedRanges.at(-1), status: "OK" });
});
