import { NextRequest, NextResponse } from "next/server";
import { selectRows } from "@/lib/fnos-db";
import { FnosDbError } from "@/lib/fnos-db";
import { resolveAccountingReview } from "@/lib/accounting-ledger";

export async function GET() {
  try {
    const review = await selectRows("accounting_review_queue", { status: "eq.pending", order: "created_at.desc", limit: 300 });
    return NextResponse.json({ ok: true, review });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "검토필요 큐 조회 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const transactions = await resolveAccountingReview(body);
    return NextResponse.json({ ok: true, transactions });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "검토필요 거래 저장 실패" }, { status });
  }
}
