import { NextRequest, NextResponse } from "next/server";
import { adjustAccountingCardPoints } from "@/lib/accounting-ledger";
import { FnosDbError } from "@/lib/fnos-db";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(clean(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cardName = clean(body.card_name || body.cardName) || "가온글로벌카드";
    const mode = clean(body.mode) === "set" ? "set" : "use";
    const amount = numberValue(body.amount);
    const point = await adjustAccountingCardPoints(cardName, mode, amount);
    return NextResponse.json({ ok: true, point });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "카드 포인트리 저장 실패" },
      { status },
    );
  }
}
