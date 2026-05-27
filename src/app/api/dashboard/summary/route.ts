import { NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { mainDashboardSummary } from "@/lib/main-dashboard";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await mainDashboardSummary()) });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "대시보드 요약 조회 실패" },
      { status },
    );
  }
}
