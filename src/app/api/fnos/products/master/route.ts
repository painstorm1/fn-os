import { NextRequest, NextResponse } from "next/server";
import { deleteRows, FnosDbError, hasDbConfig, insertRows, patchRows, selectRows, upsertRows } from "@/lib/fnos-db";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function productCode(row: AnyRecord) {
  return text(row.product_code || row.prod_cd || row.sku);
}

function productName(row: AnyRecord) {
  return text(row.product_name || row.prod_name);
}

function inferredProductAttribute(row: { product_code?: string; product_name?: string }) {
  const value = `${text(row.product_code)} ${text(row.product_name)}`.toUpperCase();
  if (/\[RG[\]\}]/.test(value)) return "rg";
  if (/\[NG[\]\}]/.test(value)) return "set";
  return "plain";
}

function normalizeProductAttribute(value: unknown, fallback: "plain" | "set" | "rg" = "plain") {
  const normalized = text(value).toLowerCase();
  if (normalized === "plain" || normalized === "set" || normalized === "rg") return normalized;
  return fallback;
}

function compactSearchText(value: unknown) {
  return text(value).toLowerCase().replace(/[\s_\-()[\]{}]/g, "");
}

function matchesSearchTokens(values: unknown[], tokens: string[]) {
  if (!tokens.length) return true;
  const haystacks = values.map((value) => ({
    normal: text(value).toLowerCase(),
    compact: compactSearchText(value),
  }));
  return tokens.every((token) => {
    const compactToken = compactSearchText(token);
    return haystacks.some((haystack) => haystack.normal.includes(token) || (compactToken && haystack.compact.includes(compactToken)));
  });
}

function warehouseCode(row: AnyRecord) {
  return text(row.warehouse_code || row.wh_cd);
}

function warehouseName(row: AnyRecord) {
  return text(row.warehouse_name || row.wh_name || warehouseCode(row));
}

function normalizeInventory(row: AnyRecord) {
  return {
    id: text(row.id),
    warehouse_id: text(row.warehouse_id),
    warehouse_code: text(row.wh_cd || row.warehouse_code),
    warehouse_name: text(row.wh_name || row.warehouse_name || row.wh_cd),
    qty: numberValue(row.on_hand_qty ?? row.bal_qty),
    available_qty: numberValue(row.available_qty ?? row.on_hand_qty ?? row.bal_qty),
  };
}

async function productRows() {
  return selectRows<AnyRecord>("products", { order: "product_name.asc", limit: 5000 });
}

async function warehouseRows() {
  return selectRows<AnyRecord>("warehouses", { order: "warehouse_name.asc", limit: 1000 }).catch(() => []);
}

async function inventoryRows() {
  return selectRows<AnyRecord>("inventory_current", { order: "updated_at.desc", limit: 10000 }).catch(() => []);
}

async function bomRows() {
  return selectRows<AnyRecord>("product_boms", { order: "created_at.asc", limit: 5000 }).catch(() => []);
}

async function bomItemRows() {
  return selectRows<AnyRecord>("product_bom_items", { order: "created_at.asc", limit: 10000 }).catch(() => []);
}

async function importLinkRows() {
  return selectRows<AnyRecord>("import_product_sku_links", { order: "created_at.asc", limit: 10000 }).catch(() => []);
}

async function importProductRows() {
  return selectRows<AnyRecord>("import_erp_products", { order: "id.asc", limit: 5000 }).catch(() => []);
}

