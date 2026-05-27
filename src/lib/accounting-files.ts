import * as XLSX from "xlsx";

type RawRow = Record<string, unknown>;

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

function rowsFromWorksheet(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "", raw: false }).filter((row) =>
    Object.values(row).some((value) => clean(value)),
  );
}

export async function parseExpenseFiles(files: File[], sourceType: string) {
  const rows: RawRow[] = [];
  const filesSummary: Array<{ name: string; sheet_count: number; row_count: number }> = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    let fileRowCount = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheetRows = rowsFromWorksheet(workbook.Sheets[sheetName]);
      fileRowCount += sheetRows.length;
      sheetRows.forEach((row, index) => {
        const vendor = clean(pick(row, ["vendor_name", "거래처", "업체명", "가맹점명", "상호", "적요", "받는분", "사용처"]));
        const description = clean(pick(row, ["description", "내용", "품목", "메모", "적요", "이용내역", "거래내용"]));
        rows.push({
          ...row,
          source_file_name: file.name,
          source_sheet_name: sheetName,
          source_row_no: index + 2,
          category: clean(pick(row, ["category", "카테고리", "분류"])) || classifyExpense(vendor, description, sourceType),
        });
      });
    }

    filesSummary.push({ name: file.name, sheet_count: workbook.SheetNames.length, row_count: fileRowCount });
  }

  return { rows, files: filesSummary };
}
