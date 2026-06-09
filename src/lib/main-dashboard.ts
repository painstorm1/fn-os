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

function rateFor(rates: Map<string, number>, currency: unknown, fallback: unknown) {
  const key = text(currency || "CNY");
  return rates.get(key) || numberValue(fallback) || 1;
}

function actualPaymentKrw(order: Row, rates: Map<string, number>) {
  const totalKrw = numberValue(order.actual_payment_total_krw);
  if (totalKrw) return totalKrw;
  const total = numberValue(order.actual_payment_total || order.actual_payment_usd);
  if (!total) return 0;
  const currency = text(order.actual_payment_currency || (order.actual_payment_usd ? "USD" : "KRW"));
  return currency === "KRW" ? total : total * rateFor(rates, currency, order.fx_rate);
}

function koreaExtraCost(order: Row) {
  return (
    numberValue(order.shipping_cost) +
    numberValue(order.customs_duty) +
    numberValue(order.vat) +
    numberValue(order.customs_fee) +
    numberValue(order.inspection_fee) +
    numberValue(order.domestic_shipping_cost) +
    numberValue(order.other_cost)
  );
}

function chinaExtraCost(order: Row, rates: Map<string, number>) {
  const currency = text(order.china_cost_currency || order.currency || "CNY");
  return (
    numberValue(order.china_domestic_shipping) +
    numberValue(order.china_fee) +
    numberValue(order.china_other_cost)
  ) * rateFor(rates, currency, order.fx_rate);
}

function importOrderTotalWon(order: Row, lines: Row[], rates: Map<string, number>) {
  const actualKrw = actualPaymentKrw(order, rates);
  if (actualKrw) return actualKrw + koreaExtraCost(order);
  const productWon = lines.reduce((total, line) => {
    const currency = line.item_currency || order.currency || "CNY";
    return total + numberValue(line.quantity) * numberValue(line.unit_price) * rateFor(rates, currency, order.fx_rate);
  }, 0);
  return productWon + koreaExtraCost(order) + chinaExtraCost(order, rates);
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

function entryAmount(row: Row) {
  return row.total_amount ?? row.supply_amount ?? row.supply_amt;
}

function entryQty(row: Row) {
  return row.qty ?? row.quantity ?? row.order_qty;
}

function entryDate(row: Row, mode: "sales" | "purchases") {
  return row.io_date ?? (mode === "sales" ? row.sale_date : row.purchase_date) ?? row.created_at;
}

function entryProductCode(row: Row) {
  return text(row.prod_cd || row.product_code || row.sku);
}

function entryProductName(row: Row) {
  return text(row.prod_name || row.product_name || row.prod_cd || row.sku);
}

function entryGroupKey(row: Row, mode: "sales" | "purchases") {
  const batchId = text(row.upload_batch_id);
  if (batchId) return `batch:${batchId}`;
  const ref = text(row.source_ref_id);
  const manualMatch = ref.match(/^(manual-(?:sale|purchase)-\d+)/);
  if (manualMatch?.[1]) return `manual:${manualMatch[1]}`;
  return `row:${text(row.id || ref || `${mode}-${entryDate(row, mode)}-${entryProductCode(row)}-${entryQty(row)}`)}`;
}

function entryLineNo(row: Row) {
  const parsed = numberValue(row.upload_ser_no);
  return parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}

function summarizeEntryRows(rows: Row[], mode: "sales" | "purchases", limit: number) {
  const groups = new Map<string, { rows: Row[]; firstSeen: number }>();
  rows.forEach((row, index) => {
    const key = entryGroupKey(row, mode);
    const group = groups.get(key) || { rows: [], firstSeen: index };
    group.rows.push(row);
    groups.set(key, group);
  });

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const sortedRows = [...group.rows].sort((left, right) => {
        const noDiff = entryLineNo(left) - entryLineNo(right);
        if (Number.isFinite(noDiff) && noDiff !== 0) return noDiff;
        return text(left.created_at).localeCompare(text(right.created_at));
      });
      const first = sortedRows[0] || {};
      return {
        ...first,
        id: key,
        entry_group_key: key,
        line_count: sortedRows.length,
        qty: sum(sortedRows, entryQty),
        supply_amt: sum(sortedRows, entryAmount),
        supply_amount: sum(sortedRows, entryAmount),
        total_amount: sum(sortedRows, entryAmount),
        prod_cd: entryProductCode(first),
        prod_name: entryProductName(first),
        representative_product_code: entryProductCode(first),
        representative_product_name: entryProductName(first),
        upload_ser_no: text(first.upload_ser_no) || "1",
        created_at: text(sortedRows.map((row) => row.created_at).filter(Boolean).sort().at(-1)) || text(first.created_at),
        sync_status: text(first.sync_status || "SAVED"),
        _recent_order: group.firstSeen,
      };
    })
    .sort((left, right) => numberValue(left._recent_order) - numberValue(right._recent_order))
    .slice(0, limit)
    .map(({ _recent_order: _removed, ...row }) => row);
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

