type RawRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(text(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown) {
  const raw = text(value);
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function mergeExistingPatchRow(row: RawRow, existing?: RawRow | null) {
  return existing ? { ...existing, ...row } : row;
}

function normalizeAccountingLoanType(value: unknown) {
  const raw = text(value);
  if (/interest_only|이자/.test(raw)) return "interest_only";
  return "principal_interest";
}

export function cleanAccountingFixedCostPayload(row: RawRow, existing?: RawRow | null) {
  const source = mergeExistingPatchRow(row, existing);
  const keywords = Array.isArray(source.match_keywords)
    ? source.match_keywords.map(text).filter(Boolean)
    : text(source.match_keywords || source.matchKeywords).split(/[,/|]+/).map(text).filter(Boolean);
  return {
    fixed_cost_name: text(source.fixed_cost_name || source.fixedCostName || source.name),
    category_large: text(source.category_large || source.categoryLarge),
    category_middle: text(source.category_middle || source.categoryMiddle),
    category_small: "",
    expected_amount: numberValue(source.expected_amount ?? source.expectedAmount ?? source.amount),
    base_day: text(source.base_day || source.baseDay || source.payment_day || source.paymentDay),
    weekend_policy: text(source.weekend_policy || source.weekendPolicy) || "previous_business_day",
    holiday_policy: text(source.holiday_policy || source.holidayPolicy) || "previous_business_day",
    payment_type: text(source.payment_type || source.paymentType) || "bank",
    payment_source: text(source.payment_source || source.paymentSource) || null,
    source_account_name: text(source.source_account_name || source.sourceAccountName) || null,
    source_card_name: text(source.source_card_name || source.sourceCardName) || null,
    affects_profit: source.affects_profit ?? source.affectsProfit ?? true,
    affects_cashflow: source.affects_cashflow ?? source.affectsCashflow ?? true,
    match_keywords: keywords.length ? keywords : null,
    is_active: source.is_active ?? source.isActive ?? true,
    sort_order: numberValue(source.sort_order ?? source.sortOrder),
    memo: text(source.memo) || null,
    updated_at: new Date().toISOString(),
  };
}

export function cleanAccountingLoanPayload(row: RawRow, existing?: RawRow | null) {
  const source = mergeExistingPatchRow(row, existing);
  const loanType = normalizeAccountingLoanType(source.loan_type || source.loanType);
  const expectedPrincipal = loanType === "principal_interest" ? numberValue(source.expected_principal_amount ?? source.expectedPrincipalAmount) : 0;
  const expectedInterest = numberValue(
    source.expected_interest_amount
    ?? source.expectedInterestAmount
    ?? (loanType === "interest_only" ? source.expected_payment_amount ?? source.expectedPaymentAmount ?? source.amount : 0),
  );
  const expectedPayment = loanType === "principal_interest"
    ? expectedPrincipal + expectedInterest
    : expectedInterest || numberValue(source.expected_payment_amount ?? source.expectedPaymentAmount ?? source.amount);
  return {
    loan_name: text(source.loan_name || source.loanName || source.name),
    principal_amount: numberValue(source.principal_amount ?? source.principalAmount),
    current_balance: numberValue(source.current_balance ?? source.currentBalance),
    bank_name: text(source.bank_name || source.bankName) || null,
    account_holder: text(source.account_holder || source.accountHolder) || null,
    account_number: text(source.account_number || source.accountNumber) || null,
    deposit_account_number: text(source.deposit_account_number || source.depositAccountNumber || source.deposit_account || source.depositAccount) || null,
    loan_start_date: isoDate(source.loan_start_date || source.loanStartDate) || null,
    loan_period_months: numberValue(source.loan_period_months ?? source.loanPeriodMonths) || null,
    payment_day: text(source.payment_day || source.paymentDay || source.base_day || source.baseDay),
    loan_type: loanType,
    expected_principal_amount: expectedPrincipal,
    expected_interest_amount: expectedInterest,
    expected_payment_amount: expectedPayment,
    payer_name: text(source.payer_name || source.payerName) || null,
    is_active: source.is_active ?? source.isActive ?? true,
    memo: text(source.memo) || null,
    updated_at: new Date().toISOString(),
  };
}

export function shouldAutoMarkLoanPaid(row: RawRow, dueDate: string, today: string) {
  if (!dueDate || !today || today <= dueDate) return false;
  const loanName = text(row.loan_name || row.title || row.display_title);
  const sourceText = `${text(row.bank_name)} ${text(row.payment_source)} ${text(row.memo)}`;
  return /기업은행\s*보증서_?1/.test(loanName) && /기업은행|IBK/i.test(sourceText);
}
