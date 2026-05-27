import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { bomStatusForImportProduct, listImportProductLinks, saveImportProductLinks } from "@/lib/import-management";

function importProductId(request: NextRequest, body?: Record<string, unknown>) {
  return String(body?.import_product_id || request.nextUrl.searchParams.get("import_product_id") || "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const id = importProductId(request);
    if (!id) return NextResponse.json({ ok: false, error: "import_product_id가 필요합니다." }, { status: 400 });
    const [links, bom] = await Promise.all([
      listImportProductLinks(id),
      bomStatusForImportProduct(id),
    ]);
    return NextResponse.json({ ok: true, links, bom });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "수입관리 SKU 연결 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { import_product_id?: string | number; links?: [] };
    const id = importProductId(request, body);
    if (!id) return NextResponse.json({ ok: false, error: "import_product_id가 필요합니다." }, { status: 400 });
    const saved = await saveImportProductLinks(id, Array.isArray(body.links) ? body.links : []);
    const [links, bom] = await Promise.all([
      listImportProductLinks(id),
      bomStatusForImportProduct(id),
    ]);
    return NextResponse.json({ ok: true, saved_count: saved.length, links, bom });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "수입관리 SKU 연결 저장 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
