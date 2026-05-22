import { NextResponse } from "next/server";
import { FnosDbError, selectRows } from "@/lib/fnos-db";

export async function GET() {
  try {
    const inventory = await selectRows("inventory_current", { order: "synced_at.desc", limit: 500 });
    return NextResponse.json({ ok: true, inventory });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "재고 조회 실패" }, { status });
  }
}
