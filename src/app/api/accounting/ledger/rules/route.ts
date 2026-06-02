import { NextRequest, NextResponse } from "next/server";
import { selectRows } from "@/lib/fnos-db";
import { FnosDbError } from "@/lib/fnos-db";
import { deactivateAccountingRule, upsertAccountingRule } from "@/lib/accounting-ledger";

export async function GET() {
  try {
    const rules = await selectRows("accounting_category_rules", { order: "priority.asc", limit: 500 });
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 규칙 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rules = await upsertAccountingRule(body);
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 규칙 저장 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    const rules = await deactivateAccountingRule(id);
    return NextResponse.json({ ok: true, mode: "deactivated", rules });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 규칙 비활성화 실패" }, { status });
  }
}