function compactRangeUntil(days: number, endDate: string) {
  if (!/^\d{8}$/.test(endDate)) return compactRange(days);
  const base = new Date(Date.UTC(Number(endDate.slice(0, 4)), Number(endDate.slice(4, 6)) - 1, Number(endDate.slice(6, 8))));
  return Array.from({ length: days }, (_, index) => {
    const current = new Date(base);
    current.setUTCDate(base.getUTCDate() - days + 1 + index);
    const key = `${current.getUTCFullYear()}${String(current.getUTCMonth() + 1).padStart(2, "0")}${String(current.getUTCDate()).padStart(2, "0")}`;
    return { key, date: iso(key), label: `${Number(key.slice(4, 6))}/${Number(key.slice(6, 8))}` };
  });
}

function dateOffsetKey(date: string, daysOffset: number) {
  if (!/^\d{8}$/.test(date)) return kstDate(daysOffset);
  const current = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))));
  current.setUTCDate(current.getUTCDate() + daysOffset);
  return `${current.getUTCFullYear()}${String(current.getUTCMonth() + 1).padStart(2, "0")}${String(current.getUTCDate()).padStart(2, "0")}`;
}

function isoDateFromKey(key: string) {
  return key && key.length === 8 ? `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}` : key;
}

function lastDayOfMonthKey(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function previousBusinessDateKey(key: string) {
  let current = key;
  for (let guard = 0; guard < 10; guard += 1) {
    const date = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(4, 6)) - 1, Number(current.slice(6, 8))));
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) return current;
    current = dateOffsetKey(current, -1);
  }
  return current;
}

