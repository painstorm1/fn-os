import { FnosDbError, insertRows, selectRows } from "./fnos-db";

type Row = Record<string, unknown>;
type QueryValue = string | number | boolean | null | undefined;
type BalanceMode = "sales" | "purchases";

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

function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function monthEnd(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return "";
  const [year, monthNo] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNo, 0)).toISOString().slice(0, 10);
}

function currentMonth() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function compact(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, "").replace(/[(){}[\]<>]/g, "");
}

function customerCode(row: Row) {
  return text(row.customer_code || row.cust_code);
}

function customerName(row: Row) {
  return text(row.customer_name || row.cust_name);
}

function customerType(row: Row) {
  const raw = compact(row.customer_type || row.cust_type || row.customer_type_label);
  return raw.includes("shopping") || raw.includes("mall") || raw.includes("shop") || raw.includes("쇼핑몰") ? "shopping" : "general";
}

function customerKeys(row: Row) {
  return [
    customerCode(row),
    customerName(row),
    row.business_no,
    row.business_number,
    row.biz_no,
    row.registration_no,
  ].map(compact).filter(Boolean);
}

function entryDate(row: Row, mode: BalanceMode) {
  return isoDate(row.io_date || (mode === "sales" ? row.sale_date : row.purchase_date) || row.created_at);
}

function entryCustomerCode(row: Row) {
  return text(row.cust_code || row.customer_code || row.supplier_code);
}

function entryCustomerName(row: Row, mode: BalanceMode) {
  return text(row.cust_name || row.customer_name || row.supplier_name || entryCustomerCode(row) || (mode === "sales" ? "거래처" : "구매처"));
}

function entryAmount(row: Row) {
  return numberValue(row.total_amount ?? row.supply_amount ?? row.supply_amt ?? row.amount);
}

function entryQty(row: Row) {
  return numberValue(row.qty ?? row.quantity ?? row.order_qty);
}

function isReturnExchangeRow(row: Row) {
  const value = text(row.return_exchange_type || row.io_type || row.sale_status || row.source_file_name || row.source_ref_id);
  return /RETURN_EXCHANGE|RETURN|EXCHANGE|return_in|exchange_out|manual-return|manual-exchange|반품|교환/i.test(value);
}

function returnExchangeFactor(row: Row) {
  const value = text(row.return_exchange_type || row.io_type || row.source_file_name || row.source_ref_id);
  if (/return_in|manual-return|RETURN|반품/i.test(value)) return -1;
  if (/exchange_out|manual-exchange|EXCHANGE|교환/i.test(value)) return 1;
  return 1;
}

function accountingDate(row: Row) {
  return isoDate(row.transaction_date || row.posting_date || row.expense_date || row.created_at);
}

function accountingAmount(row: Row, mode: BalanceMode) {
  if (mode === "sales") {
    return numberValue(row.credit_amount) || numberValue(row.amount_krw ?? row.amount);
  }
  return numberValue(row.debit_amount) || numberValue(row.amount_krw ?? row.amount);
}

function accountingMatchesMode(row: Row, mode: BalanceMode) {
  const direction = text(row.direction);
  if (mode === "sales") return direction === "income" || numberValue(row.credit_amount) > 0;
  return direction === "expense" || direction === "card_payment" || numberValue(row.debit_amount) > 0 || text(row.source_type) === "card";
}

function accountingHaystack(row: Row) {
  return [
    row.merchant_name,
    row.vendor_name,
    row.description,
    row.memo,
    row.customer_name,
    row.customer_code,
    row.account_name,
    row.card_name,
    row.raw_json ? JSON.stringify(row.raw_json) : "",
  ].map(compact).filter(Boolean).join(" ");
}

function rawJsonValue(row: Row, key: string) {
  const raw = row.raw_json;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return text((raw as Row)[key]);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return text((parsed as Row)[key]);
    } catch {
      return "";
    }
  }
  return "";
}

function isOpeningBalanceTransaction(row: Row) {
  const value = `${row.source_name || ""} ${row.category_middle || ""} ${rawJsonValue(row, "kind")}`.toLowerCase();
  return value.includes("fn os 기초잔액") || value.includes("opening_balance");
}

