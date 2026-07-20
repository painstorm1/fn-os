import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const filename = new URL("../src/lib/ads-analysis.ts", import.meta.url);
const source = readFileSync(filename, "utf8");
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

function loadAdsAnalysis(tableRows = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  const insertedReports = [];
  const fnosDb = {
    hasDbConfig: () => true,
    selectRows: async (table) => tableRows[table] || (table === "import_erp_fx_rates" ? [{ rate: 1380 }] : []),
    insertRows: async (table, rows) => {
      if (table === "ad_upload_batches") return [{ id: "batch" }];
      if (table === "ad_reports") insertedReports.push(...rows);
      return rows;
    },
    deleteRows: async () => [],
    patchRows: async () => [],
    upsertRows: async () => [],
  };
  new Function("require", "exports", "module", compiled)(() => fnosDb, cjsModule.exports, cjsModule);
  return { ...cjsModule.exports, insertedReports };
}

test("Naver GFA keeps legitimate zero rows without weakening other ad filtering", async () => {
  const { importAdRows } = loadAdsAnalysis();
  const zeroRow = { "광고 그룹 이름": "GFA ad group", "노출수": 0, "클릭수": 0, "총비용": 0 };

  assert.equal((await importAdRows([zeroRow], "네이버GFA")).success_count, 1);
  assert.equal((await importAdRows([zeroRow], "네이버쇼핑검색")).success_count, 0);
  assert.equal((await importAdRows([{ ...zeroRow, "노출수": 1 }], "네이버쇼핑검색")).success_count, 1);
});

test("Naver GFA stores conversions only from the exact purchase-complete header", async () => {
  const { importAdRows, insertedReports } = loadAdsAnalysis();
  const exactPurchase = { "캠페인명": "exact", "노출수": 1, "구매완료 수": 10, "장바구니 담기 수": 36, "총 전환수": 46 };
  const aliasesOnly = {
    "캠페인명": "aliases",
    "노출수": 1,
    "구매완료 전환수": 11,
    "구매": 12,
    purchase_conversions: 13,
    "장바구니 담기 수": 36,
    "총 전환수": 46,
    "결과": 46,
  };

  for (const channel of ["네이버GFA", "네이버_GFA"]) {
    await importAdRows([exactPurchase, aliasesOnly], channel);
  }

  assert.deepEqual(insertedReports.map(({ channel, conversions }) => [channel, conversions]), [
    ["네이버GFA", 10],
    ["네이버GFA", 0],
    ["네이버_GFA", 10],
    ["네이버_GFA", 0],
  ]);
});

test("adsSummary separates daily metrics by date and channel and recalculates ROAS from totals", async () => {
  const { adsSummary } = loadAdsAnalysis({
    ad_reports: [
      { report_date: "2026-07-01", channel: "메타GFA", cost: 100, clicks: 10, conversions: 1, conversion_value: 200 },
      { report_date: "2026-07-01", channel: "메타GFA", cost: 300, clicks: 30, conversions: 2, conversion_value: 300 },
      { report_date: "2026-07-01", channel: "네이버GFA", cost: 50, clicks: 8, conversions: 4, conversion_value: 500 },
      { report_date: "2026-07-02", channel: "메타GFA", cost: 200, clicks: 0, conversions: 0, conversion_value: 100 },
      { report_date: "2026-06-30", channel: "메타GFA", cost: 999, clicks: 9, conversions: 9, conversion_value: 999 },
    ],
  });

  const summary = await adsSummary({ from: "2026-07-01", to: "2026-07-02" });
  assert.deepEqual(summary.dailyByChannel.map(({ date, channel, cost, conversion_value, conversions, roas, cvr }) => ({ date, channel, cost, conversion_value, conversions, roas, cvr })), [
    { date: "2026-07-01", channel: "네이버GFA", cost: 50, conversion_value: 500, conversions: 4, roas: 1000, cvr: 50 },
    { date: "2026-07-01", channel: "메타GFA", cost: 400, conversion_value: 500, conversions: 3, roas: 125, cvr: 7.5 },
    { date: "2026-07-02", channel: "메타GFA", cost: 200, conversion_value: 100, conversions: 0, roas: 50, cvr: 0 },
  ]);
});

