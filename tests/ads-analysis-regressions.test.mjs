import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const filename = new URL("../src/lib/ads-analysis.ts", import.meta.url);
const source = readFileSync(filename, "utf8");

function loadImportAdRows() {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  const insertedReports = [];
  const fnosDb = {
    hasDbConfig: () => true,
    selectRows: async (table) => table === "import_erp_fx_rates" ? [{ rate: 1380 }] : [],
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
  return { importAdRows: cjsModule.exports.importAdRows, insertedReports };
}

test("Naver GFA keeps legitimate zero rows without weakening other ad filtering", async () => {
  const { importAdRows } = loadImportAdRows();
  const zeroRow = { "광고 그룹 이름": "GFA ad group", "노출수": 0, "클릭수": 0, "총비용": 0 };

  assert.equal((await importAdRows([zeroRow], "네이버GFA")).success_count, 1);
  assert.equal((await importAdRows([zeroRow], "네이버쇼핑검색")).success_count, 0);
  assert.equal((await importAdRows([{ ...zeroRow, "노출수": 1 }], "네이버쇼핑검색")).success_count, 1);
});

test("Naver GFA stores conversions only from the exact purchase-complete header", async () => {
  const { importAdRows, insertedReports } = loadImportAdRows();
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
