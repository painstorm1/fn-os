import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, deleteRows, hasDbConfig, selectRows, upsertRows } from "@/lib/fnos-db";

const FALLBACK_SETTING_KEY = "sales_channel_product_mappings_fallback";

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

function isMappingTableUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = error instanceof FnosDbError ? error.status : 0;
  return status === 404 || /sales_channel_product_mappings|DB 테이블|schema_sales_inventory|Could not find the table|schema cache/i.test(message);
}

async function readFallbackMappings() {
  const rows = await selectRows<{ setting_value?: string }>("fnos_settings", {
    setting_key: `eq.${FALLBACK_SETTING_KEY}`,
    limit: 1,
  });
  const raw = rows[0]?.setting_value || "[]";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

async function writeFallbackMappings(rows: Record<string, unknown>[]) {
  await upsertRows(
    "fnos_settings",
    {
      setting_key: FALLBACK_SETTING_KEY,
      setting_value: JSON.stringify(rows),
      memo: "쇼핑몰 코드연결 fallback 저장소",
      updated_at: new Date().toISOString(),
    },
    "setting_key",
  );
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
    if (isMappingTableUnavailable(error)) {
      try {
        const rows = await readFallbackMappings();
        return NextResponse.json({ ok: true, mappings: rows, fallback: true });
      } catch {
        return NextResponse.json({ ok: true, mappings: [], fallback: true });
      }
    }
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "쇼핑몰 코드연결 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const row = normalizeBody(body);
  if (!row.channel_name || !row.mall_product_key || !row.product_code) {
    return NextResponse.json({ ok: false, error: "쇼핑몰명, 쇼핑몰품목key, 품목코드가 필요합니다." }, { status: 400 });
  }

  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const saved = await upsertRows("sales_channel_product_mappings", row, "channel_name,mall_product_key");
    return NextResponse.json({ ok: true, mapping: saved[0] || row });
  } catch (error) {
    if (isMappingTableUnavailable(error)) {
      try {
        const rows = await readFallbackMappings();
        const saved = {
          id: text(body.id) || crypto.randomUUID(),
          ...row,
        };
        const nextRows = rows.filter((item) => {
          return !(text(item.channel_name) === row.channel_name && text(item.mall_product_key) === row.mall_product_key);
        });
        nextRows.unshift(saved);
        await writeFallbackMappings(nextRows);
        return NextResponse.json({ ok: true, mapping: saved, fallback: true });
      } catch (fallbackError) {
        const status = fallbackError instanceof FnosDbError ? fallbackError.status : 500;
        const message = fallbackError instanceof Error ? fallbackError.message : "쇼핑몰 코드연결 저장 실패";
        return NextResponse.json({ ok: false, error: message }, { status });
      }
    }
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "쇼핑몰 코드연결 저장 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const id = text(request.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ ok: false, error: "삭제할 연결 ID가 필요합니다." }, { status: 400 });

  try {
    const deleted = await deleteRows("sales_channel_product_mappings", { id: `eq.${id}` });
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    if (isMappingTableUnavailable(error)) {
      try {
        const rows = await readFallbackMappings();
        const nextRows = rows.filter((row) => text(row.id) !== id);
        await writeFallbackMappings(nextRows);
        return NextResponse.json({ ok: true, deleted: rows.length - nextRows.length, fallback: true });
      } catch (fallbackError) {
        const status = fallbackError instanceof FnosDbError ? fallbackError.status : 500;
        const message = fallbackError instanceof Error ? fallbackError.message : "쇼핑몰 코드연결 삭제 실패";
        return NextResponse.json({ ok: false, error: message }, { status });
      }
    }
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "쇼핑몰 코드연결 삭제 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