function openingBalanceMode(row: Row): BalanceMode | "" {
  const mode = rawJsonValue(row, "mode") || text(row.balance_mode);
  if (mode === "sales" || mode === "purchases") return mode;
  const category = text(row.category_large);
  if (category.includes("미지급")) return "purchases";
  if (category.includes("미수")) return "sales";
  return "";
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function lineNo(row: Row) {
  const parsed = numberValue(row.upload_ser_no);
  return parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}

function entryGroupKey(row: Row, mode: BalanceMode) {
  const batchId = text(row.upload_batch_id);
  if (batchId) return `batch:${batchId}`;
  const ref = text(row.source_ref_id);
  const manualMatch = ref.match(/^(manual-(?:sale|purchase|return|exchange)-\d+)/);
  if (manualMatch?.[1]) return `manual:${manualMatch[1]}`;
  return `row:${text(row.id || ref || `${mode}-${entryDate(row, mode)}-${entryCustomerName(row, mode)}`)}`;
}

function missingColumnName(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.match(/컬럼 '([^']+)'/)?.[1] || message.match(/Could not find the ['"]?([^'"\s]+)['"]? column/i)?.[1] || "";
}

async function insertWithSchemaFallback(table: string, row: Row) {
  let next = { ...row };
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      return await insertRows<Row>(table, next);
    } catch (error) {
      const column = missingColumnName(error);
      if (!column || !(column in next)) throw error;
      const { [column]: _removed, ...rest } = next;
      next = rest;
    }
  }
  throw new FnosDbError("저장 가능한 회계 컬럼 확인에 실패했습니다.");
}

