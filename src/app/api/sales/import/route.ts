import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { dashboardSummary, importSalesRows } from "@/lib/sales-inventory";

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
    const result = await importSalesRows(rows, body.source_file_name || body.sourceFileName);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "판매입력 처리 실패" }, { status });
  }
}
