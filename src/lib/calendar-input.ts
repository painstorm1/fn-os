export type CalendarInputMode = "date" | "month";

function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeCalendarInput(
  value: string | null | undefined,
  mode: CalendarInputMode,
  min?: string,
  max?: string,
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const pattern = mode === "date"
    ? /^(?:(\d{4})(\d{2})(\d{2})|(\d{4})[/-](\d{2})[/-](\d{2}))$/
    : /^(?:(\d{4})(\d{2})|(\d{4})[/-](\d{2}))$/;
  const match = raw.match(pattern);
  if (!match) return null;
  const year = Number(mode === "date" ? match[1] || match[4] : match[1] || match[3]);
  const month = Number(mode === "date" ? match[2] || match[5] : match[2] || match[4]);
  const day = mode === "date" ? Number(match[3] || match[6]) : 0;
  if (year < 1 || month < 1 || month > 12 || (mode === "date" && (day < 1 || day > daysInMonth(year, month)))) return null;
  const normalized = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}${mode === "date" ? `-${String(day).padStart(2, "0")}` : ""}`;
  if ((min && normalized < min) || (max && normalized > max)) return null;
  return normalized;
}

export function formatCalendarInputValue(value: string | null | undefined, mode: CalendarInputMode) {
  const normalized = normalizeCalendarInput(value, mode);
  return normalized ? normalized.replaceAll("-", "/") : "";
}
