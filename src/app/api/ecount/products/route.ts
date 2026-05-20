import { NextResponse } from "next/server";
import { FnosDbError, selectRows } from "@/lib/fnos-db";

export async function GET() {
  try {
    const products = await selectRows("products", { order: "prod_name.asc", limit: 500 });
    return NextResponse.json({ ok: true, products });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "품목 조회 실패" }, { status });
  }
}

