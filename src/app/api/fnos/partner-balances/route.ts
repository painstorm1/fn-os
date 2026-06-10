import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { createManualPartnerOpeningBalance, createManualPartnerPayment, partnerBalanceSummary } from "@/lib/partner-balances";

export async function GET(request: NextRequest) {
  try {
    const mode = request.nextUrl.searchParams.get("mode") === "purchases" ? "purchases" : "sales";
    const month = request.nextUrl.searchParams.get("month") || undefined;
    const customer = request.nextUrl.searchParams.get("customer") || undefined;
    return NextResponse.json({ ok: true, ...(await partnerBalanceSummary({ mode, month, customer })) });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "거래처 잔액 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.kind === "opening_balance") await createManualPartnerOpeningBalance(body);
    else await createManualPartnerPayment(body);
    const mode = body.mode === "purchases" ? "purchases" : "sales";
    const month = typeof body.month === "string" ? body.month : undefined;
    return NextResponse.json({ ok: true, ...(await partnerBalanceSummary({ mode, month })) });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "수동 결제 저장 실패" }, { status });
  }
}
