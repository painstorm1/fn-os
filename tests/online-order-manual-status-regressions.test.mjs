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
  assert.match(source, /statusApplyIndexes\.forEach\(\(index\)/);
});
