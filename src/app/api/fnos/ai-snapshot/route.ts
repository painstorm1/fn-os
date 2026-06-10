import { NextRequest, NextResponse } from "next/server";
import { buildAiSnapshot } from "@/lib/ai-snapshot";
import { FnosDbError } from "@/lib/fnos-db";

function boolParam(value: string | null) {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const result = await buildAiSnapshot({
      from: searchParams.get("from") || undefined,
      to: searchParams.get("to") || undefined,
      source: searchParams.get("source") || undefined,
      save: boolParam(searchParams.get("save")),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AI 분석용 스냅샷 생성 실패" },
      { status },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await buildAiSnapshot({
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
      source: typeof body.source === "string" ? body.source : "manual",
      save: true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AI 분석용 스냅샷 저장 실패" },
      { status },
    );
  }
}
