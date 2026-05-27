import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { createImportReceipt } from "@/lib/import-management";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await createImportReceipt(body);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "수입관리 구매/입고 반영 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
