import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { upsertRows } from "@/lib/fnos-db";

type SheetRow = Array<string | number | boolean | null | undefined>;

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const next = String(value).trim();
  return next ? next : null;
}

function boolActive(value: unknown) {
  const next = String(value || "").trim().toUpperCase();
  if (!next) return true;
  return !["NO", "N", "FALSE", "0", "미사용"].includes(next);
}

function rowObject(headers: SheetRow, row: SheetRow) {
  const result: Record<string, unknown> = {};
  headers.forEach((header, index) => {
    const key = text(header);
    if (key) result[key] = row[index];
  });
  return result;
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
    const headerIndex = rows.findIndex((row) => row.map((cell) => String(cell).trim()).includes("거래처코드"));
    if (headerIndex < 0) {
      return NextResponse.json({ ok: false, error: "거래처코드 헤더를 찾지 못했습니다." }, { status: 400 });
    }

    const headers = rows[headerIndex];
    const normalized = rows
      .slice(headerIndex + 1)
      .map((row) => rowObject(headers, row))
      .map((row) => ({
        cust_code: text(row["거래처코드"]),
        cust_name: text(row["거래처명"]),
        ceo_name: text(row["대표자명"]),
        tel: text(row["전화"]),
        mobile: text(row["모바일"]),
        search_text: text(row["검색창내용"]),
        is_active: boolActive(row["사용구분"]),
        transfer_info: text(row["이체정보"]),
        last_synced_at: new Date().toISOString(),
      }))
      .filter((row) => row.cust_code && row.cust_name);

    if (!normalized.length) {
      return NextResponse.json({ ok: false, error: "업로드할 거래처 행이 없습니다." }, { status: 400 });
    }

    await upsertRows("customers", normalized, "cust_code");
    return NextResponse.json({ ok: true, count: normalized.length, sheet: sheetName });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "거래처 업로드 실패" },
      { status: 500 },
    );
  }
}
