import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { upsertRows } from "@/lib/fnos-db";

type SheetRow = Array<string | number | boolean | null | undefined>;
type RowObject = Record<string, unknown>;

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const next = String(value).trim();
  return next ? next : null;
}

function boolActive(value: unknown) {
  const next = String(value || "").trim().toUpperCase();
  if (!next) return true;
  return !["NO", "N", "FALSE", "0", "미사용", "중단"].includes(next);
}

function rowObject(headers: SheetRow, row: SheetRow) {
  const result: RowObject = {};
  headers.forEach((header, index) => {
    const key = text(header);
    if (key) result[key] = row[index];
  });
  return result;
}

function first(row: RowObject, keys: string[]) {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ ok: false, error: "거래처 엑셀 파일을 선택해 주세요." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { header: 1, defval: "", raw: false });
    const headerIndex = rows.findIndex((row) => {
      const cells = row.map((cell) => String(cell).trim());
      return cells.some((cell) => ["거래처코드", "거래처 코드", "거래처명", "거래처명칭", "CUST", "CUST_NAME"].includes(cell));
    });
    if (headerIndex < 0) {
      return NextResponse.json({ ok: false, error: "거래처 헤더를 찾지 못했습니다." }, { status: 400 });
    }

    const headers = rows[headerIndex];
    const normalized = rows
      .slice(headerIndex + 1)
      .map((row) => rowObject(headers, row))
      .map((row) => {
        const code = first(row, ["거래처코드", "거래처 코드", "코드", "CUST", "BUSINESS_NO", "customer_code"]);
        const name = first(row, ["거래처명", "거래처명칭", "거래처", "상호", "CUST_NAME", "customer_name"]);
        return {
          customer_code: code,
          cust_code: code,
          customer_name: name,
          cust_name: name,
          business_no: first(row, ["사업자번호", "사업자등록번호", "BUSINESS_NO"]),
          ceo_name: first(row, ["대표자", "대표자명"]),
          contact_name: first(row, ["담당자", "연락담당자"]),
          phone: first(row, ["전화", "전화번호", "연락처", "휴대폰", "TEL"]),
          fax: first(row, ["팩스", "팩스번호", "FAX"]),
          email: first(row, ["이메일", "Email", "E-mail", "EMAIL"]),
          memo: first(row, ["비고", "메모", "적요", "REMARKS"]),
          search_text: first(row, ["검색창내용", "검색내용"]),
          is_active: boolActive(first(row, ["사용구분", "사용", "상태"])),
          last_synced_at: new Date().toISOString(),
        };
      })
      .filter((row) => row.customer_code && row.customer_name);

    if (!normalized.length) {
      return NextResponse.json({ ok: false, error: "업로드할 거래처 행이 없습니다." }, { status: 400 });
    }

    await upsertRows("customers", normalized, "customer_code");
    return NextResponse.json({ ok: true, count: normalized.length, sheet: sheetName });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "거래처 업로드 실패" },
      { status: 500 },
    );
  }
}