export async function partnerBalanceSummary({ mode, month, customer }: { mode: BalanceMode; month?: string; customer?: string }) {
  const targetMonth = /^\d{4}-\d{2}$/.test(text(month)) ? text(month) : currentMonth();
  const cutoff = monthEnd(targetMonth) || new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const monthStart = `${targetMonth}-01`;
  const [customers, salesRows, purchaseRows, transactions] = await Promise.all([
    optionalRows("customers", { order: "customer_name.asc", limit: 5000 }),
    mode === "sales" ? optionalRows("sales", { order: "created_at.desc", limit: 5000 }) : Promise.resolve([]),
    mode === "purchases" ? optionalRows("purchases", { order: "created_at.desc", limit: 5000 }) : Promise.resolve([]),
    optionalRows("accounting_transactions", { is_active: "eq.true", order: "transaction_date.desc", limit: 5000 }),
  ]);

  const customerRows = customers.map((row) => ({ row, keys: customerKeys(row), name: customerName(row) || customerCode(row), code: customerCode(row), type: customerType(row) }));
  const customerByKey = new Map<string, { row: Row; keys: string[]; name: string; code: string; type: string }>();
  customerRows.forEach((item) => item.keys.forEach((key) => customerByKey.set(key, item)));
  const findCustomer = (code: unknown, name: unknown) => {
    const candidates = [code, name].map(compact).filter(Boolean);
    for (const key of candidates) {
      const exact = customerByKey.get(key);
      if (exact) return exact;
    }
    return customerRows.find((item) => item.keys.some((key) => candidates.some((candidate) => key.includes(candidate) || candidate.includes(key)))) || null;
  };

  const targetNeedle = compact(customer);
  const groups = new Map<string, {
    customer: string;
    customer_code: string;
    customer_type: string;
    count: number;
    qty: number;
    trade_amount: number;
    paid_amount: number;
    balance: number;
    month_count: number;
    month_qty: number;
    month_trade_amount: number;
    month_paid_amount: number;
    month_end_balance: number;
    latest: string;
    settlement_start_date: string;
    details: Row[];
  }>();

  const groupFor = (code: unknown, name: unknown) => {
    const customerRecord = findCustomer(code, name);
    const display = customerRecord?.name || text(name) || text(code) || "-";
    const key = compact(customerRecord?.code || code || display) || compact(display);
    if (!key || display === "-" || display === "거래처" || display === "구매처") return null;
    if (customerRecord?.type === "shopping") return null;
    if (targetNeedle && ![customerRecord?.code, customerRecord?.name, code, name].map(compact).some((value) => value && (value.includes(targetNeedle) || targetNeedle.includes(value)))) return null;
    const prev = groups.get(key) || {
      customer: display,
      customer_code: customerRecord?.code || text(code),
      customer_type: customerRecord?.type || "general",
      count: 0,
      qty: 0,
      trade_amount: 0,
      paid_amount: 0,
      balance: 0,
      month_count: 0,
      month_qty: 0,
      month_trade_amount: 0,
      month_paid_amount: 0,
      month_end_balance: 0,
      latest: "",
      settlement_start_date: "",
      details: [],
    };
    groups.set(key, prev);
    return { key, group: prev, customerRecord };
  };

  const entries = mode === "sales" ? salesRows : purchaseRows;
  const groupedEntries = new Map<string, Row[]>();
  entries.forEach((row) => {
    if (mode === "sales" && isReturnExchangeRow(row) && returnExchangeFactor(row) === 1) return;
    const key = entryGroupKey(row, mode);
    groupedEntries.set(key, [...(groupedEntries.get(key) || []), row]);
  });

  groupedEntries.forEach((entryLines) => {
    const sorted = [...entryLines].sort((left, right) => lineNo(left) - lineNo(right));
    const first = sorted[0] || {};
    const date = entryDate(first, mode);
    if (!date || date > cutoff) return;
    const target = groupFor(entryCustomerCode(first), entryCustomerName(first, mode));
    if (!target) return;
    const factor = mode === "sales" ? returnExchangeFactor(first) : 1;
    const amount = sorted.reduce((sum, row) => sum + entryAmount(row), 0) * factor;
    const qty = sorted.reduce((sum, row) => sum + entryQty(row), 0) * factor;
    target.group.count += 1;
    target.group.qty += qty;
    target.group.trade_amount += amount;
    target.group.balance += amount;
    const settlementStart = addDays(date, -3);
    if (!target.group.settlement_start_date || settlementStart < target.group.settlement_start_date) target.group.settlement_start_date = settlementStart;
    if (date >= monthStart && date <= cutoff) {
      target.group.month_count += 1;
      target.group.month_qty += qty;
      target.group.month_trade_amount += amount;
    }
    if (date > target.group.latest) target.group.latest = date;
    target.group.details.push({
      source: "자동",
      kind: "전표",
      date,
      amount,
      payment_amount: 0,
      balance_delta: amount,
      description: `${mode === "sales" ? "판매" : "구매"} ${sorted.length.toLocaleString("ko-KR")}품목`,
      memo: text(first.remarks || first.memo),
    });
  });

  for (const tx of transactions) {
    if (!isOpeningBalanceTransaction(tx) || openingBalanceMode(tx) !== mode) continue;
    const date = accountingDate(tx);
    if (!date || date > cutoff) continue;
    const amount = numberValue(tx.amount_krw ?? tx.amount);
    if (!amount) continue;
    const target = groupFor(tx.customer_code, tx.customer_name || tx.merchant_name);
    if (!target) continue;
    target.group.balance += amount;
    if (!target.group.settlement_start_date || date < target.group.settlement_start_date) target.group.settlement_start_date = date;
    if (date >= monthStart && date <= cutoff) target.group.month_trade_amount += amount;
    if (date > target.group.latest) target.group.latest = date;
    target.group.details.push({
      source: "수동",
      kind: "기초잔액",
      date,
      amount,
      payment_amount: 0,
      balance_delta: amount,
      description: `${mode === "sales" ? "미수금" : "미지급"} 기초잔액`,
      memo: text(tx.memo),
    });
  }

  const groupItems = Array.from(groups.values());
  for (const tx of transactions) {
    if (isOpeningBalanceTransaction(tx)) continue;
    const date = accountingDate(tx);
    if (!date || date > cutoff || !accountingMatchesMode(tx, mode)) continue;
    const amount = accountingAmount(tx, mode);
    if (!amount) continue;
    const haystack = accountingHaystack(tx);
    const target = groupItems.find((item) => {
      if (item.settlement_start_date && date < item.settlement_start_date) return false;
      const customerRecord = findCustomer(item.customer_code, item.customer);
      const keys = customerRecord?.keys?.length ? customerRecord.keys : [item.customer_code, item.customer].map(compact).filter(Boolean);
      return keys.some((key) => key && haystack.includes(key));
    });
    if (!target) continue;
    target.paid_amount += amount;
    target.balance -= amount;
    if (date >= monthStart && date <= cutoff) target.month_paid_amount += amount;
    if (date > target.latest) target.latest = date;
    target.details.push({
      source: text(tx.source_type) === "manual" ? "수동" : "자동",
      kind: mode === "sales" ? "수금" : "지급",
      date,
      amount: 0,
      payment_amount: amount,
      balance_delta: -amount,
      description: text(tx.description || tx.merchant_name || tx.source_name),
      memo: text(tx.memo),
    });
  }

  const rows = Array.from(groups.values())
    .map((row) => {
      const details = row.details
        .filter((detail) => {
          const date = text(detail.date);
          return date >= monthStart && date <= cutoff;
        })
        .sort((left, right) => text(right.date).localeCompare(text(left.date)));
      return {
        ...row,
        count: row.month_count,
        qty: row.month_qty,
        trade_amount: row.month_trade_amount,
        paid_amount: row.month_paid_amount,
        month_end_balance: row.balance,
        latest: text(details[0]?.date) || "",
        details,
      };
    })
    .filter((row) => Math.round(row.month_trade_amount) !== 0 || Math.round(row.month_paid_amount) !== 0)
    .sort((left, right) => Math.abs(right.month_end_balance) - Math.abs(left.month_end_balance) || left.customer.localeCompare(right.customer, "ko-KR"));

  return { mode, month: targetMonth, cutoff, rows };
}

