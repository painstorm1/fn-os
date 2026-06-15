import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, deleteRows, hasDbConfig, selectRows, upsertRows } from "@/lib/fnos-db";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeBody(body: Record<string, unknown>) {
  const productCode = text(body.product_code || body.productCode);
  const mallProductKey = text(body.mall_product_key || body.mallProductKey);
  const channelName = text(body.channel_name || body.channelName || body.mall_name || body.mallName);
  return {
    channel_name: channelName,
    channel_code: text(body.channel_code || body.channelCode),
    mall_product_code: text(body.mall_product_code || body.mallProductCode),
    mall_product_key: mallProductKey,
    mall_product_name: text(body.mall_product_name || body.mallProductName),
    fn_product_id: text(body.fn_product_id || body.fnProductId) || null,
    product_code: productCode,
    product_name: text(body.product_name || body.productName),
    source_type: text(body.source_type || body.sourceType) || "online_orders",
    updated_at: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const limit = request.nextUrl.searchParams.get("limit") || "5000";
    const rows = await selectRows("sales_channel_product_mappings", {
      order: "updated_at.desc",
      limit,
    });
    return NextResponse.json({ ok: true, mappings: rows });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "쇼핑몰 코드연결 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const row = normalizeBody(body);
    if (!row.channel_name || !row.mall_product_key || !row.product_code) {
      return NextResponse.json({ ok: false, error: "쇼핑몰명, 쇼핑몰품목key, 품목코드가 필요합니다." }, { status: 400 });
    }
    const saved = await upsertRows("sales_channel_product_mappings", row, "channel_name,mall_product_key");
    return NextResponse.json({ ok: true, mapping: saved[0] || row });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "쇼핑몰 코드연결 저장 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = text(request.nextUrl.searchParams.get("id"));
    if (!id) return NextResponse.json({ ok: false, error: "삭제할 연결 ID가 필요합니다." }, { status: 400 });
    const deleted = await deleteRows("sales_channel_product_mappings", { id: `eq.${id}` });
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "쇼핑몰 코드연결 삭제 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
