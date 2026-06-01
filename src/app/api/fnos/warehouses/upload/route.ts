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

function warehouseType(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["fulfillment", "풀필먼트", "3pl", "쿠팡", "네이버", "n배송", "rocket"].includes(normalized)) return "fulfillment";
  return "general";
}

function memoText(row: RowObject) {
  const memo = first(row, ["비고", "메모", "적요", "REMARKS"]);
  const address = first(row, ["창고주소", "창고 주소", "주소", "warehouse_address"]);
  const phone = first(row, ["창고연락처", "창고 연락처", "연락처", "warehouse_phone"]);
  const managerName = first(row, ["담당자이름", "담당자 이름", "담당자", "manager_name"]);
  const managerPhone = first(row, ["담당자연락처", "담당자 연락처", "manager_phone"]);
  return [
    memo,
    address ? `창고 주소: ${address}` : "",
    phone ? `창고 연락처: ${phone}` : "",
    managerName ? `담당자 이름: ${managerName}` : "",
    managerPhone ? `담당자 연락처: ${managerPhone}` : "",
  ].filter(Boolean).join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ ok: false, error: "창고 엑셀 파일을 선택해 주세요." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { header: 1, defval: "", raw: false });
    const headerIndex = rows.findIndex((row) => {
      const cells = row.map((cell) => String(cell).trim());
      return cells.some((cell) => ["창고코드", "창고 코드", "창고명", "창고명칭", "WH_CD", "WH_DES"].includes(cell));
    });
    if (headerIndex < 0) {
      return NextResponse.json({ ok: false, error: "창고 헤더를 찾지 못했습니다." }, { status: 400 });
    }

    const headers = rows[headerIndex];
    const normalized = rows
      .slice(headerIndex + 1)
      .map((row) => rowObject(headers, row))
      .map((row) => {
        const code = first(row, ["창고코드", "창고 코드", "코드", "WH_CD", "warehouse_code"]);
        const name = first(row, ["창고명", "창고명칭", "창고", "WH_DES", "warehouse_name"]);
        return {
          warehouse_code: code,
          wh_cd: code,
          warehouse_name: name,
          wh_name: name,
          warehouse_type: warehouseType(first(row, ["속성", "구분", "창고구분", "warehouse_type"])),
          wh_type: warehouseType(first(row, ["속성", "구분", "창고구분", "warehouse_type"])),
          process_name: first(row, ["생산공정명", "생산공정"]),
          outsource_cust_name: first(row, ["외주거래처명", "외주거래처"]),
          memo: memoText(row),
          is_active: boolActive(first(row, ["사용구분", "사용", "상태"])),
          last_synced_at: new Date().toISOString(),
        };
      })
      .filter((row) => row.warehouse_code && row.warehouse_name);

    if (!normalized.length) {
      return NextResponse.json({ ok: false, error: "업로드할 창고 행이 없습니다." }, { status: 400 });
    }

    await upsertRows("warehouses", normalized, "warehouse_code");
    return NextResponse.json({ ok: true, count: normalized.length, sheet: sheetName });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "창고 업로드 실패" },
      { status: 500 },
    );
  }
}
