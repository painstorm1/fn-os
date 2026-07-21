import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import XLSX from "xlsx";

const require = createRequire(import.meta.url);
const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));

function loadTsModule(relativePath, overrides = {}) {
  const source = readFileSync(path.join(root, relativePath), "utf8");
  const runnableSource = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (id) => id in overrides ? overrides[id] : require(id);
  vm.runInNewContext(runnableSource, {
    console,
    exports: loaded.exports,
    module: loaded,
    process,
    require: localRequire,
  }, { filename: relativePath });
  return loaded.exports;
}

const helper = loadTsModule("src/lib/lcl-fee.ts");
const calculate = (method, cbm, usdRate = 1500) => JSON.parse(JSON.stringify(helper.calculateLclFee(method, cbm, usdRate)));

const expectedTariffs = new Map([
  [0, [0, 0, 0]],
  [0.001, [31920, 45920, 10]],
  [0.5, [31920, 45920, 10]],
  [0.501, [59280, 77520, 12]],
  [1, [59280, 77520, 20]],
  [1.001, [65208, 85272, 22]],
  [650.2, [38543856, 50403504, 13004]],
  [650.201, [0, 0, 13006]],
]);

test("실제 XLSX 요율 경계와 최대값을 두 tariff family에서 보존한다", () => {
  for (const [cbm, [monWedFri, tueThuSun, cwcUsd]] of expectedTariffs) {
    const first = calculate("LCL(월수금)", cbm);
    const second = calculate("LCL(화목일)", cbm);
    assert.equal(first.shipping_fee, monWedFri, `월수금 ${cbm}`);
    assert.equal(second.shipping_fee, tueThuSun, `화목일 ${cbm}`);
    assert.equal(first.cwc_usd, cwcUsd, `CWC ${cbm}`);
    assert.equal(second.cwc_usd, cwcUsd, `CWC ${cbm}`);
  }
});

test("legacy method aliases와 unknown 월수금 fallback을 보존한다", () => {
  assert.equal(calculate("LCL(분할)", 1.001).shipping_fee, 65208);
  assert.equal(calculate("LCL(전체)", 1.001).shipping_fee, 85272);
  assert.equal(calculate("알 수 없음", 1.001).shipping_fee, 65208);
});

test("고정비, CWC 및 Python half-even 반올림을 보존한다", () => {
  assert.deepEqual(calculate("LCL(분할)", 1.05, 1437.75), {
    method: "LCL(분할)",
    cbm: 1.05,
    shipping_fee: 65208,
    origin_certificate: 33000,
    bl_charge: 22000,
    forwarder_hc: 11000,
    cwc_usd: 22,
    usd_rate: 1437.75,
    cwc_krw: 31630,
  });
  assert.equal(helper.roundHalfEven(2.5), 2);
  assert.equal(helper.roundHalfEven(3.5), 4);
});

test("비정상 수치가 JSON 비유한값을 만들지 않는다", () => {
  for (const cbm of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    const result = calculate("", cbm, Number.NaN);
    assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/);
    assert.equal(result.shipping_fee, 0);
    assert.equal(result.usd_rate, 1500);
  }
});

test("XLSX 파싱 결과를 모듈 단위로 한 번만 캐시한다", () => {
  let reads = 0;
  const cachedHelper = loadTsModule("src/lib/lcl-fee.ts", {
    "node:fs": {
      readFileSync(filePath) {
        reads += 1;
        return readFileSync(filePath);
      },
    },
  });
  cachedHelper.calculateLclFee("LCL(월수금)", 0.5, 1500);
  cachedHelper.calculateLclFee("LCL(화목일)", 1, 1500);
  assert.equal(reads, 1);
});

test("배포 workbook의 구조와 SHA256이 legacy 원본과 일치한다", () => {
  const workbookPath = path.join(root, "data", "타배_배송비용.xlsx");
  const bytes = readFileSync(workbookPath);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "dbdb0f03dd6f92629d4ef07523b9894e4f42e15bac2b8b5dfd1f0fc56bba2cd8");
  const workbook = XLSX.read(bytes, { type: "buffer" });
  assert.ok(workbook.SheetNames.includes("LCL(월수금)"));
  assert.ok(workbook.SheetNames.includes("LCL(화목일)"));
  for (const sheetName of ["LCL(월수금)", "LCL(화목일)"]) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
    assert.equal(rows[1][0], "0.5cbm");
    assert.equal(rows.at(-1)[0], "650.2cbm");
  }
});

test("route가 import_erp_fx_rates의 USD를 읽고 DB 없음/오류를 1500으로 fallback한다", async () => {
  let queryResult = [{ rate: 1380 }];
  let queryError = null;
  const calls = [];
  const route = loadTsModule("src/app/api/lcl-fee/route.ts", {
    "next/server": {
      NextResponse: {
        json(body, init = {}) {
          return { body, status: init.status ?? 200 };
        },
      },
    },
    "@/lib/fnos-db": {
      async selectRows(...args) {
        calls.push(args);
        if (queryError) throw queryError;
        return queryResult;
      },
    },
    "@/lib/lcl-fee": helper,
  });
  const request = { nextUrl: new URL("http://fnos.test/api/lcl-fee?cbm=0.001&method=LCL(%EB%B6%84%ED%95%A0)") };

  const dbResponse = await route.GET(request);
  assert.equal(dbResponse.status, 200);
  assert.equal(dbResponse.body.cwc_krw, 13800);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ["import_erp_fx_rates", { select: "rate", currency: "eq.USD", limit: 1 }]);

  queryResult = [];
  assert.equal((await route.GET(request)).body.cwc_krw, 15000);
  queryError = new Error("DB unavailable");
  assert.equal((await route.GET(request)).body.cwc_krw, 15000);
});

test("route는 method 누락 기본값을 쓰며 IMPORT_ERP_SOURCE에 의존하지 않는다", async () => {
  const routeSource = readFileSync(path.join(root, "src/app/api/lcl-fee/route.ts"), "utf8");
  assert.match(routeSource, /\?\? "LCL\(분할\)"/);
  assert.doesNotMatch(routeSource, /IMPORT_ERP_SOURCE|localhost:5500|handleLocalImportErp/);
});

test("UI는 direct /api/lcl-fee를 호출하고 비-2xx를 계산하지 않는다", () => {
  const pageSource = readFileSync(path.join(root, "src/app/page.tsx"), "utf8");
  assert.match(pageSource, /path === "\/api\/lcl-fee"/);
  assert.match(pageSource, /if \(!res\.ok\) throw new Error/);
  assert.doesNotMatch(pageSource, /\/api\/import-erp\/api\/lcl-fee|localhost:5500/);
});

test("기존 middleware 인증과 Vercel workbook tracing에 연결된다", () => {
  const middlewareSource = readFileSync(path.join(root, "middleware.ts"), "utf8");
  const proxySource = readFileSync(path.join(root, "proxy.ts"), "utf8");
  const configSource = readFileSync(path.join(root, "next.config.ts"), "utf8");
  assert.match(middlewareSource, /export const middleware = proxy/);
  assert.match(proxySource, /if \(isApi\)/);
  assert.match(proxySource, /status: 401/);
  assert.doesNotMatch(proxySource, /lcl-fee/);
  assert.match(configSource, /"\/api\/lcl-fee": \["\.\/data\/타배_배송비용\.xlsx"\]/);
});
