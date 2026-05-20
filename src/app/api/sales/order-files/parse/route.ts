import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

type SheetName = "송장출력용" | "이카운트_송장입력" | "이카운트_판매입력";

const headers: Record<SheetName, string[]> = {
  송장출력용: ["쇼핑몰코드", "수취인", "수취인연락처1", "수취인연락처2", "우편번호", "주소", "주문옵션", "수량", "배송요청사항", "정산예정금액"],
  이카운트_송장입력: ["쇼핑몰코드", "주문번호", "묶음주문번호", "배송방법코드", "송장번호"],
  이카운트_판매입력: ["일자", "순번", "거래처코드", "거래처명", "담당자", "출하창고", "거래유형", "통화", "환율", "품목코드", "품목명", "규격", "수량", "단가(vat포함)", "외화금액", "공급가액", "적요", "생산전표생성", "결과"],
};

function clean(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseNumber(value: unknown) {
  const next = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(next) ? next : 0;
}

function comma(value: unknown) {
  const number = parseNumber(value);
  if (!number) return clean(value);
  return Math.round(number).toLocaleString("ko-KR");
}

function dateDigits(value: unknown) {
  const raw = clean(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  return raw;
}

function monthDay(value: unknown) {
  const digits = dateDigits(value);
  if (digits.length >= 8) return `${digits.slice(4, 6)}${digits.slice(6, 8)}`;
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function pick(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && clean(value) !== "") return value;
  }
  return "";
}

function hasKeys(row: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(row, key));
}

function asRow(row: Record<string, unknown>, sheet: SheetName) {
  return headers[sheet].map((header) => clean(row[header]));
}

function mallAlias(mallName: string, mallCode: string) {
  const name = mallName.toLowerCase();
  if (name.includes("펀앤파인")) return "FF";
  if (name.includes("에프엔") || name.includes("fn")) return "FN";
  if (name.includes("쿠팡")) return "C";
  if (name.includes("11번가") || name.includes("11st")) return "11";
  if (name.includes("토스")) return "T";
  if (name.includes("현대") || name.includes("이지웰")) return "Z";
  if (name.includes("오늘의집") || name.includes("오늘")) return "O";
  return clean(mallCode) || "FN";
}

function makeOrderOption(row: Record<string, unknown>) {
  const qty = Math.max(1, Math.round(parseNumber(pick(row, ["수량", "M 수량"]))) || 1);
  const name = clean(pick(row, ["품목명(ERP)", "품목명", "주문옵션", "쇼핑몰상품명"]));
  return qty > 1 ? `${name}-★${qty}개` : name;
}

function isValidDownRow(row: Record<string, unknown>) {
  const product = clean(pick(row, ["품목코드(ERP)", "품목코드", "품목명(ERP)", "품목명"]));
  const recipient = clean(pick(row, ["수취인"]));
  const orderNo = clean(pick(row, ["주문번호", "묶음주문번호"]));
  return Boolean(product && recipient && orderNo);
}

function buildFromDownRows(rows: Record<string, unknown>[]) {
  const counters = new Map<string, number>();
  const shipping: Array<{ sortKey: string; row: string[] }> = [];
  const invoice: string[][] = [];
  const sale: string[][] = [];

  for (const source of rows) {
    if (!isValidDownRow(source)) continue;

    const mallName = clean(pick(source, ["쇼핑몰명", "거래처명"]));
    const mallCode = clean(pick(source, ["쇼핑몰코드"]));
    const date = pick(source, ["수집일자", "일자"]);
    const alias = mallAlias(mallName, mallCode);
    const countKey = `${monthDay(date)}-${alias}`;
    const next = (counters.get(countKey) || 0) + 1;
    counters.set(countKey, next);

    const qty = Math.max(1, parseNumber(pick(source, ["수량", "M 수량"])) || 1);
    const amount = parseNumber(pick(source, ["정산예정금액", "공급가액"]));
    const unit = qty ? amount / qty : amount;
    const contact1 = clean(pick(source, ["수취인연락처1"]));
    const contact2 = clean(pick(source, ["수취인연락처2"])) || contact1;
    const option = makeOrderOption(source);

    shipping.push({
      sortKey: `${option}\u0000${countKey}-${String(next).padStart(3, "0")}`,
      row: [
        `${countKey}-A${String(next).padStart(3, "0")}`,
        clean(pick(source, ["수취인"])),
        contact1,
        contact2,
        clean(pick(source, ["우편번호"])),
        clean(pick(source, ["주소"])),
        option,
        "1",
        clean(pick(source, ["배송요청사항"])),
        comma(amount),
      ],
    });

    invoice.push([
      mallCode,
      clean(pick(source, ["주문번호"])),
      clean(pick(source, ["묶음주문번호"])),
      clean(pick(source, ["배송방법코드"])),
      "",
    ]);

    sale.push([
      dateDigits(date),
      "",
      "",
      mallName,
      "",
      "100",
      "",
      "",
      "",
      clean(pick(source, ["품목코드(ERP)", "품목코드"])),
      "",
      "",
      clean(pick(source, ["수량"])) || "1",
      unit ? comma(unit) : "",
      "",
      amount ? comma(amount) : "",
      "",
      "Y",
      "",
    ]);
  }

  return {
    shipping: shipping
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ko"))
      .map((item) => item.row),
    invoice,
    sale,
  };
}

const knownHeaderNames = [
  ...headers.송장출력용,
  ...headers.이카운트_송장입력,
  ...headers.이카운트_판매입력,
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
      이카운트_판매입력: [],
    };
    const downRows: Record<string, unknown>[] = [];
    const parsedFiles: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
      parsedFiles.push(file.name);

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rows = rowsFromWorksheet(worksheet).filter((row) => Object.values(row).some((value) => clean(value)));
        if (!rows.length) continue;

        const isDownData = sheetName === "다운_데이터" || sheetName === "주문관리진행단계" || rows.some((row) => hasKeys(row, ["수집처", "품목코드(ERP)", "쇼핑몰상품코드", "쇼핑몰품목key"]));
        if (isDownData) {
          downRows.push(...rows);
          continue;
        }

        if (sheetName === "송장출력용" || rows.some((row) => hasKeys(row, headers.송장출력용))) {
          result.송장출력용.push(...rows.map((row) => asRow(row, "송장출력용")).filter((row) => row.some(Boolean)));
        }
        if (sheetName === "이카운트_송장입력" || rows.some((row) => hasKeys(row, headers.이카운트_송장입력))) {
          result.이카운트_송장입력.push(...rows.map((row) => asRow(row, "이카운트_송장입력")).filter((row) => row.some(Boolean)));
        }
        if (sheetName === "1_판매입력" || sheetName === "이카운트_판매입력" || sheetName === "이카운트 판매입력" || rows.some((row) => hasKeys(row, headers.이카운트_판매입력))) {
          result.이카운트_판매입력.push(...rows.map((row) => asRow(row, "이카운트_판매입력")).filter((row) => row.some(Boolean)));
        }
      }
    }

    if (downRows.length) {
      const converted = buildFromDownRows(downRows);
      result.송장출력용.push(...converted.shipping);
      result.이카운트_송장입력.push(...converted.invoice);
      result.이카운트_판매입력.push(...converted.sale);
    }

    return NextResponse.json({ ok: true, files: parsedFiles, sheets: result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "엑셀 파일 파싱 실패" }, { status: 500 });
  }
}
