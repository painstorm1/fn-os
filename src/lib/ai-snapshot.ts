import { adsSummary } from "./ads-analysis";
import { accountingLedgerSummary } from "./accounting-ledger";
import { insertRows, selectRows, upsertRows } from "./fnos-db";
import { mainDashboardSummary } from "./main-dashboard";

type Row = Record<string, unknown>;

type SnapshotOptions = {
  from?: string;
  to?: string;
  source?: string;
  save?: boolean;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function defaultFrom(to: string) {
  const date = new Date(`${to}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 2);
  date.setUTCDate(1);
  return date.toISOString().slice(0, 10);
}

function optionalRows(table: string, query?: Record<string, string | number | boolean | null | undefined>) {
  return selectRows<Row>(table, query).catch(() => []);
}

function sum(rows: Row[], pick: (row: Row) => unknown) {
  return rows.reduce((total, row) => total + numberValue(pick(row)), 0);
}

function dateRange(rows: Row[], keys: string[]) {
  const dates = rows
    .map((row) => keys.map((key) => isoDate(row[key])).find(Boolean) || "")
    .filter(Boolean)
    .sort();
  return { earliest: dates[0] || "", latest: dates.at(-1) || "", dated_rows: dates.length };
}

function topRows(rows: Row[], pickLabel: (row: Row) => unknown, pickAmount: (row: Row) => unknown, limit = 10) {
  const map = new Map<string, { label: string; amount: number; count: number }>();
  for (const row of rows) {
    const label = text(pickLabel(row)) || "-";
    const current = map.get(label) || { label, amount: 0, count: 0 };
    current.amount += numberValue(pickAmount(row));
    current.count += 1;
    map.set(label, current);
  }
  return Array.from(map.values()).sort((left, right) => right.amount - left.amount).slice(0, limit);
}

function stripRows(rows: Row[], fields: string[], limit = 20) {
  return rows.slice(0, limit).map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null])));
}

function dataQualityWarnings({
  dashboard,
  salesRows,
  purchaseRows,
  inventoryRows,
  ads,
  accounting,
}: {
  dashboard: Row;
  salesRows: Row[];
  purchaseRows: Row[];
  inventoryRows: Row[];
  ads: Row;
  accounting: Row;
}) {
  const warnings: Array<{ code: string; severity: "info" | "warning" | "critical"; message: string }> = [];
  const collectionDates = (dashboard.collection_dates || {}) as Row;
  const accountingDate = text(collectionDates.accounting);
  const accountingLatestBatchDate = text(((accounting.batches as Row[] | undefined) || [])[0]?.created_at).slice(0, 10);
  const salesTotal = numberValue(dashboard.month_sales);
  const purchaseTotal = numberValue(dashboard.month_purchases);
  const adUnmappedCount = Array.isArray(ads.unmapped) ? ads.unmapped.length : 0;
  const inventoryCount = inventoryRows.length;
  const productCount = numberValue((dashboard as Row).product_count);
  const reviewCount = numberValue((accounting.totals as Row | undefined)?.review_count);

  if (accountingDate && accountingLatestBatchDate && accountingDate < accountingLatestBatchDate) {
    warnings.push({
      code: "accounting_collection_lag",
      severity: "warning",
      message: `메인 대시보드 회계 수집일(${accountingDate})이 최근 회계 배치(${accountingLatestBatchDate})보다 오래되었습니다.`,
    });
  }
  if (salesTotal > 0 && purchaseTotal > 0 && purchaseTotal / salesTotal < 0.05) {
    warnings.push({
      code: "purchase_sales_gap",
      severity: "warning",
      message: "월 매출 대비 구매/매입 입력액이 매우 작아 손익률 판단 전 원가 입력 상태 확인이 필요합니다.",
    });
  }
  if (adUnmappedCount > 0) {
    warnings.push({
      code: "ad_unmapped",
      severity: "warning",
      message: `광고분석 미매핑 항목이 ${adUnmappedCount.toLocaleString("ko-KR")}개 있습니다. 상품별 광고 손익 판단은 제한됩니다.`,
    });
  }
  if (inventoryCount > 0 && productCount > 0 && inventoryCount / productCount < 0.2) {
    warnings.push({
      code: "inventory_coverage_low",
      severity: "warning",
      message: "상품 수 대비 재고 연결 행이 적어 전체 재고 자문은 제한됩니다.",
    });
  }
  if (reviewCount > 0) {
    warnings.push({
      code: "accounting_review_pending",
      severity: reviewCount >= 100 ? "critical" : "warning",
      message: `회계 검토필요 거래가 ${reviewCount.toLocaleString("ko-KR")}건 남아 있습니다.`,
    });
  }
  if (!text(dashboard.order_latest_date)) {
    warnings.push({
      code: "order_collection_missing",
      severity: "info",
      message: "온라인 주문 수집일이 비어 있습니다. 주문 API/업로드 상태 확인이 필요합니다.",
    });
  }
  return warnings;
}

export async function buildAiSnapshot(options: SnapshotOptions = {}) {
  const to = isoDate(options.to) || todayKst();
  const from = isoDate(options.from) || defaultFrom(to);
  const [dashboard, salesRows, purchaseRows, products, inventoryRows, importOrders, ads, accounting] = await Promise.all([
    mainDashboardSummary(),
    optionalRows("sales", { io_date: `gte.${from}`, order: "io_date.desc", limit: 3000 }),
    optionalRows("purchases", { io_date: `gte.${from}`, order: "io_date.desc", limit: 3000 }),
    optionalRows("products", { order: "product_name.asc", limit: 3000 }),
    optionalRows("inventory_current", { order: "updated_at.desc", limit: 3000 }),
    optionalRows("import_purchase_orders", { order: "order_date.desc", limit: 300 }),
    adsSummary({ from, to }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) })),
    accountingLedgerSummary({ from, to, scope: "dashboard" }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) })),
  ]);
  const productCount = products.length;
  const activeInventoryRows = inventoryRows.filter((row) => numberValue(row.available_qty ?? row.on_hand_qty ?? row.bal_qty) !== 0);
  const riskInventoryRows = inventoryRows.filter((row) => numberValue(row.available_qty ?? row.on_hand_qty ?? row.bal_qty) <= 5);
  const adTotal = ((ads as Row).total || {}) as Row;
  const accountingTotals = (((accounting as Row).totals || {}) as Row);
  const source = text(options.source) || "fnos-ai-snapshot";
  const generatedAt = new Date().toISOString();

  const snapshot = {
    version: 1,
    source,
    generated_at: generatedAt,
    period: { from, to },
    dashboard: {
      today: dashboard.today,
      collection_dates: dashboard.collection_dates,
      last_collected_date: dashboard.last_collected_date,
    },
    sales: {
      row_count: salesRows.length,
      date_range: dateRange(salesRows, ["io_date", "sale_date", "created_at"]),
      amount: sum(salesRows, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
      qty: sum(salesRows, (row) => row.qty),
      top_customers: topRows(salesRows, (row) => row.cust_name || row.customer_name, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
      top_products: topRows(salesRows, (row) => row.prod_name || row.product_name || row.sku, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
      recent: stripRows(salesRows, ["io_date", "cust_name", "prod_cd", "prod_name", "qty", "total_amount", "source_file_name"], 20),
    },
    purchases: {
      row_count: purchaseRows.length,
      date_range: dateRange(purchaseRows, ["io_date", "purchase_date", "created_at"]),
      amount: sum(purchaseRows, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
      top_vendors: topRows(purchaseRows, (row) => row.cust_name || row.supplier_name || row.customer_name, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
    },
    ads: {
      ok: (ads as Row).ok !== false,
      cost: numberValue(adTotal.cost),
      conversion_value: numberValue(adTotal.conversion_value),
      conversions: numberValue(adTotal.conversions),
      roas: numberValue(adTotal.roas),
      channel_count: Array.isArray((ads as Row).channels) ? ((ads as Row).channels as Row[]).length : 0,
      unmapped_count: Array.isArray((ads as Row).unmapped) ? ((ads as Row).unmapped as Row[]).length : 0,
      top_campaigns: stripRows(((ads as Row).campaigns as Row[] | undefined) || [], ["channel", "campaign_name", "ad_group_name", "ad_name", "cost", "conversion_value", "roas"], 20),
    },
    inventory: {
      product_count: productCount,
      inventory_row_count: inventoryRows.length,
      active_inventory_row_count: activeInventoryRows.length,
      risk_count: riskInventoryRows.length,
      risk_items: stripRows(riskInventoryRows, ["prod_cd", "prod_name", "sku", "available_qty", "on_hand_qty", "bal_qty", "updated_at"], 30),
    },
    accounting: {
      ok: (accounting as Row).ok !== false,
      income_amount: numberValue(accountingTotals.income_amount),
      expense_amount: numberValue(accountingTotals.expense_amount),
      net_profit: numberValue(accountingTotals.net_profit),
      cashflow_amount: numberValue(accountingTotals.cashflow_amount),
      card_settlement_due: numberValue(accountingTotals.card_settlement_due),
      fixed_cost_due_amount: numberValue(accountingTotals.fixed_cost_due_amount),
      review_count: numberValue(accountingTotals.review_count),
      transaction_count: numberValue(accountingTotals.transaction_count),
      top_income: stripRows(((accounting as Row).by_income_vendor as Row[] | undefined) || [], ["label", "amount", "count"], 20),
      top_expenses: stripRows(((accounting as Row).by_expense_category as Row[] | undefined) || [], ["label", "amount", "count"], 20),
    },
    import_management: {
      order_count: importOrders.length,
      date_range: dateRange(importOrders, ["order_date", "expected_inbound_date", "created_at"]),
      amount: sum(importOrders, (row) => row.total_won ?? row.total_amount ?? row.actual_payment_total_krw ?? row.actual_payment_total),
      recent_orders: stripRows(importOrders, ["order_code", "order_date", "status", "factory_name", "repr_product", "total_qty", "total_won"], 20),
    },
    data_quality: {
      warnings: dataQualityWarnings({
        dashboard: { ...dashboard, product_count: productCount },
        salesRows,
        purchaseRows,
        inventoryRows,
        ads: ads as Row,
        accounting: accounting as Row,
      }),
    },
  };

  if (!options.save) return { snapshot };
  return { snapshot, saved: await saveAiSnapshot(snapshot) };
}

export async function saveAiSnapshot(snapshot: Record<string, unknown>) {
  const period = (snapshot.period || {}) as Row;
  const generatedAt = text(snapshot.generated_at) || new Date().toISOString();
  const row = {
    snapshot_key: `${text(period.from)}:${text(period.to)}:${text(snapshot.source) || "fnos-ai-snapshot"}`,
    period_from: text(period.from) || null,
    period_to: text(period.to) || null,
    source: text(snapshot.source) || "fnos-ai-snapshot",
    generated_at: generatedAt,
    payload: snapshot,
    summary: {
      sales_amount: numberValue(((snapshot.sales as Row | undefined) || {}).amount),
      ad_cost: numberValue(((snapshot.ads as Row | undefined) || {}).cost),
      ad_roas: numberValue(((snapshot.ads as Row | undefined) || {}).roas),
      net_profit: numberValue(((snapshot.accounting as Row | undefined) || {}).net_profit),
      warning_count: Array.isArray(((snapshot.data_quality as Row | undefined) || {}).warnings) ? (((snapshot.data_quality as Row).warnings as unknown[]).length) : 0,
    },
  };
  const saved = await upsertRows<Row>("ai_snapshots", row, "snapshot_key").catch(async (error) => {
    if (error instanceof Error && /on_conflict|unique|constraint/i.test(error.message)) return insertRows<Row>("ai_snapshots", row);
    throw error;
  });
  return saved[0] || null;
}
