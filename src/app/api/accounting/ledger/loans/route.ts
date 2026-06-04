import { NextRequest, NextResponse } from "next/server";
import { deactivateAccountingLoan, upsertAccountingLoan } from "@/lib/accounting-ledger";
import { FnosDbError, selectRows } from "@/lib/fnos-db";

export async function GET() {
  try {
    const loans = await selectRows("accounting_loans", { order: "payment_day.asc", limit: 500 });
    return NextResponse.json({ ok: true, loans });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "대출 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const loans = await upsertAccountingLoan(body);
    return NextResponse.json({ ok: true, loans });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "대출 저장 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    const loans = await deactivateAccountingLoan(id);
    return NextResponse.json({ ok: true, mode: "deactivated", loans });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "대출 비활성화 실패" }, { status });
  }
}
