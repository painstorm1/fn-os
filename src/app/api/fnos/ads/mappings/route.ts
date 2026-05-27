import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, selectRows } from "@/lib/fnos-db";
import { saveAdMapping } from "@/lib/ads-analysis";

export async function GET() {
  try {
    const mappings = await selectRows("ad_product_mappings", { order: "updated_at.desc", limit: 1000 });
    return NextResponse.json({ ok: true, mappings });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고 매핑 조회 실패" },
      { status },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const saved = await saveAdMapping(body);
    return NextResponse.json({ ok: true, saved });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고 매핑 저장 실패" },
      { status },
    );
  }
}
