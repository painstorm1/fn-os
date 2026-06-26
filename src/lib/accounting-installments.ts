type Row = Record<string, unknown>;

type AmountPick = (row: Row) => unknown;
type DatePick = (row: Row) => unknown;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(text(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function accountingIsoDate(value: unknown) {
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

function addMonthsToDate(date: string, delta: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day || 1, lastDay)).padStart(2, "0")}`;
}

function collectInstallmentText(row: Row): string[] {
  const values: string[] = [];
  const directKeys = [
    "installment",
    "installment_months",
    "installment_plan",
    "할부",
    "할부조건",
    "payment_method",
    "결제수단",
    "memo",
    "비고",
    "description",
    "raw_status",
  ];
  for (const key of directKeys) {
    const value = row[key];
    if (value !== undefined && value !== null && text(value)) values.push(text(value));
  }
  for (const payloadKey of ["raw_json", "raw_payload"]) {
    const payload = row[payloadKey];
    if (payload && typeof payload === "object") {
      for (const value of Object.values(payload as Row)) {
        if (value !== undefined && value !== null && text(value)) values.push(text(value));
      }
    }
  }
  return values;
}

export function accountingInstallmentMonths(row: Row) {
  const haystack = collectInstallmentText(row).join(" ");
  const match = /(?:무이자|할부)\s*(\d{1,2})|(?:^|\D)(\d{1,2})\s*개월(?:\s*할부)?/.exec(haystack);
  const months = Number(match?.[1] || match?.[2] || 0);
  return Number.isFinite(months) && months > 1 && months <= 60 ? months : 0;
}

export function accountingInstallmentMemo(row: Row) {
  const months = accountingInstallmentMonths(row);
  return months ? `할부 ${months}개월` : "";
}

export function appendAccountingInstallmentMemo(memo: unknown, row: Row) {
  const current = text(memo);
  const installmentMemo = accountingInstallmentMemo(row);
  if (!installmentMemo) return current;
  if (/할부\s*\d{1,2}\s*개월|무이자\s*\d{1,2}/.test(current)) return current;
  return [current, installmentMemo].filter(Boolean).join(" / ");
}

export function installmentAllocatedAmountForMonth(row: Row, month: string, amountPick: AmountPick, datePick: DatePick) {
  const txDate = accountingIsoDate(datePick(row));
  const amount = numberValue(amountPick(row));
  const months = accountingInstallmentMonths(row);
  if (!months || !txDate) return txDate.replace(/-/g, "").startsWith(month.replace(/-/g, "")) ? amount : 0;
  for (let index = 0; index < months; index += 1) {
    const partDate = addMonthsToDate(txDate, index);
    if (partDate.slice(0, 7).replace(/-/g, "") === month.replace(/-/g, "")) return amount / months;
  }
  return 0;
}

export function installmentAllocatedAmountForDateRange(row: Row, start: string, end: string, amountPick: AmountPick, datePick: DatePick) {
  const txDate = accountingIsoDate(datePick(row));
  const amount = numberValue(amountPick(row));
  const months = accountingInstallmentMonths(row);
  if (!txDate) return 0;
  if (!months) return txDate >= start && txDate <= end ? amount : 0;
  let total = 0;
  for (let index = 0; index < months; index += 1) {
    const partDate = addMonthsToDate(txDate, index);
    if (partDate >= start && partDate <= end) total += amount / months;
  }
  return total;
}

export function installmentParts(row: Row, amountPick: AmountPick, datePick: DatePick) {
  const txDate = accountingIsoDate(datePick(row));
  const amount = numberValue(amountPick(row));
  const months = accountingInstallmentMonths(row);
  if (!txDate || !months) return [{ date: txDate, amount }];
  return Array.from({ length: months }, (_, index) => ({ date: addMonthsToDate(txDate, index), amount: amount / months }));
}
