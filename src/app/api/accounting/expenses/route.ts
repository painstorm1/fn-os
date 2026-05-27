import { NextRequest, NextResponse } from "next/server";
import { createManualExpense } from "@/lib/accounting";
import { FnosDbError } from "@/lib/fnos-db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const saved = await createManualExpense(body);
    return NextResponse.json({ ok: true, expense: saved });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "비용 저장 실패" }, { status });
  }
}
