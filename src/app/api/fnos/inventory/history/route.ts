import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, hasDbConfig, selectRows } from "@/lib/fnos-db";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.slice(0, 10);
}

function parseHistoryMemo(value: unknown) {
  const memo = text(value);
  const marker = "FN_INV_HISTORY ";
  if (!memo.startsWith(marker)) return { meta: {} as AnyRecord, userMemo: memo };
  try {
    const meta = JSON.parse(memo.slice(marker.length)) as AnyRecord;
    return { meta, userMemo: text(meta.userMemo || meta.memo) };
  } catch {
    return { meta: {} as AnyRecord, userMemo: memo };
  }
}

function productCode(row: AnyRecord) {
  return text(row.product_code || row.prod_cd || row.sku);
}

function productName(row: AnyRecord) {
  return text(row.product_name || row.prod_name || row.option_name || productCode(row));
}

function warehouseCode(row: AnyRecord) {
  return text(row.warehouse_code || row.wh_cd);
}

function warehouseName(row: AnyRecord) {
  return text(row.warehouse_name || row.wh_name || warehouseCode(row));
}

function movementReason(movementType: string, sourceType: string) {
  if (movementType === "return_in") return "return";
  if (movementType === "exchange_out") return "exchange";
  if (movementType === "warehouse_transfer" || sourceType === "inventory_transfer") return "transfer";
  if (/adjustment|manual/.test(`${movementType} ${sourceType}`)) return "manual";
  return "";
}

export async function GET(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: false, error: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 503 });

    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 1000) || 1000, 5000);
    const [movements, products, warehouses, currentInventory] = await Promise.all([
      selectRows<AnyRecord>("inventory_movements", { order: "movement_date.desc", limit }).catch(() => []),
      selectRows<AnyRecord>("products", { order: "product_name.asc", limit: 10000 }).catch(() => []),
      selectRows<AnyRecord>("warehouses", { order: "warehouse_name.asc", limit: 2000 }).catch(() => []),
      selectRows<AnyRecord>("inventory_current", { order: "updated_at.desc", limit: 10000 }).catch(() => []),
    ]);

    const productsById = new Map(products.map((row) => [text(row.id), row]));
    const productsByCode = new Map<string, AnyRecord>();
    products.forEach((row) => {
      const code = productCode(row);
      if (code) productsByCode.set(code, row);
    });
    const warehousesById = new Map(warehouses.map((row) => [text(row.id), row]));
    const warehousesByCode = new Map<string, AnyRecord>();
    warehouses.forEach((row) => {
      const code = warehouseCode(row);
      if (code) warehousesByCode.set(code, row);
    });
    const currentByKey = new Map<string, AnyRecord>();
    currentInventory.forEach((row) => {
      const productKey = text(row.product_id) || productCode(row);
      const whKey = text(row.wh_cd || row.warehouse_code);
      if (productKey && whKey) currentByKey.set(`${productKey}::${whKey}`, row);
    });

    const rows = movements
      .map((movement) => {
        const movementType = text(movement.movement_type);
        const sourceType = text(movement.source_type);
        const reason = movementReason(movementType, sourceType);
        if (!reason) return null;
        const { meta, userMemo } = parseHistoryMemo(movement.memo);
        const product = (productsById.get(text(movement.product_id)) || productsByCode.get(text(meta.productCode || movement.prod_cd || movement.sku)) || {}) as AnyRecord;
        const warehouse = (warehousesById.get(text(movement.warehouse_id)) || warehousesByCode.get(text(meta.warehouseCode || meta.fromWarehouseCode || movement.wh_cd)) || {}) as AnyRecord;
        const targetWarehouse = (warehousesByCode.get(text(meta.toWarehouseCode)) || {}) as AnyRecord;
        const qty = Math.abs(numberValue(meta.qty ?? movement.qty));
        const changeQty = numberValue(meta.changeQty ?? movement.qty);
        const resolvedWarehouseCode = text(meta.warehouseCode || meta.fromWarehouseCode || movement.wh_cd || warehouseCode(warehouse));
        const productCurrentKey = text(movement.product_id) || text(meta.productCode || movement.prod_cd || movement.sku || productCode(product));
        const legacyCurrent = currentByKey.get(`${productCurrentKey}::${resolvedWarehouseCode}`);
        const hasBeforeQty = Object.prototype.hasOwnProperty.call(meta, "beforeQty");
        const hasAfterQty = Object.prototype.hasOwnProperty.call(meta, "afterQty");
        const inferredAfterQty = sourceType === "product_master" && legacyCurrent ? numberValue(legacyCurrent.on_hand_qty ?? legacyCurrent.bal_qty) : 0;
        const canInferLegacyQty = sourceType === "product_master" && Boolean(legacyCurrent);
        const beforeQty = hasBeforeQty ? numberValue(meta.beforeQty) : (hasAfterQty ? numberValue(meta.afterQty) - changeQty : (canInferLegacyQty ? inferredAfterQty - changeQty : 0));
        const afterQty = hasAfterQty ? numberValue(meta.afterQty) : (canInferLegacyQty ? inferredAfterQty : 0);
        const unitCost = numberValue(meta.unitCost ?? product?.cost_price ?? product?.in_price);
        return {
          id: text(movement.id || movement.source_ref_id || `${movementType}-${movement.movement_date}`),
          reason,
          movement_type: movementType,
          date: dateKey(movement.movement_date || movement.created_at),
          product_code: text(meta.productCode || movement.prod_cd || movement.sku || productCode(product)),
          product_name: text(meta.productName || movement.prod_name || productName(product)),
          warehouse_code: resolvedWarehouseCode,
          warehouse_name: text(meta.warehouseName || meta.fromWarehouseName || warehouseName(warehouse)),
          from_warehouse_code: text(meta.fromWarehouseCode || movement.wh_cd || warehouseCode(warehouse)),
          from_warehouse_name: text(meta.fromWarehouseName || warehouseName(warehouse)),
          to_warehouse_code: text(meta.toWarehouseCode || warehouseCode(targetWarehouse)),
          to_warehouse_name: text(meta.toWarehouseName || warehouseName(targetWarehouse)),
          before_qty: beforeQty,
          change_qty: changeQty,
          after_qty: afterQty,
          qty,
          unit_cost: unitCost,
          amount: numberValue(meta.amount) || Math.abs(qty * unitCost),
          memo: userMemo,
          source_ref_id: text(movement.source_ref_id),
          created_at: movement.created_at,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "재고이력 조회 실패" }, { status });
  }
}
