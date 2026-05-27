import { NextRequest, NextResponse } from "next/server";
import { deleteArchiveLink, saveArchiveLink } from "@/lib/archive";
import { FnosDbError } from "@/lib/fnos-db";

function errorResponse(error: unknown, fallback: string) {
  const status = error instanceof FnosDbError ? error.status : 500;
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status });
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ ok: true, saved: await saveArchiveLink(await request.json()) });
  } catch (error) {
    return errorResponse(error, "아카이브 연결 저장 실패");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ ok: false, error: "삭제할 연결 ID가 없습니다." }, { status: 400 });
    return NextResponse.json({ ok: true, deleted: await deleteArchiveLink(id) });
  } catch (error) {
    return errorResponse(error, "아카이브 연결 삭제 실패");
  }
}
