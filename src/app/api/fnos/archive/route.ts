import { NextRequest, NextResponse } from "next/server";
import { createArchiveFileItem, createArchiveItem, listArchiveData, updateArchiveItem } from "@/lib/archive";
import { FnosDbError } from "@/lib/fnos-db";

function errorResponse(error: unknown, fallback: string) {
  const status = error instanceof FnosDbError ? error.status : 500;
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status });
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await listArchiveData()) });
  } catch (error) {
    return errorResponse(error, "아카이브 조회 실패");
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const saved = contentType.includes("multipart/form-data")
      ? await createArchiveFileItem(await request.formData())
      : await createArchiveItem(await request.json());
    return NextResponse.json({ ok: true, saved });
  } catch (error) {
    return errorResponse(error, "아카이브 저장 실패");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ ok: false, error: "수정할 아카이브 ID가 없습니다." }, { status: 400 });
    return NextResponse.json({ ok: true, saved: await updateArchiveItem(id, body) });
  } catch (error) {
    return errorResponse(error, "아카이브 수정 실패");
  }
}
