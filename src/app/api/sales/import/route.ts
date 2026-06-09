import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { dashboardSummary, deleteEntryGroups, importReturnExchangeRows, importSalesRows, updateEntryGroup } from "@/lib/sales-inventory";

export async function GET() {
  try {
    const summary = await dashboardSummary();
    return NextResponse.json({ ok: true, sales: summary.recent_sales });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "판매내역 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rows = Array.isArray(body) ? body : body.rows || body.sales || body.SaleList || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "rows 배열이 필요합니다." }, { status: 400 });
    }
    const sourceFileName = body.source_file_name || body.sourceFileName;
    const result = /RETURN_EXCHANGE|RETURN|EXCHANGE/i.test(String(sourceFileName || ""))
      ? await importReturnExchangeRows(rows, sourceFileName)
      : await importSalesRows(rows, sourceFileName);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "판매입력 처리 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const groupKey = String(body.group_key || body.groupKey || "");
    if (!groupKey) return NextResponse.json({ ok: false, error: "group_key is required." }, { status: 400 });
    const rows = await updateEntryGroup("sales", groupKey, body.values || body);
    return NextResponse.json({ ok: true, updated_count: rows.length, rows });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "판매입력 수정 실패" }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const groupKeys = Array.isArray(body.group_keys) ? body.group_keys.map(String) : body.group_key ? [String(body.group_key)] : [];
    if (!groupKeys.length) return NextResponse.json({ ok: false, error: "group_keys is required." }, { status: 400 });
    const rows = await deleteEntryGroups("sales", groupKeys);
    return NextResponse.json({ ok: true, deleted_count: rows.length });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "판매입력 삭제 실패" }, { status });
  }
}
