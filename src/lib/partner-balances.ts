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
  if (raw.includes("쇼핑몰") || raw.includes("쇳븨")) return "shopping";
  return raw.includes("shopping") || raw.includes("mall") || raw.includes("shop") || raw.includes("쇼핑몰") ? "shopping" : "general";
}

function boolValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = text(value).toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "y", "on", "반영", "include"].includes(raw);
}

function balanceReflect(row: Row) {
  return boolValue(row.balance_reflect, customerType(row) !== "shopping");
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

function entryProductCode(row: Row) {
  return text(row.representative_product_code || row.prod_cd || row.product_code || row.sku || row.item_code);
}

function entryProductName(row: Row) {
  return text(row.representative_product_name || row.prod_name || row.product_name || row.item_name || row.sku_name || entryProductCode(row) || "-");
}

function entryWarehouse(row: Row) {
  return text(row.wh_cd || row.warehouse_code || row.warehouse_name || row.warehouse || "-");
}

function entryUnitPrice(row: Row) {
  const qty = entryQty(row);
  return numberValue(row.unit_price ?? row.price ?? row.sale_price ?? row.purchase_price) || (qty ? entryAmount(row) / qty : 0);
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

function lineNo(row: Row) {
  const parsed = numberValue(row.upload_ser_no);
  return parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}

function groupKeyPart(value: unknown) {
  return encodeURIComponent(text(value));
}

function batchEntryGroupKey(row: Row, mode: BalanceMode) {
  const batchId = text(row.upload_batch_id);
  if (!batchId) return "";
  const date = entryDate(row, mode).replace(/\D/g, "").slice(0, 8);
  const customerCode = entryCustomerCode(row);
  const customerName = text(row.cust_name || row.customer_name || row.supplier_name);
  if (!date || !(customerCode || customerName)) return `batch:${batchId}`;
  return ["batch-entry", batchId, date, customerCode, customerName].map(groupKeyPart).join(":");
}

function entryGroupKey(row: Row, mode: BalanceMode) {
  const batchEntryKey = batchEntryGroupKey(row, mode);
  if (batchEntryKey) return batchEntryKey;
  const ref = text(row.source_ref_id);
  const manualMatch = ref.match(/^(manual-(?:sale|purchase|return|exchange)-\d+)/);
  if (manualMatch?.[1]) return `manual:${manualMatch[1]}`;
  return `row:${text(row.id || ref || `${mode}-${entryDate(row, mode)}-${entryCustomerName(row, mode)}`)}`;
}

function entryDisplayNo(row: Row, mode: BalanceMode, groupKey: string) {
  const raw = text(row.display_no || row.voucher_no || row.slip_no || row.io_no || row.no || row.source_ref_id || groupKey.replace(/^(batch|manual|row):/, ""));
  const rawDateNo = raw.match(/(\d{4}-\d{2}-\d{2})\|(\d+)/);
  if (rawDateNo) return `${rawDateNo[1].replace(/\D/g, "").slice(2)}-${rawDateNo[2]}`;
  if (/^\d{6}-\d+$/.test(raw)) return raw;
  if (raw && raw.length <= 18 && !raw.includes("|")) return raw;
  const date = entryDate(row, mode).replace(/\D/g, "").slice(2);
  return date ? `${date}-1` : `${mode}-1`;
}

function paymentLinkedType(mode: BalanceMode) {
  return `fnos_partner_balance_${mode}`;
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
  const [customers, salesRows, purchaseRows, payments] = await Promise.all([
    optionalRows("customers", { order: "customer_name.asc", limit: 5000 }),
    mode === "sales" ? optionalRows("sales", { order: "created_at.desc", limit: 5000 }) : Promise.resolve([]),
    mode === "purchases" ? optionalRows("purchases", { order: "created_at.desc", limit: 5000 }) : Promise.resolve([]),
    optionalRows("payment_records", { linked_type: `eq.${paymentLinkedType(mode)}`, order: "payment_date.desc", limit: 5000 }),
  ]);

  const customerRows = customers.map((row) => ({ row, keys: customerKeys(row), name: customerName(row) || customerCode(row), code: customerCode(row), type: customerType(row), balance_reflect: balanceReflect(row) }));
  const customerByKey = new Map<string, { row: Row; keys: string[]; name: string; code: string; type: string; balance_reflect: boolean }>();
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
    customer_id: string;
    customer_type: string;
    count: number;
    qty: number;
    previous_balance: number;
    trade_amount: number;
    paid_amount: number;
    balance: number;
    month_count: number;
    month_qty: number;
    month_trade_amount: number;
    month_paid_amount: number;
    month_end_balance: number;
    latest: string;
    details: Row[];
  }>();

  const groupFor = (code: unknown, name: unknown) => {
    const customerRecord = findCustomer(code, name);
    const display = customerRecord?.name || text(name) || text(code) || "-";
    const key = compact(customerRecord?.code || code || display) || compact(display);
    if (customerRecord?.type === "shopping") return null;
    if (!key || display === "-" || display === "거래처" || display === "구매처") return null;
    if (!customerRecord?.balance_reflect) return null;
    if (targetNeedle && ![customerRecord?.code, customerRecord?.name, code, name].map(compact).some((value) => value && (value.includes(targetNeedle) || targetNeedle.includes(value)))) return null;
    const prev = groups.get(key) || {
      customer: display,
      customer_code: customerRecord?.code || text(code),
      customer_id: text(customerRecord?.row.id),
      customer_type: customerRecord?.type || "general",
      count: 0,
      qty: 0,
      previous_balance: 0,
      trade_amount: 0,
      paid_amount: 0,
      balance: 0,
      month_count: 0,
      month_qty: 0,
      month_trade_amount: 0,
      month_paid_amount: 0,
      month_end_balance: 0,
      latest: "",
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
      voucher_no: entryDisplayNo(first, mode, entryGroupKey(first, mode)),
      warehouse: entryWarehouse(first),
      amount,
      payment_amount: 0,
      balance_delta: amount,
      description: `${mode === "sales" ? "판매" : "구매"} ${sorted.length.toLocaleString("ko-KR")}품목`,
      memo: text(first.remarks || first.memo),
      lines: sorted.map((row) => {
        const rowQty = entryQty(row) * factor;
        const rowAmount = entryAmount(row) * factor;
        return {
          product_code: entryProductCode(row),
          product_name: entryProductName(row),
          warehouse: entryWarehouse(row),
          qty: rowQty,
          unit_price: entryUnitPrice(row),
          amount: rowAmount,
          memo: text(row.remarks || row.memo),
        };
      }),
    });
  });

  const groupItems = Array.from(groups.values());
  for (const payment of payments) {
    const date = isoDate(payment.payment_date || payment.created_at);
    if (!date || date > cutoff) continue;
    const amount = Math.abs(numberValue(payment.amount));
    if (!amount) continue;
    const target = groupItems.find((item) => {
      const paymentCustomerId = text(mode === "sales" ? payment.customer_id : payment.supplier_id);
      if (paymentCustomerId && item.customer_id && paymentCustomerId === item.customer_id) return true;
      const linkedId = compact(payment.linked_id);
      return Boolean(linkedId && [item.customer_code, item.customer].map(compact).some((value) => value && (value === linkedId || value.includes(linkedId) || linkedId.includes(value))));
    });
    if (!target) continue;
    target.paid_amount += amount;
    target.balance -= amount;
    if (date >= monthStart && date <= cutoff) target.month_paid_amount += amount;
    if (date > target.latest) target.latest = date;
    target.details.push({
      source: "수동",
      kind: mode === "sales" ? "수금" : "지급",
      date,
      amount: 0,
      payment_amount: amount,
      balance_delta: -amount,
      description: text(payment.payment_method) || (mode === "sales" ? "수동 수금" : "수동 지급"),
      memo: text(payment.memo),
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
        previous_balance: row.balance - row.month_trade_amount + row.month_paid_amount,
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

export async function createManualPartnerPayment(payload: Row) {
  const mode = text(payload.mode) === "purchases" ? "purchases" : "sales";
  const amount = Math.abs(numberValue(payload.amount));
  const customerName = text(payload.customer_name || payload.customer);
  if (!customerName || !amount) throw new FnosDbError("거래처와 결제 금액을 입력해 주세요.", 400);
  const date = isoDate(payload.payment_date || payload.date) || new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [customer] = await optionalRows("customers", text(payload.customer_code)
    ? { customer_code: `eq.${text(payload.customer_code)}`, limit: 1 }
    : { customer_name: `eq.${customerName}`, limit: 1 });
  const row = {
    payment_date: date,
    customer_id: mode === "sales" ? text(customer?.id) || null : null,
    supplier_id: mode === "purchases" ? text(customer?.id) || null : null,
    amount,
    payment_method: mode === "sales" ? "수동 수금" : "수동 지급",
    memo: text(payload.memo),
    linked_type: paymentLinkedType(mode),
    linked_id: text(payload.customer_code) || customerName,
    created_at: new Date().toISOString(),
  };
  return insertWithSchemaFallback("payment_records", row);
}
