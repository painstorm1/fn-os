import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { syncProducts } from "@/lib/sales-inventory";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}));
    return NextResponse.json(await syncProducts(payload));
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "품목 동기화 실패" }, { status });
  }
}

