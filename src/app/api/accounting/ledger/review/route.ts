import { NextResponse } from "next/server";
import { selectRows } from "@/lib/fnos-db";
import { FnosDbError } from "@/lib/fnos-db";

export async function GET() {
  try {
    const review = await selectRows("accounting_review_queue", { status: "eq.pending", order: "created_at.desc", limit: 300 });
    return NextResponse.json({ ok: true, review });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "검토필요 큐 조회 실패" }, { status });
  }
}

