import * as XLSX from "xlsx";

type RawRow = Record<string, unknown>;
type ExpenseSourceProfile = {
  match: RegExp;
  sourceType: string;
  firstDataRow: number;
  columns: {
    date: number;
    vendor: number;
    amount?: number;
    foreignAmount?: number;
    vat?: number;
    withdraw?: number;
    deposit?: number;
    balance?: number;
    paymentMethod?: number;
    paymentDue?: number;
    approvalNo?: number;
    rewardPoints?: number;
    category: number;
    detail?: number;
    memo?: number;
  };
};

const SOURCE_PROFILES: ExpenseSourceProfile[] = [
  {
    match: /가온\s*\(?\s*글로벌\s*카드\s*\)?|가온글로벌카드|카드이용내역/i,
    sourceType: "가온글로벌카드",
    firstDataRow: 7,
    columns: { date: 0, vendor: 4, amount: 5, foreignAmount: 6, paymentMethod: 7, paymentDue: 12, approvalNo: 13, rewardPoints: 14, category: 15, detail: 16, memo: 17 },
  },
  {
    match: /국민\s*\(?\s*카드\s*\)?|국민기업카드|승인내역조회/i,
    sourceType: "국민기업카드",
    firstDataRow: 6,
    columns: { date: 0, vendor: 6, amount: 10, vat: 11, paymentMethod: 8, approvalNo: 14, category: 24, detail: 25, memo: 26 },
  },
  {
    match: /국민\s*\(?\s*은행\s*\)?|국민\.xls|국민은행|47870101245017/i,
    sourceType: "국민은행",
    firstDataRow: 7,
    columns: { date: 1, vendor: 2, withdraw: 3, deposit: 4, balance: 5, paymentMethod: 8, category: 12, detail: 13, memo: 14 },
  },
  {
    match: /기업\s*\(?\s*은행\s*\)?|거래내역조회.*입출식|기업|입출식/i,
    sourceType: "기업은행",
    firstDataRow: 3,
    columns: { date: 1, vendor: 5, withdraw: 2, deposit: 3, balance: 4, paymentMethod: 9, category: 14, detail: 15, memo: 16 },
  },
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function pick(row: RawRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && clean(value) !== "") return value;
  }
  return "";
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

function inferSourceType(fileName: string, fallback: string) {
  const profile = SOURCE_PROFILES.find((item) => item.match.test(fileName));
  if (profile) return profile.sourceType;
  const name = fileName.toLowerCase();
  const compact = name.replace(/\s+/g, "").replace(/[()[\]{}_-]/g, "");
  if (/카드이용내역.*가온|가온.*글로벌.*카드|가온글로벌카드/.test(compact)) return "가온글로벌카드";
  if (/승인내역조회.*국민|국민.*카드|kb.*card|kbcard|국민카드/.test(compact)) return "국민기업카드";
  if (/47870101245017|국민.*은행|kb.*bank|kbbank|국민은행/.test(compact)) return "국민은행";
  if (/거래내역조회.*입출식.*기업|기업.*은행|ibk|기업은행/.test(compact)) return "기업은행";
  if (/세금계산서|전자세금|tax/.test(name)) return "세금계산서";
  if (/광고|ad|ads|naver|meta|google/.test(name)) return "광고비";
  if (/택배|배송|운임|물류|cj|대한통운/.test(name)) return "택배비";
  return fallback;
}

function usableSourceType(value: unknown) {
  const sourceType = clean(value);
  if (!sourceType || /^auto$/i.test(sourceType) || sourceType === "자동 분류") return "";
  return sourceType;
}

function colName(index: number) {
  return XLSX.utils.encode_col(index);
}

function fileDateBounds(fileName: string) {
  const matches = Array.from(fileName.matchAll(/(20\d{2})(\d{2})(\d{2})/g))
    .map((match) => formatDate(Number(match[1]), Number(match[2]), Number(match[3])))
    .filter((date) => !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()));
  return { start: matches[0] || "", end: matches[matches.length - 1] || matches[0] || "" };
}

function normalizeProfileDate(value: unknown, fileName: string) {
  const raw = clean(value);
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(raw)) return isoDate(raw);
  const monthDay = /^(\d{1,2})[./-](\d{1,2})/.exec(raw);
  if (!monthDay) return "";
  const { start, end } = fileDateBounds(fileName);
  const startYear = Number(start.slice(0, 4)) || new Date().getFullYear();
  const endYear = Number(end.slice(0, 4)) || startYear;
  const month = Number(monthDay[1]);
  const day = Number(monthDay[2]);
  for (let year = startYear; year <= endYear; year += 1) {
    const candidate = formatDate(year, month, day);
    if ((!start || candidate >= start) && (!end || candidate <= end)) return candidate;
  }
  return formatDate(startYear, month, day);
}

