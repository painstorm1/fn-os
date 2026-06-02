import { insertRows, patchRows, selectRows, upsertRows } from "./fnos-db";

type RawRow = Record<string, unknown>;
type QueryValue = string | number | boolean | null | undefined;

const SOURCE_ALIASES: Record<string, { sourceType: "card" | "bank"; sourceName: string; cardName?: string; accountName?: string }> = {
  "가온글로벌카드": { sourceType: "card", sourceName: "가온글로벌카드", cardName: "가온글로벌카드" },
  "국민기업카드": { sourceType: "card", sourceName: "국민기업카드", cardName: "국민기업카드" },
  "국민카드": { sourceType: "card", sourceName: "국민기업카드", cardName: "국민기업카드" },
  "국민카드 1": { sourceType: "card", sourceName: "가온글로벌카드", cardName: "가온글로벌카드" },
  "국민카드 2": { sourceType: "card", sourceName: "국민기업카드", cardName: "국민기업카드" },
  "국민은행": { sourceType: "bank", sourceName: "국민은행 통장", accountName: "국민은행 사업자통장" },
  "국민은행 통장": { sourceType: "bank", sourceName: "국민은행 통장", accountName: "국민은행 사업자통장" },
  "기업은행": { sourceType: "bank", sourceName: "기업은행 통장", accountName: "기업은행 사업자통장" },
  "기업은행 통장": { sourceType: "bank", sourceName: "기업은행 통장", accountName: "기업은행 사업자통장" },
};

