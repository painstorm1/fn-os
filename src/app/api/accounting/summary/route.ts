import { NextResponse } from "next/server";
import { accountingSummary } from "@/lib/accounting";
import { FnosDbError } from "@/lib/fnos-db";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await accountingSummary()) });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "회계/비용 조회 실패" }, { status });
  }
}
