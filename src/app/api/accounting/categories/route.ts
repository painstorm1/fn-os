import { NextRequest, NextResponse } from "next/server";
import { ensureExpenseCategories, removeExpenseCategory, upsertExpenseCategory } from "@/lib/accounting";
import { FnosDbError } from "@/lib/fnos-db";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, categories: await ensureExpenseCategories() });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "카테고리 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const category = await upsertExpenseCategory(body);
    return NextResponse.json({ ok: true, category });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "카테고리 저장 실패" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const category = await upsertExpenseCategory(body);
    return NextResponse.json({ ok: true, category });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "카테고리 수정 실패" }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    const result = await removeExpenseCategory(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "카테고리 삭제 실패" }, { status });
  }
}
