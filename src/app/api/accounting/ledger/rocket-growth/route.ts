import { NextRequest, NextResponse } from "next/server";
import { listRocketGrowthCosts, upsertRocketGrowthCosts } from "@/lib/accounting-ledger";
import { FnosDbError } from "@/lib/fnos-db";

export async function GET() {
  try {
    const rows = await listRocketGrowthCosts();
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "로켓그로스 비용 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rows = await upsertRocketGrowthCosts(body);
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "로켓그로스 비용 저장 실패" }, { status });
  }
}
