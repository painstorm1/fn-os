import { NextRequest, NextResponse } from "next/server";
import { deleteRows, FnosDbError, hasDbConfig, insertRows, patchRows, selectRows, upsertRows } from "@/lib/fnos-db";

type AnyRecord = Record<string, unknown>;

const SALES_CHANNEL_PRODUCT_MAPPINGS_FALLBACK_KEY = "sales_channel_product_mappings_fallback";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function schemaColumnFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.match(/컬럼 '([^']+)'/)?.[1] || message.match(/column ['"]?([^'"\s]+)['"]?/i)?.[1] || message.match(/Could not find the ['"]?([^'"\s]+)['"]? column/i)?.[1] || "";
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateText(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.slice(0, 10);
}

function asOfEndIso(value: unknown) {
  const date = dateText(value);
  if (!date) return "";
  const parsed = new Date(`${date}T23:59:59.999+09:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function inventoryHistoryMemo(entry: AnyRecord) {
  return `FN_INV_HISTORY ${JSON.stringify(entry)}`;
}

function productCode(row: AnyRecord) {
  return text(row.product_code || row.prod_cd || row.sku);
}

function productName(row: AnyRecord) {
  return normalizeSetPrefix(row.product_name || row.prod_name);
}

function inferredProductAttribute(row: { product_code?: string; product_name?: string }) {
  const value = `${text(row.product_code)} ${text(row.product_name)}`.toUpperCase();
  if (/\[RG[\]\}]/.test(value)) return "rg";
  if (/\[(SET|NG)[\]\}]/.test(value)) return "set";
  return "plain";
}

function normalizeProductAttribute(value: unknown, fallback: "plain" | "set" | "rg" = "plain") {
  const normalized = text(value).toLowerCase();
  if (normalized === "plain" || normalized === "set" || normalized === "rg") return normalized;
  return fallback;
}

function productAttributeLabel(value: unknown) {
  const normalized = normalizeProductAttribute(value);
  if (normalized === "set") return "SET";
  if (normalized === "rg") return "RG";
  return "일반";
}

function resolvedProductAttribute(row: AnyRecord) {
  const explicitAttribute = normalizeProductAttribute(row.product_attribute, "plain");
  const explicitKind = normalizeProductAttribute(row.product_kind, "plain");
  const inferred = inferredProductAttribute({ product_code: productCode(row), product_name: productName(row) });
  if (explicitAttribute === "set" || explicitAttribute === "rg") return explicitAttribute;
  if (explicitKind === "set" || explicitKind === "rg") return explicitKind;
  return inferred;
}

function isVirtualInventoryProduct(row: AnyRecord) {
  const attribute = resolvedProductAttribute(row);
  return attribute === "set" || attribute === "rg";
}

function normalizeSetPrefix(value: unknown) {
  return text(value).replace(/^\s*\[NG[\]\}]\s*/i, "[SET]");
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

async function inventoryMovementRows() {
  return selectRows<AnyRecord>("inventory_movements", { order: "movement_date.desc", limit: 50000 }).catch(() => []);
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

async function saveProductRows(product: AnyRecord, values: AnyRecord, createdAt: string) {
  let next = { ...values };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return text(product.id)
        ? await patchRows<AnyRecord>("products", { id: `eq.${product.id}` }, next)
        : await upsertRows<AnyRecord>("products", { ...next, created_at: createdAt }, "product_code");
    } catch (error) {
      const column = schemaColumnFromError(error);
      if (!column || !(column in next)) throw error;
      const { [column]: _removed, ...rest } = next;
      next = rest;
    }
  }
  throw new FnosDbError("품목 저장 가능한 컬럼 확인에 실패했습니다.", 500);
}

async function existingProductForSave(product: AnyRecord, code: string) {
  const id = text(product.id);
  if (id) {
    const rows = await selectRows<AnyRecord>("products", { id: `eq.${id}`, limit: 1 });
    if (rows[0]) return rows[0];
  }
  if (code) {
    const rows = await selectRows<AnyRecord>("products", { product_code: `eq.${code}`, limit: 1 });
    return rows[0] || null;
  }
  return null;
}

function productIdentityChanged(previous: AnyRecord | null, nextValues: AnyRecord) {
  if (!previous) return false;
  const previousCode = productCode(previous);
  const previousName = productName(previous);
  const nextCode = text(nextValues.product_code || nextValues.prod_cd || nextValues.sku);
  const nextName = text(nextValues.product_name || nextValues.prod_name);
  return Boolean((previousCode && nextCode && previousCode !== nextCode) || (previousName && nextName && previousName !== nextName));
}

function isOptionalMappingCleanupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = error instanceof FnosDbError ? error.status : 0;
  return status === 404 || /sales_channel_product_mappings|DB 테이블|schema_sales_inventory|Could not find the table|schema cache|fn_product_id|product_code/i.test(message);
}

async function readFallbackSalesChannelProductMappings() {
  const rows = await selectRows<{ setting_value?: string }>("fnos_settings", {
    setting_key: `eq.${SALES_CHANNEL_PRODUCT_MAPPINGS_FALLBACK_KEY}`,
    limit: 1,
  }).catch(() => []);
  const raw = rows[0]?.setting_value || "[]";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AnyRecord[] : [];
  } catch {
    return [];
  }
}

async function writeFallbackSalesChannelProductMappings(rows: AnyRecord[]) {
  await upsertRows("fnos_settings", {
    setting_key: SALES_CHANNEL_PRODUCT_MAPPINGS_FALLBACK_KEY,
    setting_value: JSON.stringify(rows),
    memo: "쇼핑몰 코드연결 fallback 저장소",
    updated_at: nowIso(),
  }, "setting_key").catch(() => []);
}

async function clearFallbackSalesChannelProductMappingsForProduct(product: AnyRecord | null, codes: string[]) {
  const productId = text(product?.id);
  const codeSet = new Set(codes.filter(Boolean));
  const rows = await readFallbackSalesChannelProductMappings();
  if (!rows.length) return 0;
  const nextRows = rows.filter((row) => {
    if (productId && text(row.fn_product_id) === productId) return false;
    if (codeSet.has(text(row.product_code))) return false;
    return true;
  });
  if (nextRows.length !== rows.length) await writeFallbackSalesChannelProductMappings(nextRows);
  return rows.length - nextRows.length;
}

async function syncFallbackSalesChannelProductMappingsForProduct(previous: AnyRecord | null, saved: AnyRecord | null, extraCode = "") {
  const productId = text(saved?.id || previous?.id);
  const previousCodes = Array.from(new Set([productCode(previous || {}), text(extraCode)].filter(Boolean)));
  const nextCode = productCode(saved || {});
  const nextName = productName(saved || {});
  if (!productId && !previousCodes.length) return 0;
  const rows = await readFallbackSalesChannelProductMappings();
  if (!rows.length) return 0;
  let changed = 0;
  const nextRows = rows.map((row) => {
    const matchesId = productId && text(row.fn_product_id) === productId;
    const matchesCode = previousCodes.includes(text(row.product_code));
    if (!matchesId && !matchesCode) return row;
    changed += 1;
    return {
      ...row,
      fn_product_id: productId || text(row.fn_product_id) || null,
      product_code: nextCode || text(row.product_code),
      product_name: nextName || text(row.product_name),
      updated_at: nowIso(),
    };
  });
  if (changed) await writeFallbackSalesChannelProductMappings(nextRows);
  return changed;
}

async function syncSalesChannelProductMappingsForProduct(previous: AnyRecord | null, saved: AnyRecord | null, extraCode = "") {
  const productId = text(saved?.id || previous?.id);
  const previousCodes = Array.from(new Set([productCode(previous || {}), text(extraCode)].filter(Boolean)));
  const nextCode = productCode(saved || {});
  const nextName = productName(saved || {});
  const values = {
    fn_product_id: productId || null,
    product_code: nextCode,
    product_name: nextName,
    updated_at: nowIso(),
  };
  let syncedCount = 0;
  let fallbackChecked = false;
  async function syncFallbackOnce() {
    if (fallbackChecked) return;
    fallbackChecked = true;
    syncedCount += await syncFallbackSalesChannelProductMappingsForProduct(previous, saved, extraCode);
  }
  if (productId) {
    try {
      const synced = await patchRows<AnyRecord>("sales_channel_product_mappings", { fn_product_id: `eq.${productId}` }, values);
      syncedCount += synced.length;
    } catch (error) {
      if (!isOptionalMappingCleanupError(error)) throw error;
      await syncFallbackOnce();
    }
  }
  for (const code of previousCodes) {
    if (!code) continue;
    try {
      const synced = await patchRows<AnyRecord>("sales_channel_product_mappings", { product_code: `eq.${code}` }, values);
      syncedCount += synced.length;
    } catch (error) {
      if (!isOptionalMappingCleanupError(error)) throw error;
      await syncFallbackOnce();
    }
  }
  return syncedCount;
}

async function clearSalesChannelProductMappingsForProduct(product: AnyRecord | null, extraCode = "") {
  const productId = text(product?.id);
  const codes = Array.from(new Set([productCode(product || {}), text(extraCode)].filter(Boolean)));
  let deletedCount = 0;
  let fallbackChecked = false;
  async function clearFallbackOnce() {
    if (fallbackChecked) return;
    fallbackChecked = true;
    deletedCount += await clearFallbackSalesChannelProductMappingsForProduct(product, codes);
  }
  if (productId) {
    try {
      const deleted = await deleteRows<AnyRecord>("sales_channel_product_mappings", { fn_product_id: `eq.${productId}` });
      deletedCount += deleted.length;
    } catch (error) {
      if (!isOptionalMappingCleanupError(error)) throw error;
      await clearFallbackOnce();
    }
  }
  for (const code of codes) {
    try {
      const deleted = await deleteRows<AnyRecord>("sales_channel_product_mappings", { product_code: `eq.${code}` });
      deletedCount += deleted.length;
    } catch (error) {
      if (!isOptionalMappingCleanupError(error)) throw error;
      await clearFallbackOnce();
    }
  }
  return deletedCount;
}

export async function GET(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: true, products: [], total: 0, page: 1, pageSize: 20, warehouses: [] });
    const query = text(request.nextUrl.searchParams.get("q")).toLowerCase();
    const queryTokens = query.split(/\s+/).filter(Boolean);
    const searchField = text(request.nextUrl.searchParams.get("searchField"));
    const relation = text(request.nextUrl.searchParams.get("relation"));
    const asOfIso = asOfEndIso(request.nextUrl.searchParams.get("asOf"));
    const excludeBom = text(request.nextUrl.searchParams.get("excludeBom")).toLowerCase() === "true";
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(5000, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const [products, warehouses, currentInventory, movements, boms, bomItems, importLinks, importProducts] = await Promise.all([
      productRows(),
      warehouseRows(),
      inventoryRows(),
      asOfIso ? inventoryMovementRows() : Promise.resolve([] as AnyRecord[]),
      bomRows(),
      bomItemRows(),
      importLinkRows(),
      importProductRows(),
    ]);
    const warehouseByIdForInventory = new Map(warehouses.map((row) => [text(row.id), row]));
    const inventory = currentInventory.map((row) => ({ ...row }));
    if (asOfIso) {
      const targetTime = new Date(asOfIso).getTime();
      const inventoryByKey = new Map<string, AnyRecord>();
      inventory.forEach((row) => {
        const code = text(row.prod_cd || row.sku);
        const wh = text(row.wh_cd || row.warehouse_code) || warehouseCode(warehouseByIdForInventory.get(text(row.warehouse_id)) || {});
        if (code && wh) inventoryByKey.set(`${code}::${wh}`, row);
      });
      movements.forEach((movement) => {
        const movementTime = new Date(text(movement.movement_date || movement.created_at)).getTime();
        if (!Number.isFinite(movementTime) || movementTime <= targetTime) return;
        const code = text(movement.prod_cd || movement.product_code || movement.sku);
        const wh = text(movement.wh_cd || movement.warehouse_code) || warehouseCode(warehouseByIdForInventory.get(text(movement.warehouse_id)) || {});
        if (!code || !wh) return;
        const key = `${code}::${wh}`;
        const row = inventoryByKey.get(key) || {
          prod_cd: code,
          sku: code,
          wh_cd: wh,
          wh_name: warehouseName(warehouseByIdForInventory.get(text(movement.warehouse_id)) || { wh_cd: wh }),
          on_hand_qty: 0,
          available_qty: 0,
          bal_qty: 0,
        };
        const nextQty = numberValue(row.on_hand_qty ?? row.bal_qty) - numberValue(movement.qty);
        row.on_hand_qty = nextQty;
        row.available_qty = nextQty - numberValue(row.reserved_qty);
        row.bal_qty = nextQty;
        inventoryByKey.set(key, row);
      });
    }

    const activeProducts = products.filter((row) => text(row.status).toLowerCase() !== "deleted" && row.is_active !== false);
    const activeProductIds = new Set(activeProducts.map((row) => text(row.id)).filter(Boolean));
    const activeProductCodes = new Set(activeProducts.map((row) => productCode(row)).filter(Boolean));
    const productById = new Map<string, AnyRecord>(products.map((row): [string, AnyRecord] => [text(row.id), row]));
    const activeProductById = new Map<string, AnyRecord>(activeProducts.map((row): [string, AnyRecord] => [text(row.id), row]).filter(([id]) => Boolean(id)));
    const activeProductByCode = new Map<string, AnyRecord>(activeProducts.map((row): [string, AnyRecord] => [productCode(row), row]).filter(([code]) => Boolean(code)));
    const inventoryByProduct = new Map<string, AnyRecord[]>();
    const inventoryByCode = new Map<string, AnyRecord[]>();
    inventory.forEach((row) => {
      const qty = numberValue(row.on_hand_qty ?? row.bal_qty);
      if (qty === 0) return;
      const productId = text(row.product_id);
      const code = text(row.prod_cd || row.sku);
      if (productId) {
        const matchedProduct = activeProductById.get(productId);
        if (!activeProductIds.has(productId) || !matchedProduct || isVirtualInventoryProduct(matchedProduct)) return;
        inventoryByProduct.set(productId, [...(inventoryByProduct.get(productId) || []), row]);
        return;
      }
      const matchedProduct = activeProductByCode.get(code);
      if (!code || !activeProductCodes.has(code) || !matchedProduct || isVirtualInventoryProduct(matchedProduct)) return;
      inventoryByCode.set(code, [...(inventoryByCode.get(code) || []), row]);
    });
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

    const normalizedProducts = activeProducts.map((row) => {
      const code = productCode(row);
      const productAttribute = resolvedProductAttribute(row);
      const virtualInventoryProduct = isVirtualInventoryProduct(row);
      const stockRows = virtualInventoryProduct ? [] : inventoryByProduct.get(text(row.id)) || inventoryByCode.get(code) || [];
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
        product_attribute: productAttribute,
        product_kind: productAttribute,
        product_attribute_label: productAttributeLabel(productAttribute),
        cost_price: numberValue(row.cost_price ?? row.in_price),
        standard_price: numberValue(row.standard_price ?? row.out_price),
        current_stock: virtualInventoryProduct ? 0 : currentStock,
        inventory: virtualInventoryProduct ? [] : inventoryList,
        bom: mappedBom,
        import_links: mappedImportLinks,
        raw: row,
      };
    });
    const filtered = normalizedProducts.filter((row) => {
      if (relation === "bom" && !row.bom.length) return false;
      if ((relation === "ng" || relation === "set") && row.product_kind !== "set") return false;
      if (relation === "rg" && row.product_kind !== "rg") return false;
      if (relation === "import" && !row.import_links.length) return false;
      if (relation === "plain" && row.product_kind !== "plain") return false;
      if (excludeBom && (row.bom.length || row.product_kind === "set" || row.product_kind === "rg")) return false;
      const searchValues = searchField === "code"
        ? [row.product_code]
        : [row.product_name];
      return matchesSearchTokens(searchValues, queryTokens);
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
    const name = normalizeSetPrefix(product.product_name || product.prod_name);
    if (!code || !name) {
      return NextResponse.json({ ok: false, error: "품목코드와 품목명은 필수입니다." }, { status: 400 });
    }

    const now = nowIso();
    const inferredAttribute = inferredProductAttribute({ product_code: code, product_name: name });
    const explicitAttribute = normalizeProductAttribute(product.product_attribute, "plain");
    const explicitKind = normalizeProductAttribute(product.product_kind, "plain");
    const productAttribute = explicitAttribute === "set" || explicitAttribute === "rg"
      ? explicitAttribute
      : explicitKind === "set" || explicitKind === "rg"
        ? explicitKind
        : inferredAttribute;
    const virtualInventoryProduct = productAttribute === "set" || productAttribute === "rg";
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
      is_stock_managed: !virtualInventoryProduct,
      status: "active",
      is_active: true,
      updated_at: now,
    };

    const previousProduct = await existingProductForSave(product, code);
    let saved: AnyRecord | undefined;
    const rows = await saveProductRows(product, values, now);
    saved = rows[0];
    if (!saved) {
      const rows = await selectRows<AnyRecord>("products", { product_code: `eq.${code}`, limit: 1 });
      saved = rows[0];
    }

    const syncedMappingCount = productIdentityChanged(previousProduct, values)
      ? await syncSalesChannelProductMappingsForProduct(previousProduct, saved, code)
      : 0;

    const productId = text(saved?.id);
    const warehouses = await warehouseRows();
    const warehouseById = new Map(warehouses.map((row) => [text(row.id), row]));
    const warehouseByCode = new Map(warehouses.map((row) => [warehouseCode(row), row]));
    const inventory = virtualInventoryProduct ? [] : Array.isArray(body.inventory) ? body.inventory as AnyRecord[] : [];
    const inventoryHistory = virtualInventoryProduct ? [] : Array.isArray(body.inventory_history) ? body.inventory_history as AnyRecord[] : [];
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
      if (delta !== 0 && !inventoryHistory.length) {
        const resolvedWarehouseCode = whCode || warehouseCode(warehouse || {});
        const unitCost = numberValue(saved?.cost_price ?? saved?.in_price ?? product.cost_price ?? product.in_price);
        await insertRows("inventory_movements", {
          movement_date: now,
          movement_type: delta > 0 ? "adjustment_plus" : "adjustment_minus",
          warehouse_id: text(warehouse?.id) || null,
          product_id: productId || null,
          sku: code,
          prod_cd: code,
          wh_cd: resolvedWarehouseCode,
          qty: delta,
          source_type: "product_master",
          source_ref_id: `product-master-${code}-${resolvedWarehouseCode}-${Date.now()}`,
          memo: inventoryHistoryMemo({
            kind: "manual_adjustment",
            source: "product_master",
            productCode: code,
            productName: name,
            warehouseCode: resolvedWarehouseCode,
            warehouseName: warehouseName(warehouse || item),
            beforeQty: prevQty,
            changeQty: delta,
            afterQty: nextQty,
            qty: Math.abs(delta),
            unitCost,
            amount: Math.abs(delta) * unitCost,
            userMemo: "",
          }),
          created_at: now,
        }).catch(() => null);
      }
    }

    if (inventoryHistory.length) {
      const movementRows = inventoryHistory
        .map((entry, index) => {
          const kind = text(entry.kind || entry.type);
          const sourceRefId = text(entry.source_ref_id) || `inventory-${kind || "change"}-${code}-${Date.now()}-${index}`;
          const qty = numberValue(entry.kind === "manual_adjustment" || entry.type === "manual_adjustment" ? entry.changeQty : entry.qty);
          const whCode = text(entry.fromWarehouseCode || entry.warehouseCode);
          const warehouse = warehouseByCode.get(whCode);
          return {
            movement_date: now,
            movement_type: kind === "warehouse_transfer" ? "warehouse_transfer" : "manual_adjustment",
            warehouse_id: text(warehouse?.id) || null,
            product_id: productId || null,
            sku: code,
            qty,
            source_type: kind === "warehouse_transfer" ? "inventory_transfer" : "inventory_manual",
            source_ref_id: sourceRefId,
            memo: inventoryHistoryMemo({
              ...entry,
              kind: kind === "warehouse_transfer" ? "warehouse_transfer" : "manual_adjustment",
              productCode: text(entry.productCode) || code,
              productName: text(entry.productName) || name,
            }),
            created_at: now,
          };
        })
        .filter((entry) => text(entry.movement_type) && (text(entry.sku) || text(entry.product_id)));
      if (movementRows.length) await insertRows("inventory_movements", movementRows).catch(() => null);
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

    return NextResponse.json({ ok: true, product: saved, inventory_count: inventory.length, synced_mapping_count: syncedMappingCount });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "품목 저장 실패" }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: false, error: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const id = text(body.id || request.nextUrl.searchParams.get("id"));
    const code = text(body.product_code || request.nextUrl.searchParams.get("product_code"));
    if (!id && !code) {
      return NextResponse.json({ ok: false, error: "삭제할 품목을 찾을 수 없습니다." }, { status: 400 });
    }
    const filters = id ? { id: `eq.${id}` } : { product_code: `eq.${code}` };
    const rows = await patchRows<AnyRecord>("products", filters, {
      status: "deleted",
      is_active: false,
      updated_at: nowIso(),
    });
    const deletedIds = rows.map((row) => text(row.id)).filter(Boolean);
    let unlinkedMappingCount = 0;
    for (const row of rows) {
      unlinkedMappingCount += await clearSalesChannelProductMappingsForProduct(row, code);
    }
    for (const productId of deletedIds) {
      await deleteRows("import_product_sku_links", { product_id: `eq.${productId}` }).catch(() => []);
      const boms = await selectRows<AnyRecord>("product_boms", { parent_product_id: `eq.${productId}`, limit: 500 }).catch(() => []);
      for (const bom of boms) {
        await deleteRows("product_bom_items", { bom_id: `eq.${bom.id}` }).catch(() => []);
      }
      await deleteRows("product_boms", { parent_product_id: `eq.${productId}` }).catch(() => []);
      await deleteRows("product_bom_items", { component_product_id: `eq.${productId}` }).catch(() => []);
    }
    return NextResponse.json({ ok: true, deleted: rows.length, unlinked_mapping_count: unlinkedMappingCount });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "품목 삭제 실패" }, { status });
  }
}
