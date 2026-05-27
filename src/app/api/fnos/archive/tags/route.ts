import { NextRequest, NextResponse } from "next/server";
import { mergeArchiveTags, saveArchiveTag } from "@/lib/archive";
import { FnosDbError } from "@/lib/fnos-db";

function errorResponse(error: unknown, fallback: string) {
  const status = error instanceof FnosDbError ? error.status : 500;
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === "merge") {
      return NextResponse.json({ ok: true, ...(await mergeArchiveTags(String(body.from_tag_id || ""), String(body.to_tag_id || ""))) });
    }
    return NextResponse.json({ ok: true, saved: await saveArchiveTag(body) });
  } catch (error) {
    return errorResponse(error, "태그 저장 실패");
  }
}
