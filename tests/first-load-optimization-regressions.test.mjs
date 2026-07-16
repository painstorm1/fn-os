import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const routeSource = readFileSync(new URL("../src/app/api/dashboard/summary/route.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/app/main-dashboard.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const cacheSource = readFileSync(new URL("../src/lib/client-cache.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const resourceHintsSource = readFileSync(new URL("../src/app/resource-hints.tsx", import.meta.url), "utf8");
const globalsSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

const mainAllowlist = [
  "today",
  "collection_dates",
  "sales_label",
  "sales_latest_date",
  "sales_latest_amount",
  "seven_day_sales",
  "month_sales",
  "sales_daily",
  "order_count",
  "inventory_risk_count",
  "inquiry_channels",
  "ad_label",
  "ad_latest_date",
  "ad_latest_spend",
  "ad_seven_day_spend",
  "ad_month_spend",
  "ad_seven_day_roas",
  "ad_month_roas",
  "ad_conversion_sales",
  "ad_roas",
  "ad_daily",
  "card_expense_amount",
  "bank_balance",
  "upcoming_fixed_costs",
  "import_recent_orders",
  "import_monthly",
];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function runTranspiledModule(source, globals = {}) {
  const cjsModule = { exports: {} };
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { module: cjsModule, exports: cjsModule.exports, ...globals }, { filename: "first-load-regression-module.js" });
  return cjsModule.exports;
}

function loadDashboardSummaryGet({ mainDashboardSummary, salesHistorySummary }) {
  const source = routeSource.replace(/^import .*\r?\n/gm, "").concat("\nmodule.exports = { GET };\n");
  const FnosDbError = class FnosDbError extends Error {};
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status || 200 }) };
  return runTranspiledModule(source, {
    mainDashboardSummary,
    salesHistorySummary,
    FnosDbError,
    NextResponse,
    URL,
    Error,
  }).GET;
}

function fixtureSummary() {
  return {
    title: "legacy full title",
    today: "2026-07-16",
    collection_dates: { orders: "2026-07-15", ads: "2026-07-14", accounting: "2026-07-13" },
    sales_label: "sales label",
    sales_latest_date: "2026-07-15",
    sales_latest_amount: 101,
    seven_day_sales: 102,
    month_sales: 103,
    sales_daily: [{ date: "2026-07-15", value: 104 }],
    order_count: 105,
    inventory_risk_count: 106,
    inquiry_channels: [{ channel_name: "fixture", count: 107 }],
    ad_label: "ad label",
    ad_latest_date: "2026-07-14",
    ad_latest_spend: 108,
    ad_yesterday_spend: 109,
    ad_seven_day_spend: 110,
    ad_month_spend: 111,
    ad_seven_day_roas: 112,
    ad_month_roas: 113,
    ad_conversion_sales: 114,
    ad_roas: 115,
    ad_daily: [{ date: "2026-07-14", cost: 116, conversion_sales: 117, roas: 118 }],
    card_expense_amount: 119,
    bank_balance: 120,
    upcoming_fixed_costs: [{ id: "fixed", expected_amount: 121 }],
    import_recent_orders: [{ id: "import", repr_image: "fixture.png" }],
    import_six_month_amount: 122,
    import_monthly: [{ month: "202607", value: 123, count: 1, orders: [{ id: "nested" }] }],
    legacy_only: { must: "remain on legacy scopes" },
  };
}

test("scope=main is exact opt-in, calls the full summary once, and deep-projects only the dashboard allowlist", async () => {
  const full = fixtureSummary();
  let mainCalls = 0;
  const GET = loadDashboardSummaryGet({
    mainDashboardSummary: async () => {
      mainCalls += 1;
      return full;
    },
    salesHistorySummary: async () => ({ sales_history: true }),
  });

  const response = await GET(new Request("http://localhost/api/dashboard/summary?scope=main"));
  const expected = Object.fromEntries(mainAllowlist.map((key) => [key, full[key]]));

  assert.equal(response.status, 200);
  assert.equal(mainCalls, 1, "mainDashboardSummary must run exactly once for scope=main");
  assert.deepEqual(Object.keys(response.body).sort(), ["ok", ...mainAllowlist].sort());
  assert.deepEqual(plain(response.body), { ok: true, ...expected });
  assert.deepEqual(plain(response.body.import_monthly), full.import_monthly, "nested projected values must stay unchanged");
});

