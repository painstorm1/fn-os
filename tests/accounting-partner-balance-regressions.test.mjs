import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const partnerBalancesSource = readFileSync(new URL("../src/lib/partner-balances.ts", import.meta.url), "utf8");
const accountingLedgerSource = readFileSync(new URL("../src/lib/accounting-ledger.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function compile(source, filename) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
}

function loadPartnerBalances(initialTables = {}) {
  const tables = Object.fromEntries(Object.entries(initialTables).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
  const payments = new Map((tables.payment_records || []).map((row) => [String(row.id), row]));
  tables.payment_records = Array.from(payments.values());
  const calls = { upserts: [], deletes: [] };
  const db = {
    FnosDbError: class FnosDbError extends Error {
      constructor(message, status = 500) {
        super(message);
        this.status = status;
      }
    },
    selectRows: async (table) => (tables[table] || []).map((row) => ({ ...row })),
    insertRows: async (_table, rows) => Array.isArray(rows) ? rows : [rows],
    upsertRows: async (table, rows, conflictTarget) => {
      assert.equal(table, "payment_records");
      assert.equal(conflictTarget, "id");
      const list = Array.isArray(rows) ? rows : [rows];
      calls.upserts.push(...list.map((row) => ({ ...row })));
      for (const row of list) payments.set(String(row.id), { ...(payments.get(String(row.id)) || {}), ...row });
      tables.payment_records = Array.from(payments.values());
      return list;
    },
    deleteRows: async (table, filters) => {
      assert.equal(table, "payment_records");
      calls.deletes.push({ ...filters });
      const id = String(filters.id || "").replace(/^eq\./, "");
      const current = payments.get(id);
      if (current && ["회계 자동 수금", "회계 자동 지급"].includes(String(current.payment_method))) payments.delete(id);
      tables.payment_records = Array.from(payments.values());
      return current ? [current] : [];
    },
  };
  const cjsModule = { exports: {} };
  const compiled = compile(partnerBalancesSource, "partner-balances.ts");
  new Function("require", "exports", "module", compiled)(() => db, cjsModule.exports, cjsModule);
  return { ...cjsModule.exports, tables, payments, calls };
}

const customerFixtures = [
  ["제이비(직거래)", "customer-jb-direct"],
  ["제이비컴퍼니", "customer-jb-company"],
  ["케이모아", "customer-kmore"],
  ["나스포", "customer-naspo"],
  ["아주레포츠", "customer-aju"],
  ["믹스스포츠", "customer-mix"],
].map(([customer_name, id], index) => ({ id, customer_code: `C${index + 1}`, customer_name, balance_reflect: true }));

function bankRow(id, merchant_name, direction, amount = 1000) {
  return {
    id,
    source_type: "bank",
    merchant_name,
    transaction_date: "2026-07-15",
    debit_amount: direction === "purchases" ? amount : 0,
    credit_amount: direction === "sales" ? amount : 0,
    amount: amount * 99,
    amount_krw: amount * 88,
  };
}

test("actual projection helper accepts only the nine exact alias/direction combinations", async () => {
  const loaded = loadPartnerBalances({ customers: customerFixtures });
  const cases = [
    ["이종복", "sales", "customer-jb-direct"],
    ["이 종복", "purchases", "customer-jb-direct"],
    ["이종복(제이비컴퍼니", "sales", "customer-jb-company"],
    ["이종복(제이비컴퍼니", "purchases", "customer-jb-company"],
    ["오완성(케이모아스포", "purchases", "customer-kmore"],
    ["주식회사나스포", "purchases", "customer-naspo"],
    ["(주)아주레포츠", "purchases", "customer-aju"],
    ["우리주식회사믹스스포츠", "purchases", "customer-mix"],
    ["주식회사믹스스포츠", "purchases", "customer-mix"],
  ];
  const rows = cases.map(([alias, direction], index) => bankRow(`tx-${index + 1}`, alias, direction, 1000 + index));

  const count = await loaded.reconcileAccountingPartnerPayments(rows);

  assert.equal(count, 9);
  assert.equal(loaded.payments.size, 9);
  cases.forEach(([, direction, customerId], index) => {
    const row = loaded.payments.get(`tx-${index + 1}`);
    assert.equal(row.id, `tx-${index + 1}`);
    assert.equal(row.amount, 1000 + index, "must use the exact debit/credit side, not amount fallbacks");
    assert.equal(row.customer_id, direction === "sales" ? customerId : null);
    assert.equal(row.supplier_id, direction === "purchases" ? customerId : null);
    assert.equal(row.linked_type, `fnos_partner_balance_${direction}`);
    assert.equal(row.payment_method, direction === "sales" ? "회계 자동 수금" : "회계 자동 지급");
  });
});

test("projection blocks disallowed direction, card, both/zero sides, substring and non-merchant matches", async () => {
  const loaded = loadPartnerBalances({ customers: customerFixtures });
  const blocked = [
    bankRow("blocked-direction", "오완성(케이모아스포", "sales"),
    { ...bankRow("blocked-card", "이종복", "sales"), source_type: "card" },
    { ...bankRow("blocked-both", "이종복", "sales"), debit_amount: 1 },
    { ...bankRow("blocked-zero", "이종복", "sales"), credit_amount: 0, amount: 5000, amount_krw: 5000 },
    bankRow("blocked-substring", "송금 이종복", "sales"),
    bankRow("blocked-hyphens", "이-종-복", "sales"),
    bankRow("blocked-periods", "이.종.복", "sales"),
    bankRow("blocked-punctuation-suffix", "이종복!!!", "sales"),
    { ...bankRow("blocked-description", "다른 사람", "sales"), description: "이종복", memo: "이종복" },
  ];

  assert.equal(await loaded.reconcileAccountingPartnerPayments(blocked), 0);
  assert.equal(loaded.payments.size, 0);
});

test("projection is idempotent and stale cleanup can delete only its own automatic row", async () => {
  const manual = { id: "manual-id", payment_method: "수동 수금", amount: 777 };
  const loaded = loadPartnerBalances({ customers: customerFixtures, payment_records: [manual] });
  const row = bankRow("same-id", "이종복", "sales", 123456);

  assert.equal(await loaded.reconcileAccountingPartnerPayments([row]), 1);
  assert.equal(await loaded.reconcileAccountingPartnerPayments([row]), 1);
  assert.equal(loaded.payments.size, 2);
  assert.equal(loaded.payments.get("same-id").amount, 123456);

  await loaded.reconcileAccountingPartnerPayments([{ ...row, credit_amount: 0 }], { removeStale: true });
  assert.equal(loaded.payments.has("same-id"), false);
  await loaded.reconcileAccountingPartnerPayments([{ ...manual, source_type: "bank", merchant_name: "다른 사람", debit_amount: 0, credit_amount: 0 }], { removeStale: true });
  assert.deepEqual(plain(loaded.payments.get("manual-id")), manual);
  assert.equal(loaded.calls.deletes.at(-1).payment_method, "like.회계 자동*");
});

test("projection fails closed for missing, ambiguous, or balance-disabled customer masters", async () => {
  const tx = bankRow("strict-customer", "이종복", "sales");
  await assert.rejects(() => loadPartnerBalances({ customers: [] }).reconcileAccountingPartnerPayments([tx]));
  await assert.rejects(() => loadPartnerBalances({ customers: [customerFixtures[0], { ...customerFixtures[0], id: "duplicate" }] }).reconcileAccountingPartnerPayments([tx]));
  await assert.rejects(() => loadPartnerBalances({ customers: [{ ...customerFixtures[0], balance_reflect: false }] }).reconcileAccountingPartnerPayments([tx]));
});

test("projection rejects an inactive balance-enabled customer but accepts active or legacy masters", async () => {
  const tx = bankRow("customer-active-state", "이종복", "sales");
  const inactive = loadPartnerBalances({ customers: [{ ...customerFixtures[0], is_active: false, balance_reflect: true }] });
  await assert.rejects(() => inactive.reconcileAccountingPartnerPayments([tx]), /잔액 반영 대상이 아닙니다/);
  assert.equal(inactive.payments.size, 0);

  for (const customer of [{ ...customerFixtures[0], is_active: true }, customerFixtures[0]]) {
    const loaded = loadPartnerBalances({ customers: [customer] });
    assert.equal(await loaded.reconcileAccountingPartnerPayments([tx]), 1);
    assert.equal(loaded.payments.size, 1);
  }
});

test("partner balance behavior accumulates manual plus accounting payments and excludes sourcing customer", async () => {
  const loaded = loadPartnerBalances({
    customers: [
      { id: "customer-jb", customer_code: "JB", customer_name: "제이비컴퍼니", balance_reflect: true },
      { id: "customer-inactive", customer_code: "OLD", customer_name: "비활성 거래처", balance_reflect: true, is_active: false },
      { id: "customer-sourcing", customer_code: "SOURCE", customer_name: "FN해외 상품 구매(소싱)", balance_reflect: true },
    ],
    sales: [
      { id: "sale-1", io_date: "2026-07-10", cust_code: "JB", cust_name: "제이비컴퍼니", total_amount: 500000, qty: 1 },
      { id: "sale-inactive", io_date: "2026-07-10", cust_code: "OLD", cust_name: "비활성 거래처", total_amount: 100000, qty: 1 },
    ],
    purchases: [{ id: "purchase-1", io_date: "2026-07-10", cust_code: "SOURCE", cust_name: "FN해외 상품 구매(소싱)", total_amount: 900000, qty: 1 }],
    payment_records: [
      { id: "manual-payment", linked_type: "fnos_partner_balance_sales", customer_id: "customer-jb", payment_date: "2026-07-11", amount: 100000, payment_method: "수동 수금" },
      { id: "auto-payment", linked_type: "fnos_partner_balance_sales", customer_id: "customer-jb", payment_date: "2026-07-12", amount: 123456, payment_method: "회계 자동 수금" },
    ],
  });

  const sales = await loaded.partnerBalanceSummary({ mode: "sales", month: "2026-07" });
  assert.equal(sales.rows.length, 1);
  assert.equal(sales.rows[0].paid_amount, 223456);
  assert.equal(sales.rows[0].month_end_balance, 276544);
  assert.deepEqual(sales.rows[0].details.filter((row) => row.kind === "수금").map((row) => row.source).sort(), ["수동", "회계 자동"]);

  const purchases = await loaded.partnerBalanceSummary({ mode: "purchases", month: "2026-07" });
  assert.equal(purchases.rows.length, 0, "excluded customer must stay hidden even with balance_reflect=true and purchase history");
});

function loadAccountingLedger({ failDedupeRead = false, failFirstReconcile = false } = {}) {
  const transactions = [];
  const batches = [];
  const batchPatches = [];
  const reconciled = [];
  const reconcileOptions = [];
  let reconcileCalls = 0;
  const db = {
    deleteRows: async () => [],
    insertRows: async (table, rows) => {
      const list = Array.isArray(rows) ? rows : [rows];
      if (table === "accounting_import_batches") {
        const batch = { ...list[0], id: `batch-${batches.length + 1}` };
        batches.push(batch);
        return [batch];
      }
      return list;
    },
    patchRows: async (table, filters, values) => {
      if (table === "accounting_import_batches") batchPatches.push({ filters, values: { ...values } });
      if (table === "accounting_transactions") {
        const id = String(filters.id || "").replace(/^eq\./, "");
        const row = transactions.find((item) => item.id === id);
        if (!row) return [];
        Object.assign(row, values);
        return [{ ...row }];
      }
      return [];
    },
    selectRows: async (table, query = {}) => {
      if (table !== "accounting_transactions") return [];
      if (failDedupeRead && (query.dedupe_key || query.transaction_date)) throw new Error("dedupe read failed");
      if (query.id) {
        const id = String(query.id).replace(/^eq\./, "");
        return transactions.filter((row) => row.id === id).map((row) => ({ ...row }));
      }
      if (query.dedupe_key) return transactions.filter((row) => String(query.dedupe_key).includes(`\"${row.dedupe_key}\"`)).map((row) => ({ ...row }));
      if (query.transaction_date) return transactions.filter((row) => String(query.transaction_date).includes(`\"${row.transaction_date}\"`)).map((row) => ({ ...row }));
      return transactions.map((row) => ({ ...row }));
    },
    upsertRows: async (table, rows) => {
      const list = Array.isArray(rows) ? rows : [rows];
      if (table !== "accounting_transactions") return list;
      return list.map((input) => {
        let row = transactions.find((item) => item.dedupe_key === input.dedupe_key);
        if (!row) {
          row = { ...input, id: `accounting-tx-${transactions.length + 1}`, is_active: true, created_at: "2026-07-15T00:00:00.000Z" };
          transactions.push(row);
        } else Object.assign(row, input);
        return { ...row };
      });
    },
  };
  const accountingInstallments = {
    appendAccountingInstallmentMemo: (memo) => memo,
    installmentAllocatedAmountForDateRange: () => 0,
    installmentParts: () => [],
  };
  const accountingPayloads = {
    cleanAccountingFixedCostPayload: (row) => row,
    cleanAccountingLoanPayload: (row) => row,
    shouldAutoMarkLoanPaid: () => false,
  };
  const partnerBalances = {
    reconcileAccountingPartnerPayments: async (rows, options) => {
      reconcileCalls += 1;
      if (failFirstReconcile && reconcileCalls === 1) throw new Error("payment write failed");
      reconciled.push(...rows.map((row) => ({ ...row })));
      reconcileOptions.push(options);
      return rows.length;
    },
  };
  const cjsModule = { exports: {} };
  const compiled = compile(accountingLedgerSource, "accounting-ledger.ts");
  const requireMock = (id) => {
    if (id === "./fnos-db") return db;
    if (id === "./accounting-installments") return accountingInstallments;
    if (id === "./accounting-ledger-payloads") return accountingPayloads;
    if (id === "./partner-balances") return partnerBalances;
    throw new Error(`unexpected require: ${id}`);
  };
  vm.runInNewContext(compiled, { module: cjsModule, exports: cjsModule.exports, require: requireMock, console, process, URL, Date, Error, Map, Set, Promise }, { filename: "accounting-ledger.js" });
  return { ...cjsModule.exports, transactions, batches, batchPatches, reconciled, reconcileOptions, get reconcileCalls() { return reconcileCalls; } };
}

const importRow = {
  source_name: "기업은행",
  transaction_date: "2026-07-15",
  merchant_name: "이종복",
  description: "설명은 매칭에 사용하지 않음",
  debit_amount: 0,
  credit_amount: 123456,
};

test("failed payment projection is healed by re-uploading the already persisted canonical transaction", async () => {
  const loaded = loadAccountingLedger({ failFirstReconcile: true });

  await assert.rejects(() => loaded.importAccountingLedgerRows([importRow], { sourceType: "bank", sourceFileName: "bank.xlsx" }), /payment write failed/);
  assert.equal(loaded.transactions.length, 1, "accounting transaction remains persisted after the first projection failure");
  assert.equal(loaded.batchPatches.at(-1).values.status, "failed");
  loaded.transactions[0].dedupe_key = "legacy-fallback-key";

  const retry = await loaded.importAccountingLedgerRows([importRow], { sourceType: "bank", sourceFileName: "bank.xlsx" });
  assert.equal(loaded.transactions.length, 1);
  assert.equal(retry.new_count, 0);
  assert.equal(retry.duplicate_count, 1);
  assert.equal(retry.partner_payment_count, 1);
  assert.equal(loaded.reconciled.at(-1).id, loaded.transactions[0].id);
  assert.equal(loaded.batchPatches.at(-1).values.status, "uploaded");
});

test("money-flow dedupe reads fail closed instead of being swallowed as an empty result", async () => {
  const loaded = loadAccountingLedger({ failDedupeRead: true });
  await assert.rejects(() => loaded.importAccountingLedgerRows([importRow], { sourceType: "bank" }), /dedupe read failed/);
  assert.equal(loaded.reconcileCalls, 0);
  assert.equal(loaded.batchPatches.at(-1).values.status, "failed");
});

test("accounting debit/credit edits reconcile the saved canonical row", async () => {
  const loaded = loadAccountingLedger();
  loaded.transactions.push({ ...bankRow("edited-tx", "이종복", "sales", 5000), dedupe_key: "edit-key", is_active: true });

  await loaded.updateAccountingTransaction("edited-tx", { debit_amount: 5000, credit_amount: 0 });

  assert.equal(loaded.reconcileCalls, 1);
  assert.equal(loaded.reconciled[0].id, "edited-tx");
  assert.equal(loaded.reconciled[0].debit_amount, 5000);
  assert.equal(loaded.reconciled[0].credit_amount, 0);
  assert.deepEqual(plain(loaded.reconcileOptions[0]), { removeStale: true });
});

test("shared accounting invalidation clears partner balances and upload uses the shared helper", () => {
  const helperStart = pageSource.indexOf("function invalidateAccountingCache()");
  const helperEnd = pageSource.indexOf("function AccountingWorkspace", helperStart);
  const helperSource = pageSource.slice(helperStart, helperEnd);
  const uploadStart = pageSource.indexOf("  async function uploadExpenses()");
  const uploadEnd = pageSource.indexOf("  function resetCategoryDraft", uploadStart);
  const uploadSource = pageSource.slice(uploadStart, uploadEnd);
  assert.notEqual(helperStart, -1);
  assert.match(helperSource, /invalidateClientCache\("\/api\/fnos\/partner-balances"\);/);
  assert.notEqual(uploadStart, -1);
  assert.match(uploadSource, /invalidateAccountingCache\(\);\s*loadSummary\(true\);/);
  assert.doesNotMatch(uploadSource, /invalidateClientCache\("\/api\/fnos\/partner-balances"\);/);
});
