import { selectRows } from "./fnos-db";

type Row = Record<string, unknown>;
type QueryValue = string | number | boolean | null | undefined;

async function optionalRows(table: string, query?: Record<string, QueryValue>) {
  return selectRows<Row>(table, query).catch(() => []);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function kstDate(daysOffset = 0) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + daysOffset * 86400000)
    .toISOString()
    .slice(0, 10)
    .replace(/\D/g, "");
}

function dateKey(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{8}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10).replace(/\D/g, "");
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10).replace(/\D/g, "");
  return raw.replace(/\D/g, "").slice(0, 8);
}

function iso(value: string) {
  return value && value.length === 8 ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
}

function latestDate(rows: Row[], pick: (row: Row) => unknown) {
  return rows.map((row) => dateKey(pick(row))).filter(Boolean).sort().at(-1) || "";
}

function rowsOn(rows: Row[], pick: (row: Row) => unknown, date: string) {
  if (!date) return [];
  return rows.filter((row) => dateKey(pick(row)) === date);
}

function rowsFrom(rows: Row[], pick: (row: Row) => unknown, fromDate: string) {
  return rows.filter((row) => {
    const date = dateKey(pick(row));
    return date && date >= fromDate;
  });
}

function sum(rows: Row[], pick: (row: Row) => unknown) {
  return rows.reduce((total, row) => total + numberValue(pick(row)), 0);
}

function metricTitle(base: string, date: string, today: string, yesterday: string) {
  if (date === today) return `오늘${base}`;
  if (date === yesterday) return `어제 ${base}`;
  return base;
}

function rowTitle(row: Row) {
  return row.order_no ?? row.order_code ?? row.memo ?? row.product_name ?? row.sku ?? row.customer_name ?? row.name ?? "-";
}

function compactRange(days: number) {
  return Array.from({ length: days }, (_, index) => {
    const key = kstDate(index - days + 1);
    return { key, date: iso(key), label: `${Number(key.slice(4, 6))}/${Number(key.slice(6, 8))}` };
  });
}

function monthRange(months: number) {
  const base = new Date(Date.now() + 9 * 60 * 60 * 1000);
  base.setDate(1);
  return Array.from({ length: months }, (_, index) => {
    const current = new Date(base);
    current.setMonth(base.getMonth() - months + 1 + index);
    const month = `${current.getFullYear()}${String(current.getMonth() + 1).padStart(2, "0")}`;
    return { month, label: `${current.getFullYear()}.${String(current.getMonth() + 1).padStart(2, "0")}` };
  });
}

function dailySeries(rows: Row[], days: number, pickDate: (row: Row) => unknown, pickAmount: (row: Row) => unknown) {
  return compactRange(days).map((day) => ({
    ...day,
    value: sum(
      rows.filter((row) => dateKey(pickDate(row)) === day.key),
      pickAmount,
    ),
  }));
}

function monthlySeries(rows: Row[], months: number, pickDate: (row: Row) => unknown, pickAmount: (row: Row) => unknown) {
  return monthRange(months).map((item) => ({
    ...item,
    value: sum(
      rows.filter((row) => dateKey(pickDate(row)).startsWith(item.month)),
      pickAmount,
    ),
  }));
}

