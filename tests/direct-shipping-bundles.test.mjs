import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(projectRoot, "src/lib/direct-shipping-bundles.ts");
const helperSource = readFileSync(helperPath, "utf8");
const pageSource = readFileSync(resolve(projectRoot, "src/app/page.tsx"), "utf8");

function loadHelper() {
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: helperPath,
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "exports", "module", compiled)(require, cjsModule.exports, cjsModule);
  return cjsModule.exports;
}

const {
  groupDirectShippingSourceIndexes,
  planDirectShippingBundleSelection,
  resolveDirectShippingBundleSelection,
  splitDirectShippingDisplayedSources,
} = loadHelper();

const row = (sourceIndex, bundleOrderNo = "", extra = {}) => ({
  sourceIndex,
  bundleOrderNo,
  recipient: `수취인-${sourceIndex}`,
  orderOption: `옵션-${sourceIndex}`,
  assignedPartner: "",
  storedPartner: "",
  ...extra,
});

test("4/7 묶음은 연속 정렬되고 그룹 sequence를 공유한다", () => {
  const grouped = groupDirectShippingSourceIndexes(
    [4, 5, 6, 7],
    [row(4, "B-1"), row(5), row(6), row(7, "B-1")],
  );
  assert.deepEqual(grouped.map((item) => item.sourceIndex), [4, 7, 5, 6]);
  assert.deepEqual(grouped.map((item) => item.sequence), [1, 1, 2, 3]);
});

test("빈 묶음번호는 값이 같아도 각 행이 독립 그룹이다", () => {
  const grouped = groupDirectShippingSourceIndexes(
    [3, 1, 2],
    [row(1), row(2), row(3)],
  );
  assert.deepEqual(grouped.map((item) => item.sourceIndex), [1, 2, 3]);
  assert.deepEqual(grouped.map((item) => item.sequence), [1, 2, 3]);
});

test("반대 partner 행은 경고되며 자동 포함 대상에서 제외된다", () => {
  const plan = planDirectShippingBundleSelection({
    partner: "JB",
    selectedSourceIndexes: [4],
    rows: [
      row(4, "B-1"),
      row(7, "B-1", { assignedPartner: "케이모아", storedPartner: "케이모아" }),
      row(8, "B-1"),
      row(9, "B-1", { assignedPartner: "JB" }),
    ],
  });
  assert.deepEqual(plan.eligibleMissingSourceIndexes, [8, 9]);
  assert.deepEqual(plan.blockedMissingSourceIndexes, [7]);
  assert.equal(plan.bundles[0].rows.find((item) => item.sourceIndex === 7)?.status, "opposite-partner");
  assert.equal(plan.bundles[0].rows.find((item) => item.sourceIndex === 9)?.status, "same-partner");
  assert.deepEqual(resolveDirectShippingBundleSelection(plan, "include-eligible"), [4, 8, 9]);

  const oppositeSelected = planDirectShippingBundleSelection({
    partner: "JB",
    selectedSourceIndexes: [7],
    rows: [row(7, "B-1", { assignedPartner: "케이모아", storedPartner: "케이모아" })],
  });
  assert.deepEqual(resolveDirectShippingBundleSelection(oppositeSelected, "selected-only"), []);
});

test("여러 묶음의 누락과 경고를 한 payload로 만든다", () => {
  const plan = planDirectShippingBundleSelection({
    partner: "케이모아",
    selectedSourceIndexes: [1, 10],
    rows: [
      row(1, "A"),
      row(2, "A"),
      row(10, "B"),
      row(11, "B", { assignedPartner: "JB" }),
    ],
  });
  assert.deepEqual(plan.bundles.map((bundle) => bundle.bundleOrderNo), ["A", "B"]);
  assert.deepEqual(plan.eligibleMissingSourceIndexes, [2]);
  assert.deepEqual(plan.blockedMissingSourceIndexes, [11]);
});

test("yes/no/cancel 결정은 eligible/원선택/빈 목록으로 고정된다", () => {
  const plan = planDirectShippingBundleSelection({
    partner: "JB",
    selectedSourceIndexes: [4],
    rows: [row(4, "B"), row(5, "B"), row(6, "B", { assignedPartner: "케이모아" })],
  });
  assert.deepEqual(resolveDirectShippingBundleSelection(plan, "include-eligible"), [4, 5]);
  assert.deepEqual(resolveDirectShippingBundleSelection(plan, "selected-only"), [4]);
  assert.deepEqual(resolveDirectShippingBundleSelection(plan, "cancel"), []);
});

test("수동 정렬 또는 stale workspace 화면의 삭제 행은 표시 source index로 해석한다", () => {
  assert.deepEqual(
    splitDirectShippingDisplayedSources([5, 4, 7, 6], [0]),
    { removedSourceIndexes: [5], retainedSourceIndexes: [4, 7, 6] },
  );
  assert.deepEqual(
    splitDirectShippingDisplayedSources([4, 5, 6, 7], [1]),
    { removedSourceIndexes: [5], retainedSourceIndexes: [4, 6, 7] },
  );
});

test("React popup과 저장/내보내기 경로가 묶음 helper를 사용한다", () => {
  assert.match(pageSource, /title="묶음배송 누락 확인"/);
  assert.match(pageSource, />\s*네, 직송파일 함께 생성\s*</);
  assert.match(pageSource, />\s*아니요, 해당건만 파일생성\s*</);
  assert.match(pageSource, /다른 직송처가 섞여 있음 \/ 자동 포함 불가/);
  assert.match(pageSource, /onClose=\{\(\) => setDirectShippingBundlePrompt\(null\)\}/);
  const makeStart = pageSource.indexOf("  async function makeDirectShippingFile");
  const makeEnd = pageSource.indexOf("  async function applyDirectShippingBundleDecision", makeStart);
  assert.notEqual(makeStart, -1);
  assert.notEqual(makeEnd, -1);
  assert.match(pageSource.slice(makeStart, makeEnd), /planDirectShippingBundleSelection/);
  assert.doesNotMatch(pageSource.slice(makeStart, makeEnd), /window\.confirm/);
  assert.match(pageSource, /function currentDirectShippingRows[\s\S]*groupedDirectShippingSources\(partner\)[\s\S]*mapper\(sourceRow, sequence\)/);
  assert.match(pageSource, /async function removeDirectShippingRows[\s\S]*groupDirectShippingSourceIndexes/);
  assert.match(pageSource, /async function removeDirectShippingRows[\s\S]*splitDirectShippingDisplayedSources/);
  assert.doesNotMatch(pageSource, /function mergeDirectShippingRows/);
  assert.doesNotMatch(pageSource, /function directShippingCode/);
});

test("기존 직송 mapping schema와 쇼핑몰코드 패턴을 유지한다", () => {
  assert.match(pageSource, /const jbDirectHeaders = \[\s*"쇼핑몰코드",[\s\S]*salesSheetHeaders\.송장출력용\.filter/);
  assert.match(pageSource, /const kemoreDirectHeaders = \["쇼핑몰코드", "수량", "수취인", "수취인연락처1", "수취인연락처2", "주문옵션", "우편번호", "주소", "배송구분", "배송금액", "선불\/착불", "배송요청사항", "발송처", "발송처TEL"\]/);
  assert.match(pageSource, /`\$\{mmdd\}-JB-\$\{String\(sequence\)\.padStart\(3, "0"\)\}`/);
  assert.match(pageSource, /`\$\{mmdd\}-에프엔-\$\{String\(sequence\)\.padStart\(3, "0"\)\}`/);
});
