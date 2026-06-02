import { NextRequest, NextResponse } from "next/server";
import { updateAccountingTransaction } from "@/lib/accounting-ledger";
import { FnosDbError, selectRows } from "@/lib/fnos-db";

export async function GET(request: NextRequest) {
  try {
    const limit = request.nextUrl.searchParams.get("limit") || "300";
    const transactions = await selectRows("accounting_transactions", {
      is_active: "eq.true",
      order: "transaction_date.desc",
      limit,
    });
    return NextResponse.json({ ok: true, transactions });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "거래 DB 조회 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const id = String(body.id || body.transaction_id || body.transactionId || "").trim();
    const transactions = await updateAccountingTransaction(id, body);
    return NextResponse.json({ ok: true, transactions });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "거래 DB 저장 실패" }, { status });
  }
}
