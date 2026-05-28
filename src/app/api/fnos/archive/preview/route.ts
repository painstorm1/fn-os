import { NextRequest, NextResponse } from "next/server";
import { generateArchivePreview, processPendingArchivePreviews } from "@/lib/archive-preview";
import { FnosDbError } from "@/lib/fnos-db";

function errorResponse(error: unknown) {
  const status = error instanceof FnosDbError ? error.status : 500;
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "미리보기 생성 실패" }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "");
    if (id) {
      return NextResponse.json({ ok: true, saved: await generateArchivePreview(id, { force: body.force === true }) });
    }
    const limit = Math.min(Math.max(Number(body.limit || 5), 1), 20);
    return NextResponse.json({ ok: true, saved: await processPendingArchivePreviews(limit) });
  } catch (error) {
    return errorResponse(error);
  }
}
