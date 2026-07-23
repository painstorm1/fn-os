import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { parse } from "acorn";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/lib/main-dashboard.ts", import.meta.url), "utf8");
const dashboardSummaryRouteSource = readFileSync(new URL("../src/app/api/dashboard/summary/route.ts", import.meta.url), "utf8");

function runTranspiledModule(source, globals = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, ...globals }, { filename: "transpiled-regression-module.js" });
  return module.exports;
}

function loadSalesHistorySummary(selectRows) {
  const source = dashboardSource
    .replace(/^import[\s\S]*?from "\.\/accounting-installments";\r?\n/, "")
    .replace(/^import \{ selectRows \} from "\.\/fnos-db";\r?\n/, "")
    .concat("\nmodule.exports = { salesHistorySummary };\n");
  return runTranspiledModule(source, { selectRows }).salesHistorySummary;
}

function loadDashboardSummaryGet({ salesHistorySummary }) {
  const source = dashboardSummaryRouteSource.replace(/^import .*\r?\n/gm, "").concat("\nmodule.exports = { GET };\n");
  const FnosDbError = class FnosDbError extends Error {};
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status || 200 }) };
  return runTranspiledModule(source, { salesHistorySummary, mainDashboardSummary: async () => ({}), FnosDbError, NextResponse, URL, Error }).GET;
}

function loadTradeAnalysisVoucherExportMatrix() {
  const start = pageSource.indexOf("export function tradeAnalysisVoucherExportMatrix");
  const end = pageSource.indexOf("\nfunction preventEnterSubmit", start);
  assert.notEqual(start, -1, "tradeAnalysisVoucherExportMatrix must exist");
  assert.notEqual(end, -1, "tradeAnalysisVoucherExportMatrix end must exist");
  const source = pageSource.slice(start, end).replace("export function", "function").concat("\nmodule.exports = { tradeAnalysisVoucherExportMatrix };\n");
  return runTranspiledModule(source).tradeAnalysisVoucherExportMatrix;
}

function popupTemplateSource() {
  const startMarker = "    const html = `<!doctype html";
  const start = pageSource.indexOf(startMarker, pageSource.indexOf("async function openTradeAnalysisPopup"));
  assert.notEqual(start, -1, "openTradeAnalysisPopup HTML template start must exist");
  const contentStart = pageSource.indexOf("`", start) + 1;
  const endMarker = "</script></body></html>`;";
  const end = pageSource.indexOf(endMarker, contentStart);
  assert.notEqual(end, -1, "openTradeAnalysisPopup HTML template end must exist");
  return pageSource.slice(contentStart, end + "</script></body></html>".length);
}

