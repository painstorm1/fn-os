import { NextResponse } from "next/server";
import { selectRows } from "@/lib/fnos-db";
import { FnosDbError } from "@/lib/fnos-db";

export async function GET() {
  try {
    const rules = await selectRows("accounting_category_rules", { order: "priority.asc", limit: 500 });
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 규칙 조회 실패" }, { status });
  }
}

