import { deleteRows, insertRows, patchRows, selectRows, upsertRows } from "./fnos-db";
import { cleanAccountingFixedCostPayload, cleanAccountingLoanPayload, shouldAutoMarkLoanPaid } from "./accounting-ledger-payloads";

type RawRow = Record<string, unknown>;
type QueryValue = string | number | boolean | null | undefined;
const CARD_POINT_SETTING_PREFIX = "accounting_card_points";

type AccountingSourceAccountContext = {
  bankAccounts?: RawRow[];
  cardAccounts?: RawRow[];
};

export function accountingAccountDisplayName(row: RawRow, mode: "bank" | "card") {
  const alias = text(row.display_alias || row.displayAlias);
  if (alias) return alias;
  return text(mode === "bank" ? row.bank_name || row.account_name || row.source_name : row.card_name || row.source_name);
}

export function findAccountingSourceAccount(sourceName: unknown, accounts: RawRow[], mode: "bank" | "card") {
  const target = matchText(sourceName);
  if (!target) return null;
  return accounts.find((account) => {
    const names = [
      mode === "bank" ? account.bank_name : account.card_name,
      account.source_name,
    ];
    return names.some((name) => {
      const candidate = matchText(name);
      return candidate && (candidate === target || candidate.includes(target) || target.includes(candidate));
    });
  }) || null;
}

