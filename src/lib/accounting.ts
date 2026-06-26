import { appendAccountingInstallmentMemo } from "./accounting-installments";
import { deleteRows, hasDbConfig, insertRows, patchRows, selectRows } from "./fnos-db";

type RawRow = Record<string, unknown>;

const DEFAULT_CATEGORIES = [
  "광고비",
  "마케팅-광고",
  "물류비",
  "택배비",
  "수입비용",
  "수입 결제",
  "관세",
  "부가세",
  "통관수수료",
  "샘플비",
  "포장비",
  "박스구매",
  "상품매입",
  "제품구매",
  "외주비",
  "소모품",
  "인건비",
  "사무실비",
  "업무비용",
  "식대",
  "유지비",
  "통장이동",
  "거래처 결제",
  "판매 정산금",
  "입금",
  "출금",
  "국민기업카드",
  "가온글로벌",
  "4대보험",
  "대출이자",
  "세무사기장료",
  "종소세신고료",
  "반품택배",
  "주유비",
  "통신인터넷",
  "타배",
  "추가비용(세관창고보관료)",
  "기타",
];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function first(row: RawRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && text(value) !== "") return value;
  }
  return "";
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(raw)) {
    const [year, month, day] = raw.split(/[./-\s]/);
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function compactMonth(value: unknown) {
  return isoDate(value).slice(0, 7);
}

function classifyExpense(vendor: string, description: string, sourceType: string) {
  const haystack = `${vendor} ${description} ${sourceType}`.toLowerCase();
  if (/네이버|naver|meta|facebook|instagram|구글|google|광고|ads/.test(haystack)) return "광고비";
  if (/cj대한통운|대한통운|택배|우체국|로젠|한진/.test(haystack)) return "택배비";
  if (/물류|운임|해상|항공|배대지|배송대행|포워딩/.test(haystack)) return "물류비";
  if (/관세/.test(haystack)) return "관세";
  if (/부가세|vat/.test(haystack)) return "부가세";
  if (/관세사|통관|수수료/.test(haystack)) return "통관수수료";
  if (/샘플|sample|해외결제/.test(haystack)) return "샘플비";
  if (/포장|박스|봉투/.test(haystack)) return "포장비";
  if (/구매|매입|1688|알리바바|alibaba/.test(haystack)) return "상품매입";
  if (/외주|디자인|촬영|편집/.test(haystack)) return "외주비";
  if (/사무실|임대|관리비|전기|인터넷/.test(haystack)) return "사무실비";
  if (/소모품|문구|비품/.test(haystack)) return "소모품";
  if (/급여|인건비|알바/.test(haystack)) return "인건비";
  if (/수입|검품|중국|일본/.test(haystack)) return "수입비용";
  return "기타";
}

async function optionalRows(table: string, query?: Record<string, string | number | boolean | null | undefined>) {
  return selectRows<Record<string, unknown>>(table, query).catch(() => []);
}

function sum(rows: RawRow[], pick: (row: RawRow) => unknown) {
  return rows.reduce((total, row) => total + numberValue(pick(row)), 0);
}

function groupAmount(rows: RawRow[], key: (row: RawRow) => string, pick: (row: RawRow) => unknown) {
  const map = new Map<string, { label: string; amount: number; count: number }>();
  rows.forEach((row) => {
    const label = key(row) || "기타";
    const prev = map.get(label) || { label, amount: 0, count: 0 };
    prev.amount += numberValue(pick(row));
    prev.count += 1;
    map.set(label, prev);
  });
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

export async function ensureExpenseCategories() {
  if (!hasDbConfig()) return [];
  const existing = await optionalRows("expense_categories", { order: "category_name.asc", limit: 200 });
  const names = new Set(existing.map((row) => text(row.category_name)));
  const missing = DEFAULT_CATEGORIES.filter((name) => !names.has(name));
  if (missing.length) {
    await insertRows("expense_categories", missing.map((category_name) => ({ category_name }))).catch(() => []);
  }
  return optionalRows("expense_categories", { order: "category_name.asc", limit: 200 });
}

export async function upsertExpenseCategory(row: RawRow) {
  const name = text(row.category_name || row.name);
  if (!name) throw new Error("카테고리명을 입력해 주세요.");
  const id = text(row.id);
  const values = {
    category_name: name,
    parent_category_id: text(row.parent_category_id) || null,
    is_active: row.is_active === undefined ? true : Boolean(row.is_active),
    updated_at: new Date().toISOString(),
  };
  if (id) {
    const [saved] = await patchRows("expense_categories", { id: `eq.${id}` }, values);
    return saved;
  }
  const [saved] = await insertRows("expense_categories", values);
  return saved;
}

export async function removeExpenseCategory(id: string) {
  if (!id) throw new Error("삭제할 카테고리를 선택해 주세요.");
  const used = await optionalRows("expenses", { category_id: `eq.${id}`, limit: 1 });
  if (used.length) {
    const [saved] = await patchRows("expense_categories", { id: `eq.${id}` }, { is_active: false, updated_at: new Date().toISOString() });
    return { mode: "deactivated", category: saved };
  }
  const [deleted] = await deleteRows("expense_categories", { id: `eq.${id}` });
  return { mode: "deleted", category: deleted };
}

export async function accountingSummary() {
  const [categories, expenses, legacyExpenses, batches, payables, payments, purchases, ads, sales, importOrders] = await Promise.all([
    ensureExpenseCategories(),
    optionalRows("expenses", { order: "expense_date.desc", limit: 500 }),
    optionalRows("expense_entries", { order: "expense_date.desc", limit: 200 }),
    optionalRows("expense_upload_batches", { order: "uploaded_at.desc", limit: 30 }),
    optionalRows("customer_payables", { order: "base_month.desc", limit: 100 }),
    optionalRows("payment_records", { order: "payment_date.desc", limit: 100 }),
    optionalRows("purchases", { order: "created_at.desc", limit: 500 }),
    optionalRows("ad_daily_metrics", { order: "metric_date.desc", limit: 200 }),
    optionalRows("sales", { order: "created_at.desc", limit: 500 }),
    optionalRows("import_purchase_orders", { order: "created_at.desc", limit: 100 }),
  ]);

  const categoryById = new Map(categories.map((row) => [text(row.id), text(row.category_name)]));
  const normalizedExpenses = expenses.length ? expenses : legacyExpenses.map((row) => ({
    ...row,
    vendor_name: row.customer_name || row.title,
    description: row.title || row.memo,
    amount: row.supply_amount,
  }));
  const month = new Date().toISOString().slice(0, 7);
  const monthExpenses = normalizedExpenses.filter((row) => isoDate(row.expense_date ?? row.created_at).startsWith(month));
  const monthSales = sales.filter((row) => compactMonth(row.io_date ?? row.sale_date ?? row.created_at) === month);
  const monthPurchases = purchases.filter((row) => compactMonth(row.io_date ?? row.purchase_date ?? row.created_at) === month);
  const monthAds = ads.filter((row) => compactMonth(row.metric_date ?? row.created_at) === month);

  const totalExpense = sum(monthExpenses, (row) => row.total_amount ?? row.amount ?? row.supply_amount);
  const adSpend = sum(monthAds, (row) => row.spend_amount);
  const purchaseAmount = sum(monthPurchases, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt);
  const salesAmount = sum(monthSales, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt);
  const estimatedProfit = salesAmount - purchaseAmount - adSpend - totalExpense;

  return {
    categories,
    expenses: normalizedExpenses.slice(0, 200),
    batches,
    payables,
    payments,
    import_orders: importOrders,
    totals: {
      month,
      sales_amount: salesAmount,
      purchase_amount: purchaseAmount,
      ad_spend: adSpend,
      expense_amount: totalExpense,
      estimated_profit: estimatedProfit,
      margin_rate: salesAmount ? (estimatedProfit / salesAmount) * 100 : 0,
      unpaid_count: payables.filter((row) => numberValue(row.balance_amount) > 0 || !["paid", "closed"].includes(text(row.status).toLowerCase())).length,
    },
    by_category: groupAmount(monthExpenses, (row) => categoryById.get(text(row.category_id)) || text(row.category) || "기타", (row) => row.total_amount ?? row.amount),
    by_vendor: groupAmount(monthExpenses, (row) => text(row.vendor_name || row.customer_name || row.title), (row) => row.total_amount ?? row.amount),
    by_month: groupAmount(normalizedExpenses, (row) => compactMonth(row.expense_date ?? row.created_at), (row) => row.total_amount ?? row.amount),
  };
}

export async function importExpenseRows(rows: RawRow[], sourceType = "기타", sourceFileName?: string, memo?: string) {
  const categories = await ensureExpenseCategories();
  const categoryByName = new Map(categories.map((row) => [text(row.category_name), text(row.id)]));
  const [batch] = await insertRows<{ id: string }>("expense_upload_batches", {
    source_type: sourceType,
    source_file_name: sourceFileName || null,
    total_count: rows.length,
    success_count: 0,
    fail_count: 0,
    status: "processing",
    memo: memo || null,
  });

  const normalized = rows.map((row) => {
    const vendor = text(first(row, ["vendor_name", "거래처", "업체명", "가맹점명", "상호", "적요", "받는분", "사용처"]));
    const description = text(first(row, ["description", "내용", "품목", "메모", "적요", "이용내역", "거래내용", "무게", "구간"]));
    const total = numberValue(first(row, ["total_amount", "합계", "금액", "이용금액", "출금액", "입금액", "청구금액", "배송비", "운임", "비용", "결제금액", "사용금액"]));
    const vat = numberValue(first(row, ["vat_amount", "부가세", "VAT", "세액"]));
    const amount = numberValue(first(row, ["amount", "공급가액", "공급가", "승인금액", "배송비", "운임", "비용"])) || Math.max(0, total - vat);
    const rowSourceType = text(row.source_type) || sourceType;
    const categoryName = text(first(row, ["category", "카테고리", "분류"])) || classifyExpense(vendor, description, rowSourceType);
    const categoryDetail = text(first(row, ["category_detail", "subcategory", "sub_category", "세부분류", "소분류", "상세분류"]));
    const categoryMemo = text(first(row, ["category_memo", "category_note", "detail_memo", "보조메모", "분류메모"]));
    const paymentDue = text(first(row, ["payment_due_date", "payment_due", "결제예정일"]));
    const currencyHint = text(first(row, ["currency_hint", "currency", "통화"]));
    const memo = appendAccountingInstallmentMemo([categoryDetail, categoryMemo, paymentDue ? `결제예정일:${paymentDue}` : "", currencyHint && currencyHint !== "KRW" ? `통화:${currencyHint}` : "", text(first(row, ["memo", "비고", "메모"]))].filter(Boolean).join(" / "), row);
    return {
      expense_date: isoDate(first(row, ["expense_date", "날짜", "일자", "거래일자", "이용일자", "승인일자", "작성일자"])),
      source_type: rowSourceType,
      vendor_name: vendor || description || sourceType,
      description,
      amount,
      vat_amount: vat,
      total_amount: total || amount + vat,
      payment_method: text(first(row, ["payment_method", "결제수단", "카드명", "계좌", "은행"])),
      category_id: categoryByName.get(categoryName) || categoryByName.get("기타") || null,
      linked_type: text(first(row, ["linked_type", "연결유형"])),
      linked_id: text(first(row, ["linked_id", "연결ID"])),
      memo,
      raw_payload: row,
      upload_batch_id: batch.id,
    };
  });

  const saved = normalized.length ? await insertRows("expenses", normalized) : [];
  await patchRows("expense_upload_batches", { id: `eq.${batch.id}` }, {
    success_count: saved.length,
    fail_count: Math.max(0, rows.length - saved.length),
    status: "uploaded",
  });
  return { ok: true, batch_id: batch.id, total_count: rows.length, success_count: saved.length, fail_count: Math.max(0, rows.length - saved.length) };
}

export async function createManualExpense(row: RawRow) {
  const categories = await ensureExpenseCategories();
  const category = categories.find((item) => text(item.id) === text(row.category_id) || text(item.category_name) === text(row.category_name));
  const [saved] = await insertRows("expenses", {
    expense_date: isoDate(row.expense_date),
    source_type: text(row.source_type) || "manual",
    vendor_name: text(row.vendor_name),
    description: text(row.description),
    amount: numberValue(row.amount),
    vat_amount: numberValue(row.vat_amount),
    total_amount: numberValue(row.total_amount) || numberValue(row.amount) + numberValue(row.vat_amount),
    payment_method: text(row.payment_method),
    category_id: category?.id || null,
    linked_type: text(row.linked_type),
    linked_id: text(row.linked_id),
    memo: text(row.memo),
    raw_payload: row,
  });
  return saved;
}