function fixedCostDueKey(row: Row, todayKey: string) {
  const year = Number(todayKey.slice(0, 4));
  const month = Number(todayKey.slice(4, 6));
  const raw = text(row.base_day ?? row.payment_day ?? row.due_day);
  const day = raw === "말일" || raw === "last" ? lastDayOfMonthKey(year, month) : Math.min(Math.max(numberValue(raw), 1), lastDayOfMonthKey(year, month));
  return previousBusinessDateKey(`${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`);
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

function dailyAdSeries(rows: Row[], days: number, endDate: string, pickDate: (row: Row) => unknown, pickSpend: (row: Row) => unknown, pickConversionSales: (row: Row) => unknown) {
  return compactRangeUntil(days, endDate).map((day) => {
    const dayRows = rows.filter((row) => dateKey(pickDate(row)) === day.key);
    const cost = sum(dayRows, pickSpend);
    const conversionSales = sum(dayRows, pickConversionSales);
    return {
      ...day,
      value: cost,
      cost,
      conversion_sales: conversionSales,
      roas: cost ? (conversionSales / cost) * 100 : 0,
    };
  });
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
    purchases,
    orders,
    inventory,
    channels,
    adReports,
    adDailyMetrics,
    expenses,
    legacyExpenses,
    payables,
    fixedCosts,
    importPurchaseOrders,
    importErpOrdersRaw,
    importErpItems,
    importErpProducts,
    importErpRates,
    importErpFactories,
  ] = await Promise.all([
    optionalRows("sales", { order: "created_at.desc", limit: 1500 }),
    optionalRows("purchases", { order: "created_at.desc", limit: 1500 }),
    optionalRows("orders", { order: "created_at.desc", limit: 700 }),
    optionalRows("inventory_current", { order: "updated_at.desc", limit: 500 }),
    optionalRows("sales_channels", { order: "channel_code.asc", limit: 100 }),
    optionalRows("ad_reports", { order: "report_date.desc", limit: 2000 }),
    optionalRows("ad_daily_metrics", { order: "metric_date.desc", limit: 500 }),
    optionalRows("expenses", { order: "expense_date.desc", limit: 700 }),
    optionalRows("expense_entries", { order: "expense_date.desc", limit: 500 }),
    optionalRows("customer_payables", { order: "due_date.asc", limit: 100 }),
    optionalRows("accounting_fixed_costs", { is_active: "eq.true", order: "sort_order.asc", limit: 300 }),
    optionalRows("import_purchase_orders", { order: "created_at.desc", limit: 120 }),
    optionalRows("import_erp_orders", { order: "order_date.desc", limit: 160 }),
    optionalRows("import_erp_order_items", { order: "sort_order.asc", limit: 1200 }),
    optionalRows("import_erp_products", { order: "id.asc", limit: 1200 }),
    optionalRows("import_erp_fx_rates", { order: "currency.asc", limit: 50 }),
    optionalRows("import_erp_factories", { order: "name.asc", limit: 300 }),
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
  const adConversionSales = (row: Row) => row.conversion_value ?? row.purchase_conversion_value;
  const expenseRows = expenses.length ? expenses : legacyExpenses;
  const expenseDate = (row: Row) => row.expense_date ?? row.created_at;
  const factoryById = new Map(importErpFactories.map((row) => [String(row.id), text(row.name)]));
  const productById = new Map(importErpProducts.map((row) => [text(row.id), row]));
  const importRateMap = new Map(importErpRates.map((row) => [text(row.currency), numberValue(row.rate)]));
  const itemsByOrder = new Map<string, Row[]>();
  for (const item of importErpItems) {
    const key = text(item.order_id);
    if (!key) continue;
    itemsByOrder.set(key, [...(itemsByOrder.get(key) || []), item]);
  }
  const importErpOrders = importErpOrdersRaw.map((row) => {
    const lines = itemsByOrder.get(text(row.id)) || [];
    const firstLine = lines[0] || {};
    return {
      ...row,
      factory_name: factoryById.get(text(row.factory_id)) || row.factory_name,
      repr_product: firstLine.product_name || row.repr_product,
      repr_image: firstLine.image_path || (productById.get(text(firstLine.product_id)) || {}).image_path || row.repr_image,
      total_qty: lines.reduce((total, line) => total + numberValue(line.quantity), 0),
      line_count: lines.length,
      total_won: importOrderTotalWon(row, lines, importRateMap),
    };
  });
  const importOrders = importPurchaseOrders.length ? importPurchaseOrders : importErpOrders;
  const importDate = (row: Row) => row.order_date ?? row.expected_inbound_date ?? row.created_at;
  const importAmount = (row: Row) =>
    row.total_won ??
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
  const adSevenDayStart = dateOffsetKey(latestAdDate, -6);
  const recentImportOrders = [...importOrders].sort((left, right) => dateKey(importDate(right)).localeCompare(dateKey(importDate(left))));

  const latestSalesRows = rowsOn(sales, salesDate, latestSalesDate);
  const monthSalesRows = sales.filter((row) => dateKey(salesDate(row)).startsWith(month));
  const monthPurchaseRows = purchases.filter((row) => dateKey(entryDate(row, "purchases")).startsWith(month));
  const sevenDaySalesRows = rowsFrom(sales, salesDate, sevenDaysAgo);
  const latestOrderRows = rowsOn(orders, orderDate, latestOrderDate);
  const riskItems = inventory.filter((row) => numberValue(row.available_qty ?? row.on_hand_qty ?? row.bal_qty) <= 5);

  const latestAdRows = rowsOn(adRows, adDate, latestAdDate);
  const yesterdayAdRows = rowsOn(adRows, adDate, yesterday);
  const sevenDayAdRows = rowsFrom(adRows, adDate, adSevenDayStart);
  const monthAdRows = adRows.filter((row) => dateKey(adDate(row)).startsWith(month));
  const monthExpenseRows = expenseRows.filter((row) => dateKey(expenseDate(row)).startsWith(month));
  const cardRows = monthExpenseRows.filter((row) => /card|credit|카드/i.test(`${row.payment_method || ""} ${row.source_type || ""}`));
  const upcomingFixedCosts = fixedCosts.length
    ? fixedCosts
      .map((row) => {
        const due = fixedCostDueKey(row, today);
        return {
          ...row,
          due_date: isoDateFromKey(due),
          amount: numberValue(row.last_actual_amount) || numberValue(row.expected_amount ?? row.amount),
          display_title: row.fixed_cost_name || row.name,
        };
      })
      .filter((row) => {
        const due = dateKey(row.due_date);
        return due && due >= today && due <= threeDaysLater && numberValue(row.amount) > 0;
      })
    : payables.filter((row) => {
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

  const adSevenDaySpend = sum(sevenDayAdRows, adSpend);
  const adMonthSpend = sum(monthAdRows, adSpend);
  const adSevenDayConversionSales = sum(sevenDayAdRows, adConversionSales);
  const conversionSales = sum(monthAdRows, adConversionSales);
  const importMonthly = monthlySeries(importOrders, 6, importDate, importAmount)
    .map((group) => {
      const rows = importOrders
        .filter((row) => dateKey(importDate(row)).startsWith(group.month))
        .sort((left, right) => dateKey(importDate(right)).localeCompare(dateKey(importDate(left))));
      return {
        ...group,
        count: rows.length,
        orders: rows.slice(0, 8).map((row) => ({ ...row, display_title: rowTitle(row) })),
      };
    })
    .reverse();

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
    month_purchases: sum(monthPurchaseRows, entryAmount),
    sales_daily: dailySeries(sales, 14, salesDate, salesAmount),
    order_count: latestOrderRows.length,
    order_latest_date: iso(latestOrderDate),
    inventory_risk_count: riskItems.length,
    inventory_risk_items: riskItems.slice(0, 10),
    inventory: inventory.slice(0, 500),
    sales_inventory_basis: sales.slice(0, 1500),
    purchase_inventory_basis: purchases.slice(0, 1500),
    recent_sales: summarizeEntryRows(sales, "sales", 80),
    recent_purchases: summarizeEntryRows(purchases, "purchases", 80),
    recent_sales_lines: sales.slice(0, 500),
    recent_purchase_lines: purchases.slice(0, 500),
    inquiry_channels: inquiryChannels,
    ad_label: metricTitle("광고비", latestAdDate, today, yesterday),
    ad_latest_date: iso(latestAdDate),
    ad_latest_spend: sum(latestAdRows, adSpend),
    ad_yesterday_spend: sum(yesterdayAdRows, adSpend),
    ad_seven_day_spend: adSevenDaySpend,
    ad_month_spend: adMonthSpend,
    ad_seven_day_roas: adSevenDaySpend ? (adSevenDayConversionSales / adSevenDaySpend) * 100 : 0,
    ad_month_roas: adMonthSpend ? (conversionSales / adMonthSpend) * 100 : 0,
    ad_conversion_sales: conversionSales,
    ad_roas: adMonthSpend ? (conversionSales / adMonthSpend) * 100 : 0,
    ad_daily: dailyAdSeries(adRows, 7, latestAdDate, adDate, adSpend, adConversionSales),
    card_expense_amount: cardRows.length
      ? sum(cardRows, (row) => row.total_amount ?? row.amount ?? row.supply_amount)
      : sum(monthExpenseRows, (row) => row.total_amount ?? row.amount ?? row.supply_amount),
    bank_balance: null,
    upcoming_fixed_costs: upcomingFixedCosts.slice(0, 8).map((row) => ({ ...row, display_title: rowTitle(row) })),
    import_recent_orders: recentImportOrders.slice(0, 8).map((row) => ({ ...row, display_title: rowTitle(row) })),
    import_six_month_amount: sum(importSixMonthRows, importAmount),
    import_monthly: importMonthly,
  };
}
