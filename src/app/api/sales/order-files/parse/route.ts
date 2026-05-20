import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

type SheetName = "송장출력용" | "이카운트_송장입력" | "이카운트 판매입력";

const headers: Record<SheetName, string[]> = {
  송장출력용: ["쇼핑몰코드", "수취인", "수취인연락처1", "수취인연락처2", "우편번호", "주소", "주문옵션", "수량", "배송요청사항", "정산예정금액"],
  이카운트_송장입력: ["쇼핑몰코드", "주문번호", "묶음주문번호", "배송방법코드", "송장번호"],
  "이카운트 판매입력": ["일자", "순번", "거래처코드", "거래처명", "담당자", "출하창고", "거래유형", "통화", "환율", "품목코드", "품목명", "규격", "수량", "단가(vat포함)", "외화금액", "공급가액", "적요", "생산전표생성", "결과"],
};

function clean(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function numberText(value: unknown) {
  const next = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(next) && next !== 0 ? String(Math.round(next)) : clean(value);
}

function dateText(value: unknown) {
  const raw = clean(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  return raw;
}

function hasKeys(row: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(row, key));
}

function pick(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function asRow(row: Record<string, unknown>, sheet: SheetName) {
  return headers[sheet].map((header) => clean(row[header]));
}

function fromDownData(row: Record<string, unknown>) {
  const qty = Number(pick(row, ["수량", "M 수량"]) || 0) || 0;
  const amount = Number(String(pick(row, ["정산예정금액", "공급가액"]) || "").replace(/,/g, "")) || 0;
  const unit = qty ? Math.round(amount / qty) : amount;
  return {
    shipping: [
      clean(pick(row, ["쇼핑몰코드"])),
      clean(pick(row, ["수취인"])),
      clean(pick(row, ["수취인연락처1"])),
      clean(pick(row, ["수취인연락처2"])),
      clean(pick(row, ["우편번호"])),
      clean(pick(row, ["주소"])),
      clean(pick(row, ["주문옵션", "쇼핑몰상품명", "품목명(ERP)"])),
      clean(pick(row, ["수량"])) || "1",
      clean(pick(row, ["배송요청사항"])),
      numberText(pick(row, ["정산예정금액"])),
    ],
    invoice: [
      clean(pick(row, ["쇼핑몰코드"])),
      clean(pick(row, ["주문번호"])),
      clean(pick(row, ["묶음주문번호"])),
      clean(pick(row, ["배송방법코드"])),
      clean(pick(row, ["송장번호"])),
    ],
    sale: [
      dateText(pick(row, ["수집일자", "일자"])),
      "",
      "",
      clean(pick(row, ["쇼핑몰명", "거래처명"])),
      "",
      "100",
      "",
      "",
      "",
      clean(pick(row, ["품목코드(ERP)", "품목코드"])),
      clean(pick(row, ["품목명(ERP)", "품목명"])),
      "",
      clean(pick(row, ["수량"])) || "1",
      unit ? String(unit) : "",
      "",
      amount ? String(Math.round(amount)) : "",
      clean(pick(row, ["주문번호", "주문옵션"])),
      "",
      "",
    ],
  };
}

const knownHeaderNames = [
  ...headers.송장출력용,
  ...headers.이카운트_송장입력,
  ...headers["이카운트 판매입력"],
  "수집처",
  "수집일자",
  "품목코드(ERP)",
  "쇼핑몰상품코드",
  "품목명(ERP)",
  "쇼핑몰품목key",
  "쇼핑몰명",
  "주문상태",
  "상태별처리기능",
];

function rowsFromWorksheet(sheet: XLSX.WorkSheet) {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { defval: "", raw: false, header: 1 });
  const headerIndex = matrix.findIndex((row) => {
    const values = row.map((cell) => clean(cell));
    return values.filter((cell) => knownHeaderNames.includes(cell)).length >= 3;
  });
  if (headerIndex < 0) {
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  }
  const headerRow = matrix[headerIndex].map((cell) => clean(cell));
  return matrix.slice(headerIndex + 1).map((row) => {
    const next: Record<string, unknown> = {};
    headerRow.forEach((header, index) => {
      if (header) next[header] = row[index] ?? "";
    });
    return next;
  });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length) {
      return NextResponse.json({ ok: false, error: "업로드할 파일이 없습니다." }, { status: 400 });
    }

    const result: Record<SheetName, string[][]> = {
      송장출력용: [],
      이카운트_송장입력: [],
      "이카운트 판매입력": [],
    };
    const parsedFiles: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
      parsedFiles.push(file.name);

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rows = rowsFromWorksheet(worksheet).filter((row) => Object.values(row).some((value) => clean(value)));
        if (!rows.length) continue;

        if (sheetName === "송장출력용" || rows.some((row) => hasKeys(row, headers.송장출력용))) {
          result.송장출력용.push(...rows.map((row) => asRow(row, "송장출력용")).filter((row) => row.some(Boolean)));
        }
        if (sheetName === "이카운트_송장입력" || rows.some((row) => hasKeys(row, headers.이카운트_송장입력))) {
          result.이카운트_송장입력.push(...rows.map((row) => asRow(row, "이카운트_송장입력")).filter((row) => row.some(Boolean)));
        }
        if (sheetName === "1_판매입력" || sheetName === "이카운트 판매입력" || rows.some((row) => hasKeys(row, headers["이카운트 판매입력"]))) {
          result["이카운트 판매입력"].push(...rows.map((row) => asRow(row, "이카운트 판매입력")).filter((row) => row.some(Boolean)));
        }
        if (sheetName === "다운_데이터" || rows.some((row) => hasKeys(row, ["수집처", "품목코드(ERP)", "쇼핑몰코드", "수취인"]))) {
          for (const row of rows) {
            const converted = fromDownData(row);
            if (converted.shipping.some(Boolean)) result.송장출력용.push(converted.shipping);
            if (converted.invoice.some(Boolean)) result.이카운트_송장입력.push(converted.invoice);
            if (converted.sale.some(Boolean)) result["이카운트 판매입력"].push(converted.sale);
          }
        }
      }
    }

    return NextResponse.json({ ok: true, files: parsedFiles, sheets: result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "엑셀 파일 파싱 실패" }, { status: 500 });
  }
}
