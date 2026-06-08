import { NextRequest, NextResponse } from "next/server";
import { deactivateAccountingFixedCost, upsertAccountingFixedCost } from "@/lib/accounting-ledger";
import { FnosDbError, selectRows } from "@/lib/fnos-db";

export async function GET() {
  try {
    const fixedCosts = await selectRows("accounting_fixed_costs", { is_active: "eq.true", order: "sort_order.asc", limit: 500 });
    return NextResponse.json({ ok: true, fixed_costs: fixedCosts });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "고정비 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fixedCosts = await upsertAccountingFixedCost(body);
    return NextResponse.json({ ok: true, fixed_costs: fixedCosts });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "고정비 저장 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    const fixedCosts = await deactivateAccountingFixedCost(id);
    return NextResponse.json({ ok: true, mode: "deleted", fixed_costs: fixedCosts });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "고정비 삭제 실패" }, { status });
  }
}
