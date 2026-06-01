import { NextRequest, NextResponse } from "next/server";
import { deleteRows, FnosDbError, hasDbConfig, patchRows, selectRows, upsertRows } from "@/lib/fnos-db";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function boolActive(value: unknown) {
  const next = String(value || "").trim().toUpperCase();
  if (!next) return true;
  return !["NO", "N", "FALSE", "0", "미사용", "중단", "DELETED"].includes(next);
}

function warehouseCode(row: AnyRecord) {
  return text(row.warehouse_code || row.wh_cd);
}

function warehouseName(row: AnyRecord) {
  return text(row.warehouse_name || row.wh_name);
}

function normalizeWarehouseType(value: unknown) {
  const normalized = text(value).toLowerCase();
  if (["fulfillment", "풀필먼트", "3pl", "쿠팡", "네이버", "n배송", "rocket"].includes(normalized)) return "fulfillment";
  return "general";
}

function warehouseTypeLabel(value: unknown) {
  return normalizeWarehouseType(value) === "fulfillment" ? "풀필먼트" : "일반";
}

function matches(values: unknown[], query: string) {
  if (!query) return true;
  const needle = query.toLowerCase().replace(/\s+/g, "");
  return values.some((value) => text(value).toLowerCase().replace(/\s+/g, "").includes(needle));
}

function inventoryWarehouseCode(row: AnyRecord) {
  return text(row.wh_cd || row.warehouse_code);
}

function inventoryProductKey(row: AnyRecord) {
  return text(row.product_id || row.product_code || row.prod_cd || row.sku || row.id);
}

export async function GET(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: true, warehouses: [], total: 0, page: 1, pageSize: 20 });
    const query = text(request.nextUrl.searchParams.get("q"));
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(5000, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const [warehouses, inventory] = await Promise.all([
      selectRows<AnyRecord>("warehouses", { order: "warehouse_code.asc", limit: 5000 }),
      selectRows<AnyRecord>("inventory_current", { order: "updated_at.desc", limit: 20000 }).catch(() => []),
    ]);
    const stockCounts = new Map<string, Set<string>>();
    inventory.forEach((row) => {
      const code = inventoryWarehouseCode(row);
      const productKey = inventoryProductKey(row);
      const qty = Number(row.on_hand_qty ?? row.bal_qty ?? row.qty ?? 0);
      if (!code || !productKey || qty <= 0) return;
      if (!stockCounts.has(code)) stockCounts.set(code, new Set());
      stockCounts.get(code)?.add(productKey);
    });
    const normalized = warehouses
      .filter((row) => text(row.status).toLowerCase() !== "deleted" && row.is_active !== false)
      .map((row) => {
        const code = warehouseCode(row);
        return {
          id: text(row.id),
          warehouse_code: code,
          warehouse_name: warehouseName(row),
          warehouse_type: normalizeWarehouseType(row.warehouse_type || row.wh_type),
          warehouse_type_label: warehouseTypeLabel(row.warehouse_type || row.wh_type),
          memo: text(row.memo || row.remarks),
          stock_product_count: stockCounts.get(code)?.size || 0,
          is_active: boolActive(row.is_active),
        };
      })
      .filter((row) => matches([row.warehouse_code, row.warehouse_name, row.memo], query));
    const offset = (page - 1) * pageSize;
    return NextResponse.json({
      ok: true,
      warehouses: normalized.slice(offset, offset + pageSize),
      total: normalized.length,
      page,
      pageSize,
    });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "창고 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: false, error: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const warehouse = (body.warehouse || body) as AnyRecord;
    const code = text(warehouse.warehouse_code || warehouse.wh_cd);
    const name = text(warehouse.warehouse_name || warehouse.wh_name);
    if (!code || !name) return NextResponse.json({ ok: false, error: "창고코드와 창고명은 필수입니다." }, { status: 400 });
    const now = new Date().toISOString();
    const warehouseType = normalizeWarehouseType(warehouse.warehouse_type || warehouse.wh_type);
    const values = {
      warehouse_code: code,
      wh_cd: code,
      warehouse_name: name,
      wh_name: name,
      warehouse_type: warehouseType,
      wh_type: warehouseType,
      memo: text(warehouse.memo || warehouse.remarks),
      is_active: boolActive(warehouse.is_active),
      updated_at: now,
    };
    const rows = text(warehouse.id)
      ? await patchRows<AnyRecord>("warehouses", { id: `eq.${warehouse.id}` }, values)
      : await upsertRows<AnyRecord>("warehouses", { ...values, created_at: now }, "warehouse_code");
    return NextResponse.json({ ok: true, warehouse: rows[0] || null });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "창고 저장 실패" }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: false, error: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const id = text(body.id || request.nextUrl.searchParams.get("id"));
    const code = text(body.warehouse_code || request.nextUrl.searchParams.get("warehouse_code"));
    if (!id && !code) return NextResponse.json({ ok: false, error: "삭제할 창고를 찾을 수 없습니다." }, { status: 400 });
    const filters = id ? { id: `eq.${id}` } : { warehouse_code: `eq.${code}` };
    const rows = await patchRows<AnyRecord>("warehouses", filters, { status: "deleted", is_active: false, updated_at: new Date().toISOString() })
      .catch(() => deleteRows<AnyRecord>("warehouses", filters));
    return NextResponse.json({ ok: true, deleted: rows.length });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "창고 삭제 실패" }, { status });
  }
}