export async function GET(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: true, products: [], total: 0, page: 1, pageSize: 20, warehouses: [] });
    const query = text(request.nextUrl.searchParams.get("q")).toLowerCase();
    const queryTokens = query.split(/\s+/).filter(Boolean);
    const relation = text(request.nextUrl.searchParams.get("relation"));
    const excludeBom = text(request.nextUrl.searchParams.get("excludeBom")).toLowerCase() === "true";
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(5000, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const [products, warehouses, inventory, boms, bomItems, importLinks, importProducts] = await Promise.all([
      productRows(),
      warehouseRows(),
      inventoryRows(),
      bomRows(),
      bomItemRows(),
      importLinkRows(),
      importProductRows(),
    ]);

    const inventoryByProduct = new Map<string, AnyRecord[]>();
    const inventoryByCode = new Map<string, AnyRecord[]>();
    inventory.forEach((row) => {
      const productId = text(row.product_id);
      const code = text(row.prod_cd || row.sku);
      if (productId) inventoryByProduct.set(productId, [...(inventoryByProduct.get(productId) || []), row]);
      if (code) inventoryByCode.set(code, [...(inventoryByCode.get(code) || []), row]);
    });
    const productById = new Map(products.map((row) => [text(row.id), row]));
    const bomByProduct = new Map<string, AnyRecord>();
    boms.forEach((row) => {
      const key = text(row.parent_product_id);
      if (key && !bomByProduct.has(key)) bomByProduct.set(key, row);
    });
    const bomItemsByBom = new Map<string, AnyRecord[]>();
    bomItems.forEach((row) => {
      const key = text(row.bom_id);
      if (!key) return;
      bomItemsByBom.set(key, [...(bomItemsByBom.get(key) || []), row]);
    });
    const importProductById = new Map(importProducts.map((row) => [text(row.id), row]));
    const importLinksByProduct = new Map<string, AnyRecord[]>();
    importLinks.forEach((row) => {
      const key = text(row.product_id);
      if (!key) return;
      importLinksByProduct.set(key, [...(importLinksByProduct.get(key) || []), row]);
    });

    const normalizedProducts = products.map((row) => {
      const code = productCode(row);
      const stockRows = inventoryByProduct.get(text(row.id)) || inventoryByCode.get(code) || [];
      const inventoryList = stockRows.map(normalizeInventory);
      const currentStock = inventoryList.reduce((sum, item) => sum + item.qty, 0);
      const bom = bomByProduct.get(text(row.id));
      const componentRows = bom ? bomItemsByBom.get(text(bom.id)) || [] : [];
      const importRows = importLinksByProduct.get(text(row.id)) || [];
      const mappedBom = componentRows.map((item) => {
        const component = productById.get(text(item.component_product_id));
        return {
          id: text(item.id),
          bom_id: text(item.bom_id),
          component_product_id: text(item.component_product_id),
          component_sku: text(item.component_sku || productCode(component || {})),
          component_product_code: productCode(component || {}) || text(item.component_sku),
          component_product_name: productName(component || {}),
          qty_per_unit: numberValue(item.qty_per_unit),
        };
      });
      const mappedImportLinks = importRows.map((item) => {
        const importProduct = importProductById.get(text(item.import_product_id));
        return {
          id: text(item.id),
          import_product_id: text(item.import_product_id),
          import_product_name: text(importProduct?.name || importProduct?.product_name || importProduct?.sku || item.import_product_id),
          import_option_name: text(item.import_option_name || item.import_option_key || item.match_group_label || item.variant_label),
          default_qty: numberValue(item.default_qty),
          default_ratio: numberValue(item.default_ratio) || 1,
        };
      });
      return {
        id: text(row.id),
        product_code: code,
        product_name: productName(row),
        product_attribute: normalizeProductAttribute(row.product_attribute, inferredProductAttribute({ product_code: code, product_name: productName(row) })),
        product_kind: normalizeProductAttribute(row.product_attribute, inferredProductAttribute({ product_code: code, product_name: productName(row) })),
        cost_price: numberValue(row.cost_price ?? row.in_price),
        standard_price: numberValue(row.standard_price ?? row.out_price),
        current_stock: currentStock,
        inventory: inventoryList,
        bom: mappedBom,
        import_links: mappedImportLinks,
        raw: row,
      };
    });
    const filtered = normalizedProducts.filter((row) => {
      if (relation === "bom" && !row.bom.length) return false;
      if (relation === "ng" && row.product_kind !== "set") return false;
      if (relation === "rg" && row.product_kind !== "rg") return false;
      if (relation === "import" && !row.import_links.length) return false;
      if (relation === "plain" && row.product_kind !== "plain") return false;
      if (excludeBom && (row.bom.length || row.product_kind === "set" || row.product_kind === "rg")) return false;
      return matchesSearchTokens([
        row.product_code,
        row.product_name,
        ...row.bom.flatMap((item) => [item.component_product_code, item.component_sku, item.component_product_name]),
        ...row.import_links.flatMap((item) => [item.import_product_name, item.import_option_name]),
      ], queryTokens);
    });
    const offset = (page - 1) * pageSize;
    const pageRows = filtered.slice(offset, offset + pageSize);

    return NextResponse.json({
      ok: true,
      products: pageRows,
      total: filtered.length,
      page,
      pageSize,
      warehouses: warehouses.map((row) => ({
        id: text(row.id),
        warehouse_code: warehouseCode(row),
        warehouse_name: warehouseName(row),
      })),
    });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "품목 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: false, error: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const product = (body.product || {}) as AnyRecord;
    const code = text(product.product_code || product.prod_cd || product.sku);
    const name = text(product.product_name || product.prod_name);
    if (!code || !name) {
      return NextResponse.json({ ok: false, error: "품목코드와 품목명은 필수입니다." }, { status: 400 });
    }

    const now = nowIso();
    const inferredAttribute = inferredProductAttribute({ product_code: code, product_name: name });
    const productAttribute = normalizeProductAttribute(product.product_attribute ?? product.product_kind, inferredAttribute);
    const values = {
      product_code: code,
      prod_cd: code,
      sku: code,
      product_name: name,
      prod_name: name,
      product_attribute: productAttribute,
      cost_price: numberValue(product.cost_price ?? product.in_price),
      in_price: numberValue(product.cost_price ?? product.in_price),
      standard_price: numberValue(product.standard_price ?? product.out_price),
      out_price: numberValue(product.standard_price ?? product.out_price),
      is_stock_managed: true,
      status: "active",
      is_active: true,
      updated_at: now,
    };

    let saved: AnyRecord | undefined;
    if (text(product.id)) {
      const rows = await patchRows<AnyRecord>("products", { id: `eq.${product.id}` }, values);
      saved = rows[0];
    } else {
      const rows = await upsertRows<AnyRecord>("products", { ...values, created_at: now }, "product_code");
      saved = rows[0];
    }
    if (!saved) {
      const rows = await selectRows<AnyRecord>("products", { product_code: `eq.${code}`, limit: 1 });
      saved = rows[0];
    }

    const productId = text(saved?.id);
    const warehouses = await warehouseRows();
    const warehouseById = new Map(warehouses.map((row) => [text(row.id), row]));
    const warehouseByCode = new Map(warehouses.map((row) => [warehouseCode(row), row]));
    const inventory = Array.isArray(body.inventory) ? body.inventory as AnyRecord[] : [];
    const bom = Array.isArray(body.bom) ? body.bom as AnyRecord[] : [];

    for (const item of inventory) {
      const whCode = text(item.warehouse_code || item.wh_cd);
      const warehouse = warehouseById.get(text(item.warehouse_id)) || warehouseByCode.get(whCode);
      const nextQty = numberValue(item.qty ?? item.on_hand_qty ?? item.bal_qty);
      const filters: Record<string, string> = productId
        ? { product_id: `eq.${productId}`, wh_cd: `eq.${whCode || warehouseCode(warehouse || {})}` }
        : { prod_cd: `eq.${code}`, wh_cd: `eq.${whCode}` };
      const [current] = await selectRows<AnyRecord>("inventory_current", { ...filters, limit: 1 }).catch(() => []);
      const prevQty = numberValue(current?.on_hand_qty ?? current?.bal_qty);
      const inventoryValues = {
        warehouse_id: text(warehouse?.id) || null,
        product_id: productId || null,
        sku: code,
        wh_cd: whCode || warehouseCode(warehouse || {}),
        wh_name: warehouseName(warehouse || item),
        prod_cd: code,
        prod_name: name,
        on_hand_qty: nextQty,
        available_qty: nextQty - numberValue(current?.reserved_qty),
        bal_qty: nextQty,
        last_movement_at: now,
        updated_at: now,
        synced_at: now,
      };
      if (current?.id) {
        await patchRows("inventory_current", { id: `eq.${current.id}` }, inventoryValues);
      } else {
        await insertRows("inventory_current", inventoryValues);
      }
      const delta = nextQty - prevQty;
      if (delta !== 0) {
        await insertRows("inventory_movements", {
          movement_date: now,
          movement_type: delta > 0 ? "adjustment_plus" : "adjustment_minus",
          warehouse_id: text(warehouse?.id) || null,
          product_id: productId || null,
          sku: code,
          qty: delta,
          source_type: "product_master",
          source_ref_id: code,
          memo: "품목관리 재고 직접수정",
          created_at: now,
        }).catch(() => null);
      }
    }

    if (Array.isArray(body.bom)) {
      const existingBoms = await selectRows<AnyRecord>("product_boms", { parent_product_id: `eq.${productId}`, limit: 100 }).catch(() => []);
      for (const existingBom of existingBoms) {
        await deleteRows("product_bom_items", { bom_id: `eq.${existingBom.id}` }).catch(() => []);
      }
      await deleteRows("product_boms", { parent_product_id: `eq.${productId}` }).catch(() => []);
      const normalizedBom = bom
        .map((item) => ({
          component_product_id: text(item.component_product_id || item.product_id),
          component_sku: text(item.component_sku || item.product_code || item.sku),
          qty_per_unit: numberValue(item.qty_per_unit || item.qty),
        }))
        .filter((item) => item.component_product_id && item.qty_per_unit > 0);
      if (normalizedBom.length) {
        const [savedBom] = await insertRows<AnyRecord>("product_boms", {
          parent_product_id: productId,
          bom_name: `${name} BOM`,
          bom_type: "set",
          is_active: true,
          created_at: now,
          updated_at: now,
        });
        await insertRows("product_bom_items", normalizedBom.map((item) => ({
          bom_id: savedBom.id,
          component_product_id: item.component_product_id,
          component_sku: item.component_sku,
          qty_per_unit: item.qty_per_unit,
          is_required: true,
          created_at: now,
          updated_at: now,
        })));
      }
    }

    return NextResponse.json({ ok: true, product: saved, inventory_count: inventory.length });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "품목 저장 실패" }, { status });
  }
}