function generatedPopupHtml() {
  const salesRow = {
    type: "sales",
    typeLabel: "판매",
    date: "2026-04-03",
    month: "2026-04",
    no: "fixture-sale",
    customer: "테스트거래처",
    warehouse: "W-FIXTURE",
    productCode: "SET-FIXTURE",
    productName: "Fixture SET",
    qty: 1,
    unitPrice: 137,
    amount: 137,
    memo: "fixture",
    sourceProductCode: "SET-FIXTURE",
    sourceProductName: "Fixture SET",
    sourceQty: 1,
    sourceAmount: 137,
    sourceId: "sale-fixture-id",
    sourceRefId: "manual-sale-fixture-ref",
    salesKey: "sale-fixture-id",
    bom: [
      { componentCode: "COMP-A", componentName: "Component A", qtyPerUnit: 2 },
      { componentCode: "COMP-B", componentName: "Component B", qtyPerUnit: 3 },
    ],
  };
  const zeroActualSaleRow = {
    ...salesRow,
    no: "fixture-zero-sale",
    sourceId: "sale-zero-id",
    sourceRefId: "",
    salesKey: "sale-zero-id",
    productCode: "ZERO-FIXTURE",
    productName: "Zero actual fixture",
    qty: 7,
    amount: 70,
    sourceProductCode: "ZERO-FIXTURE",
    sourceProductName: "Zero actual fixture",
    sourceQty: 7,
    sourceAmount: 70,
    bom: [],
  };
  const purchaseRow = {
    type: "purchase",
    typeLabel: "구매",
    date: "2026-04-03",
    month: "2026-04",
    no: "fixture-purchase",
    customer: "테스트구매처",
    warehouse: "W-FIXTURE",
    productCode: "PURCHASE-FIXTURE",
    productName: "Fixture Purchase",
    qty: 1,
    unitPrice: 41,
    amount: 41,
    memo: "fixture",
    sourceProductCode: "PURCHASE-FIXTURE",
    sourceProductName: "Fixture Purchase",
    sourceQty: 1,
    sourceAmount: 41,
    sourceId: "purchase-fixture-id",
    sourceRefId: "manual-purchase-fixture-ref",
    salesKey: "",
    bom: [
      { componentCode: "PURCHASE-COMP-A", componentName: "Purchase component A", qtyPerUnit: 2 },
      { componentCode: "PURCHASE-COMP-B", componentName: "Purchase component B", qtyPerUnit: 3 },
    ],
  };
  const movementRows = [
    { sourceRefId: "sale-fixture-id", movementType: "bom_consume", date: "2026-04-03", warehouse: "W-FIXTURE", productCode: "COMP-A", productName: "Component A", qty: 2 },
    { sourceRefId: "sale-fixture-id", movementType: "bom_consume", date: "2026-04-03", warehouse: "W-FIXTURE", productCode: "COMP-B", productName: "Component B", qty: 3 },
    { sourceRefId: "", movementType: "sale_out", date: "2026-04-03", warehouse: "W-FIXTURE", productCode: "COMP-A", productName: "Unlinked component", qty: 11 },
    { sourceRefId: "", movementType: "sale_out", date: "2026-03-31", warehouse: "W-FIXTURE", productCode: "COMP-A", productName: "Outside-period unlinked component", qty: 19 },
    { sourceRefId: "sale-fixture-id", movementType: "adjustment", date: "2026-04-03", warehouse: "W-FIXTURE", productCode: "SHOULD-NOT-RENDER", productName: "Excluded", qty: 99 },
  ];
  const values = {
    title: "거래 분석 fixture",
    safeJson: JSON.stringify([salesRow, zeroActualSaleRow, purchaseRow]),
    inventorySalesJson: JSON.stringify(movementRows),
    productsJson: JSON.stringify([]),
    warehouseOptionsJson: JSON.stringify([{ code: "W-FIXTURE", name: "Fixture warehouse" }]),
    customerOptionsJson: JSON.stringify([]),
    companyInfoJson: JSON.stringify({}),
    analysisDefaultDay: "2026-04-03",
    analysisDefaultFromMonth: "2026-02",
    thisMonth: "2026-04",
    today: "2026-04-03",
    FN_SEAL_FALLBACK_URL: "",
  };
  const names = Object.keys(values);
  const renderTemplate = new Function(...names, `return \`${popupTemplateSource()}\`;`);
  return renderTemplate(...names.map((name) => values[name]));
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this._innerHTML = "";
    this.innerHTMLWrites = 0;
    this.textContent = "";
    this.dataset = {};
    this.style = {};
    this.disabled = false;
    this.listeners = new Map();
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    };
  }
  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(value) {
    this._innerHTML = value;
    this.innerHTMLWrites += 1;
  }
  dispatch(type, event = {}) {
    const listener = this.listeners.get(type);
    if (listener) listener({ target: this, currentTarget: this, preventDefault() {}, ...event });
  }
  focus() {}
  showPicker() { this.showPickerCalls = (this.showPickerCalls || 0) + 1; }
}

function popupRuntime(script) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  Object.assign(element("type"), { value: "all" });
  Object.assign(element("basis"), { value: "actual" });
  Object.assign(element("group"), { value: "detail" });
  Object.assign(element("periodMode"), { value: "month" });
  Object.assign(element("fromMonth"), { value: "2026-04" });
  Object.assign(element("toMonth"), { value: "2026-04" });
  Object.assign(element("fromDay"), { value: "2026-04-03" });
  Object.assign(element("toDay"), { value: "2026-04-03" });

  const document = {
    getElementById: element,
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const window = {
    document,
    opener: {},
    alert() {},
    confirm() { return false; },
    prompt() { return null; },
    close() {},
  };
  window.window = window;
  const context = vm.createContext({
    console,
    document,
    window,
    Intl,
    Date,
    Math,
    Number,
    String,
    Array,
    Set,
    Map,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ customers: [] }) }),
  });
  vm.runInContext(`${script}\nwindow.__fixtureRows = rowsByBasis();\nwindow.__fixtureUnlinkedRows = unlinkedOutboundRows();\nwindow.__fixtureVouchers = buildVoucherRows(window.__fixtureRows);`, context, { filename: "generated-trade-analysis-popup.js" });
  return { window, elements, context };
}

