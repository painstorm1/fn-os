import { NextRequest, NextResponse } from "next/server";
import { deactivateAccountingBankAccount, upsertAccountingBankAccount } from "@/lib/accounting-ledger";
import { FnosDbError, selectRows } from "@/lib/fnos-db";

export async function GET() {
  try {
    const bankAccounts = await selectRows("accounting_bank_accounts", { or: "(is_active.is.null,is_active.eq.true)", order: "sort_order.asc", limit: 500 });
    return NextResponse.json({ ok: true, bank_accounts: bankAccounts });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통장 설정 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bankAccounts = await upsertAccountingBankAccount(body);
    return NextResponse.json({ ok: true, bank_accounts: bankAccounts });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통장 설정 저장 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    const bankAccounts = await deactivateAccountingBankAccount(id);
    return NextResponse.json({ ok: true, mode: "deactivated", bank_accounts: bankAccounts });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통장 설정 비활성화 실패" }, { status });
  }
}