export async function createManualPartnerOpeningBalance(payload: Row) {
  const mode = text(payload.mode) === "purchases" ? "purchases" : "sales";
  const amount = Math.abs(numberValue(payload.amount));
  const customerName = text(payload.customer_name || payload.customer);
  if (!customerName || !amount) throw new FnosDbError("거래처와 기초잔액을 입력해 주세요.", 400);
  const date = isoDate(payload.balance_date || payload.date) || new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isSales = mode === "sales";
  const row = {
    source_type: "manual",
    source_name: "FN OS 기초잔액",
    balance_mode: mode,
    transaction_date: date,
    posting_date: date,
    description: `${isSales ? "미수금" : "미지급"} 기초잔액 - ${customerName}`,
    merchant_name: customerName,
    customer_name: customerName,
    customer_code: text(payload.customer_code),
    debit_amount: 0,
    credit_amount: 0,
    amount,
    amount_krw: amount,
    currency: "KRW",
    direction: "opening_balance",
    category_large: isSales ? "미수금" : "미지급",
    category_middle: "FN OS 기초잔액",
    category_small: "",
    review_status: "confirmed",
    affects_profit: false,
    affects_cashflow: false,
    memo: text(payload.memo),
    raw_json: { ...payload, kind: "opening_balance", mode },
    dedupe_key: `fnos-opening-partner-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return insertWithSchemaFallback("accounting_transactions", row);
}

export async function createManualPartnerPayment(payload: Row) {
  const mode = text(payload.mode) === "purchases" ? "purchases" : "sales";
  const amount = Math.abs(numberValue(payload.amount));
  const customerName = text(payload.customer_name || payload.customer);
  if (!customerName || !amount) throw new FnosDbError("거래처와 결제 금액을 입력해 주세요.", 400);
  const date = isoDate(payload.payment_date || payload.date) || new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isSales = mode === "sales";
  const row = {
    source_type: "manual",
    source_name: "FN OS 수동결제",
    transaction_date: date,
    posting_date: date,
    description: `${isSales ? "미수금 수동 수금" : "미지급 수동 지급"} - ${customerName}`,
    merchant_name: customerName,
    customer_name: customerName,
    customer_code: text(payload.customer_code),
    debit_amount: isSales ? 0 : amount,
    credit_amount: isSales ? amount : 0,
    amount,
    amount_krw: amount,
    currency: "KRW",
    direction: isSales ? "income" : "expense",
    category_large: isSales ? "수금" : "지급",
    category_middle: "FN OS 수동결제",
    category_small: "",
    review_status: "confirmed",
    affects_profit: false,
    affects_cashflow: true,
    memo: text(payload.memo),
    raw_json: payload,
    dedupe_key: `fnos-manual-partner-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return insertWithSchemaFallback("accounting_transactions", row);
}