function numberValue(value: unknown) {
  const parsed = Number(clean(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown) {
  const raw = clean(value);
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

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cardPaymentDue(sourceType: string, value: unknown) {
  const date = isoDate(value);
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  if (sourceType === "가온글로벌카드") {
    const dueMonth = day >= 22 ? addMonths(year, month, 2) : addMonths(year, month, 1);
    return formatDate(dueMonth.year, dueMonth.month, 5);
  }
  if (sourceType === "국민기업카드") {
    const dueMonth = day >= 6 ? addMonths(year, month, 1) : { year, month };
    return formatDate(dueMonth.year, dueMonth.month, 20);
  }
  return "";
}

function profileRowsFromWorksheet(sheet: XLSX.WorkSheet, profile: ExpenseSourceProfile, fileName: string) {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  const rows: RawRow[] = [];
  for (let index = profile.firstDataRow; index < matrix.length; index += 1) {
    const row = matrix[index] || [];
    const expenseDate = normalizeProfileDate(row[profile.columns.date], fileName);
    if (!expenseDate) continue;
    const withdraw = profile.columns.withdraw !== undefined ? row[profile.columns.withdraw] : "";
    const deposit = profile.columns.deposit !== undefined ? row[profile.columns.deposit] : "";
    const hasDeposit = clean(deposit) && clean(deposit) !== "0";
    const hasWithdraw = clean(withdraw) && clean(withdraw) !== "0";
    const primaryAmount = profile.columns.amount !== undefined ? row[profile.columns.amount] : hasDeposit ? deposit : withdraw;
    const foreignAmount = profile.columns.foreignAmount !== undefined ? row[profile.columns.foreignAmount] : "";
    const amount = primaryAmount;
    const direction = hasDeposit ? "입금" : hasWithdraw ? "출금" : "";
    const category = clean(row[profile.columns.category]) || direction;
    const detail = profile.columns.detail !== undefined ? clean(row[profile.columns.detail]) : "";
    const memo = profile.columns.memo !== undefined ? clean(row[profile.columns.memo]) : "";
    const rawByColumn: RawRow = {};
    row.forEach((value, colIndex) => {
      if (clean(value)) rawByColumn[colName(colIndex)] = value;
    });
    rows.push({
      ...rawByColumn,
      expense_date: expenseDate,
      vendor_name: row[profile.columns.vendor],
      description: [row[profile.columns.vendor], detail, memo].map(clean).filter(Boolean).join(" / "),
      amount,
      total_amount: amount,
      vat_amount: profile.columns.vat !== undefined ? row[profile.columns.vat] : "",
      payment_method: profile.columns.paymentMethod !== undefined ? row[profile.columns.paymentMethod] : "",
      payment_due_date: profile.columns.paymentDue !== undefined ? row[profile.columns.paymentDue] : cardPaymentDue(profile.sourceType, expenseDate),
      approval_no: profile.columns.approvalNo !== undefined ? row[profile.columns.approvalNo] : "",
      reward_points: profile.columns.rewardPoints !== undefined ? row[profile.columns.rewardPoints] : "",
      foreign_amount: foreignAmount,
      currency_hint: profile.columns.foreignAmount !== undefined && numberValue(primaryAmount) === 0 && numberValue(foreignAmount) > 0 ? "foreign" : "KRW",
      category,
      category_detail: detail,
      category_memo: memo,
      cash_direction: direction,
      balance_amount: profile.columns.balance !== undefined ? row[profile.columns.balance] : "",
      source_row_no: index + 1,
    });
  }
  return rows;
}

function rowsFromWorksheet(sheet: XLSX.WorkSheet, fileName: string) {
  const profile = SOURCE_PROFILES.find((item) => item.match.test(fileName));
  if (profile) return profileRowsFromWorksheet(sheet, profile, fileName);
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "", raw: false }).filter((row) =>
    Object.values(row).some((value) => clean(value)),
  );
}

export async function parseExpenseFiles(files: File[], sourceType: string, fileSourceTypes: string[] = []) {
  const rows: RawRow[] = [];
  const filesSummary: Array<{ name: string; source_type: string; sheet_count: number; row_count: number }> = [];

  for (const [fileIndex, file] of files.entries()) {
    const fileSourceType = usableSourceType(fileSourceTypes[fileIndex]) || inferSourceType(file.name, usableSourceType(sourceType) || "auto");
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    let fileRowCount = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheetRows = rowsFromWorksheet(workbook.Sheets[sheetName], file.name);
      fileRowCount += sheetRows.length;
      sheetRows.forEach((row, index) => {
        const vendor = clean(pick(row, ["vendor_name", "거래처", "업체명", "가맹점명", "상호", "적요", "받는분", "사용처"]));
        const description = clean(pick(row, ["description", "내용", "품목", "메모", "적요", "이용내역", "거래내용"]));
        rows.push({
          ...row,
          source_type: fileSourceType,
          source_file_name: file.name,
          source_sheet_name: sheetName,
          source_row_no: index + 2,
          category: clean(pick(row, ["category", "카테고리", "분류"])) || classifyExpense(vendor, description, fileSourceType),
        });
      });
    }

    filesSummary.push({ name: file.name, source_type: fileSourceType, sheet_count: workbook.SheetNames.length, row_count: fileRowCount });
  }

  return { rows, files: filesSummary };
}
