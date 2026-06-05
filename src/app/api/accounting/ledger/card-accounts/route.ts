import { NextRequest, NextResponse } from "next/server";
import { deactivateAccountingCardAccount, upsertAccountingCardAccount } from "@/lib/accounting-ledger";
import { FnosDbError, selectRows } from "@/lib/fnos-db";

export async function GET() {
  try {
    const cardAccounts = await selectRows("accounting_card_accounts", {
      select: "id,card_type,card_name,card_number,expiry_date,cvc_hint,secure_message,payment_password_hint,cutoff_start_day,cutoff_end_day,payment_day,card_limit,withdrawal_account_name,list_enabled,physical_owner,memo,sort_order,is_active",
      or: "(is_active.is.null,is_active.eq.true)",
      order: "sort_order.asc",
      limit: 500,
    });
    return NextResponse.json({ ok: true, card_accounts: cardAccounts });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "카드 설정 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cardAccounts = await upsertAccountingCardAccount(body);
    return NextResponse.json({ ok: true, card_accounts: cardAccounts });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "카드 설정 저장 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    const cardAccounts = await deactivateAccountingCardAccount(id);
    return NextResponse.json({ ok: true, mode: "deactivated", card_accounts: cardAccounts });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "카드 설정 비활성화 실패" }, { status });
  }
}