test("generated trade-analysis popup script parses and reaches ready/render with fixture data", () => {
  const html = generatedPopupHtml();
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, "generated popup must contain an inline script");
  const script = match[1];
  assert.doesNotThrow(() => parse(script, { ecmaVersion: "latest", sourceType: "script" }));

  const { window, elements } = popupRuntime(script);
  assert.equal(window.__fnosTradeAnalysisReady, true);
  assert.match(elements.get("tbody").innerHTML, /Component A/);
  assert.match(elements.get("tbody").innerHTML, /Component B/);
  assert.doesNotMatch(elements.get("thead").innerHTML, /출고확인\/원 입력품목/);
  assert.doesNotMatch(elements.get("tbody").innerHTML, /실제출고 확인\(bom_consume\)/);
  assert.doesNotMatch(elements.get("tbody").innerHTML, /SHOULD-NOT-RENDER/);
  assert.equal(elements.get("salesQty").textContent, "5개", "actualQty=0 must not fall back to entered qty=7");
  assert.equal(elements.get("salesAmount").textContent, "총 금액 207원");
  assert.equal(elements.get("purchaseAmount").textContent, "총 금액 41원");

  const salesRows = window.__fixtureRows.filter((row) => row.type === "sales");
  const purchaseRows = window.__fixtureRows.filter((row) => row.type === "purchase");
  assert.equal(salesRows.reduce((sum, row) => sum + Number(row.amount || 0), 0), 207, "multi-component BOM must not multiply sales revenue");
  assert.equal(salesRows.reduce((sum, row) => sum + Number(row.actualQty ?? row.qty ?? 0), 0), 5, "actual outbound qty must equal linked selling movement qty");
  assert.equal(salesRows.find((row) => row.sourceId === "sale-zero-id").actualQty, 0);
  assert.equal(purchaseRows.length, 1, "purchase BOM must keep one entered purchase row");
  assert.equal(purchaseRows[0].actualQty, 1);
  assert.equal(purchaseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0), 41);
  assert.deepEqual(Array.from(salesRows.filter((row) => row.sourceId === "sale-fixture-id"), (row) => row.actualProductCode), ["COMP-A", "COMP-B"]);

  const unlinkedRows = window.__fixtureUnlinkedRows;
  assert.equal(unlinkedRows.length, 1, "empty source_ref_id movement must remain unlinked");
  assert.equal(unlinkedRows[0].actualQty, 11);
  assert.doesNotMatch(elements.get("tbody").innerHTML, /Unlinked component/, "unlinked movement must not enter standard sales output");
  assert.match(elements.get("salesScope").innerHTML, /연결 출고 2건 \/ 5개/);
  assert.match(elements.get("salesScope").innerHTML, /미연결 출고 1건 \/ 11개/);
  elements.get("toggleUnlinkedOutbound").dispatch("click");
  assert.match(elements.get("tbody").innerHTML, /미연결 출고 감사행/);
  assert.match(elements.get("tbody").innerHTML, /Unlinked component/);
});

