import { NextRequest, NextResponse } from "next/server";
import { searchAdProducts } from "@/lib/ads-analysis";
import { FnosDbError } from "@/lib/fnos-db";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q") || "";
    return NextResponse.json({ ok: true, products: await searchAdProducts(query) });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "상품 검색 실패" },
      { status },
    );
  }
}