test("channel performance page hides overview KPIs and wires preserved range plus selected-channel chart", () => {
  const detailStart = pageSource.indexOf("function AdsChannelDetailWorkspace");
  const detailEnd = pageSource.indexOf("function AdsAnalysisWorkspace", detailStart);
  const detailSource = pageSource.slice(detailStart, detailEnd);
  const workspaceStart = detailEnd;
  const workspaceEnd = pageSource.indexOf("function AdsRightPanel", workspaceStart);
  const workspaceSource = pageSource.slice(workspaceStart, workspaceEnd);
  const openRangeStart = pageSource.indexOf("function openAdRange", workspaceEnd);
  const openRangeEnd = pageSource.indexOf("function applyRangePreset", openRangeStart);
  const openRangeSource = pageSource.slice(openRangeStart, openRangeEnd);

  assert.match(workspaceSource, /adsSection !== "channels"\s*&&\s*\([\s\S]*?<AdsMetricCard label="총비용"/);
  assert.match(workspaceSource, /adMetricReportRows\(channels, adsSection === "channels" \? adReportChannelOrder : selectedAdChannels\)/);
  assert.match(workspaceSource, /<AdsLineChart rows=\{daily\} from=\{dateFrom\} to=\{dateTo\} \/>/);
  assert.match(openRangeSource, /searchParams\.get\("adsSection"\)[\s\S]*?params\.set\("adsSection"/);
  assert.match(openRangeSource, /searchParams\.get\("adsChannel"\)[\s\S]*?params\.set\("adsChannel"/);
  assert.match(detailSource, /dailyByChannel[\s\S]*?adChannelsMatch\(row\.channel, currentChannel\)/);
  assert.match(detailSource, /<AdsLineChart rows=\{channelDaily\} from=\{dateFrom\} to=\{dateTo\} exactRange channelMetrics/);
  assert.deepEqual([...detailSource.matchAll(/\{ label: "([^"]+)"/g)].map((match) => match[1]), [
    "총비용",
    "구매완료 전환매출액",
    "ROAS",
    "전환 구매 건수",
    "구매완료 전환율",
    "전환 구매당 광고비",
  ]);
  assert.doesNotMatch(detailSource, /아이템별 현재 데이터/);
});

test("channel-only chart keeps the overview chart unchanged and shows cost, ROAS, CVR, CPA", () => {
  const cpaStart = pageSource.indexOf("function adChartCpa");
  const chartStart = pageSource.indexOf("function AdsLineChart");
  const chartEnd = pageSource.indexOf("function AdsWorkflowSummary", chartStart);
  const cpaSource = pageSource.slice(cpaStart, chartStart);
  const chartSource = pageSource.slice(chartStart, chartEnd);

  const compiledCpa = ts.transpileModule(`${cpaSource}\nmodule.exports = { adChartCpa };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cpaModule = { exports: {} };
  new Function("module", "exports", "adNumber", compiledCpa)(cpaModule, cpaModule.exports, (value) => Number(value || 0));

  assert.match(chartSource, /channelMetrics\s*=\s*false/);
  assert.match(chartSource, /title=\{channelMetrics \? "성과 그래프" : "일별 광고비 \/ ROAS"\}/);
  assert.match(chartSource, /channelMetrics[\s\S]*?>총비용<[\s\S]*?>ROAS<[\s\S]*?>CVR<[\s\S]*?>CPA</);
  assert.match(chartSource, /adNumber\(row\.cvr\)/);
  assert.match(chartSource, /adChartCpa\(row\)/);
  assert.match(chartSource, /<span>CVR<\/span>[\s\S]*?adPercent2\(adNumber\(row\.cvr\)\)/);
  assert.match(chartSource, /<span>CPA<\/span>[\s\S]*?krw\(adChartCpa\(row\)\)/);
  assert.equal(cpaModule.exports.adChartCpa({ cost: 400, conversions: 3 }), 400 / 3);
  assert.equal(cpaModule.exports.adChartCpa({ cost: 200, conversions: 0 }), 0);
});
