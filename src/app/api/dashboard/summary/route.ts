import { NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { mainDashboardSummary, salesHistorySummary } from "@/lib/main-dashboard";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const summary = url.searchParams.get("scope") === "sales-history"
      ? await salesHistorySummary()
      : await mainDashboardSummary();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "대시보드 요약 조회 실패" },
      { status },
    );
  }
}
