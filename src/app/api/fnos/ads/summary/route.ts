import { NextResponse } from "next/server";
import { adsSummary } from "@/lib/ads-analysis";
import { FnosDbError } from "@/lib/fnos-db";

export async function GET() {
  try {
    return NextResponse.json(await adsSummary());
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고 분석 조회 실패" },
      { status },
    );
  }
}
