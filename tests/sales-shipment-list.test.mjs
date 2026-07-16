import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(root, "src/lib/sales-shipment-list.ts");
const source = readFileSync(helperPath, "utf8");
const pageSource = readFileSync(resolve(root, "src/app/page.tsx"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
  fileName: helperPath,
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "exports", "module", compiled)(require, cjsModule.exports, cjsModule);
const { buildSalesShipmentList } = cjsModule.exports;

const row = (sourceIndex, productName, quantity, directShippingPartner = "") => ({
  rowNumber: sourceIndex + 1,
  sourceIndex,
  productName,
  quantity,
  directShippingPartner,
});
const uniqueRows = (count) => Array.from({ length: count }, (_, index) => row(index, `품목 ${index + 1}`, 1));

function build(rows, indexes = {}) {
  const result = buildSalesShipmentList(rows, indexes);
  assert.equal(result.ok, true);
  return result;
}

test("일반 품목명 공백을 정규화하고 수량을 숫자로 합산한다", () => {
  const result = build([row(0, "  테스트   품목 ", "1,200"), row(1, "테스트 품목", 3)]);
  assert.deepEqual(result.items, [{ productName: "테스트 품목", quantity: 1203, direct: false }]);
});

test("JB와 케이모아는 하나의 직송 구역으로 합산한다", () => {
  const result = build([row(0, "직송품", 2, "JB"), row(1, "직송품", 4, "케이모아")]);
  assert.deepEqual(result.items, [{ productName: "직송품", quantity: 6, direct: true }]);
});

test("같은 품목도 일반과 직송은 두 행으로 유지한다", () => {
  const result = build([row(0, "공통품", 2), row(1, "공통품", 4, "JB")]);
  assert.deepEqual(result.items, [
    { productName: "공통품", quantity: 2, direct: false },
    { productName: "공통품", quantity: 4, direct: true },
  ]);
  assert.equal(result.pages[0].left[0], result.items[0]);
  assert.deepEqual(result.pages[0].left[29], { separator: true });
  assert.equal(result.pages[0].left[30], result.items[1]);
});

test("직송처와 두 source index 배열이 중첩돼도 한 행은 한 번만 집계한다", () => {
  const result = build([row(0, "중복방지", 5, "JB")], { JB: [0], 케이모아: [0] });
  assert.deepEqual(result.items, [{ productName: "중복방지", quantity: 5, direct: true }]);
});

test("각 구역을 ko-KR numeric 오름차순으로 정렬한다", () => {
  const result = build([
    row(0, "품목 10", 1), row(1, "품목 2", 1), row(2, "나 품목", 1), row(3, "가 품목", 1),
    row(4, "직송 10", 1, "JB"), row(5, "직송 2", 1, "케이모아"),
  ]);
  assert.deepEqual(result.items.map((item) => item.productName), ["가 품목", "나 품목", "품목 2", "품목 10", "직송 2", "직송 10"]);
});

test("30개는 A5, 31개는 A4이다", () => {
  assert.equal(build(uniqueRows(30)).format, "A5");
  assert.equal(build(uniqueRows(30)).pages[0].left.length, 31);
  assert.equal(build(uniqueRows(31)).format, "A4");
});

test("A4는 73행씩 좌우 열 우선 배치하고 146/147에서 페이지가 나뉜다", () => {
  const onePage = build(uniqueRows(146));
  assert.equal(onePage.pages.length, 1);
  assert.equal(onePage.pages[0].left.length, 73);
  assert.equal(onePage.pages[0].right.length, 73);
  assert.equal(onePage.pages[0].left[0].productName, "품목 1");
  assert.equal(onePage.pages[0].right[0].productName, "품목 74");
  assert.equal(build(uniqueRows(147)).pages.length, 2);
});

test("직송 품목은 고정 그리드의 마지막 행부터 위로 배치된다", () => {
  const rows = [
    ...Array.from({ length: 72 }, (_, index) => row(index, `일반 ${index + 1}`, 1)),
    row(72, "직송", 1, "JB"),
  ];
  const result = build(rows);
  assert.equal(result.pages[0].left[71].productName, "일반 72");
  assert.deepEqual(result.pages[0].right[71], { separator: true });
  assert.equal(result.pages[0].right[72].productName, "직송");
});

test("품목명 누락 또는 수량 비숫자/0/음수 행은 원본 행 번호로 반환하고 중단한다", () => {
  const result = buildSalesShipmentList([
    { ...row(0, "", 1), rowNumber: 3 },
    { ...row(1, "품목", "abc"), rowNumber: 7 },
    { ...row(2, "품목", 0), rowNumber: 9 },
    { ...row(3, "품목", -1), rowNumber: 11 },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.invalidRowNumbers, [3, 7, 9, 11]);
  assert.deepEqual(result.pages, []);
});

test("온라인발주 버튼과 팝업은 진행 단계 전체 행 및 SVG/인쇄/클립보드 경로를 사용한다", () => {
  assert.match(pageSource, /송장 엑셀<\/label>[\s\S]*FN판매입력<\/label>[\s\S]*FN구매입력<\/label>[\s\S]*onClick=\{openSalesShipmentListPopup\}>출고리스트<\/button>/);
  assert.doesNotMatch(pageSource, /function exportSalesShipmentList/);
  const start = pageSource.indexOf("  function openSalesShipmentListPopup");
  const end = pageSource.indexOf("  function selectedShippingRows", start);
  const popupSource = pageSource.slice(start, end);
  assert.match(popupSource, /sheets\["발주 진행 단계"\]/);
  assert.match(popupSource, /indexOf\("품목명\(ERP\)"\)/);
  assert.match(popupSource, /indexOf\("수량"\)/);
  assert.doesNotMatch(popupSource, /수집일자|\.filter\([^)]*(?:date|일자)/i);
  assert.match(popupSource, />이미지 캡쳐<\/button><button[^>]*>인쇄\/PDF저장<\/button><button[^>]*>닫기<\/button>/);
  assert.match(popupSource, /navigator\.clipboard\.write\(\[new ClipboardItem\(\{'image\/png':png\}\)\]\)/);
  assert.match(popupSource, /@page\{size:\$\{pageSize\};margin:0\}/);
  assert.match(popupSource, /\.toolbar\{display:none!important\}/);
  assert.match(popupSource, /\.shipment-page\{display:block!important/);
});

test("출고리스트 팝업에 생성되는 인라인 스크립트는 유효한 JavaScript이다", () => {
  const normalized = pageSource.split(String.fromCharCode(13)).join("");
  const functionStart = normalized.indexOf("function openSalesShipmentListPopup");
  const marker = "popup.document.write(";
  const templateStart = normalized.indexOf(marker, functionStart) + marker.length;
  const templateEnd = normalized.indexOf(");\n    popup.document.close()", templateStart);
  assert.ok(functionStart >= 0 && templateStart >= marker.length && templateEnd > templateStart);

  const html = Function(
    "pageSize",
    "paperWidth",
    "paperHeight",
    "pageSvgs",
    "totalPages",
    `return ${normalized.slice(templateStart, templateEnd)}`,
  )(
    "A5 landscape",
    "210mm",
    "148mm",
    '<svg class="shipment-page active"></svg>',
    1,
  );
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
