import { NextRequest, NextResponse } from "next/server";
import { accountingLedgerSummary } from "@/lib/accounting-ledger";
import { FnosDbError } from "@/lib/fnos-db";

export async function GET(request: NextRequest) {
  try {
    const from = request.nextUrl.searchParams.get("from") || "";
    const to = request.nextUrl.searchParams.get("to") || "";
    return NextResponse.json({ ok: true, ...(await accountingLedgerSummary({ from, to })) });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "통합 회계 요약 조회 실패" },
      { status },
    );
  }
}