const REVIEW_CATEGORY_BY_REASON: Record<string, [string, string, string]> = {
  KCP확인: ["검토필요", "KCP확인", ""],
  네이버확인: ["검토필요", "네이버확인", ""],
  일반명거래: ["검토필요", "일반명거래", ""],
  "자금이동 확인": ["자금이동", "계좌간이체/대표자입출금", ""],
  미분류: ["검토필요", "미분류", ""],
};

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
  const parsed = Number(text(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(raw)) {
    const [year, month, day] = raw.split(/[./-\s]/);
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return "";
}

function addMonths(year: number, month: number, delta: number) {
  const date = new Date(year, month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function dateText(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  current.setUTCDate(current.getUTCDate() + days);
  return dateText(current.getUTCFullYear(), current.getUTCMonth() + 1, current.getUTCDate());
}

function kstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function previousBusinessDay(date: string) {
  let current = date;
  for (let guard = 0; guard < 10; guard += 1) {
    const [year, month, day] = current.split("-").map(Number);
    const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekDay !== 0 && weekDay !== 6) return current;
    current = addDays(current, -1);
  }
  return current;
}

function monthDueDate(baseDay: unknown, today = kstToday()) {
  const [year, month] = today.split("-").map(Number);
  const raw = text(baseDay);
  const day = raw === "last" || raw === "말일" ? lastDayOfMonth(year, month) : Math.min(Math.max(numberValue(raw), 1), lastDayOfMonth(year, month));
  return previousBusinessDay(dateText(year, month, day));
}

function inferCardPaymentName(row: RawRow) {
  const haystack = `${text(row.merchant_name)} ${text(row.description)}`;
  if (!/KB카드출금|카드대금|카드출금/.test(haystack)) return "";
  const day = Number(isoDate(row.transaction_date).slice(8, 10));
  if (day >= 3 && day <= 7) return "가온글로벌카드";
  if (day >= 18 && day <= 22) return "국민기업카드";
  return "";
}

function sourceMeta(row: RawRow) {
  const raw = text(row.source_name || row.source_type || row.sourceType);
  const alias = SOURCE_ALIASES[raw];
  if (alias) return alias;
  if (/가온/.test(raw)) return SOURCE_ALIASES["가온글로벌카드"];
  if (/국민.*카드|기업카드/.test(raw)) return SOURCE_ALIASES["국민기업카드"];
  if (/국민.*은행/.test(raw)) return SOURCE_ALIASES["국민은행"];
  if (/기업.*은행|IBK/i.test(raw)) return SOURCE_ALIASES["기업은행"];
  return { sourceType: /은행|통장/.test(raw) ? "bank" as const : "card" as const, sourceName: raw || "기타" };
}

function settlementFor(cardName: string, date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  if (cardName === "가온글로벌카드") {
    const startBase = day >= 22 ? { year, month } : addMonths(year, month, -1);
    const endBase = day >= 22 ? addMonths(year, month, 1) : { year, month };
    const dueBase = addMonths(startBase.year, startBase.month, 2);
    return {
      settlement_start: dateText(startBase.year, startBase.month, 22),
      settlement_end: dateText(endBase.year, endBase.month, 21),
      payment_due_date: dateText(dueBase.year, dueBase.month, 5),
      card_limit: 20000000,
    };
  }
  if (cardName === "국민기업카드") {
    const startBase = day >= 6 ? { year, month } : addMonths(year, month, -1);
    const endBase = day >= 6 ? addMonths(year, month, 1) : { year, month };
    const dueBase = day >= 6 ? addMonths(year, month, 1) : { year, month };
    return {
      settlement_start: dateText(startBase.year, startBase.month, 6),
      settlement_end: dateText(endBase.year, endBase.month, 5),
      payment_due_date: dateText(dueBase.year, dueBase.month, 20),
      card_limit: 10000000,
    };
  }
  return null;
}

function directionFor(sourceType: string, row: RawRow, merchant: string, debit: number, credit: number) {
  const haystack = `${merchant} ${text(row.description)} ${text(row.category)} ${text(row.category_detail)}`;
  if (/KB카드출금/.test(haystack)) return "card_payment";
  if (/카드대금|카드결제|결제대금/.test(haystack)) return "card_payment";
  if (/계좌|이체|대표자|자금|대출원금|상환/.test(haystack)) return "transfer";
  if (sourceType === "bank" && credit > 0) return "income";
  if (sourceType === "bank" && debit > 0) return "expense";
  if (sourceType === "card") return "expense";
  return "pending_review";
}

function existingCategory(row: RawRow) {
  const large = text(first(row, ["existing_category_large", "기존대분류", "category", "카테고리", "분류"]));
  const middle = text(first(row, ["existing_category_middle", "기존중분류", "category_detail", "세부분류", "중분류", "상세분류"]));
  const small = text(first(row, ["existing_category_small", "기존소분류", "category_memo", "소분류", "보조메모", "분류메모"]));
  return { large, middle, small };
}

function dedupeKey(parts: Array<unknown>) {
  return parts.map((part) => text(part).replace(/\s+/g, " ")).join("|").toLowerCase();
}

function ruleMatches(rule: RawRow, tx: RawRow) {
  const field = text(rule.condition_field || "merchant_name");
  const operator = text(rule.condition_operator || "contains");
  const keyword = text(rule.keyword);
  const amountCondition = text(rule.amount_condition);
  const target = field === "merchant_amount"
    ? `${tx.merchant_name || ""} ${tx.amount || ""}`
    : text(tx[field] ?? tx.merchant_name ?? tx.description);
  if (text(rule.source_type) && text(rule.source_type) !== text(tx.source_type)) return false;
  if (text(rule.source_name) && text(rule.source_name) !== text(tx.source_name)) return false;
  if (text(rule.direction_condition) && text(rule.direction_condition) !== text(tx.direction)) return false;
  if (amountCondition && amountCondition !== "무관" && !amountCondition.split(/[,/또는\s]+/).filter(Boolean).some((item) => numberValue(item) === numberValue(tx.amount))) return false;
  if (!keyword) return true;
  if (operator === "equals" || operator === "일치") return target === keyword;
  if (operator === "starts_with" || operator === "시작") return target.startsWith(keyword);
  return target.includes(keyword);
}

async function optionalRows(table: string, query?: Record<string, QueryValue>) {
  return selectRows<RawRow>(table, query).catch(() => []);
}

function transactionAmount(row: RawRow) {
  return numberValue(row.amount_krw ?? row.amount ?? row.debit_amount ?? row.total_amount);
}

function fixedCostKeywords(row: RawRow) {
  const raw = row.match_keywords;
  if (Array.isArray(raw)) return raw.map(text).filter(Boolean);
  return text(raw).split(/[,/|]+/).map(text).filter(Boolean);
}

function matchingActualTransaction(fixedCost: RawRow, transactions: RawRow[], dueDate: string, today: string) {
  const keywords = fixedCostKeywords(fixedCost);
  if (!keywords.length) return null;
  const from = addDays(dueDate, -3);
  const to = text(fixedCost.base_day) === "말일" || text(fixedCost.base_day) === "last" ? addDays(dueDate, 2) : addDays(dueDate, 2);
  const sourceHint = text(fixedCost.payment_source || fixedCost.source_account_name || fixedCost.source_card_name);
  const candidates = transactions
    .filter((row) => {
      const txDate = isoDate(row.transaction_date);
      if (!txDate || txDate < from || txDate > to || txDate > today) return false;
      if (text(row.source_type) === "bank" && numberValue(row.debit_amount) <= 0) return false;
      if (sourceHint && !`${text(row.source_name)} ${text(row.account_name)} ${text(row.card_name)}`.includes(sourceHint)) return false;
      const haystack = `${text(row.merchant_name)} ${text(row.description)} ${text(row.memo)}`;
      return keywords.some((keyword) => haystack.includes(keyword));
    })
    .sort((left, right) => isoDate(right.transaction_date).localeCompare(isoDate(left.transaction_date)));
  return candidates[0] || null;
}

function fixedCostOccurrence(row: RawRow, today = kstToday(), transactions: RawRow[] = []) {
  const dueDate = monthDueDate(row.base_day ?? row.payment_day ?? row.due_day, today);
  const expectedAmount = numberValue(row.expected_amount ?? row.amount);
  const actualRow = matchingActualTransaction(row, transactions, dueDate, today);
  const actualAmount = actualRow ? transactionAmount(actualRow) : numberValue(row.last_actual_amount);
  const displayAmount = actualAmount || expectedAmount;
  const daysUntil = Math.round((new Date(`${dueDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
  return {
    id: row.id,
    fixed_cost_id: row.id,
    title: row.fixed_cost_name || row.name,
    display_title: row.fixed_cost_name || row.name,
    category_large: row.category_large,
    category_middle: row.category_middle,
    expected_amount: expectedAmount,
    last_actual_amount: actualAmount || null,
    last_actual_date: actualRow ? isoDate(actualRow.transaction_date) : row.last_actual_date || null,
    matched_transaction_id: actualRow?.id || null,
    amount: displayAmount,
    due_date: dueDate,
    base_day: row.base_day ?? row.payment_day ?? row.due_day,
    days_until: daysUntil,
    payment_type: row.payment_type,
    payment_source: row.payment_source,
    status: daysUntil < 0 ? "overdue_or_paid" : daysUntil <= 3 ? "upcoming" : "scheduled",
    memo: row.memo,
  };
}

function categoryKey(row: RawRow) {
  return `${text(row.category_large)}|${text(row.category_middle)}|${text(row.category_small)}`;
}

export function normalizeAccountingTransaction(row: RawRow) {
  const meta = sourceMeta(row);
  const transactionDate = isoDate(first(row, ["transaction_date", "expense_date", "거래일", "일자", "날짜", "이용일자", "승인일자"]));
  const merchant = text(first(row, ["merchant_name", "vendor_name", "거래처", "가맹점명", "적요", "받는분", "사용처"]));
  const description = text(first(row, ["description", "거래내용", "내용", "이용내역", "메모", "적요"])) || merchant;
  const withdrawal = numberValue(first(row, ["debit_amount", "출금액", "지급금액", "withdraw", "withdraw_amount"]));
  const deposit = numberValue(first(row, ["credit_amount", "입금액", "deposit", "deposit_amount"]));
  const explicitAmount = numberValue(first(row, ["amount", "total_amount", "금액원", "금액", "이용금액", "승인금액", "결제금액", "사용금액"]));
  const amount = explicitAmount || withdrawal || deposit;
  const debit = meta.sourceType === "card" ? amount : withdrawal;
  const credit = meta.sourceType === "bank" ? deposit : 0;
  const foreignAmount = numberValue(first(row, ["foreign_amount", "해외금액", "USD", "외화금액"]));
  const currency = text(first(row, ["currency", "통화"])) || (foreignAmount > 0 && amount === 0 ? "USD" : "KRW");
  const fxRate = numberValue(first(row, ["fx_rate", "환율"]));
  const amountKrw = currency === "KRW" ? amount : fxRate ? foreignAmount * fxRate : null;
  const existing = existingCategory(row);
  const direction = directionFor(meta.sourceType, row, merchant, debit, credit);
  const paymentCardName = direction === "card_payment" ? inferCardPaymentName({ ...row, transaction_date: transactionDate, merchant_name: merchant, description }) : "";
  const approvalNo = text(first(row, ["approval_no", "승인번호", "거래번호"]));
  const key = dedupeKey([
    meta.sourceName,
    transactionDate,
    approvalNo || text(row.transaction_time || row["거래시각"]),
    merchant || description,
    amount || foreignAmount,
  ]);
  return {
    source_file_name: text(row.source_file_name || row["원본파일"]),
    source_sheet_name: text(row.source_sheet_name),
    source_row_no: numberValue(row.source_row_no || row["원본행"]) || null,
    source_type: meta.sourceType,
    source_name: meta.sourceName,
    transaction_date: transactionDate || null,
    posting_date: isoDate(row.posting_date || row["승인일"] || row["이용일"]) || transactionDate || null,
    transaction_time: text(row.transaction_time || row["거래시각"]),
    description,
    merchant_name: merchant || description,
    debit_amount: debit,
    credit_amount: credit,
    amount,
    currency,
    fx_rate: fxRate || null,
    amount_krw: amountKrw,
    foreign_amount: foreignAmount || null,
    direction,
    payment_method: text(row.payment_method || row["결제수단"]),
    card_name: paymentCardName || meta.cardName || null,
    account_name: meta.accountName || null,
    approval_no: approvalNo,
    existing_category_large: existing.large,
    existing_category_middle: existing.middle,
    existing_category_small: existing.small,
    memo: text(row.memo || row["비고"]),
    raw_json: row,
    dedupe_key: key,
  };
}

export async function classifyAccountingTransactions(rows: RawRow[]): Promise<RawRow[]> {
  const [categories, rules] = await Promise.all([
    optionalRows("accounting_categories", { order: "sort_order.asc", limit: 500 }),
    optionalRows("accounting_category_rules", { is_active: "eq.true", order: "priority.asc", limit: 500 }),
  ]);
  const categoryByPath = new Map(categories.map((category) => [categoryKey(category), category]));
  const defaultReview = categoryByPath.get("검토필요|미분류|");

  return rows.map((row) => {
    const rule = rules.find((item) => ruleMatches(item, row));
    const isCardPayment = row.direction === "card_payment";
    const isTransfer = row.direction === "transfer";
    const reviewReason = text(rule?.review_reason) || (row.direction === "pending_review" ? "미분류" : "");
    const reviewPath = reviewReason ? REVIEW_CATEGORY_BY_REASON[reviewReason] : null;
    const categoryLarge = isCardPayment ? "카드대금" : isTransfer ? "자금이동" : reviewPath?.[0] || text(rule?.category_large) || text(row.existing_category_large) || text(defaultReview?.category_large);
    const categoryMiddle = isCardPayment ? text(row.card_name) || "카드출금" : isTransfer ? "계좌 간 이체/대표자 입출금" : reviewPath?.[1] || text(rule?.category_middle) || text(row.existing_category_middle) || text(defaultReview?.category_middle);
    const categorySmall = isCardPayment || isTransfer ? "" : reviewPath?.[2] || text(rule?.category_small) || text(row.existing_category_small) || text(defaultReview?.category_small);
    const category = categoryByPath.get(`${categoryLarge}|${categoryMiddle}|${categorySmall}`) || defaultReview;
    const needsReview = !isCardPayment && !isTransfer && (Boolean(rule?.review_required) || Boolean(reviewReason) || Boolean(category?.default_review_required));
    return {
      ...row,
      category_large: categoryLarge,
      category_middle: categoryMiddle,
      category_small: categorySmall,
      category_id: category?.id || null,
      rule_id: rule?.id || null,
      confidence: rule ? (needsReview ? 0.55 : 0.9) : 0.3,
      review_status: needsReview ? "pending" : "confirmed",
      review_reason: reviewReason || (needsReview ? "미분류" : ""),
      affects_profit: isCardPayment || isTransfer ? false : category?.affects_profit ?? row.direction === "expense",
      affects_cashflow: category?.affects_cashflow ?? row.source_type === "bank",
      affects_card_settlement: category?.affects_card_settlement ?? row.source_type === "card",
    } as RawRow;
  });
}

async function upsertReviewRows(transactions: RawRow[]) {
  const reviewRows = transactions
    .filter((row) => text(row.review_status) === "pending" && text(row.id))
    .map((row) => ({
      transaction_id: row.id,
      reason: text(row.review_reason) || "미분류",
      status: "pending",
      suggested_category_id: row.category_id || null,
      suggested_category_large: row.category_large || null,
      suggested_category_middle: row.category_middle || null,
      suggested_category_small: row.category_small || null,
      memo: row.memo || null,
    }));
  if (reviewRows.length) await upsertRows("accounting_review_queue", reviewRows, "transaction_id");
}

async function rebuildCardSettlements() {
  const cardRows = await optionalRows("accounting_transactions", { source_type: "eq.card", is_active: "eq.true", limit: 5000 });
  const grouped = new Map<string, RawRow>();
  for (const row of cardRows) {
    const cardName = text(row.card_name || row.source_name);
    const txDate = isoDate(row.transaction_date);
    const settlement = settlementFor(cardName, txDate);
    if (!settlement) continue;
    const key = `${cardName}|${settlement.settlement_start}|${settlement.settlement_end}`;
    const prev = grouped.get(key) || {
      card_name: cardName,
      ...settlement,
      domestic_amount: 0,
      foreign_amount: 0,
      amount_krw: 0,
      currency: "USD",
      paid: false,
    };
    prev.domestic_amount = numberValue(prev.domestic_amount) + (text(row.currency) === "KRW" ? numberValue(row.amount_krw ?? row.amount) : 0);
    prev.foreign_amount = numberValue(prev.foreign_amount) + (text(row.currency) === "KRW" ? 0 : numberValue(row.foreign_amount || row.amount));
    prev.amount_krw = numberValue(prev.amount_krw) + numberValue(row.amount_krw);
    prev.usage_rate = numberValue(prev.card_limit) ? numberValue(prev.domestic_amount) / numberValue(prev.card_limit) : null;
    grouped.set(key, prev);
  }
  const rows = Array.from(grouped.values());
  if (rows.length) await upsertRows("accounting_card_settlements", rows, "card_name,settlement_start,settlement_end");
  return rows;
}

async function categoryFor(row: RawRow) {
  const id = text(row.category_id || row.categoryId);
  if (id) {
    const [category] = await optionalRows("accounting_categories", { id: `eq.${id}`, limit: 1 });
    if (category) return category;
  }
  const category_large = text(row.category_large || row.categoryLarge);
  const category_middle = text(row.category_middle || row.categoryMiddle);
  const category_small = text(row.category_small || row.categorySmall);
  if (!category_large) return null;
  const [category] = await optionalRows("accounting_categories", {
    category_large: `eq.${category_large}`,
    category_middle: `eq.${category_middle}`,
    category_small: `eq.${category_small}`,
    limit: 1,
  });
  return category || null;
}

function cleanCategoryPayload(row: RawRow) {
  return {
    category_large: text(row.category_large || row.categoryLarge),
    category_middle: text(row.category_middle || row.categoryMiddle),
    category_small: text(row.category_small || row.categorySmall),
    is_active: row.is_active ?? row.isActive ?? true,
    sort_order: numberValue(row.sort_order ?? row.sortOrder),
    affects_profit: row.affects_profit ?? row.affectsProfit ?? true,
    affects_cashflow: row.affects_cashflow ?? row.affectsCashflow ?? true,
    affects_card_settlement: row.affects_card_settlement ?? row.affectsCardSettlement ?? false,
    default_review_required: row.default_review_required ?? row.defaultReviewRequired ?? false,
    memo: text(row.memo) || null,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertAccountingCategory(row: RawRow) {
  const id = text(row.id);
  const payload = cleanCategoryPayload(row);
  if (!payload.category_large) throw new Error("대분류가 필요합니다.");
  if (id) return patchRows("accounting_categories", { id: `eq.${id}` }, payload);
  return upsertRows("accounting_categories", payload, "category_large,category_middle,category_small");
}

export async function deactivateAccountingCategory(id: string) {
  if (!id) throw new Error("카테고리 id가 필요합니다.");
  return patchRows("accounting_categories", { id: `eq.${id}` }, { is_active: false, updated_at: new Date().toISOString() });
}

export async function upsertAccountingRule(row: RawRow) {
  const id = text(row.id);
  const category = await categoryFor(row);
  const payload = {
    priority: numberValue(row.priority) || 100,
    is_active: row.is_active ?? row.isActive ?? true,
    source_type: text(row.source_type || row.sourceType) || null,
    source_name: text(row.source_name || row.sourceName) || null,
    condition_field: text(row.condition_field || row.conditionField) || "merchant_name",
    condition_operator: text(row.condition_operator || row.conditionOperator) || "contains",
    keyword: text(row.keyword) || null,
    amount_condition: text(row.amount_condition || row.amountCondition) || null,
    direction_condition: text(row.direction_condition || row.directionCondition) || null,
    currency_condition: text(row.currency_condition || row.currencyCondition) || null,
    recurring_condition: text(row.recurring_condition || row.recurringCondition) || null,
    merchant_condition: text(row.merchant_condition || row.merchantCondition) || null,
    category_id: category?.id || null,
    category_large: text(category?.category_large || row.category_large || row.categoryLarge),
    category_middle: text(category?.category_middle || row.category_middle || row.categoryMiddle),
    category_small: text(category?.category_small || row.category_small || row.categorySmall),
    auto_confirm: row.auto_confirm ?? row.autoConfirm ?? false,
    review_required: row.review_required ?? row.reviewRequired ?? true,
    review_reason: text(row.review_reason || row.reviewReason) || null,
    memo: text(row.memo) || null,
    updated_at: new Date().toISOString(),
  };
  if (id) return patchRows("accounting_category_rules", { id: `eq.${id}` }, payload);
  return insertRows("accounting_category_rules", payload);
}

export async function deactivateAccountingRule(id: string) {
  if (!id) throw new Error("규칙 id가 필요합니다.");
  return patchRows("accounting_category_rules", { id: `eq.${id}` }, { is_active: false, updated_at: new Date().toISOString() });
}

function cleanFixedCostPayload(row: RawRow) {
  const keywords = Array.isArray(row.match_keywords)
    ? row.match_keywords.map(text).filter(Boolean)
    : text(row.match_keywords || row.matchKeywords).split(/[,/|]+/).map(text).filter(Boolean);
  return {
    fixed_cost_name: text(row.fixed_cost_name || row.fixedCostName || row.name),
    category_large: text(row.category_large || row.categoryLarge),
    category_middle: text(row.category_middle || row.categoryMiddle),
    category_small: text(row.category_small || row.categorySmall),
    expected_amount: numberValue(row.expected_amount ?? row.expectedAmount ?? row.amount),
    base_day: text(row.base_day || row.baseDay || row.payment_day || row.paymentDay),
    weekend_policy: text(row.weekend_policy || row.weekendPolicy) || "previous_business_day",
    holiday_policy: text(row.holiday_policy || row.holidayPolicy) || "previous_business_day",
    payment_type: text(row.payment_type || row.paymentType) || "bank",
    payment_source: text(row.payment_source || row.paymentSource) || null,
    source_account_name: text(row.source_account_name || row.sourceAccountName) || null,
    source_card_name: text(row.source_card_name || row.sourceCardName) || null,
    affects_profit: row.affects_profit ?? row.affectsProfit ?? true,
    affects_cashflow: row.affects_cashflow ?? row.affectsCashflow ?? true,
    match_keywords: keywords.length ? keywords : null,
    is_active: row.is_active ?? row.isActive ?? true,
    sort_order: numberValue(row.sort_order ?? row.sortOrder),
    memo: text(row.memo) || null,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertAccountingFixedCost(row: RawRow) {
  const id = text(row.id);
  const payload = cleanFixedCostPayload(row);
  if (!payload.fixed_cost_name) throw new Error("고정비명이 필요합니다.");
  if (!payload.base_day) throw new Error("기준일이 필요합니다.");
  if (id) return patchRows("accounting_fixed_costs", { id: `eq.${id}` }, payload);
  return upsertRows("accounting_fixed_costs", payload, "fixed_cost_name");
}

export async function deactivateAccountingFixedCost(id: string) {
  if (!id) throw new Error("고정비 id가 필요합니다.");
  return patchRows("accounting_fixed_costs", { id: `eq.${id}` }, { is_active: false, updated_at: new Date().toISOString() });
}

export async function updateAccountingTransaction(id: string, row: RawRow) {
  if (!id) throw new Error("거래 id가 필요합니다.");
  const category = await categoryFor(row);
  const payload: RawRow = {
    memo: text(row.memo) || null,
    review_status: text(row.review_status || row.reviewStatus) || "confirmed",
    updated_at: new Date().toISOString(),
  };
  if (category) {
    payload.category_id = category.id;
    payload.category_large = category.category_large;
    payload.category_middle = category.category_middle;
    payload.category_small = category.category_small;
  }
  for (const key of ["category_large", "category_middle", "category_small"]) {
    if (row[key] !== undefined && !category) payload[key] = text(row[key]);
  }
  for (const key of ["direction", "review_reason"]) {
    if (row[key] !== undefined) payload[key] = text(row[key]);
  }
  for (const key of ["affects_profit", "affects_cashflow", "affects_card_settlement"]) {
    if (row[key] !== undefined) payload[key] = row[key];
  }
  const saved = await patchRows<RawRow>("accounting_transactions", { id: `eq.${id}` }, payload);
  if (payload.review_status === "confirmed") {
    await patchRows("accounting_review_queue", { transaction_id: `eq.${id}` }, {
      status: "resolved",
      resolved_category_id: category?.id || null,
      resolved_at: new Date().toISOString(),
      memo: text(row.review_memo || row.reviewMemo || row.memo) || null,
      updated_at: new Date().toISOString(),
    }).catch(() => []);
  }
  await rebuildCardSettlements();
  return saved;
}

export async function resolveAccountingReview(row: RawRow) {
  const transactionId = text(row.transaction_id || row.transactionId || row.id);
  if (!transactionId) throw new Error("검토할 거래 id가 필요합니다.");
  const [transaction] = await optionalRows("accounting_transactions", { id: `eq.${transactionId}`, limit: 1 });
  const updated = await updateAccountingTransaction(transactionId, { ...row, review_status: "confirmed" });
  if (row.create_rule || row.createRule || row.save_rule || row.saveRule) {
    const category = await categoryFor(row);
    await upsertAccountingRule({
      priority: row.priority || 50,
      source_type: transaction?.source_type,
      source_name: transaction?.source_name,
      condition_field: "merchant_name",
      condition_operator: "contains",
      keyword: text(row.keyword) || text(transaction?.merchant_name || transaction?.description),
      amount_condition: row.amount_condition || row.amountCondition || null,
      direction_condition: transaction?.direction,
      category_id: category?.id,
      category_large: category?.category_large || row.category_large,
      category_middle: category?.category_middle || row.category_middle,
      category_small: category?.category_small || row.category_small,
      auto_confirm: row.auto_confirm ?? row.autoConfirm ?? false,
      review_required: row.review_required ?? row.reviewRequired ?? false,
      review_reason: row.review_reason || row.reviewReason || null,
      memo: row.rule_memo || row.ruleMemo || "검토필요 탭에서 저장한 자동분류 규칙",
    });
  }
  return updated;
}

export async function importAccountingLedgerRows(rows: RawRow[], options: { sourceType?: string; sourceFileName?: string; uploadedBy?: string; memo?: string } = {}) {
  const normalized = rows.map((row) => normalizeAccountingTransaction({ ...row, source_type: row.source_type || options.sourceType }));
  const classified = await classifyAccountingTransactions(normalized);
  const [batch] = await insertRows<{ id: string }>("accounting_import_batches", {
    source_name: options.sourceType || "자동 분류",
    source_type: options.sourceType || "auto",
    source_file_name: options.sourceFileName || null,
    uploaded_by: options.uploadedBy || null,
    total_count: classified.length,
    status: "processing",
    memo: options.memo || null,
  });
  const rowsWithBatch: RawRow[] = classified.map((row) => ({ ...row, batch_id: batch.id }));
  const existing = rowsWithBatch.length
    ? await optionalRows("accounting_transactions", { dedupe_key: `in.(${rowsWithBatch.map((row) => `"${String(row.dedupe_key).replace(/"/g, '\\"')}"`).join(",")})`, limit: rowsWithBatch.length })
    : [];
  const existingKeys = new Set(existing.map((row) => text(row.dedupe_key)));
  const fresh = rowsWithBatch.filter((row) => !existingKeys.has(text(row.dedupe_key)));
  const saved = fresh.length ? await upsertRows<RawRow>("accounting_transactions", fresh, "dedupe_key") : [];
  await upsertReviewRows(saved);
  await rebuildCardSettlements();
  const reviewCount = saved.filter((row) => text(row.review_status) === "pending").length;
  await patchRows("accounting_import_batches", { id: `eq.${batch.id}` }, {
    new_count: saved.length,
    duplicate_count: classified.length - fresh.length,
    error_count: 0,
    review_count: reviewCount,
    status: "uploaded",
    updated_at: new Date().toISOString(),
  });
  return {
    ok: true,
    batch_id: batch.id,
    total_count: classified.length,
    success_count: saved.length,
    new_count: saved.length,
    duplicate_count: classified.length - fresh.length,
    review_count: reviewCount,
  };
}

export async function accountingLedgerSummary(range?: { from?: string; to?: string }) {
  const from = text(range?.from);
  const to = text(range?.to);
  const dateFilter = from && to ? `gte.${from}` : undefined;
  const rows = await optionalRows("accounting_transactions", {
    ...(dateFilter ? { transaction_date: dateFilter } : {}),
    order: "transaction_date.desc",
    limit: 2000,
  });
  const filtered = rows.filter((row) => {
    const date = isoDate(row.transaction_date);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return row.is_active !== false;
  });
  const categories = await optionalRows("accounting_categories", { order: "sort_order.asc", limit: 500 });
  const rules = await optionalRows("accounting_category_rules", { order: "priority.asc", limit: 500 });
  const batches = await optionalRows("accounting_import_batches", { order: "created_at.desc", limit: 20 });
  const reviewQueue = await optionalRows("accounting_review_queue", { status: "eq.pending", order: "created_at.desc", limit: 100 });
  const settlements = await optionalRows("accounting_card_settlements", { order: "payment_due_date.asc", limit: 30 });
  const fixedCosts = await optionalRows("accounting_fixed_costs", { is_active: "eq.true", order: "sort_order.asc", limit: 300 });
  const bankAccounts = await optionalRows("accounting_bank_accounts", { is_active: "eq.true", order: "sort_order.asc", limit: 100 });
  const cardAccounts = await optionalRows("accounting_card_accounts", { is_active: "eq.true", order: "sort_order.asc", limit: 100 });
  const today = kstToday();
  const threeDaysLater = addDays(today, 3);
  const fixedCostOccurrences = fixedCosts.map((row) => fixedCostOccurrence(row, today, rows));
  const upcomingFixedCosts = fixedCostOccurrences
    .filter((row) => text(row.due_date) >= today && text(row.due_date) <= threeDaysLater)
    .sort((left, right) => text(left.due_date).localeCompare(text(right.due_date)))
    .slice(0, 8);
  const fixedCostDueAmount = upcomingFixedCosts.reduce((total, row) => total + numberValue(row.amount), 0);
  const income = filtered.filter((row) => row.direction === "income" && row.affects_profit !== false).reduce((total, row) => total + numberValue(row.amount_krw ?? row.amount), 0);
  const expense = filtered.filter((row) => row.direction === "expense" && row.affects_profit !== false).reduce((total, row) => total + numberValue(row.amount_krw ?? row.amount), 0);
  const cashIn = filtered.filter((row) => row.source_type === "bank").reduce((total, row) => total + numberValue(row.credit_amount), 0);
  const cashOut = filtered.filter((row) => row.source_type === "bank").reduce((total, row) => total + numberValue(row.debit_amount), 0);
  const pendingCard = settlements.filter((row) => row.paid !== true).reduce((total, row) => total + numberValue(row.domestic_amount), 0);
  const group = (pick: (row: RawRow) => string) => {
    const map = new Map<string, { label: string; amount: number; count: number }>();
    for (const row of filtered) {
      const label = pick(row) || "기타";
      const prev = map.get(label) || { label, amount: 0, count: 0 };
      prev.amount += numberValue(row.amount_krw ?? row.amount);
      prev.count += 1;
      map.set(label, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  };
  const byMonth = Array.from(filtered.reduce((map, row) => {
    const label = isoDate(row.transaction_date).slice(0, 7) || "미지정";
    const prev = map.get(label) || { label, income: 0, expense: 0, amount: 0, count: 0 };
    const amount = numberValue(row.amount_krw ?? row.amount);
    if (row.direction === "income" && row.affects_profit !== false) prev.income += amount;
    if (row.direction === "expense" && row.affects_profit !== false) prev.expense += amount;
    prev.amount = prev.income - prev.expense;
    prev.count += 1;
    map.set(label, prev);
    return map;
  }, new Map<string, { label: string; income: number; expense: number; amount: number; count: number }>()).values()).sort((a, b) => a.label.localeCompare(b.label));
  const categoryLarge = group((row) => text(row.category_large));
  return {
    transactions: filtered.slice(0, 300),
    expenses: filtered.slice(0, 300),
    categories,
    rules,
    batches,
    review_queue: reviewQueue,
    card_settlements: settlements,
    fixed_costs: fixedCosts,
    fixed_cost_occurrences: fixedCostOccurrences,
    upcoming_fixed_costs: upcomingFixedCosts,
    bank_accounts: bankAccounts,
    card_accounts: cardAccounts,
    totals: {
      income_amount: income,
      expense_amount: expense,
      net_profit: income - expense,
      cashflow_amount: cashIn - cashOut,
      card_settlement_due: pendingCard,
      fixed_cost_due_amount: fixedCostDueAmount,
      review_count: reviewQueue.length,
      transaction_count: filtered.length,
    },
    by_category_large: categoryLarge,
    by_category: categoryLarge,
    by_vendor: group((row) => text(row.merchant_name)),
    by_card: group((row) => text(row.card_name || row.source_name)),
    by_month: byMonth,
  };
}