test("generated popup calendar adapter keeps ISO state, visible drafts, picker, and render count synchronized", () => {
  const html = generatedPopupHtml();
  assert.match(html, /id="fromMonthText"[^>]*type="text"[^>]*inputmode="numeric"/);
  assert.match(html, /id="fromMonthPicker"[^>]*data-calendar-picker="true"[^>]*type="month"[^>]*tabindex="-1"/);
  assert.match(html, /id="fromDayPicker"[^>]*data-calendar-picker="true"[^>]*type="date"[^>]*tabindex="-1"/);
  assert.doesNotMatch(html.match(/id="fromMonthPicker"[^>]*>/)?.[0] || "", /\bname=/);
  assert.match(html, /input:not\(\[data-calendar-part\]\),select/);

  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  const { elements } = popupRuntime(script);
  const state = elements.get("fromDay");
  const text = elements.get("fromDayText");
  const picker = elements.get("fromDayPicker");
  const tbody = elements.get("tbody");

  assert.equal(state.value, "2026-04-03");
  assert.equal(text.value, "2026/04/03");
  assert.equal(picker.value, "2026-04-03");

  const initialWrites = tbody.innerHTMLWrites;
  text.value = "2026/02";
  text.dispatch("input");
  assert.equal(state.value, "2026-04-03", "partial draft must not change the confirmed ISO value");
  assert.equal(tbody.innerHTMLWrites, initialWrites, "partial draft must not render");
  text.dispatch("blur");
  assert.equal(text.value, "2026/04/03", "blur restores the last confirmed value");

  text.value = "20240229";
  text.dispatch("input");
  assert.equal(state.value, "2024-02-29");
  assert.equal(text.value, "2024/02/29");
  assert.equal(picker.value, "2024-02-29");
  assert.equal(tbody.innerHTMLWrites, initialWrites + 1, "valid text commit renders exactly once");

  state.value = "2026-07-23";
  assert.equal(text.value, "2026/07/23", "programmatic state assignment synchronizes visible text");
  assert.equal(picker.value, "2026-07-23", "programmatic state assignment synchronizes picker");
  assert.equal(tbody.innerHTMLWrites, initialWrites + 1, "programmatic synchronization does not render by itself");

  const beforePicker = tbody.innerHTMLWrites;
  picker.value = "2026-07-24";
  picker.dispatch("change");
  assert.equal(state.value, "2026-07-24");
  assert.equal(text.value, "2026/07/24");
  assert.equal(tbody.innerHTMLWrites, beforePicker + 1, "picker commit renders exactly once");

  elements.get("fromDayButton").dispatch("click");
  assert.equal(picker.showPickerCalls, 1, "only the calendar button opens the native picker");
});

test("unlinked outbound audit rows follow active date, product, warehouse, and customer filters", () => {
  const html = generatedPopupHtml();
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const { window, elements, context } = popupRuntime(script);

  assert.equal(window.__fixtureUnlinkedRows.length, 1, "out-of-period movement must not enter the current summary scope");
  assert.equal(window.__fixtureUnlinkedRows[0].actualQty, 11);

  elements.get("warehouse").value = "OTHER";
  vm.runInContext("window.__filteredUnlinkedRows = unlinkedOutboundRows();", context);
  assert.equal(window.__filteredUnlinkedRows.length, 0, "warehouse filter must apply to audit rows");

  elements.get("warehouse").value = "W-FIXTURE";
  elements.get("product").value = "NO-MATCH";
  vm.runInContext("window.__filteredUnlinkedRows = unlinkedOutboundRows();", context);
  assert.equal(window.__filteredUnlinkedRows.length, 0, "product filter must apply to audit rows");

  elements.get("product").value = "";
  elements.get("customer").value = "테스트거래처";
  vm.runInContext("window.__filteredUnlinkedRows = unlinkedOutboundRows();", context);
  assert.equal(window.__filteredUnlinkedRows.length, 0, "customer-filtered audit scope explicitly has no unlinked rows");
});

test("voucher Excel export matrix helper writes each voucher amount only in detail amount cells", () => {
  const html = generatedPopupHtml();
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const { window } = popupRuntime(script);
  const vouchers = window.__fixtureVouchers;
  const matrix = loadTradeAnalysisVoucherExportMatrix()(vouchers);
  const exportedAmountSum = matrix.reduce((sum, row) => sum + Number(row[9] || 0), 0);
  const sourceAmountSum = vouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  assert.equal(exportedAmountSum, sourceAmountSum, "voucher header amount must not double-count detail amount");
  assert.ok(matrix.some((row) => row[5] === "전표합계" && row[9] === ""), "header is descriptive only, not an amount cell");
  assert.match(pageSource, /const exportRows = tradeAnalysisVoucherExportMatrix\(rows\);/, "actual export callback must use the tested matrix helper");
});