test("default, unknown, and sales-history dashboard contracts remain unchanged", async () => {
  const full = fixtureSummary();
  const salesHistory = { recent_sales: [{ id: "sale" }], inventory_sales_basis: [{ id: "movement" }] };
  let mainCalls = 0;
  let salesHistoryCalls = 0;
  const GET = loadDashboardSummaryGet({
    mainDashboardSummary: async () => {
      mainCalls += 1;
      return full;
    },
    salesHistorySummary: async () => {
      salesHistoryCalls += 1;
      return salesHistory;
    },
  });

  const defaultResponse = await GET(new Request("http://localhost/api/dashboard/summary"));
  const unknownResponse = await GET(new Request("http://localhost/api/dashboard/summary?scope=unknown"));
  const salesResponse = await GET(new Request("http://localhost/api/dashboard/summary?scope=sales-history"));

  assert.deepEqual(plain(defaultResponse.body), { ok: true, ...full });
  assert.deepEqual(plain(unknownResponse.body), { ok: true, ...full });
  assert.deepEqual(plain(salesResponse.body), { ok: true, ...salesHistory });
  assert.equal(mainCalls, 2);
  assert.equal(salesHistoryCalls, 1);
});

test("main dashboard initial/read/fetch caches share one scoped URL and import thumbnails are deferred", () => {
  const consumedSummaryKeys = Array.from(
    new Set(Array.from(dashboardSource.matchAll(/summary\?\.([a-z_]+)/g), (match) => match[1])),
  ).filter((key) => key !== "ok" && key !== "error");
  assert.deepEqual(consumedSummaryKeys.sort(), [...mainAllowlist].sort(), "main allowlist must equal the fields rendered by MainDashboard");
  assert.match(dashboardSource, /const MAIN_DASHBOARD_SUMMARY_URL = "\/api\/dashboard\/summary\?scope=main";/);
  const cacheArguments = Array.from(
    dashboardSource.matchAll(/(?:readInitialCachedJson|readCachedJson|cachedJson)<DashboardSummary>\(([^,]+)/g),
    (match) => match[1].trim(),
  );
  assert.deepEqual(cacheArguments, [
    "MAIN_DASHBOARD_SUMMARY_URL",
    "MAIN_DASHBOARD_SUMMARY_URL",
    "MAIN_DASHBOARD_SUMMARY_URL",
  ]);
  assert.doesNotMatch(dashboardSource, /(?:readInitialCachedJson|readCachedJson|cachedJson)<DashboardSummary>\("\/api\/dashboard\/summary"/);
  assert.match(dashboardSource, /<img src=\{assetUrl\(row\.repr_image\)\} alt="" loading="lazy" decoding="async"/);
});

test("CalendarMemo requests fixed accounting scope without losing range, version, or occurrence consumption", () => {
  const start = pageSource.indexOf("function CalendarMemo()");
  const end = pageSource.indexOf("\n  function saveMemos", start);
  const calendarSource = pageSource.slice(start, end);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(calendarSource, /\?scope=fixed&from=\$\{encodeURIComponent\(start\)\}&to=\$\{encodeURIComponent\(end\)\}&v=\$\{encodeURIComponent\(ACCOUNTING_CACHE_VERSION\)\}/);
  assert.match(calendarSource, /accounting\?\.fixed_cost_occurrences/);
});

test("dashboard cache invalidation prefix removes the scoped memory and session entries", async () => {
  const sessionStorage = {
    getItem(key) { return Object.hasOwn(this, key) ? String(this[key]) : null; },
    setItem(key, value) { this[key] = String(value); },
    removeItem(key) { delete this[key]; },
  };
  const window = { sessionStorage };
  const payload = { ok: true, today: "2026-07-16" };
  const cache = runTranspiledModule(cacheSource, {
    window,
    fetch: async () => ({ ok: true, status: 200, json: async () => payload }),
    Date,
    Promise,
    Map,
    JSON,
    Object,
    Array,
    Error,
  });
  const scopedUrl = "/api/dashboard/summary?scope=main";

  await cache.cachedJson(scopedUrl);
  assert.deepEqual(plain(cache.readCachedJson(scopedUrl)), payload);
  assert.ok(Object.keys(sessionStorage).some((key) => key.includes(scopedUrl)));

  cache.invalidateClientCache("/api/dashboard/summary");
  assert.equal(cache.readCachedJson(scopedUrl), null);
  assert.equal(Object.keys(sessionStorage).some((key) => key.includes(scopedUrl)), false);
});

test("jsDelivr hints use the Next-supported ReactDOM API and leave the Pretendard import chain intact", () => {
  assert.match(layoutSource, /<ResourceHints \/>/);
  assert.match(resourceHintsSource, /ReactDOM\.preconnect\("https:\/\/cdn\.jsdelivr\.net", \{ crossOrigin: "anonymous" \}\)/);
  assert.match(resourceHintsSource, /ReactDOM\.prefetchDNS\("https:\/\/cdn\.jsdelivr\.net"\)/);
  assert.equal(
    globalsSource.split(/\r?\n/, 1)[0],
    "@import url(\"https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css\");",
  );
});
