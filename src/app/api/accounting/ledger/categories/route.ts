import { NextResponse } from "next/server";
import { selectRows } from "@/lib/fnos-db";
import { FnosDbError } from "@/lib/fnos-db";

export async function GET() {
  try {
    const categories = await selectRows("accounting_categories", { order: "sort_order.asc", limit: 500 });
    return NextResponse.json({ ok: true, categories });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 카테고리 조회 실패" }, { status });
  }
}

