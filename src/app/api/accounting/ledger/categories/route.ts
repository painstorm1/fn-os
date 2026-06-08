import { NextRequest, NextResponse } from "next/server";
import { selectRows } from "@/lib/fnos-db";
import { FnosDbError } from "@/lib/fnos-db";
import { accountingCategoryUsage, deactivateAccountingCategory, upsertAccountingCategory } from "@/lib/accounting-ledger";

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    if (id && request.nextUrl.searchParams.get("usage") === "1") {
      return NextResponse.json({ ok: true, usage: await accountingCategoryUsage(id) });
    }
    const categories = await selectRows("accounting_categories", { is_active: "eq.true", order: "sort_order.asc", limit: 500 });
    return NextResponse.json({ ok: true, categories });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 카테고리 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const categories = await upsertAccountingCategory(body);
    return NextResponse.json({ ok: true, categories });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 카테고리 저장 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    const categories = await deactivateAccountingCategory(id);
    return NextResponse.json({ ok: true, mode: "deactivated", categories });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 카테고리 비활성화 실패" }, { status });
  }
}
