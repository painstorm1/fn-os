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
  const fnosDb = {
    hasDbConfig: () => true,
    selectRows: async (table) => table === "import_erp_fx_rates" ? [{ rate: 1380 }] : [],
    insertRows: async (table, rows) => table === "ad_upload_batches" ? [{ id: "batch" }] : rows,
    deleteRows: async () => [],
    patchRows: async () => [],
    upsertRows: async () => [],
  };
  new Function("require", "exports", "module", compiled)(() => fnosDb, cjsModule.exports, cjsModule);
  return cjsModule.exports.importAdRows;
}

test("Naver GFA keeps legitimate zero rows without weakening other ad filtering", async () => {
  const importAdRows = loadImportAdRows();
  const zeroRow = { "광고 그룹 이름": "GFA ad group", "노출수": 0, "클릭수": 0, "총비용": 0 };

  assert.equal((await importAdRows([zeroRow], "네이버GFA")).success_count, 1);
  assert.equal((await importAdRows([zeroRow], "네이버쇼핑검색")).success_count, 0);
  assert.equal((await importAdRows([{ ...zeroRow, "노출수": 1 }], "네이버쇼핑검색")).success_count, 1);
});
