import { NextRequest, NextResponse } from "next/server";
import { saveArchiveCategory } from "@/lib/archive";
import { deleteRows, FnosDbError } from "@/lib/fnos-db";

function errorResponse(error: unknown, fallback: string) {
  const status = error instanceof FnosDbError ? error.status : 500;
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status });
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ ok: true, saved: await saveArchiveCategory(await request.json()) });
  } catch (error) {
    return errorResponse(error, "카테고리 저장 실패");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ ok: false, error: "삭제할 카테고리 ID가 없습니다." }, { status: 400 });
    return NextResponse.json({ ok: true, deleted: await deleteRows("archive_categories", { id: `eq.${id}` }) });
  } catch (error) {
    return errorResponse(error, "카테고리 삭제 실패");
  }
}