export async function mainDashboardSummary() {
  const [
    sales,
    orders,
    inventory,
    channels,
    adReports,
    adDailyMetrics,
    expenses,
    legacyExpenses,
    payables,
    importPurchaseOrders,
    importErpOrders,
  ] = await Promise.all([
    optionalRows("sales", { order: "created_at.desc", limit: 1500 }),
    optionalRows("orders", { order: "created_at.desc", limit: 700 }),
    optionalRows("inventory_current", { order: "updated_at.desc", limit: 500 }),
    optionalRows("sales_channels", { order: "channel_code.asc", limit: 100 }),
    optionalRows("ad_reports", { order: "report_date.desc", limit: 2000 }),
    optionalRows("ad_daily_metrics", { order: "metric_date.desc", limit: 500 }),
    optionalRows("expenses", { order: "expense_date.desc", limit: 700 }),
    optionalRows("expense_entries", { order: "expense_date.desc", limit: 500 }),
    optionalRows("customer_payables", { order: "due_date.asc", limit: 100 }),
    optionalRows("import_purchase_orders", { order: "created_at.desc", limit: 120 }),
    optionalRows("import_erp_orders", { order: "created_at.desc", limit: 120 }),
  ]);

  const today = kstDate();
  const yesterday = kstDate(-1);
  const sevenDaysAgo = kstDate(-6);
  const threeDaysLater = kstDate(3);
  const month = today.slice(0, 6);
  const sixMonthsAgo = new Date(Date.now() + 9 * 60 * 60 * 1000);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  const sixMonthStart = `${sixMonthsAgo.getFullYear()}${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}01`;

  const salesDate = (row: Row) => row.io_date ?? row.sale_date ?? row.created_at;
  const salesAmount = (row: Row) => row.total_amount ?? row.supply_amount ?? row.supply_amt;
  const orderDate = (row: Row) => row.order_date ?? row.created_at;
  const adRows = adReports.length ? adReports : adDailyMetrics;
  const adDate = (row: Row) => row.report_date ?? row.metric_date ?? row.created_at;
  const adSpend = (row: Row) => row.cost ?? row.spend_amount ?? row.spend;
  const expenseRows = expenses.length ? expenses : legacyExpenses;
  const expenseDate = (row: Row) => row.expense_date ?? row.created_at;
  const importOrders = importPurchaseOrders.length ? importPurchaseOrders : importErpOrders;
  const importDate = (row: Row) => row.order_date ?? row.expected_inbound_date ?? row.created_at;
  const importAmount = (row: Row) =>
    row.total_amount ??
    row.amount ??
    row.actual_payment_total_krw ??
    row.actual_payment_total ??
    row.actual_payment_usd ??
    row.item_total ??
    0;

  const latestSalesDate = latestDate(sales, salesDate);
  const latestAdDate = latestDate(adRows, adDate);
  const latestOrderDate = latestDate(orders, orderDate);
  const latestExpenseDate = latestDate(expenseRows, expenseDate);
  const latestImportDate = latestDate(importOrders, importDate);

  const latestSalesRows = rowsOn(sales, salesDate, latestSalesDate);
  const monthSalesRows = sales.filter((row) => dateKey(salesDate(row)).startsWith(month));
  const sevenDaySalesRows = rowsFrom(sales, salesDate, sevenDaysAgo);
  const latestOrderRows = rowsOn(orders, orderDate, latestOrderDate);
  const riskItems = inventory.filter((row) => numberValue(row.available_qty ?? row.on_hand_qty ?? row.bal_qty) <= 5);

  const latestAdRows = rowsOn(adRows, adDate, latestAdDate);
  const yesterdayAdRows = rowsOn(adRows, adDate, yesterday);
  const sevenDayAdRows = rowsFrom(adRows, adDate, sevenDaysAgo);
  const monthAdRows = adRows.filter((row) => dateKey(adDate(row)).startsWith(month));
  const monthExpenseRows = expenseRows.filter((row) => dateKey(expenseDate(row)).startsWith(month));
  const cardRows = monthExpenseRows.filter((row) => /card|credit|카드/i.test(`${row.payment_method || ""} ${row.source_type || ""}`));
  const upcomingFixedCosts = payables.filter((row) => {
    const due = dateKey(row.due_date ?? row.created_at);
    const amount = numberValue(row.balance_amount ?? row.amount ?? row.total_amount);
    return due && due >= today && due <= threeDaysLater && amount > 0;
  });
  const importSixMonthRows = importOrders.filter((row) => dateKey(importDate(row)) >= sixMonthStart);
  const inquiryChannels = channels
    .filter((row) => Boolean(row.api_enabled || row.last_synced_at))
    .map((row) => ({ channel_name: row.channel_name || row.channel_code || "-", count: 0 }));

  const collectedItems = [
    latestSalesDate && { label: "매출", date: iso(latestSalesDate) },
    latestOrderDate && { label: "온라인 발주", date: iso(latestOrderDate) },
    latestAdDate && { label: "광고분석", date: iso(latestAdDate) },
    latestExpenseDate && { label: "회계/비용", date: iso(latestExpenseDate) },
    latestImportDate && { label: "수입관리", date: iso(latestImportDate) },
  ].filter(Boolean);

  const adMonthSpend = sum(monthAdRows, adSpend);
  const conversionSales = sum(monthAdRows, (row) => row.conversion_value ?? row.purchase_conversion_value);

  return {
    title: "FN OS",
    today: iso(today),
    collection_dates: {
      orders: iso(latestOrderDate),
      ads: iso(latestAdDate),
      accounting: iso(latestExpenseDate),
    },
    last_collected_date: collectedItems.map((row) => text((row as Row).date)).sort().at(-1) || "",
    last_collected_items: collectedItems,
    sales_label: metricTitle("매출", latestSalesDate, today, yesterday),
    sales_latest_date: iso(latestSalesDate),
    sales_latest_amount: sum(latestSalesRows, salesAmount),
    seven_day_sales: sum(sevenDaySalesRows, salesAmount),
    month_sales: sum(monthSalesRows, salesAmount),
    sales_daily: dailySeries(sales, 14, salesDate, salesAmount),
    order_count: latestOrderRows.length,
    order_latest_date: iso(latestOrderDate),
    inventory_risk_count: riskItems.length,
    inventory_risk_items: riskItems.slice(0, 10),
    inquiry_channels: inquiryChannels,
    ad_label: metricTitle("광고비", latestAdDate, today, yesterday),
    ad_latest_date: iso(latestAdDate),
    ad_latest_spend: sum(latestAdRows, adSpend),
    ad_yesterday_spend: sum(yesterdayAdRows, adSpend),
    ad_seven_day_spend: sum(sevenDayAdRows, adSpend),
    ad_month_spend: adMonthSpend,
    ad_conversion_sales: conversionSales,
    ad_roas: adMonthSpend ? (conversionSales / adMonthSpend) * 100 : 0,
    ad_daily: dailySeries(adRows, 14, adDate, adSpend),
    card_expense_amount: cardRows.length
      ? sum(cardRows, (row) => row.total_amount ?? row.amount ?? row.supply_amount)
      : sum(monthExpenseRows, (row) => row.total_amount ?? row.amount ?? row.supply_amount),
    bank_balance: null,
    upcoming_fixed_costs: upcomingFixedCosts.slice(0, 8).map((row) => ({ ...row, display_title: rowTitle(row) })),
    import_recent_orders: importOrders.slice(0, 8).map((row) => ({ ...row, display_title: rowTitle(row) })),
    import_six_month_amount: sum(importSixMonthRows, importAmount),
    import_monthly: monthlySeries(importOrders, 6, importDate, importAmount),
  };
}