const REVIEW_CATEGORY_BY_REASON: Record<string, [string, string, string]> = {
  KCP확인: ["기타 출금", "검토필요", ""],
  네이버확인: ["기타 출금", "검토필요", ""],
  일반명거래: ["기타 출금", "미확인 출금", ""],
  "자금이동 확인": ["기타 출금", "내부이체", ""],
  미분류: ["기타 출금", "검토필요", ""],
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function matchText(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, "").replace(/[()[\]{}<>.,'"`|\\/_-]/g, "");
}

function isAutoAccountingSource(value: unknown) {
  const raw = text(value).toLowerCase();
  return !raw || raw === "auto" || raw === "자동 분류";
}

function accountingSourceFromFileName(fileName: unknown) {
  const compact = matchText(fileName);
  if (!compact) return "";
  if (/cardusage|카드이용내역|가온글로벌|가온글로벌카드|globalcard/.test(compact)) return "가온글로벌카드";
  if (/승인내역조회|국민카드|국민기업카드|kbcard/.test(compact)) return "국민기업카드";
  if (/47870101245017|국민은행|kbbank/.test(compact)) return "국민은행";
  if (/거래내역조회.*입출식|기업은행|ibk/.test(compact)) return "기업은행";
  return "";
}

function transactionMatchName(row: RawRow) {
  return matchText(row.merchant_name || row.description);
}

function transactionMatchMemo(row: RawRow) {
  return matchText(`${text(row.merchant_name || row.description)} ${text(row.description)} ${text(row.memo)}`);
}

function sameSourceAndDirection(left: RawRow, right: RawRow) {
  if (text(left.source_type) && text(right.source_type) && text(left.source_type) !== text(right.source_type)) return false;
  if (text(left.source_name) && text(right.source_name) && text(left.source_name) !== text(right.source_name)) return false;
  if (text(left.direction) && text(right.direction) && text(left.direction) !== text(right.direction)) return false;
  return true;
}

function bankTransferSide(row: RawRow) {
  const source = matchText(`${text(row.source_name)} ${text(row.account_name)} ${text(row.raw_json && typeof row.raw_json === "object" ? (row.raw_json as RawRow).source_name : "")}`);
  const description = matchText(`${text(row.merchant_name)} ${text(row.description)} ${text(row.memo)}`);
  const amount = Math.abs(numberValue(row.amount_krw ?? row.amount ?? row.debit_amount ?? row.credit_amount));
  const date = isoDate(row.transaction_date);
  const isDebit = numberValue(row.debit_amount) > 0;
  const isCredit = numberValue(row.credit_amount) > 0;
  const isKb = /국민|kb/.test(source);
  const isIbk = /기업|ibk/.test(source);
  const kbMemo = /에프엔|김재욱/.test(description);
  const ibkMemo = /김재욱에프엔/.test(description);
  if (!date || !amount || text(row.source_type) !== "bank") return null;
  if (!((isKb && kbMemo) || (isIbk && ibkMemo))) return null;
  if (!isDebit && !isCredit) return null;
  return { date, amount, isDebit, isCredit, isKb, isIbk };
}

function markMatchedInternalTransfers(rows: RawRow[]) {
  const next = rows.map((row) => ({ ...row }));
  const sides = next.map((row, index) => ({ row, index, side: bankTransferSide(row) })).filter((item) => item.side);
  const used = new Set<number>();
  for (const left of sides) {
    if (used.has(left.index) || !left.side) continue;
    const right = sides.find((item) => {
      if (item.index === left.index || used.has(item.index) || !item.side) return false;
      if (item.side.date !== left.side!.date || item.side.amount !== left.side!.amount) return false;
      if (item.side.isDebit === left.side!.isDebit || item.side.isCredit === left.side!.isCredit) return false;
      return (item.side.isKb && left.side!.isIbk) || (item.side.isIbk && left.side!.isKb);
    });
    if (!right) continue;
    for (const item of [left, right]) {
      const row = next[item.index];
      const isIncome = numberValue(row.credit_amount) > 0;
      row.direction = "transfer";
      row.category_large = isIncome ? "기타 입금" : "기타 출금";
      row.category_middle = "내부이체";
      row.category_small = "";
      row.review_status = "confirmed";
      row.review_reason = "";
      row.affects_profit = false;
      row.affects_cashflow = true;
      row.affects_card_settlement = false;
    }
    used.add(left.index);
    used.add(right.index);
  }
  return next;
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

function normalizeLoanType(value: unknown) {
  const raw = text(value);
  if (/interest_only|이자/.test(raw)) return "interest_only";
  return "principal_interest";
}

function isCardCancel(row: RawRow) {
  return text(row.source_type) === "card" && /취소|cancel/i.test(`${text(row.description)} ${text(row.merchant_name)} ${text(row.status)} ${text(row.raw_status)} ${text(row.memo)}`);
}

function signedAccountingAmount(row: RawRow) {
  const amount = numberValue(row.amount_krw ?? row.amount);
  return isCardCancel(row) ? -Math.abs(amount) : amount;
}

function accountingCardKey(value: unknown) {
  const normalized = matchText(value);
  if (/가온|gaon|global/.test(normalized)) return "gaon";
  if (/국민.*기업|기업.*카드|kb.*card|국민기업/.test(normalized)) return "kb";
  return normalized;
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

function addMonthsToDate(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return "";
  const next = new Date(Date.UTC(year, month - 1 + months, 1));
  const nextYear = next.getUTCFullYear();
  const nextMonth = next.getUTCMonth() + 1;
  return dateText(nextYear, nextMonth, Math.min(day, lastDayOfMonth(nextYear, nextMonth)));
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

function sourceTypeHint(raw: string) {
  if (/카드|승인|가온/i.test(raw)) return "card";
  if (/은행|통장|입출식|IBK/i.test(raw)) return "bank";
  return "";
}

function sourceMeta(row: RawRow, accounts: AccountingSourceAccountContext = {}) {
  const rowSource = row.source_name || row.source_type || row.sourceType;
  const raw = isAutoAccountingSource(rowSource) ? accountingSourceFromFileName(row.source_file_name) || text(rowSource) : text(rowSource);
  const hint = sourceTypeHint(raw);
  const cardAccount = hint !== "bank" ? findAccountingSourceAccount(raw, accounts.cardAccounts || [], "card") : null;
  if (cardAccount) {
    const cardName = text(cardAccount.card_name || cardAccount.source_name);
    return { sourceType: "card" as const, sourceName: cardName || raw || "기타", cardName: cardName || null };
  }
  const bankAccount = hint !== "card" ? findAccountingSourceAccount(raw, accounts.bankAccounts || [], "bank") : null;
  if (bankAccount) {
    const bankName = text(bankAccount.bank_name || bankAccount.account_name || bankAccount.source_name);
    return { sourceType: "bank" as const, sourceName: bankName || raw || "기타", accountName: bankName || null };
  }
  const sourceType = hint === "bank" ? "bank" as const : "card" as const;
  return {
    sourceType,
    sourceName: raw || "기타",
    cardName: sourceType === "card" ? raw || null : null,
    accountName: sourceType === "bank" ? raw || null : null,
  };
}

function settlementFor(cardName: string, date: string, cardAccount?: RawRow) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const cutoffStart = numberValue(cardAccount?.cutoff_start_day ?? cardAccount?.cutoffStartDay);
  const cutoffEnd = numberValue(cardAccount?.cutoff_end_day ?? cardAccount?.cutoffEndDay);
  const paymentDay = numberValue(cardAccount?.payment_day ?? cardAccount?.paymentDay);
  const cardLimit = numberValue(cardAccount?.card_limit ?? cardAccount?.cardLimit);
  if (cutoffStart && cutoffEnd && paymentDay) {
    const startBase = day >= cutoffStart ? { year, month } : addMonths(year, month, -1);
    const endBase = day >= cutoffStart ? addMonths(year, month, 1) : { year, month };
    const dueBase = paymentDay < cutoffEnd ? addMonths(startBase.year, startBase.month, 2) : addMonths(startBase.year, startBase.month, 1);
    return {
      settlement_start: dateText(startBase.year, startBase.month, cutoffStart),
      settlement_end: dateText(endBase.year, endBase.month, Math.min(cutoffEnd, lastDayOfMonth(endBase.year, endBase.month))),
      payment_due_date: dateText(dueBase.year, dueBase.month, Math.min(paymentDay, lastDayOfMonth(dueBase.year, dueBase.month))),
      card_limit: cardLimit || null,
    };
  }
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

function cardPanelCycle(cardKey: string, date: string) {
  const config = cardKey === "gaon"
    ? { startDay: 22, endDay: 21, paymentDay: 5, limit: 20000000 }
    : cardKey === "kb"
      ? { startDay: 6, endDay: 5, paymentDay: 20, limit: 10000000 }
      : null;
  if (!config) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const startBase = day >= config.startDay ? { year, month } : addMonths(year, month, -1);
  const endBase = config.startDay > config.endDay ? addMonths(startBase.year, startBase.month, 1) : startBase;
  const dueBase = config.paymentDay < config.endDay ? addMonths(startBase.year, startBase.month, 2) : addMonths(startBase.year, startBase.month, 1);
  return {
    settlement_start: dateText(startBase.year, startBase.month, config.startDay),
    settlement_end: dateText(endBase.year, endBase.month, Math.min(config.endDay, lastDayOfMonth(endBase.year, endBase.month))),
    payment_due_date: dateText(dueBase.year, dueBase.month, Math.min(config.paymentDay, lastDayOfMonth(dueBase.year, dueBase.month))),
    card_limit: config.limit,
  };
}

function cardPanelStatuses(rows: RawRow[], settlements: RawRow[]) {
  const latestDate = rows.map((row) => isoDate(row.transaction_date)).filter(Boolean).sort((a, b) => b.localeCompare(a))[0] || kstToday();
  return [
    { key: "gaon", title: "가온글로벌카드" },
    { key: "kb", title: "국민기업카드" },
  ].map((card) => {
    const cycle = cardPanelCycle(card.key, latestDate);
    const cardRows = rows.filter((row) => accountingCardKey(row.card_name || row.source_name) === card.key && row.affects_card_settlement === true);
    const currentRows = cycle ? cardRows.filter((row) => {
      const date = isoDate(row.transaction_date);
      return date >= cycle.settlement_start && date <= latestDate;
    }) : [];
    const currentAmount = currentRows.reduce((sum, row) => sum + signedAccountingAmount(row), 0);
    const dueSettlement = settlements
      .filter((row) => accountingCardKey(row.card_name) === card.key && row.paid !== true && text(row.payment_due_date) >= latestDate)
      .sort((left, right) => text(left.payment_due_date).localeCompare(text(right.payment_due_date)))[0];
    const limit = numberValue(dueSettlement?.card_limit) || numberValue(cycle?.card_limit);
    const settlementAmount = numberValue(dueSettlement?.amount_krw || dueSettlement?.domestic_amount);
    return {
      card_key: card.key,
      card_name: card.title,
      as_of_date: latestDate,
      usage_start: cycle?.settlement_start || "",
      usage_end: latestDate,
      current_amount: currentAmount,
      card_limit: limit,
      usage_rate: limit ? currentAmount / limit : 0,
      settlement_start: text(dueSettlement?.settlement_start || cycle?.settlement_start),
      settlement_end: text(dueSettlement?.settlement_end || cycle?.settlement_end),
      payment_due_date: text(dueSettlement?.payment_due_date || cycle?.payment_due_date),
      settlement_amount: settlementAmount || currentAmount,
    };
  });
}

function directionFor(sourceType: string, row: RawRow, merchant: string, debit: number, credit: number) {
  const haystack = `${merchant} ${text(row.description)} ${text(row.category)} ${text(row.category_detail)}`;
  if (/KB카드출금/.test(haystack)) return "card_payment";
  if (/카드대금|카드결제|결제대금/.test(haystack)) return "card_payment";
  if (/계좌|이체|대표자|자금/.test(haystack)) return "transfer";
  if (sourceType === "bank" && /입금/.test(text(row.cash_direction || row.category || row["분류"]))) return "income";
  if (sourceType === "bank" && /출금/.test(text(row.cash_direction || row.category || row["분류"]))) return "expense";
  if (sourceType === "bank" && credit > 0) return "income";
  if (sourceType === "bank" && debit > 0) return "expense";
  if (sourceType === "card") return "expense";
  return "pending_review";
}

function existingCategory(row: RawRow) {
  const large = text(first(row, ["existing_category_large", "기존대분류", "cash_direction", "category", "카테고리", "분류"]));
  const middle = text(first(row, ["existing_category_middle", "기존중분류", "category_detail", "세부분류", "중분류", "상세분류"]));
  const small = text(first(row, ["existing_category_small", "기존소분류", "category_memo", "소분류", "보조메모", "분류메모"]));
  return { large, middle, small };
}

function dedupeKey(parts: Array<unknown>) {
  return parts.map((part) => text(part).replace(/\s+/g, " ")).join("|").toLowerCase();
}

function transactionFallbackDedupeKey(row: RawRow) {
  const amount = numberValue(row.amount_krw ?? row.amount ?? row.debit_amount ?? row.credit_amount);
  return dedupeKey([
    row.source_name || row.card_name || row.account_name || row.source_type,
    isoDate(row.transaction_date),
    row.merchant_name || row.description,
    amount,
  ]);
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
  if (amountCondition && amountCondition !== "무관") {
    const txAmount = numberValue(tx.amount);
    const amountMatched = amountCondition.split(/[,/또는\s]+/).filter(Boolean).some((item) => {
      if (item.includes("..")) {
        const [min, max] = item.split("..").map((part) => numberValue(part));
        return txAmount >= Math.min(min, max) && txAmount <= Math.max(min, max);
      }
      return numberValue(item) === txAmount;
    });
    if (!amountMatched) return false;
  }
  if (!keyword) return true;
  if (operator === "equals" || operator === "일치") return target === keyword;
  if (operator === "starts_with" || operator === "시작") return target.startsWith(keyword);
  return target.includes(keyword);
}

function isNaverAdTransaction(row: RawRow) {
  const haystack = `${text(row.merchant_name)} ${text(row.description)} ${text(row.category)} ${text(row.category_detail)} ${text(row.memo)}`;
  const amount = Math.abs(numberValue(row.amount_krw ?? row.amount ?? row.debit_amount ?? row.credit_amount));
  const sourceText = `${text(row.source_type)} ${text(row.source_name)} ${text(row.card_name)}`;
  const isExpenseLike = /카드|card/i.test(sourceText) || text(row.direction) === "expense" || numberValue(row.debit_amount) > 0;
  if (!isExpenseLike) return false;
  if (/네이버페이[_\s-]*비즈월렛|비즈월렛/i.test(haystack)) return true;
  const merchantName = text(row.merchant_name || row.description).replace(/\s+/g, "");
  if (merchantName === "네이버파이낸셜" || /^NAVERFINANCIAL$/i.test(merchantName)) return true;
  if (/네이버파이낸셜|NAVER\s*FINANCIAL/i.test(haystack) && amount >= 50000 && amount % 50000 === 0) return true;
  return false;
}

function ambiguousReviewReason(row: RawRow) {
  const haystack = `${text(row.merchant_name)} ${text(row.description)} ${text(row.category)} ${text(row.category_detail)} ${text(row.memo)}`;
  const amount = Math.abs(numberValue(row.amount_krw ?? row.amount ?? row.debit_amount ?? row.credit_amount));
  if (/KCP/i.test(haystack) && /자동과금|자동결제/i.test(haystack) && amount === 300000) return "";
  if (isNaverAdTransaction(row)) return "";
  if (text(row.currency) !== "KRW" && numberValue(row.foreign_amount) > 0 && !numberValue(row.amount_krw)) return "외화환율 확인";
  if (/KCP|케이씨피|인터넷상거래_?4|자동결제_?1/i.test(haystack)) return "KCP확인";
  if (/네이버파이낸셜|비즈월렛|NAVER\s*FINANCIAL/i.test(haystack)) return "네이버확인";
  return "";
}

async function optionalRows(table: string, query?: Record<string, QueryValue>) {
  return selectRows<RawRow>(table, query).catch(() => []);
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

async function fxRatesMap() {
  const rows = await optionalRows("import_erp_fx_rates", { order: "currency.asc", limit: 50 });
  return Object.fromEntries(rows.map((row) => [text(row.currency).toUpperCase(), numberValue(row.rate)]));
}

export async function accountingFxRates() {
  return fxRatesMap();
}

export async function accountingSourceAccounts(): Promise<AccountingSourceAccountContext> {
  const [bankAccounts, cardAccounts] = await Promise.all([
    optionalRows("accounting_bank_accounts", { or: "(is_active.is.null,is_active.eq.true)", order: "sort_order.asc", limit: 500 }),
    optionalRows("accounting_card_accounts", { or: "(is_active.is.null,is_active.eq.true)", order: "sort_order.asc", limit: 500 }),
  ]);
  return { bankAccounts, cardAccounts };
}

function cardPointSettingKey(cardName: string) {
  return `${CARD_POINT_SETTING_PREFIX}:${cardName}`;
}

async function readAccountingCardPoint(cardName: string) {
  const [row] = await optionalRows("fnos_settings", { setting_key: `eq.${cardPointSettingKey(cardName)}`, limit: 1 });
  try {
    const parsed = JSON.parse(text(row?.setting_value) || "{}");
    return { card_name: cardName, balance: numberValue(parsed.balance), updated_at: parsed.updated_at || row?.updated_at || null };
  } catch {
    return { card_name: cardName, balance: 0, updated_at: row?.updated_at || null };
  }
}

async function writeAccountingCardPoint(cardName: string, balance: number) {
  const now = new Date().toISOString();
  const payload = {
    setting_key: cardPointSettingKey(cardName),
    setting_value: JSON.stringify({ balance: Math.max(0, Math.round(balance)), updated_at: now }),
    memo: "Accounting card point balance",
    updated_at: now,
  };
  try {
    await upsertRows("fnos_settings", payload, "setting_key");
  } catch {
    await patchRows("fnos_settings", { setting_key: `eq.${payload.setting_key}` }, { setting_value: payload.setting_value, updated_at: now });
  }
  return readAccountingCardPoint(cardName);
}

async function addAccountingCardPoints(cardName: string, points: number) {
  if (!cardName || !points) return readAccountingCardPoint(cardName);
  const current = await readAccountingCardPoint(cardName);
  return writeAccountingCardPoint(cardName, numberValue(current.balance) + points);
}

export async function adjustAccountingCardPoints(cardName: string, mode: "use" | "set", amount: number) {
  const current = await readAccountingCardPoint(cardName);
  const next = mode === "set" ? amount : numberValue(current.balance) - amount;
  return writeAccountingCardPoint(cardName, next);
}

function transactionAmount(row: RawRow) {
  return numberValue(row.amount_krw ?? row.amount ?? row.debit_amount ?? row.total_amount);
}

function fixedCostKeywords(row: RawRow) {
  const raw = row.match_keywords;
  if (Array.isArray(raw)) return raw.map(text).filter(Boolean);
  return text(raw).split(/[,/|]+/).map(text).filter(Boolean);
}

function fixedCostCardKey(row: RawRow) {
  const haystack = `${text(row.fixed_cost_name || row.name)} ${text(row.category_large)} ${text(row.category_middle)} ${text(row.payment_source)} ${text(row.source_card_name)} ${text(row.memo)}`;
  if (!/카드|카드대금|가온|국민기업|국민 기업/.test(haystack)) return "";
  const key = accountingCardKey(haystack);
  return key === "gaon" || key === "kb" ? key : "";
}

function cardSettlementAmount(row: RawRow) {
  return numberValue(row.amount_krw || row.domestic_amount || row.amount);
}

function matchingCardSettlement(fixedCost: RawRow, settlements: RawRow[], dueDate: string) {
  const cardKey = fixedCostCardKey(fixedCost);
  if (!cardKey) return null;
  return settlements
    .filter((row) => {
      if (row.paid === true) return false;
      if (accountingCardKey(row.card_name) !== cardKey) return false;
      const paymentDueDate = isoDate(row.payment_due_date);
      return paymentDueDate === dueDate || previousBusinessDay(paymentDueDate) === dueDate;
    })
    .sort((left, right) => text(left.payment_due_date).localeCompare(text(right.payment_due_date)))[0] || null;
}

function matchingActualTransaction(fixedCost: RawRow, transactions: RawRow[], dueDate: string, today: string) {
  const keywords = fixedCostKeywords(fixedCost);
  const from = addDays(dueDate, -3);
  const to = addDays(dueDate, 5);
  const sourceHint = text(fixedCost.payment_source || fixedCost.source_account_name || fixedCost.source_card_name);
  const categoryLarge = text(fixedCost.category_large);
  const categoryMiddle = text(fixedCost.category_middle);
  const candidates = transactions
    .filter((row) => {
      const txDate = isoDate(row.transaction_date);
      if (!txDate || txDate < from || txDate > to || txDate > today) return false;
      if (text(row.source_type) === "bank" && numberValue(row.debit_amount) <= 0) return false;
      if (sourceHint && !`${text(row.source_name)} ${text(row.account_name)} ${text(row.card_name)}`.includes(sourceHint)) return false;
      const haystack = `${text(row.merchant_name)} ${text(row.description)} ${text(row.memo)}`;
      if (keywords.some((keyword) => haystack.includes(keyword))) return true;
      if (categoryMiddle && text(row.category_middle) === categoryMiddle) {
        return !categoryLarge || text(row.category_large) === categoryLarge;
      }
      return false;
    })
    .sort((left, right) => isoDate(right.transaction_date).localeCompare(isoDate(left.transaction_date)));
  return candidates[0] || null;
}

function actualDateInDueWindow(actualDate: string, dueDate: string, today: string) {
  if (!actualDate || !dueDate || actualDate > today) return false;
  return actualDate >= addDays(dueDate, -3) && actualDate <= addDays(dueDate, 3);
}

function fixedCostOccurrence(row: RawRow, today = kstToday(), transactions: RawRow[] = [], dueAnchor = today, settlements: RawRow[] = []) {
  const dueDate = monthDueDate(row.base_day ?? row.payment_day ?? row.due_day, dueAnchor);
  const expectedAmount = numberValue(row.expected_amount ?? row.amount);
  const actualRow = matchingActualTransaction(row, transactions, dueDate, today);
  const cardSettlement = !actualRow ? matchingCardSettlement(row, settlements, dueDate) : null;
  const savedActualDate = isoDate(row.last_actual_date);
  const savedActualInWindow = actualDateInDueWindow(savedActualDate, dueDate, today);
  const actualAmount = actualRow ? transactionAmount(actualRow) : savedActualInWindow ? numberValue(row.last_actual_amount) : 0;
  const settlementAmount = cardSettlement ? cardSettlementAmount(cardSettlement) : 0;
  const displayAmount = actualAmount || settlementAmount || expectedAmount;
  const daysUntil = Math.round((new Date(`${dueDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
  const paid = Boolean(actualRow || savedActualInWindow);
  return {
    id: row.id,
    fixed_cost_id: row.id,
    title: row.fixed_cost_name || row.name,
    display_title: row.fixed_cost_name || row.name,
    category_large: row.category_large,
    category_middle: row.category_middle,
    expected_amount: expectedAmount,
    last_actual_amount: actualAmount || null,
    last_actual_date: actualRow ? isoDate(actualRow.transaction_date) : savedActualInWindow ? savedActualDate : null,
    matched_transaction_id: actualRow?.id || null,
    matched_card_settlement_id: cardSettlement?.id || null,
    card_settlement_amount: settlementAmount || null,
    card_settlement_due_date: cardSettlement ? isoDate(cardSettlement.payment_due_date) : null,
    paid,
    amount: displayAmount,
    due_date: dueDate,
    base_day: row.base_day ?? row.payment_day ?? row.due_day,
    days_until: daysUntil,
    payment_type: row.payment_type,
    payment_source: row.payment_source,
    status: paid ? "paid" : daysUntil < 0 ? "overdue" : daysUntil <= 3 ? "upcoming" : "scheduled",
    memo: row.memo,
  };
}

function categoryKey(row: RawRow) {
  return `${text(row.category_large)}|${text(row.category_middle)}|`;
}

function findHistoricalCategoryMatch(row: RawRow, confirmedRows: RawRow[]) {
  const name = transactionMatchName(row);
  const memo = transactionMatchMemo(row);
  if (!name || name.length < 2) return null;
  let best: { row: RawRow; confidence: number; autoConfirm: boolean } | null = null;
  for (const previous of confirmedRows) {
    if (!text(previous.category_id) && !text(previous.category_large)) continue;
    if (!sameSourceAndDirection(row, previous)) continue;
    const previousName = transactionMatchName(previous);
    if (!previousName || previousName.length < 2) continue;
    const previousMemo = transactionMatchMemo(previous);
    const exactName = previousName === name;
    const containsName = previousName.includes(name) || name.includes(previousName);
    const memoOverlap = previousMemo && memo && (previousMemo.includes(name) || memo.includes(previousName));
    if (!exactName && !containsName && !memoOverlap) continue;
    const amountMatches = Math.abs(numberValue(previous.amount_krw ?? previous.amount) - numberValue(row.amount_krw ?? row.amount)) <= 1;
    const confidence = exactName && amountMatches ? 0.92 : exactName ? 0.86 : containsName ? 0.72 : 0.62;
    const autoConfirm = confidence >= 0.85;
    if (!best || confidence > best.confidence) best = { row: previous, confidence, autoConfirm };
  }
  return best;
}

function salaryPrivateWithdrawalException(row: RawRow, categoryByPath: Map<string, RawRow>) {
  const haystack = `${text(row.merchant_name)} ${text(row.description)} ${text(row.memo)} ${text(row.category_large)} ${text(row.category_middle)}`;
  if (!/급여|김수진|이상민/.test(haystack)) return null;
  const amount = Math.abs(numberValue(row.amount_krw ?? row.amount ?? row.debit_amount));
  const match = [
    { amount: 1667010, memo: "급여 김수진" },
    { amount: 2070030, memo: "급여 이상민" },
  ].find((item) => Math.abs(amount - item.amount) <= 1000);
  if (!match) return null;
  const category_large = "기타 출금";
  const category_middle = "사비출금";
  return {
    category: categoryByPath.get(`${category_large}|${category_middle}|`) || null,
    category_large,
    category_middle,
    memo: match.memo,
  };
}

function manualCategoryPath(row: RawRow) {
  const existingLarge = text(row.existing_category_large);
  const existingMiddle = text(row.existing_category_middle);
  const existingSmall = text(row.existing_category_small);
  const merchant = text(row.merchant_name || row.description);
  const sourceType = text(row.source_type);
  const sourceName = text(row.source_name);
  const haystack = `${existingLarge} ${existingMiddle} ${existingSmall} ${merchant} ${text(row.description)}`;
  const compactHaystack = haystack.replace(/\s+/g, "");
  const isOutgoing = text(row.direction) === "expense" || numberValue(row.debit_amount) > 0 || /출금/.test(existingLarge);
  const pair = (large: string, middle: string) => ({ large, middle });
  if (sourceType === "bank" && (text(row.direction) === "income" || numberValue(row.credit_amount) > 0)) {
    if (/스마트스토어|NAVER\s*FINANCIAL|네이버/i.test(haystack)) return pair("판매 정산금", "스마트스토어");
    if (/쿠팡|COUPANG/i.test(haystack)) return pair("판매 정산금", "쿠팡");
    if (/11ST|11번가|십일번가/i.test(haystack)) return pair("판매 정산금", "11번가");
    if (/지마켓|G마켓|GMARKET/i.test(haystack)) return pair("판매 정산금", "지마켓");
    if (/옥션|AUCTION/i.test(haystack)) return pair("판매 정산금", "옥션");
    if (/롯데온|LOTTEON/i.test(haystack)) return pair("판매 정산금", "롯데온");
    if (/SSG|신세계/i.test(haystack)) return pair("판매 정산금", "신세계");
    if (/카카오/i.test(haystack)) return pair("판매 정산금", "카카오");
    if (/토스|TOSS/i.test(haystack)) return pair("판매 정산금", "토스");
  }

  if (/카드대금|카드출금|가온글로벌|가온 글로벌/.test(haystack)) return pair("카드대금", "가온글로벌카드");
  if (/국민기업카드|국민기업/.test(haystack) && /카드|출금/.test(haystack)) return pair("카드대금", "국민기업카드");
  if (/통장이동|내부이체|계좌이체/.test(haystack)) return pair(existingLarge === "입금" ? "기타 입금" : "기타 출금", "내부이체");

  if (existingLarge === "입금") {
    if (existingMiddle === "판매 정산금") {
      const channelAliases: Record<string, string> = { SSG: "신세계", 이지웰: "현대이지웰", ".옥션": "옥션" };
      return pair("판매 정산금", channelAliases[existingSmall] || existingSmall || "기타 판매");
    }
    if (/환불|환급/.test(haystack)) return pair("금융비용", "환급금");
    if (/대출/.test(haystack)) return pair("금융비용", "대출 입금");
    if (/거래처 결제|반환/.test(haystack)) return pair("금융비용", "거래처 반환");
    if (/재민|재욱|사비/.test(haystack)) return pair("기타 입금", "사비입금");
    return pair("기타 입금", "검토필요");
  }

  const vendorAliases: Record<string, string> = { 제이비: "제이비컴퍼니", 아주: "아주레포츠" };
  if (/거래처 결제/.test(haystack)) return pair("거래처 결제", vendorAliases[existingSmall] || existingSmall || "기타 구매");
  if (/1688|알리바바|Alibaba|제품구매|수입제품 대금|해외/.test(haystack)) return pair("거래처 결제", "해외 거래처");
  if (/메타|FACEBK/i.test(haystack)) return pair("마케팅·광고", "메타 광고");
  if (isNaverAdTransaction(row) || /네이버|비즈월렛|KCP\(자동과금\)/.test(haystack)) return pair("마케팅·광고", "네이버 광고");
  if (/브랜드커넥트|체험단|협찬/.test(haystack)) return pair("마케팅·광고", "체험단/협찬");
  if (/박스구매|포장재|박스/.test(haystack)) return pair("업무 비용", "포장재/박스");
  if (/구독료|포토샵|지피티|클로드|OPENAI|ANTHROPIC|CLAUDE|이카운트|고도호스팅|프로그램/.test(haystack)) return pair("업무 비용", "프로그램/구독료");
  if (/세무|기장/.test(haystack)) return pair("업무 비용", "세무/기장");
  if (/통신|인터넷/.test(haystack)) return pair("업무 비용", "통신비");
  if (/텔레캅|보안/.test(haystack)) return pair("업무 비용", "보안/관리");
  if (/수입 결제|관부과세|관부가세|통관|세관/.test(haystack)) return pair("업무 비용", "수입/통관");
  if (/CJ|씨제이|CJ택배|대한통운/.test(haystack)) return pair("업무 비용", "CJ대한통운");
  if (/N배송/.test(haystack)) return pair("업무 비용", "N배송");
  if (/타배|화물|반품택배|국내배송비|배송비/.test(haystack)) return pair("업무 비용", "기타 화물비");
  if (/월세|임대료/.test(haystack)) return pair("유지비", "임대료");
  if (/전기세|전기요금|한전/.test(haystack)) return pair("유지비", "전기요금");
  if (/차량렌트|렌트/.test(haystack)) return pair("유지비", "차량 렌트비");
  if (/주차/.test(haystack)) return pair("유지비", "주차요금");
  if (/주유/.test(haystack)) return pair("유지비", "주유비");
  if (/하이패스/.test(haystack)) return pair("유지비", "하이패스");
  if (/화재보험/.test(haystack)) return pair("유지비", "화재보험");
  if (/급여/.test(haystack)) return pair("인건비", "급여");
  if (isOutgoing && /이자-\d{1,3}-\d+/.test(compactHaystack)) return pair("금융비용", "대출 원리금");
  if (/대출이자|대출|원리금|상환/.test(haystack)) return pair("금융비용", "대출 원리금");
  if (/보증료|수수료|문자통지료|SMS/.test(haystack)) return pair("금융비용", "보증료/수수료");
  if (/통합(?:연금|산재|고용|건강)\d{2,6}/.test(compactHaystack)) return pair("복리후생비", "4대보험");
  if (/4대보험|산재보험|고용보험|국민연금|국민건강/.test(haystack)) return pair("복리후생비", "4대보험");
  if (/식대|점심|커피|편의점|회식/.test(haystack)) return pair("복리후생비", "회식 식대");
  if (/교통비|티머니/.test(haystack)) return pair("복리후생비", "직원 교통비");
  if (/재민|재욱|사비/.test(haystack)) return pair("기타 출금", "사비출금");
  if (sourceType === "bank" && /입금/.test(existingLarge)) return pair("기타 입금", "검토필요");
  if (sourceType === "card" || /출금/.test(existingLarge) || /카드/.test(sourceName)) return pair("기타 출금", "검토필요");
  return null;
}

export function normalizeAccountingTransaction(row: RawRow, fxRates: Record<string, number> = {}, accounts: AccountingSourceAccountContext = {}) {
  const meta = sourceMeta(row, accounts);
  const transactionDate = isoDate(first(row, ["transaction_date", "expense_date", "거래일", "일자", "날짜", "이용일자", "승인일자"]));
  const merchant = text(first(row, ["merchant_name", "vendor_name", "거래처", "가맹점명", "적요", "받는분", "사용처"]));
  const description = text(first(row, ["description", "거래내용", "내용", "이용내역", "메모", "적요"])) || merchant;
  const withdrawal = numberValue(first(row, ["debit_amount", "출금액", "지급금액", "withdraw", "withdraw_amount"]));
  const deposit = numberValue(first(row, ["credit_amount", "입금액", "deposit", "deposit_amount"]));
  const explicitAmount = numberValue(first(row, ["amount", "total_amount", "금액원", "금액", "이용금액", "승인금액", "결제금액", "사용금액"]));
  const amount = explicitAmount || withdrawal || deposit;
  const cashDirection = text(row.cash_direction || row.category || row["분류"]);
  const debit = meta.sourceType === "card" ? amount : /입금/.test(cashDirection) ? 0 : withdrawal || (/출금/.test(cashDirection) ? amount : 0);
  const credit = meta.sourceType === "bank" ? /출금/.test(cashDirection) ? 0 : deposit || (/입금/.test(cashDirection) ? amount : 0) : 0;
  const foreignAmount = numberValue(first(row, ["foreign_amount", "해외금액", "해외이용금액", "해외이용금액($)", "USD", "외화금액"]));
  const currency = text(first(row, ["currency", "통화"])) || (foreignAmount > 0 ? "USD" : "KRW");
  const fxRate = numberValue(first(row, ["fx_rate", "환율"])) || (currency === "KRW" ? 1 : numberValue(fxRates[currency]));
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
  const [categories, rules, confirmedRows] = await Promise.all([
    optionalRows("accounting_categories", { is_active: "eq.true", order: "sort_order.asc", limit: 500 }),
    optionalRows("accounting_category_rules", { is_active: "eq.true", order: "priority.asc", limit: 500 }),
    optionalRows("accounting_transactions", { review_status: "eq.confirmed", is_active: "eq.true", order: "transaction_date.desc", limit: 3000 }),
  ]);
  const categoryByPath = new Map<string, RawRow>(categories.map((category): [string, RawRow] => [categoryKey(category), category]));
  const defaultReview = categoryByPath.get("기타 출금|검토필요|");

  return rows.map((row) => {
    const isCardPayment = row.direction === "card_payment";
    const isTransfer = row.direction === "transfer";
    const salaryException = !isCardPayment && !isTransfer ? salaryPrivateWithdrawalException(row, categoryByPath) : null;
    const forcedReviewReason = !isCardPayment && !isTransfer ? ambiguousReviewReason(row) : "";
    const rule = forcedReviewReason ? undefined : rules.find((item) => ruleMatches(item, row));
    const manualPath = forcedReviewReason ? null : manualCategoryPath(row);
    const manualCategory = manualPath ? categoryByPath.get(`${manualPath.large}|${manualPath.middle}|`) : null;
    const historyMatch = !forcedReviewReason && !rule && !manualCategory ? findHistoricalCategoryMatch(row, confirmedRows) : null;
    const reviewReason = forcedReviewReason || text(rule?.review_reason) || (row.direction === "pending_review" ? "미분류" : "");
    const reviewPath = reviewReason ? REVIEW_CATEGORY_BY_REASON[reviewReason] : null;
    const transferLarge = numberValue(row.credit_amount) > 0 ? "기타 입금" : "기타 출금";
    const categoryLarge = isCardPayment ? "카드대금" : isTransfer ? transferLarge : text(salaryException?.category_large) || text(manualCategory?.category_large) || reviewPath?.[0] || text(rule?.category_large) || text(row.existing_category_large) || text(defaultReview?.category_large);
    const categoryMiddle = isCardPayment ? text(row.card_name) || "카드출금" : isTransfer ? "내부이체" : text(salaryException?.category_middle) || text(manualCategory?.category_middle) || reviewPath?.[1] || text(rule?.category_middle) || text(row.existing_category_middle) || text(defaultReview?.category_middle);
    const categorySmall = "";
    const category = salaryException?.category || manualCategory || categoryByPath.get(`${categoryLarge}|${categoryMiddle}|`) || defaultReview;
    const historyCategory = historyMatch ? categoryByPath.get(`${text(historyMatch.row.category_large)}|${text(historyMatch.row.category_middle)}|`) : null;
    const resolvedCategory = historyMatch && !reviewPath ? historyCategory || historyMatch.row : category;
    const needsReview = !salaryException && !manualCategory && !isCardPayment && !isTransfer && (historyMatch ? !historyMatch.autoConfirm : (Boolean(rule?.review_required) || Boolean(reviewReason) || Boolean(resolvedCategory?.default_review_required)));
    return {
      ...row,
      memo: salaryException?.memo || text(rule?.memo) || row.memo,
      category_large: text(resolvedCategory?.category_large) || categoryLarge,
      category_middle: text(resolvedCategory?.category_middle) || categoryMiddle,
      category_small: categorySmall,
      category_id: historyCategory?.id || historyMatch?.row.category_id || category?.id || null,
      rule_id: rule?.id || historyMatch?.row.rule_id || null,
      confidence: rule ? (needsReview ? 0.55 : 0.9) : historyMatch?.confidence || 0.3,
      review_status: needsReview ? "pending" : "confirmed",
      review_reason: reviewReason || (needsReview ? "미분류" : ""),
      affects_profit: salaryException ? false : isCardPayment || isTransfer ? false : resolvedCategory?.affects_profit ?? historyMatch?.row.affects_profit ?? row.direction === "expense",
      affects_cashflow: isCardPayment || isTransfer ? true : row.source_type === "bank" && resolvedCategory?.affects_cashflow !== false,
      affects_card_settlement: !isCardPayment && row.source_type === "card",
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
  const [cardRows, cardAccounts] = await Promise.all([
    optionalRows("accounting_transactions", { source_type: "eq.card", is_active: "eq.true", limit: 5000 }),
    optionalRows("accounting_card_accounts", { or: "(is_active.is.null,is_active.eq.true)", limit: 500 }),
  ]);
  const grouped = new Map<string, RawRow>();
  for (const row of cardRows) {
    if (row.affects_card_settlement !== true) continue;
    const cardName = text(row.card_name || row.source_name);
    const txDate = isoDate(row.transaction_date);
    const cardAccount = findAccountingSourceAccount(cardName, cardAccounts, "card") || undefined;
    const settlement = settlementFor(cardName, txDate, cardAccount);
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
    const sign = isCardCancel(row) ? -1 : 1;
    prev.domestic_amount = numberValue(prev.domestic_amount) + (text(row.currency) === "KRW" ? sign * Math.abs(numberValue(row.amount_krw ?? row.amount)) : 0);
    prev.foreign_amount = numberValue(prev.foreign_amount) + (text(row.currency) === "KRW" ? 0 : sign * Math.abs(numberValue(row.foreign_amount || row.amount)));
    prev.amount_krw = numberValue(prev.amount_krw) + sign * Math.abs(numberValue(row.amount_krw));
    prev.usage_rate = numberValue(prev.card_limit) ? numberValue(prev.amount_krw || prev.domestic_amount) / numberValue(prev.card_limit) : null;
    grouped.set(key, prev);
  }
  const rows = Array.from(grouped.values());
  if (rows.length) await upsertRows("accounting_card_settlements", rows, "card_name,settlement_start,settlement_end");
  return rows;
}

function touchesCardSettlement(row: RawRow) {
  return [
    "transaction_date",
    "posting_date",
    "card_name",
    "source_name",
    "currency",
    "amount",
    "amount_krw",
    "foreign_amount",
    "debit_amount",
    "credit_amount",
    "affects_card_settlement",
  ].some((key) => row[key] !== undefined);
}

async function categoryFor(row: RawRow) {
  const id = text(row.category_id || row.categoryId);
  if (id) {
    const [category] = await optionalRows("accounting_categories", { id: `eq.${id}`, limit: 1 });
    if (category) return category;
  }
  const category_large = text(row.category_large || row.categoryLarge);
  const category_middle = text(row.category_middle || row.categoryMiddle);
  const category_small = "";
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
    category_small: "",
    is_active: row.is_active ?? row.isActive ?? true,
    sort_order: numberValue(row.sort_order ?? row.sortOrder),
    affects_profit: row.affects_profit ?? row.affectsProfit ?? true,
    affects_cashflow: row.affects_cashflow ?? row.affectsCashflow ?? true,
    default_review_required: row.default_review_required ?? row.defaultReviewRequired ?? false,
    memo: text(row.memo) || null,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertAccountingCategory(row: RawRow) {
  const id = text(row.id);
  const payload = cleanCategoryPayload(row);
  if (!payload.category_large) throw new Error("대분류가 필요합니다.");
  if (id) {
    const [previous] = await optionalRows("accounting_categories", { id: `eq.${id}`, limit: 1 });
    const updated = await patchRows("accounting_categories", { id: `eq.${id}` }, payload);
    const categoryPatch = {
      category_large: payload.category_large,
      category_middle: payload.category_middle,
      category_small: payload.category_small,
      updated_at: new Date().toISOString(),
    };
    await patchRows("accounting_transactions", { category_id: `eq.${id}` }, categoryPatch).catch(() => []);
    await patchRows("accounting_category_rules", { category_id: `eq.${id}` }, categoryPatch).catch(() => []);
    await patchRows("accounting_fixed_costs", { category_large: `eq.${text(previous?.category_large)}`, category_middle: `eq.${text(previous?.category_middle)}` }, categoryPatch).catch(() => []);
    await patchRows("accounting_loans", { category_large: `eq.${text(previous?.category_large)}`, category_middle: `eq.${text(previous?.category_middle)}` }, categoryPatch).catch(() => []);
    return updated;
  }
  return upsertRows("accounting_categories", payload, "category_large,category_middle,category_small");
}

export async function accountingCategoryUsage(id: string) {
  if (!id) throw new Error("카테고리 id가 필요합니다.");
  const [category] = await optionalRows("accounting_categories", { id: `eq.${id}`, limit: 1 });
  if (!category) return { total: 0, transactions: 0, rules: 0, fixed_costs: 0, loans: 0 };
  const large = text(category.category_large);
  const middle = text(category.category_middle);
  const [transactions, rules, fixedCosts, loans] = await Promise.all([
    optionalRows("accounting_transactions", { category_id: `eq.${id}`, limit: 5000 }),
    optionalRows("accounting_category_rules", { category_id: `eq.${id}`, limit: 5000 }),
    optionalRows("accounting_fixed_costs", { category_large: `eq.${large}`, category_middle: `eq.${middle}`, is_active: "eq.true", limit: 5000 }),
    optionalRows("accounting_loans", { category_large: `eq.${large}`, category_middle: `eq.${middle}`, is_active: "eq.true", limit: 5000 }),
  ]);
  return {
    total: transactions.length + rules.length + fixedCosts.length + loans.length,
    transactions: transactions.length,
    rules: rules.length,
    fixed_costs: fixedCosts.length,
    loans: loans.length,
  };
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
    category_small: "",
    auto_confirm: row.auto_confirm ?? row.autoConfirm ?? false,
    review_required: row.review_required ?? row.reviewRequired ?? true,
    review_reason: text(row.review_reason || row.reviewReason) || null,
    memo: text(row.memo) || null,
    updated_at: new Date().toISOString(),
  };
  if (id) return patchRows("accounting_category_rules", { id: `eq.${id}` }, payload);
  return insertRows("accounting_category_rules", payload);
}

async function rememberAccountingRuleFromTransaction(transaction: RawRow, row: RawRow = {}) {
  if (!text(transaction.id)) return;
  if (["transfer", "card_payment"].includes(text(transaction.direction))) return;
  const keyword = text(row.keyword) || text(transaction.merchant_name || transaction.description);
  if (matchText(keyword).length < 2) return;
  const category = await categoryFor({
    category_id: transaction.category_id || row.category_id,
    category_large: transaction.category_large || row.category_large,
    category_middle: transaction.category_middle || row.category_middle,
  });
  if (!category) return;
  const payload = {
    priority: row.priority || 60,
    source_type: transaction.source_type,
    source_name: transaction.source_name,
    condition_field: "merchant_name",
    condition_operator: "contains",
    keyword,
    amount_condition: row.amount_condition || row.amountCondition || null,
    direction_condition: transaction.direction,
    category_id: category.id,
    category_large: category.category_large,
    category_middle: category.category_middle,
    category_small: "",
    auto_confirm: true,
    review_required: false,
    review_reason: null,
    memo: row.rule_memo || row.ruleMemo || "Learned from confirmed accounting transaction",
  };
  const existing = await optionalRows("accounting_category_rules", {
    source_type: `eq.${text(payload.source_type)}`,
    source_name: `eq.${text(payload.source_name)}`,
    condition_field: "eq.merchant_name",
    condition_operator: "eq.contains",
    keyword: `eq.${keyword}`,
    direction_condition: `eq.${text(payload.direction_condition)}`,
    limit: 1,
  });
  await upsertAccountingRule({ ...payload, id: existing[0]?.id }).catch(() => []);
}

export async function deactivateAccountingRule(id: string) {
  if (!id) throw new Error("규칙 id가 필요합니다.");
  return patchRows("accounting_category_rules", { id: `eq.${id}` }, { is_active: false, updated_at: new Date().toISOString() });
}

function cleanFixedCostPayload(row: RawRow, existing?: RawRow | null) {
  return cleanAccountingFixedCostPayload(row, existing);
}

export async function upsertAccountingFixedCost(row: RawRow) {
  const id = text(row.id);
  const existing = id ? (await selectRows<RawRow>("accounting_fixed_costs", { id: `eq.${id}`, limit: 1 }).catch(() => []))[0] : null;
  const payload = cleanFixedCostPayload(row, existing);
  if (!payload.fixed_cost_name) throw new Error("고정비명이 필요합니다.");
  if (!payload.base_day) throw new Error("기준일이 필요합니다.");
  if (id) return patchRows("accounting_fixed_costs", { id: `eq.${id}` }, payload);
  return upsertRows("accounting_fixed_costs", payload, "fixed_cost_name");
}

export async function deactivateAccountingFixedCost(id: string) {
  if (!id) throw new Error("고정비 id가 필요합니다.");
  return deleteRows("accounting_fixed_costs", { id: `eq.${id}` });
}


function cleanLoanPayload(row: RawRow, existing?: RawRow | null) {
  return cleanAccountingLoanPayload(row, existing);
}

export async function upsertAccountingLoan(row: RawRow) {
  const id = text(row.id);
  const existing = id ? (await selectRows<RawRow>("accounting_loans", { id: `eq.${id}`, limit: 1 }).catch(() => []))[0] : null;
  const payload = cleanLoanPayload(row, existing);
  if (!payload.loan_name) throw new Error("대출명이 필요합니다.");
  if (!payload.payment_day) throw new Error("납입 기준일이 필요합니다.");
  if (id) return patchRows("accounting_loans", { id: `eq.${id}` }, payload);
  return insertRows("accounting_loans", { ...payload, created_at: new Date().toISOString() });
}

export async function deactivateAccountingLoan(id: string) {
  if (!id) throw new Error("대출 id가 필요합니다.");
  return deleteRows("accounting_loans", { id: `eq.${id}` });
}

function matchingLoanPaymentTransaction(loan: RawRow, transactions: RawRow[], dueDate: string, today: string, expectedAmount: number) {
  if (!expectedAmount) return null;
  const loanName = text(loan.loan_name);
  const special = matchingSpecialLoanPaymentTransaction(loanName, transactions, dueDate, today, expectedAmount);
  if (special) return special;
  const from = addDays(dueDate, -3);
  const to = addDays(dueDate, 3);
  const bankHint = text(loan.bank_name);
  const tolerance = Math.max(1000, Math.round(expectedAmount * 0.03));
  const candidates = transactions
    .filter((row) => {
      const txDate = isoDate(row.transaction_date);
      if (!txDate || txDate < from || txDate > to || txDate > today) return false;
      if (text(row.source_type) !== "bank") return false;
      if (numberValue(row.debit_amount) <= 0) return false;
      if (Math.abs(transactionAmount(row) - expectedAmount) > tolerance) return false;
      const sourceText = `${text(row.source_name)} ${text(row.account_name)} ${text(row.card_name)}`;
      const descriptionText = `${text(row.merchant_name)} ${text(row.description)} ${text(row.memo)}`;
      if (bankHint && !sourceText.includes(bankHint) && !descriptionText.includes(bankHint) && !/재민|재욱/.test(loanName)) return false;
      if (loanName && descriptionText.includes(loanName)) return true;
      return true;
    })
    .sort((left, right) => isoDate(right.transaction_date).localeCompare(isoDate(left.transaction_date)));
  return candidates[0] || null;
}

function matchingSpecialLoanPaymentTransaction(loanName: string, transactions: RawRow[], dueDate: string, today: string, expectedAmount: number) {
  const from = addDays(dueDate, -5);
  const to = addDays(dueDate, 5);
  const candidates = transactions
    .filter((row) => {
      const txDate = isoDate(row.transaction_date);
      if (!txDate || txDate < from || txDate > to || txDate > today) return false;
      if (text(row.source_type) !== "bank" || numberValue(row.debit_amount) <= 0) return false;
      const amount = transactionAmount(row);
      const descriptionText = `${text(row.merchant_name)} ${text(row.description)} ${text(row.memo)}`;
      if (/국민은행 신용_1/.test(loanName)) {
        return /01391602909175/.test(descriptionText) || Math.abs(amount - expectedAmount) <= 1000;
      }
      if (/재민 신한은행 신용|재민 현대해상 약관/.test(loanName)) {
        return /김재욱/.test(descriptionText) && amount >= 120000 && amount <= 130000;
      }
      if (/기업은행 보증서_2/.test(loanName)) {
        return /이자-32-00033/.test(descriptionText);
      }
      if (/재민 경남은행 신용/.test(loanName)) {
        return /김재욱/.test(descriptionText) && amount >= 200000 && amount <= 250000;
      }
      return false;
    })
    .sort((left, right) => isoDate(right.transaction_date).localeCompare(isoDate(left.transaction_date)));
  return candidates[0] || null;
}

function loanOccurrence(row: RawRow, today = kstToday(), transactions: RawRow[] = [], dueAnchor = today) {
  const dueDate = monthDueDate(row.payment_day ?? row.base_day, dueAnchor);
  const amount = numberValue(row.expected_payment_amount)
    || numberValue(row.expected_principal_amount) + numberValue(row.expected_interest_amount);
  const actualRow = matchingLoanPaymentTransaction(row, transactions, dueDate, today, amount);
  const autoPaid = !actualRow && shouldAutoMarkLoanPaid(row, dueDate, today);
  const combinedPrivateLoanPayment = /재민 신한은행 신용|재민 현대해상 약관/.test(text(row.loan_name)) && actualRow && transactionAmount(actualRow) >= 120000;
  const actualAmount = actualRow ? (combinedPrivateLoanPayment ? amount : transactionAmount(actualRow)) : null;
  const daysUntil = Math.round((new Date(`${dueDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
  const paid = Boolean(actualRow || autoPaid);
  return {
    id: `loan-${text(row.id)}`,
    loan_id: row.id,
    fixed_cost_id: row.id,
    title: row.loan_name,
    display_title: row.loan_name,
    category_large: "금융비용",
    category_middle: "대출 원리금",
    expected_amount: amount,
    last_actual_amount: actualAmount,
    last_actual_date: actualRow ? isoDate(actualRow.transaction_date) : null,
    matched_transaction_id: actualRow?.id || null,
    paid,
    amount: actualAmount ?? amount,
    due_date: dueDate,
    base_day: row.payment_day,
    days_until: daysUntil,
    payment_type: "bank",
    payment_source: row.bank_name,
    status: paid ? "paid" : daysUntil < 0 ? "overdue" : daysUntil <= 3 ? "upcoming" : "scheduled",
    memo: row.memo,
    row_type: "loan",
    loan_type: normalizeLoanType(row.loan_type),
    principal_amount: row.principal_amount,
    expected_principal_amount: row.expected_principal_amount,
    expected_interest_amount: row.expected_interest_amount,
  };
}

function loanMaturityOccurrence(row: RawRow) {
  const startDate = isoDate(row.loan_start_date);
  const periodMonths = numberValue(row.loan_period_months);
  if (!startDate || !periodMonths) return null;
  const maturityDate = addMonthsToDate(startDate, periodMonths);
  if (!maturityDate) return null;
  const calendarDate = previousBusinessDay(addDays(maturityDate, -7));
  return {
    id: `loan-maturity-${text(row.id)}`,
    loan_id: row.id,
    title: `[대출만기] ${text(row.loan_name) || "대출"} 만기 예정`,
    display_title: `[대출만기] ${text(row.loan_name) || "대출"} 만기 예정`,
    category_large: "금융비용",
    category_middle: "대출 원리금",
    expected_amount: numberValue(row.current_balance) || numberValue(row.principal_amount),
    amount: numberValue(row.current_balance) || numberValue(row.principal_amount),
    due_date: calendarDate,
    maturity_date: maturityDate,
    base_day: "만기 7일 전",
    days_until: 0,
    payment_type: "loan_maturity",
    payment_source: row.bank_name,
    status: "scheduled",
    memo: row.memo,
    row_type: "loan_maturity",
  };
}

function monthAnchorsForRange(from: string, to: string) {
  if (!from || !to) return [kstToday()];
  const start = isoDate(from).slice(0, 7);
  const end = isoDate(to).slice(0, 7);
  if (!start || !end || start > end) return [kstToday()];
  const [startYear, startMonth] = start.split("-").map(Number);
  const anchors: string[] = [];
  let year = startYear;
  let month = startMonth;
  for (let guard = 0; guard < 120; guard += 1) {
    const anchor = `${dateText(year, month, 1)}`;
    if (anchor.slice(0, 7) > end) break;
    anchors.push(anchor);
    const next = addMonths(year, month, 1);
    year = next.year;
    month = next.month;
    if (`${year}-${String(month).padStart(2, "0")}` > end) break;
  }
  return anchors.length ? anchors : [kstToday()];
}

function suggestReview(row: RawRow, rules: RawRow[], confirmedRows: RawRow[]) {
  const matchingRule = rules.find((rule) => ruleMatches(rule, row) && (text(rule.category_id) || text(rule.category_large)));
  if (matchingRule) {
    return {
      source: "rule",
      label: "저장 규칙",
      category_id: matchingRule.category_id || null,
      category_large: matchingRule.category_large || null,
      category_middle: matchingRule.category_middle || null,
      direction: matchingRule.direction_condition || row.direction,
      affects_profit: text(matchingRule.category_large) === "카드대금" || text(matchingRule.category_middle) === "내부이체" ? false : undefined,
      affects_cashflow: true,
      memo: matchingRule.memo || null,
      confidence: 0.85,
    };
  }
  const merchant = text(row.merchant_name || row.description);
  if (!merchant) return null;
  const normalized = merchant.replace(/\s+/g, "").toLowerCase();
  const previous = confirmedRows.find((item) => {
    const haystack = text(item.merchant_name || item.description).replace(/\s+/g, "").toLowerCase();
    return haystack && (haystack.includes(normalized) || normalized.includes(haystack));
  });
  if (!previous) return null;
  return {
    source: "history",
    label: "최근 확정",
    category_id: previous.category_id || null,
    category_large: previous.category_large || null,
    category_middle: previous.category_middle || null,
    direction: previous.direction || row.direction,
    affects_profit: previous.affects_profit,
    affects_cashflow: previous.affects_cashflow,
    memo: previous.memo || null,
    confidence: 0.65,
  };
}

function compactAccountingTransaction(row: RawRow) {
  const {
    raw_json: _rawJson,
    raw_payload: _rawPayload,
    raw: _raw,
    ...rest
  } = row;
  return rest;
}

function compactReviewTransaction(row: RawRow) {
  return {
    id: row.id,
    transaction_date: row.transaction_date,
    expense_date: row.expense_date,
    source_name: row.source_name,
    source_type: row.source_type,
    card_name: row.card_name,
    account_name: row.account_name,
    merchant_name: row.merchant_name,
    vendor_name: row.vendor_name,
    description: row.description,
    debit_amount: row.debit_amount,
    credit_amount: row.credit_amount,
    amount: row.amount,
    amount_krw: row.amount_krw,
    foreign_amount: row.foreign_amount,
    currency: row.currency,
    direction: row.direction,
    review_status: row.review_status,
    review_reason: row.review_reason,
    category_id: row.category_id,
    category_large: row.category_large,
    category_middle: row.category_middle,
    affects_profit: row.affects_profit,
    affects_cashflow: row.affects_cashflow,
    memo: row.memo,
  };
}

function needsAccountingReview(row: RawRow) {
  return text(row.review_status) === "pending" ||
    [row.review_reason, row.category_large, row.category_middle].some((value) => text(value) === "검토필요");
}

function rocketGrowthMonthDate(month: unknown) {
  const raw = text(month);
  if (!/^\d{4}-\d{2}$/.test(raw)) return "";
  return `${raw}-01`;
}

function rocketGrowthDedupeKey(month: string, item: string) {
  return `manual|coupang-rocket-growth|${month}|${item}`;
}

async function categoryByLargeMiddle(categoryLarge: string, categoryMiddle: string, options: { aliases?: string[]; createIfMissing?: boolean; memo?: string } = {}) {
  const categories = await optionalRows("accounting_categories", { is_active: "eq.true", limit: 500 });
  const normalize = (value: unknown) => text(value).replace(/[·\s/-]/g, "");
  const middleCandidates = [categoryMiddle, ...(options.aliases || [])].map(normalize).filter(Boolean);
  const category = categories.find((item) => {
    if (normalize(item.category_large) !== normalize(categoryLarge)) return false;
    const itemMiddle = normalize(item.category_middle);
    return middleCandidates.some((candidate) => itemMiddle === candidate || itemMiddle.includes(candidate) || candidate.includes(itemMiddle));
  });
  if (category) return category;
  if (options.createIfMissing) {
    const [created] = await upsertRows<RawRow>("accounting_categories", {
      category_large: categoryLarge,
      category_middle: categoryMiddle,
      category_small: "",
      is_active: true,
      affects_profit: false,
      affects_cashflow: false,
      default_review_required: false,
      sort_order: 0,
      memo: options.memo || "쿠팡 로켓그로스 수동 비용 입력용 카테고리",
    }, "category_large,category_middle,category_small");
    if (created) return created;
  }
  if (!category) throw new Error(`${categoryLarge} > ${categoryMiddle} 카테고리가 필요합니다.`);
  return category;
}

export async function listRocketGrowthCosts() {
  const rows = await optionalRows("accounting_transactions", {
    source_type: "eq.manual",
    source_name: "eq.쿠팡 로켓그로스",
    is_active: "eq.true",
    order: "transaction_date.desc",
    limit: 200,
  });
  return rows.filter((row) => text(row.dedupe_key).startsWith("manual|coupang-rocket-growth|"));
}

export async function upsertRocketGrowthCosts(row: RawRow) {
  const month = text(row.month);
  const transactionDate = rocketGrowthMonthDate(month);
  if (!transactionDate) throw new Error("기준월이 필요합니다.");
  const adAmount = numberValue(row.ad_amount ?? row.adAmount);
  const fulfillmentAmount = numberValue(row.fulfillment_amount ?? row.fulfillmentAmount);
  const sellerDiscountCouponAmount = numberValue(row.seller_discount_coupon_amount ?? row.sellerDiscountCouponAmount);
  const subscriptionServiceAmount = numberValue(row.subscription_service_amount ?? row.subscriptionServiceAmount);
  const coupangLiveAmount = numberValue(row.coupang_live_amount ?? row.coupangLiveAmount);
  const rocketGrowthServiceAmount = fulfillmentAmount + sellerDiscountCouponAmount + subscriptionServiceAmount + coupangLiveAmount;
  if ([adAmount, fulfillmentAmount, sellerDiscountCouponAmount, subscriptionServiceAmount, coupangLiveAmount].some((amount) => amount < 0)) throw new Error("금액은 0 이상이어야 합니다.");
  const [adCategory, fulfillmentCategory] = await Promise.all([
    categoryByLargeMiddle("마케팅·광고", "쿠팡", { aliases: ["쿠팡 광고"], createIfMissing: true }),
    categoryByLargeMiddle("업무 비용", "쿠팡 로켓그로스", { aliases: ["로켓그로스"], createIfMissing: true }),
  ]);
  const now = new Date().toISOString();
  const base = {
    transaction_date: transactionDate,
    source_type: "manual",
    source_name: "쿠팡 로켓그로스",
    direction: "expense",
    currency: "KRW",
    debit_amount: 0,
    credit_amount: 0,
    review_status: "confirmed",
    review_reason: "",
    affects_profit: false,
    affects_cashflow: false,
    affects_card_settlement: false,
    is_active: true,
    updated_at: now,
  };
  const rows = [
    {
      ...base,
      merchant_name: "쿠팡 로켓그로스 광고비",
      description: `${month} 쿠팡 로켓그로스 광고비`,
      amount: adAmount,
      amount_krw: adAmount,
      category_id: adCategory.id,
      category_large: adCategory.category_large,
      category_middle: adCategory.category_middle,
      category_small: "",
      memo: text(row.memo) || null,
      raw_json: {
        source: "manual_rocket_growth",
        month,
        item: "ad",
        ad_amount: adAmount,
      },
      dedupe_key: rocketGrowthDedupeKey(month, "ad"),
    },
    {
      ...base,
      merchant_name: "쿠팡 로켓그로스 업무비용",
      description: `${month} 쿠팡 로켓그로스 업무비용`,
      amount: rocketGrowthServiceAmount,
      amount_krw: rocketGrowthServiceAmount,
      category_id: fulfillmentCategory.id,
      category_large: fulfillmentCategory.category_large,
      category_middle: fulfillmentCategory.category_middle,
      category_small: "",
      memo: text(row.memo) || null,
      raw_json: {
        source: "manual_rocket_growth",
        month,
        item: "rocket_growth_services",
        fulfillment_amount: fulfillmentAmount,
        seller_discount_coupon_amount: sellerDiscountCouponAmount,
        subscription_service_amount: subscriptionServiceAmount,
        coupang_live_amount: coupangLiveAmount,
      },
      dedupe_key: rocketGrowthDedupeKey(month, "fulfillment"),
    },
  ];
  return upsertRows<RawRow>("accounting_transactions", rows, "dedupe_key");
}

function cleanBankAccountPayload(row: RawRow) {
  return {
    account_type: text(row.account_type || row.accountType) || "business",
    bank_name: text(row.bank_name || row.bankName),
    account_holder: text(row.account_holder || row.accountHolder) || null,
    account_number: text(row.account_number || row.accountNumber) || null,
    password_hint: text(row.password_hint || row.passwordHint) || null,
    display_alias: text(row.display_alias || row.displayAlias) || null,
    list_enabled: row.list_enabled ?? row.listEnabled ?? true,
    memo: text(row.memo) || null,
    is_active: row.is_active ?? row.isActive ?? true,
    sort_order: numberValue(row.sort_order ?? row.sortOrder),
    updated_at: new Date().toISOString(),
  };
}

async function writeAccountWithColumnFallback(table: string, payload: RawRow, options: { id?: string; conflictTarget?: string; createdAt?: boolean }) {
  let nextPayload = { ...payload };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      if (options.id) return patchRows(table, { id: `eq.${options.id}` }, nextPayload);
      return options.conflictTarget
        ? upsertRows(table, { ...nextPayload, ...(options.createdAt ? { created_at: new Date().toISOString() } : {}) }, options.conflictTarget)
        : insertRows(table, { ...nextPayload, ...(options.createdAt ? { created_at: new Date().toISOString() } : {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const missingColumn = message.match(/컬럼 '([^']+)'/)?.[1] || message.match(/Could not find the ['"]?([^'"\s]+)['"]? column/i)?.[1] || "";
      if (!missingColumn || !(missingColumn in nextPayload)) throw error;
      const { [missingColumn]: _removed, ...rest } = nextPayload;
      nextPayload = rest;
    }
  }
  throw new Error("계정 설정 저장 가능 컬럼 확인에 실패했습니다.");
}

export async function upsertAccountingBankAccount(row: RawRow) {
  const id = text(row.id);
  const payload = cleanBankAccountPayload(row);
  if (!payload.bank_name) throw new Error("은행명이 필요합니다.");
  return writeAccountWithColumnFallback("accounting_bank_accounts", payload, { id, createdAt: true });
}

export async function deactivateAccountingBankAccount(id: string) {
  if (!id) throw new Error("통장 id가 필요합니다.");
  return patchRows("accounting_bank_accounts", { id: `eq.${id}` }, { is_active: false, updated_at: new Date().toISOString() });
}

function cleanCardAccountPayload(row: RawRow) {
  return {
    card_type: text(row.card_type || row.cardType) || "business",
    card_name: text(row.card_name || row.cardName),
    card_number: text(row.card_number || row.cardNumber) || null,
    expiry_date: isoDate(row.expiry_date || row.expiryDate) || null,
    cvc_hint: text(row.cvc_hint || row.cvcHint) || null,
    secure_message: text(row.secure_message || row.secureMessage) || null,
    payment_password_hint: text(row.payment_password_hint || row.paymentPasswordHint) || null,
    cutoff_start_day: numberValue(row.cutoff_start_day ?? row.cutoffStartDay) || null,
    cutoff_end_day: numberValue(row.cutoff_end_day ?? row.cutoffEndDay) || null,
    payment_day: numberValue(row.payment_day ?? row.paymentDay) || null,
    card_limit: numberValue(row.card_limit ?? row.cardLimit) || null,
    withdrawal_account_name: text(row.withdrawal_account_name || row.withdrawalAccountName) || null,
    display_alias: text(row.display_alias || row.displayAlias) || null,
    list_enabled: row.list_enabled ?? row.listEnabled ?? true,
    physical_owner: text(row.physical_owner || row.physicalOwner) || null,
    memo: text(row.memo) || null,
    is_active: row.is_active ?? row.isActive ?? true,
    sort_order: numberValue(row.sort_order ?? row.sortOrder),
    updated_at: new Date().toISOString(),
  };
}

export async function upsertAccountingCardAccount(row: RawRow) {
  const id = text(row.id);
  const payload = cleanCardAccountPayload(row);
  if (!payload.card_name) throw new Error("카드명이 필요합니다.");
  return writeAccountWithColumnFallback("accounting_card_accounts", payload, { id, conflictTarget: "card_name", createdAt: true });
}

export async function deactivateAccountingCardAccount(id: string) {
  if (!id) throw new Error("카드 id가 필요합니다.");
  return patchRows("accounting_card_accounts", { id: `eq.${id}` }, { is_active: false, updated_at: new Date().toISOString() });
}

export async function updateAccountingTransaction(id: string, row: RawRow) {
  if (!id) throw new Error("거래 id가 필요합니다.");
  const [previous] = await optionalRows("accounting_transactions", { id: `eq.${id}`, limit: 1 });
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
    payload.category_small = "";
  }
  for (const key of ["category_large", "category_middle", "category_small"]) {
    if (row[key] !== undefined && !category) payload[key] = key === "category_small" ? "" : text(row[key]);
  }
  for (const key of ["direction", "review_reason"]) {
    if (row[key] !== undefined) payload[key] = text(row[key]);
  }
  for (const key of ["debit_amount", "credit_amount", "amount", "amount_krw", "foreign_amount", "fx_rate"]) {
    if (row[key] !== undefined) payload[key] = numberValue(row[key]);
  }
  if (row.currency !== undefined) payload.currency = text(row.currency) || "KRW";
  for (const key of ["affects_profit", "affects_cashflow"]) {
    if (row[key] !== undefined) payload[key] = row[key];
  }
  const saved = await patchRows<RawRow>("accounting_transactions", { id: `eq.${id}` }, payload);
  if (payload.review_status === "confirmed") {
    if (row.create_rule || row.createRule || row.save_rule || row.saveRule) {
      await rememberAccountingRuleFromTransaction({ ...(previous || {}), ...payload, id }, row);
    }
    await patchRows("accounting_review_queue", { transaction_id: `eq.${id}` }, {
      status: "resolved",
      resolved_category_id: category?.id || null,
      resolved_at: new Date().toISOString(),
      memo: text(row.review_memo || row.reviewMemo || row.memo) || null,
      updated_at: new Date().toISOString(),
    }).catch(() => []);
  } else if (payload.review_status === "pending") {
    await upsertRows("accounting_review_queue", [{
      transaction_id: id,
      reason: text(payload.review_reason) || "미분류",
      status: "pending",
      suggested_category_id: payload.category_id || null,
      suggested_category_large: payload.category_large || null,
      suggested_category_middle: payload.category_middle || null,
      suggested_category_small: payload.category_small || null,
      memo: text(row.review_memo || row.reviewMemo || row.memo) || null,
      updated_at: new Date().toISOString(),
    }], "transaction_id").catch(() => []);
  }
  if (touchesCardSettlement(row)) await rebuildCardSettlements();
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
      category_small: "",
      auto_confirm: row.auto_confirm ?? row.autoConfirm ?? false,
      review_required: row.review_required ?? row.reviewRequired ?? false,
      review_reason: row.review_reason || row.reviewReason || null,
      memo: row.rule_memo || row.ruleMemo || "검토필요 탭에서 저장한 자동분류 규칙",
    }).catch(() => []);
  }
  return updated;
}

export async function importAccountingLedgerRows(rows: RawRow[], options: { sourceType?: string; sourceFileName?: string; uploadedBy?: string; memo?: string } = {}) {
  const [fxRates, sourceAccounts] = await Promise.all([fxRatesMap(), accountingSourceAccounts()]);
  const normalized = rows.map((row) => normalizeAccountingTransaction({ ...row, source_type: row.source_type || options.sourceType }, fxRates, sourceAccounts));
  const classified = await classifyAccountingTransactions(markMatchedInternalTransfers(normalized));
  const [batch] = await insertRows<{ id: string }>("accounting_import_batches", {
    source_name: options.sourceType || "자동 분류",
    source_type: options.sourceType || "auto",
    source_file_name: options.sourceFileName || null,
    uploaded_by: options.uploadedBy || null,
    total_count: classified.length,
    status: "processing",
    memo: options.memo || null,
  });
  try {
    const rowsWithBatch: RawRow[] = classified.map((row) => ({ ...row, batch_id: batch.id }));
    const existing: RawRow[] = [];
    for (const keyChunk of chunkRows(rowsWithBatch.map((row) => text(row.dedupe_key)).filter(Boolean), 100)) {
      existing.push(...await optionalRows("accounting_transactions", {
        dedupe_key: `in.(${keyChunk.map((key) => `"${key.replace(/"/g, '\\"')}"`).join(",")})`,
        limit: keyChunk.length,
      }));
    }
    const dateKeys = Array.from(new Set(rowsWithBatch.map((row) => isoDate(row.transaction_date)).filter(Boolean)));
    const existingByDate: RawRow[] = [];
    for (const dateChunk of chunkRows(dateKeys, 100)) {
      existingByDate.push(...await optionalRows("accounting_transactions", {
        transaction_date: `in.(${dateChunk.map((date) => `"${date}"`).join(",")})`,
        is_active: "eq.true",
        limit: 5000,
      }));
    }
    const existingKeys = new Set(existing.map((row) => text(row.dedupe_key)));
    const existingFallbackKeys = new Set(existingByDate
      .filter((row) => !text(row.approval_no))
      .map(transactionFallbackDedupeKey)
      .filter(Boolean));
    const freshByKey = new Map<string, RawRow>();
    const freshFallbackKeys = new Set<string>();
    let uploadDuplicateCount = 0;
    for (const row of rowsWithBatch) {
      const key = text(row.dedupe_key);
      const fallbackKey = transactionFallbackDedupeKey(row);
      const shouldUseFallback = !text(row.approval_no) || existingFallbackKeys.has(fallbackKey);
      if (!key || existingKeys.has(key) || freshByKey.has(key) || (shouldUseFallback && (existingFallbackKeys.has(fallbackKey) || freshFallbackKeys.has(fallbackKey)))) {
        uploadDuplicateCount += 1;
        continue;
      }
      freshByKey.set(key, row);
      if (shouldUseFallback) freshFallbackKeys.add(fallbackKey);
    }
    const fresh = Array.from(freshByKey.values());
    const savedChunks = await Promise.all(chunkRows(fresh, 200).map((chunk) => upsertRows<RawRow>("accounting_transactions", chunk, "dedupe_key")));
    const saved = savedChunks.flat();
    const gaonPointTotal = saved
      .filter((row) => text(row.card_name || row.source_name) === "가온글로벌카드")
      .reduce((sum, row) => sum + numberValue((row.raw_json as RawRow | undefined)?.reward_points ?? row.reward_points), 0);
    if (gaonPointTotal) await addAccountingCardPoints("가온글로벌카드", gaonPointTotal);
    for (const chunk of chunkRows(saved, 300)) await upsertReviewRows(chunk);
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
      upload_duplicate_count: uploadDuplicateCount,
      review_count: reviewCount,
    };
  } catch (error) {
    await patchRows("accounting_import_batches", { id: `eq.${batch.id}` }, {
      new_count: 0,
      duplicate_count: 0,
      error_count: classified.length,
      review_count: 0,
      status: "failed",
      memo: error instanceof Error ? error.message.slice(0, 500) : "회계 업로드 실패",
      updated_at: new Date().toISOString(),
    }).catch(() => []);
    throw error;
  }
}

export async function accountingLedgerSummary(range?: { from?: string; to?: string; scope?: string }) {
  const from = text(range?.from);
  const to = text(range?.to);
  const scope = text(range?.scope);
  const dashboardOnly = scope === "dashboard";
  const ledgerOnly = scope === "ledger";
  const fixedOnly = scope === "fixed";
  const dbOnly = scope === "db";
  const queryFrom = from && to ? addDays(from, -3) : from;
  const dateFilter = queryFrom ? `gte.${queryFrom}` : undefined;
  const [
    rows,
    categories,
    rules,
    batches,
    reviewQueue,
    settlements,
    fixedCosts,
    loans,
    bankAccounts,
    cardAccounts,
    fxRates,
    gaonCardPoints,
    rocketGrowthCosts,
  ] = await Promise.all([
    optionalRows("accounting_transactions", {
      ...(dateFilter ? { transaction_date: dateFilter } : {}),
      order: "transaction_date.desc",
      limit: 2000,
    }),
    dashboardOnly ? Promise.resolve([]) : optionalRows("accounting_categories", { is_active: "eq.true", order: "sort_order.asc", limit: 500 }),
    dashboardOnly ? Promise.resolve([]) : optionalRows("accounting_category_rules", { order: "priority.asc", limit: 500 }),
    optionalRows("accounting_import_batches", { order: "created_at.desc", limit: dashboardOnly ? 5 : 20 }),
    optionalRows("accounting_review_queue", { status: "eq.pending", order: "created_at.desc", limit: 100 }),
    optionalRows("accounting_card_settlements", { order: "payment_due_date.asc", limit: 30 }),
    optionalRows("accounting_fixed_costs", { order: "sort_order.asc", limit: 300 }),
    optionalRows("accounting_loans", { order: "payment_day.asc", limit: 300 }),
    dashboardOnly ? Promise.resolve([]) : optionalRows("accounting_bank_accounts", { order: "sort_order.asc", limit: 100 }),
    dashboardOnly ? Promise.resolve([]) : optionalRows("accounting_card_accounts", { order: "sort_order.asc", limit: 100 }),
    fxRatesMap(),
    readAccountingCardPoint("가온글로벌카드"),
    dbOnly ? listRocketGrowthCosts() : Promise.resolve([]),
  ]);
  const filtered = rows.filter((row) => {
    const date = isoDate(row.transaction_date);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return row.is_active !== false;
  }).map((row) => {
    const isInternalTransfer = text(row.direction) === "transfer" && text(row.category_middle) === "내부이체";
    if (!isInternalTransfer) return row;
    return {
      ...row,
      category_large: numberValue(row.credit_amount) > 0 ? "기타 입금" : "기타 출금",
    };
  });
  const activeFixedCosts = fixedCosts.filter((row) => row.is_active !== false);
  const activeLoans = loans.filter((row) => row.is_active !== false);
  const today = kstToday();
  const sevenDaysLater = addDays(today, 7);
  const occurrenceAnchors = from && to ? monthAnchorsForRange(from, to) : [today];
  const fixedCostOccurrences = occurrenceAnchors.flatMap((anchor) => activeFixedCosts.map((row) => fixedCostOccurrence(row, today, rows, anchor, settlements)));
  const loanOccurrences = occurrenceAnchors.flatMap((anchor) => activeLoans.map((row) => loanOccurrence(row, today, rows, anchor)));
  const loanMaturityOccurrences = (activeLoans.map((row) => loanMaturityOccurrence(row)).filter(Boolean) as RawRow[])
    .filter((row) => {
      const dueDate = text(row.due_date);
      if (from && dueDate < from) return false;
      if (to && dueDate > to) return false;
      return true;
    });
  const calendarFixedCostOccurrences = [...fixedCostOccurrences, ...loanOccurrences, ...loanMaturityOccurrences];
  const upcomingFixedCosts = [...fixedCostOccurrences, ...loanOccurrences]
    .filter((row) => row.paid !== true && text(row.due_date) >= today && text(row.due_date) <= sevenDaysLater)
    .sort((left, right) => text(left.due_date).localeCompare(text(right.due_date)))
    .slice(0, 30);
  const fixedCostDueAmount = upcomingFixedCosts.reduce((total, row) => total + numberValue(row.amount), 0);
  const loanProfitAmountByTransactionId = new Map<string, number>();
  for (const occurrence of loanOccurrences) {
    const transactionId = text(occurrence.matched_transaction_id);
    if (!transactionId) continue;
    const totalAmount = numberValue(occurrence.last_actual_amount ?? occurrence.amount);
    const expectedInterest = numberValue(occurrence.expected_interest_amount);
    const expectedPrincipal = numberValue(occurrence.expected_principal_amount);
    const profitAmount = text(occurrence.loan_type) === "principal_interest"
      ? expectedInterest || Math.max(0, totalAmount - expectedPrincipal)
      : totalAmount;
    loanProfitAmountByTransactionId.set(transactionId, profitAmount);
  }
  const profitExpenseAmount = (row: RawRow) => {
    const loanProfitAmount = loanProfitAmountByTransactionId.get(text(row.id));
    if (loanProfitAmount !== undefined) return loanProfitAmount;
    return signedAccountingAmount(row);
  };
  const income = filtered.filter((row) => row.direction === "income" && row.affects_profit !== false).reduce((total, row) => total + numberValue(row.amount_krw ?? row.amount), 0);
  const expense = filtered.filter((row) => row.direction === "expense" && row.affects_profit !== false).reduce((total, row) => total + profitExpenseAmount(row), 0);
  const cashIn = filtered.filter((row) => row.source_type === "bank" && row.affects_cashflow !== false).reduce((total, row) => total + numberValue(row.credit_amount), 0);
  const cashOut = filtered.filter((row) => row.source_type === "bank" && row.affects_cashflow !== false).reduce((total, row) => total + numberValue(row.debit_amount), 0);
  const pendingCard = settlements.filter((row) => row.paid !== true).reduce((total, row) => total + numberValue(row.amount_krw || row.domestic_amount), 0);
  const cardPanelCards = cardPanelStatuses(filtered, settlements);
  const group = (pick: (row: RawRow) => string, sourceRows = filtered, amountPick: (row: RawRow) => number = (row) => row.source_type === "card" ? signedAccountingAmount(row) : numberValue(row.amount_krw ?? row.amount)) => {
    const map = new Map<string, { label: string; amount: number; count: number }>();
    for (const row of sourceRows) {
      const label = pick(row) || "기타";
      const prev = map.get(label) || { label, amount: 0, count: 0 };
      prev.amount += amountPick(row);
      prev.count += 1;
      map.set(label, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  };
  type MonthSummary = { label: string; income: number; expense: number; amount: number; count: number };
  const byMonthMap = filtered.reduce<Map<string, MonthSummary>>((map, row) => {
    const label = isoDate(row.transaction_date).slice(0, 7) || "미지정";
    const prev = map.get(label) || { label, income: 0, expense: 0, amount: 0, count: 0 };
    const amount = row.source_type === "card" ? signedAccountingAmount(row) : numberValue(row.amount_krw ?? row.amount);
    const expenseAmount = profitExpenseAmount(row);
    if (row.direction === "income" && row.affects_profit !== false) prev.income += amount;
    if (row.direction === "expense" && row.affects_profit !== false) prev.expense += expenseAmount;
    prev.amount = prev.income - prev.expense;
    prev.count += 1;
    map.set(label, prev);
    return map;
  }, new Map<string, MonthSummary>());
  const byMonth = Array.from(byMonthMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  const incomeRows = filtered.filter((row) => row.direction === "income" && row.affects_profit !== false);
  const expenseRows = filtered.filter((row) => row.direction === "expense" && row.affects_profit !== false);
  const incomeRankPick = (row: RawRow) => text(row.category_middle || row.category_large || row.merchant_name || row.source_name);
  const categoryLarge = group((row) => text(row.category_large));
  const expenseCategoryMiddle = group((row) => `${text(row.category_large)}|${text(row.category_middle)}`, expenseRows, profitExpenseAmount)
    .map((row) => {
      const [parent, label] = text(row.label).split("|");
      return { ...row, parent, label: label || parent || "기타" };
    });
  const confirmedRows = dashboardOnly ? [] : filtered.filter((item) => text(item.review_status) === "confirmed");
  const reviewSuggestions = dashboardOnly ? {} : Object.fromEntries(
    filtered
      .filter((row) => text(row.review_status) === "pending")
      .map((row) => [text(row.id), suggestReview(row, rules, confirmedRows)])
      .filter(([id, suggestion]) => id && suggestion),
  );
  const commonSummary = {
    batches,
    card_settlements: settlements,
    card_panel_cards: cardPanelCards,
    card_points: { "가온글로벌카드": gaonCardPoints },
    fx_rates: fxRates,
    upcoming_fixed_costs: upcomingFixedCosts,
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
  };
  if (dashboardOnly) {
    return {
      scope: "dashboard",
      batches,
      card_settlements: settlements,
      card_panel_cards: cardPanelCards,
      card_points: { "가온글로벌카드": gaonCardPoints },
      fx_rates: fxRates,
      upcoming_fixed_costs: upcomingFixedCosts,
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
      by_income_vendor: group(incomeRankPick, incomeRows, (row) => numberValue(row.credit_amount) || numberValue(row.amount_krw ?? row.amount)),
      by_expense_category: group((row) => text(row.category_large), expenseRows, profitExpenseAmount),
      by_expense_category_middle: expenseCategoryMiddle,
      by_expense_vendor: group((row) => text(row.merchant_name || row.source_name), expenseRows, profitExpenseAmount),
      by_card: group((row) => text(row.card_name || row.source_name)),
      by_month: byMonth,
    };
  }
  if (ledgerOnly) {
    return {
      scope: "ledger",
      ...commonSummary,
      categories,
      bank_accounts: bankAccounts,
      card_accounts: cardAccounts,
      by_month: byMonth,
    };
  }
  if (fixedOnly) {
    return {
      scope: "fixed",
      ...commonSummary,
      categories,
      fixed_costs: activeFixedCosts,
      fixed_cost_occurrences: calendarFixedCostOccurrences,
      loan_occurrences: loanOccurrences,
      loan_maturity_occurrences: loanMaturityOccurrences,
      loans: activeLoans,
      bank_accounts: bankAccounts,
      card_accounts: cardAccounts,
    };
  }
  if (dbOnly) {
    const pendingRows = filtered.filter(needsAccountingReview).slice(0, 300).map(compactReviewTransaction);
    return {
      scope: "db",
      ...commonSummary,
      transactions: pendingRows,
      expenses: [],
      categories,
      rules,
      review_queue: reviewQueue,
      review_suggestions: reviewSuggestions,
      rocket_growth_costs: rocketGrowthCosts,
    };
  }
  return {
    scope: "full",
    transactions: filtered.slice(0, 300).map(compactAccountingTransaction),
    expenses: [],
    categories,
    rules,
    batches,
    review_queue: reviewQueue,
    card_settlements: settlements,
    card_panel_cards: cardPanelCards,
    card_points: { "가온글로벌카드": gaonCardPoints },
    fx_rates: fxRates,
    fixed_costs: activeFixedCosts,
    fixed_cost_occurrences: calendarFixedCostOccurrences,
    loan_occurrences: loanOccurrences,
    loan_maturity_occurrences: loanMaturityOccurrences,
    loans: activeLoans,
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
    by_income_vendor: group(incomeRankPick, incomeRows, (row) => numberValue(row.credit_amount) || numberValue(row.amount_krw ?? row.amount)),
    by_expense_category: group((row) => text(row.category_large), expenseRows, profitExpenseAmount),
    by_expense_category_middle: expenseCategoryMiddle,
    by_expense_vendor: group((row) => text(row.merchant_name || row.source_name), expenseRows, profitExpenseAmount),
    by_card: group((row) => text(row.card_name || row.source_name)),
    by_month: byMonth,
    review_suggestions: reviewSuggestions,
  };
}