test("sales-history required inventory query propagates while optional sales/purchases remain empty", async () => {
  const calls = [];
  const salesHistorySummary = loadSalesHistorySummary(async (table) => {
    calls.push(table);
    if (table === "inventory_movements") throw new Error("inventory query failed");
    throw new Error(`${table} optional failure`);
  });
  await assert.rejects(salesHistorySummary(), /inventory query failed/);
  assert.deepEqual(calls.sort(), ["inventory_movements", "purchases", "sales"]);

  const optionalFailuresAllowed = loadSalesHistorySummary(async (table) => {
    if (table === "inventory_movements") return [];
    throw new Error(`${table} optional failure`);
  });
  await assert.doesNotReject(optionalFailuresAllowed());
  const result = await optionalFailuresAllowed();
  assert.equal(Array.from(result.sales_inventory_basis).length, 0);
  assert.equal(Array.from(result.purchase_inventory_basis).length, 0);
});

test("sales-history displays every entry menu newest date first with persisted-time tie breaking", async () => {
  const calls = [];
  const salesHistorySummary = loadSalesHistorySummary(async (table, query) => {
    calls.push({ table, query });
    if (table === "sales") return [
      { id: "sale-old", io_date: "2026-07-14", created_at: "2026-07-16T10:00:00Z", cust_name: "old sale" },
      { id: "return-new", io_date: "20260716", created_at: "2026-07-15T10:00:00Z", cust_name: "new return", return_exchange_type: "return_in" },
      { id: "sale-new", io_date: "2026-07-16", created_at: "2026-07-14T10:00:00Z", cust_name: "new sale" },
      { id: "return-old", io_date: "20260715", created_at: "2026-07-13T10:00:00Z", cust_name: "old return", return_exchange_type: "return_in" },
    ];
    if (table === "purchases") return [
      { id: "purchase-old", io_date: "2026-07-14", created_at: "2026-07-16T10:00:00Z", cust_name: "old purchase" },
      { id: "purchase-new-older", io_date: "20260716", created_at: "2026-07-14T10:00:00Z", cust_name: "new purchase, older save" },
      { id: "purchase-new-newer", io_date: "2026-07-16", created_at: "2026-07-15T10:00:00Z", cust_name: "new purchase, newer save" },
    ];
    return [];
  });

  const summary = await salesHistorySummary();

  for (const table of ["sales", "purchases"]) {
    const query = calls.find((call) => call.table === table)?.query;
    assert.equal(query?.order, "created_at.desc");
    assert.equal(query?.limit, 1500);
  }
  assert.deepEqual(Array.from(summary.recent_sales, (row) => row.cust_name), ["new sale", "old sale"]);
  assert.deepEqual(Array.from(summary.recent_returns, (row) => row.cust_name), ["new return", "old return"]);
  assert.deepEqual(Array.from(summary.recent_purchases, (row) => row.cust_name), [
    "new purchase, newer save",
    "new purchase, older save",
    "old purchase",
  ]);
  const displaySummarySource = pageSource.slice(pageSource.indexOf("function summarizeEntryDisplayRows"), pageSource.indexOf("function filterEntryRows"));
  assert.match(displaySummarySource, /entryDateFilterKey\(entryRowDate\(right\)\)\.localeCompare\(entryDateFilterKey\(entryRowDate\(left\)\)\)/);
});

test("dashboard summary GET returns ok:false and 5xx when sales-history summary rejects", async () => {
  const GET = loadDashboardSummaryGet({ salesHistorySummary: async () => { throw new Error("inventory query failed"); } });
  const response = await GET(new Request("http://localhost/api/dashboard/summary?scope=sales-history"));
  assert.equal(response.status, 500);
  assert.equal(response.body.ok, false);
  assert.match(response.body.error, /inventory query failed/);
});

test("popup fallback keeps sales-history scope and reports failures instead of swallowing them", () => {
  const start = pageSource.indexOf("function refreshEmptyBaseRows()", pageSource.indexOf("async function openTradeAnalysisPopup"));
  const end = pageSource.indexOf("function monthEnd", start);
  const fallbackSource = pageSource.slice(start, end);
  assert.match(fallbackSource, /scope=sales-history/);
  assert.match(fallbackSource, /if \(!res\.ok\) throw new Error/);
  assert.match(fallbackSource, /console\.error\("\[FNOS 거래분석\] sales-history 보강 조회 실패"/);
  assert.match(fallbackSource, /loadStatus\.textContent = "보강 조회 실패:/);
  assert.doesNotMatch(fallbackSource, /\.catch\(\(\) => \{\}\)/);
});
