import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { searchFnProducts } from "@/lib/import-management";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q") || "";
    const products = await searchFnProducts(query);
    return NextResponse.json({ ok: true, products });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "FN 상품 검색 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
