import { deleteRows, hasDbConfig, insertRows, patchRows, selectRows } from "./fnos-db";

type AnyRecord = Record<string, unknown>;

export type ImportSkuLinkInput = {
  import_product_id: number | string;
  product_id: string;
  sku?: string;
  option_name?: string;
  group_label?: string;
  import_option_key?: string;
  import_option_name?: string;
  match_group_label?: string;
  variant_label?: string;
  default_ratio?: number;
  default_qty?: number;
  is_primary?: boolean;
  sort_order?: number;
  is_active?: boolean;
  memo?: string;
};

export type ImportReceiptAllocation = {
  import_order_id: number | string;
  import_order_item_id?: number | string;
  import_product_id: number | string;
  import_option_key?: string;
  import_option_name?: string;
  product_id: string;
  sku?: string;
  allocated_qty: number;
  unit_cost?: number;
  warehouse_id?: string;
};

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

function dateKey(value: unknown) {
  const raw = text(value);
  if (!raw) return new Date().toISOString().slice(0, 10);
  return raw.slice(0, 10);
}

function parseSkuAllocation(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
}

function sqlList(values: string[]) {
  return `in.(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`;
}

function productSku(row: AnyRecord) {
  return text(row.sku || row.product_code || row.prod_cd || row.id);
}

function productName(row: AnyRecord) {
  return text(row.product_name || row.prod_name || row.name || row.PROD_DES);
}

function productOption(row: AnyRecord) {
  return text(row.option_name || row.size_des || row.SIZE_DES);
}

function linkOptionName(link?: AnyRecord | null) {
  return text(link?.option_name || link?.import_option_name || link?.import_option_key);
}

function sameImportOption(link: AnyRecord, optionName: string) {
  return linkOptionName(link) === text(optionName);
}

function skuAllocationKey(link: AnyRecord) {
  return text(link.product_id || productSku((link.product as AnyRecord) || {}) || link.sku);
}

function productImage(row: AnyRecord) {
  return text(row.image_url || row.image_path);
}

function productKind(row: AnyRecord) {
  const explicitKind = text(row.product_kind || row.item_kind || row.product_type || row.category_type).toLowerCase();
  const value = `${productSku(row)} ${productName(row)} ${text(row.product_code || row.prod_cd)}`.toUpperCase();
  if (explicitKind === "rg" || explicitKind.includes("rocket") || explicitKind.includes("로켓")) return "rg";
  if (explicitKind === "set" || explicitKind.includes("세트")) return "set";
  if (/\[RG[\]\}]/.test(value)) return "rg";
  if (/\[(SET|NG)[\]\}]/.test(value)) return "set";
  return "plain";
}

function productCost(row: AnyRecord) {
  return numberValue(row.cost_price ?? row.in_price ?? row.standard_price ?? row.out_price);
}

function productPrice(row: AnyRecord) {
  return numberValue(row.standard_price ?? row.out_price ?? row.cost_price ?? row.in_price);
}

function normalizeProduct(row: AnyRecord, inventoryByProduct: Map<string, AnyRecord[]>) {
  const id = text(row.id);
  const inventoryRows = inventoryByProduct.get(id) || [];
  const onHand = inventoryRows.reduce((sum, item) => sum + numberValue(item.on_hand_qty ?? item.bal_qty), 0);
  const available = inventoryRows.reduce((sum, item) => sum + numberValue(item.available_qty ?? item.on_hand_qty ?? item.bal_qty), 0);
  return {
    id,
    product_id: id,
    sku: productSku(row),
    product_code: text(row.product_code || row.prod_cd),
    product_name: productName(row),
    option_name: productOption(row),
    image_url: productImage(row),
    current_stock: onHand,
    available_stock: available,
    standard_price: productPrice(row),
    cost_price: productCost(row),
    currency: text(row.currency) || "KRW",
    raw: row,
  };
}

async function inventoryForProducts(productIds: string[]) {
  if (!productIds.length) return new Map<string, AnyRecord[]>();
  const rows = await selectRows<AnyRecord>("inventory_current", {
    product_id: sqlList(productIds),
    limit: 5000,
  }).catch(() => []);
  const map = new Map<string, AnyRecord[]>();
  rows.forEach((row) => {
    const key = text(row.product_id);
    if (!key) return;
    map.set(key, [...(map.get(key) || []), row]);
  });
  return map;
}

async function productsByIds(productIds: string[]) {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  if (!uniqueIds.length) return [];
  return selectRows<AnyRecord>("products", {
    id: sqlList(uniqueIds),
    limit: uniqueIds.length,
  });
}

async function activeBomParentProductIds() {
  const rows = await selectRows<AnyRecord>("product_boms", {
    is_active: "eq.true",
    limit: 5000,
  }).catch(() => []);
  return new Set(rows.map((row) => text(row.parent_product_id)).filter(Boolean));
}

export async function searchFnProducts(query: string, limit = 80) {
  if (!hasDbConfig()) return [];
  const keywords = text(query).toLowerCase().split(/\s+/).filter(Boolean);
  const [rows, bomParentIds] = await Promise.all([
    selectRows<AnyRecord>("products", { order: "product_name.asc", limit: 2500 }),
    activeBomParentProductIds(),
  ]);
  const matched = rows
    .filter((row) => !bomParentIds.has(text(row.id)))
    .filter((row) => productKind(row) === "plain")
    .map((row) => {
      const haystack = [row.product_code, row.sku, row.product_name, row.prod_cd, row.prod_name, row.option_name, row.size_des]
        .map((value) => text(value).toLowerCase())
        .join(" ");
      const score = keywords.length
        ? keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0)
        : 1;
      return { row, score };
    })
    .filter((item) => !keywords.length || item.score > 0)
    .sort((a, b) => b.score - a.score || productName(a.row).localeCompare(productName(b.row), "ko-KR", { numeric: true, sensitivity: "base" }))
    .map((item) => item.row)
    .slice(0, limit);
  const inventoryByProduct = await inventoryForProducts(matched.map((row) => text(row.id)));
  return matched.map((row) => normalizeProduct(row, inventoryByProduct));
}

export async function listImportProductLinks(importProductId: number | string): Promise<Array<AnyRecord & { product: ReturnType<typeof normalizeProduct> | null }>> {
  if (!hasDbConfig()) return [];
  const links = await selectRows<AnyRecord>("import_product_sku_links", {
    import_product_id: `eq.${importProductId}`,
    order: "sort_order.asc,is_primary.desc,created_at.asc",
    limit: 500,
  }).catch(() => []);
  const productRows = await productsByIds(links.map((row) => text(row.product_id)));
  const inventoryByProduct = await inventoryForProducts(productRows.map((row) => text(row.id)));
  const productMap = new Map(productRows.map((row) => [text(row.id), normalizeProduct(row, inventoryByProduct)]));
  return links.map((link) => {
    const optionName = text(link.option_name || link.import_option_name || link.import_option_key);
    const groupLabel = text(link.group_label || link.match_group_label || optionName);
    return {
      ...link,
      option_name: optionName,
      group_label: groupLabel,
      import_option_key: text(link.import_option_key || optionName),
      import_option_name: text(link.import_option_name || optionName),
      match_group_label: groupLabel,
      sort_order: numberValue(link.sort_order),
      product: productMap.get(text(link.product_id)) || null,
    };
  });
}

export async function saveImportProductLinks(importProductId: number | string, links: ImportSkuLinkInput[]) {
  if (!hasDbConfig()) throw new Error("Supabase environment variables are not configured.");
  await deleteRows("import_product_sku_links", { import_product_id: `eq.${importProductId}` });
  const now = nowIso();
  const rows = links
    .filter((link) => text(link.product_id))
    .map((link, index) => ({
      import_product_id: Number(importProductId),
      product_id: link.product_id,
      sku: text(link.sku),
      import_option_key: text(link.import_option_key || link.option_name || link.import_option_name) || null,
      import_option_name: text(link.import_option_name || link.option_name || link.import_option_key) || null,
      match_group_label: text(link.match_group_label || link.group_label || link.option_name || link.import_option_name) || null,
      variant_label: text(link.variant_label) || null,
      default_ratio: Number(link.default_ratio || 0) || 1,
      default_qty: Number(link.default_qty || 0),
      is_primary: Boolean(link.is_primary || index === 0),
      sort_order: Number(link.sort_order ?? index) || 0,
      is_active: link.is_active !== false,
      memo: text(link.memo) || null,
      created_at: now,
      updated_at: now,
    }));
  if (!rows.length) return [];
  return insertRows("import_product_sku_links", rows);
}

export async function bomStatusForImportProduct(importProductId: number | string) {
  const links = await listImportProductLinks(importProductId);
  const productIds = links.map((link) => text(link.product_id)).filter(Boolean);
  if (!productIds.length) return [];
  const boms = await selectRows<AnyRecord>("product_boms", {
    parent_product_id: sqlList(productIds),
    is_active: "eq.true",
    limit: 500,
  }).catch(() => []);
  const bomIds = boms.map((row) => text(row.id)).filter(Boolean);
  const items = bomIds.length
    ? await selectRows<AnyRecord>("product_bom_items", { bom_id: sqlList(bomIds), limit: 1000 }).catch(() => [])
    : [];
  const componentIds = Array.from(new Set(items.map((row) => text(row.component_product_id)).filter(Boolean)));
  const componentRows = await productsByIds(componentIds);
  const componentInventory = await inventoryForProducts(componentIds);
  const componentMap = new Map(componentRows.map((row) => [text(row.id), normalizeProduct(row, componentInventory)]));
  const bomsByProduct = new Map<string, AnyRecord[]>();
  boms.forEach((bom) => {
    const key = text(bom.parent_product_id);
    bomsByProduct.set(key, [...(bomsByProduct.get(key) || []), bom]);
  });
  const itemsByBom = new Map<string, AnyRecord[]>();
  items.forEach((item) => {
    const key = text(item.bom_id);
    itemsByBom.set(key, [...(itemsByBom.get(key) || []), item]);
  });
  return links.map((link) => {
    const product = link.product as ReturnType<typeof normalizeProduct> | null;
    const productBoms = bomsByProduct.get(text(link.product_id)) || [];
    const components = productBoms.flatMap((bom) => itemsByBom.get(text(bom.id)) || []).map((item) => {
      const component = componentMap.get(text(item.component_product_id));
      const requiredQty = numberValue(item.qty_per_unit);
      const stock = numberValue(component?.available_stock ?? component?.current_stock);
      return {
        ...item,
        component,
        shortage: Boolean(item.is_required !== false && stock < requiredQty),
      };
    });
    return {
      product_id: text(link.product_id),
      sku: product?.sku || text(link.sku),
      product_name: product?.product_name || "",
      has_bom: productBoms.length > 0,
      components,
      shortage: components.some((item) => item.shortage),
      status: productBoms.length ? (components.some((item) => item.shortage) ? "부족" : "정상") : "미등록",
    };
  });
}

async function defaultWarehouseId() {
  const [warehouse] = await selectRows<AnyRecord>("warehouses", {
    is_active: "eq.true",
    order: "warehouse_name.asc",
    limit: 1,
  }).catch(() => []);
  return text(warehouse?.id) || null;
}

export async function createImportReceipt(payload: {
  purchase_date?: string;
  supplier_id?: string;
  supplier_name?: string;
  warehouse_id?: string;
  source_ref_id?: string | number;
  memo?: string;
  allocations: ImportReceiptAllocation[];
}) {
  if (!hasDbConfig()) throw new Error("Supabase environment variables are not configured.");
  const allocations = (payload.allocations || []).filter((item) => numberValue(item.allocated_qty) > 0 && text(item.product_id));
  if (!allocations.length) throw new Error("SKU별 배분 수량을 입력해 주세요.");

  const warehouseId = text(payload.warehouse_id) || await defaultWarehouseId();
  const productRows = await productsByIds(allocations.map((item) => text(item.product_id)));
  const productMap = new Map(productRows.map((row) => [text(row.id), row]));
  const purchaseDate = dateKey(payload.purchase_date);
  const sourceRefId = text(payload.source_ref_id || allocations[0]?.import_order_id);
  const importOrderId = numberValue(allocations[0]?.import_order_id || sourceRefId);
  if (importOrderId) {
    const existingAllocations = await selectRows<AnyRecord>("import_purchase_sku_allocations", {
      import_order_id: `eq.${importOrderId}`,
      limit: 1,
    }).catch(() => []);
    if (existingAllocations.length) throw new Error("이미 FN OS 구매/입고로 반영된 발주입니다.");
  }
  const now = nowIso();

  const purchaseRows = allocations.map((item, index) => {
    const product = productMap.get(text(item.product_id)) || {};
    const qty = numberValue(item.allocated_qty);
    const unitCost = numberValue(item.unit_cost) || productCost(product);
    const sku = text(item.sku) || productSku(product);
    const productNameValue = productName(product);
    return {
      purchase_date: purchaseDate,
      io_date: purchaseDate.replace(/\D/g, ""),
      supplier_id: text(payload.supplier_id) || null,
      warehouse_id: warehouseId,
      product_id: text(item.product_id),
      sku,
      qty,
      unit_price: unitCost,
      price: unitCost,
      supply_amount: qty * unitCost,
      supply_amt: qty * unitCost,
      vat_amount: 0,
      total_amount: qty * unitCost,
      source_type: "import_order",
      source_ref_id: sourceRefId,
      memo: text(payload.memo) || null,
      cust_name: text(payload.supplier_name),
      prod_cd: text(product.product_code || product.prod_cd || sku),
      prod_name: productNameValue,
      size_des: productOption(product),
      upload_ser_no: String(index + 1),
      sync_status: "SAVED",
      sync_message: "수입관리 입고 반영",
      created_at: now,
      updated_at: now,
    };
  });
  const savedPurchases = await insertRows<AnyRecord>("purchases", purchaseRows);

  const movementRows = allocations.map((item, index) => {
    const product = productMap.get(text(item.product_id)) || {};
    return {
      movement_date: `${purchaseDate}T00:00:00.000Z`,
      movement_type: "purchase_in",
      warehouse_id: warehouseId,
      product_id: text(item.product_id),
      sku: text(item.sku) || productSku(product),
      qty: numberValue(item.allocated_qty),
      source_type: "import_order",
      source_ref_id: text(savedPurchases[index]?.id || sourceRefId),
      memo: text(payload.memo) || null,
      created_at: now,
    };
  });
  await insertRows("inventory_movements", movementRows);

  for (const item of allocations) {
    const product = productMap.get(text(item.product_id)) || {};
    const sku = text(item.sku) || productSku(product);
    const filters: Record<string, string | number> = { product_id: `eq.${text(item.product_id)}`, sku: `eq.${sku}`, limit: 1 };
    if (warehouseId) filters.warehouse_id = `eq.${warehouseId}`;
    const [current] = await selectRows<AnyRecord>("inventory_current", filters).catch(() => []);
    const qty = numberValue(item.allocated_qty);
    if (current?.id) {
      const onHand = numberValue(current.on_hand_qty ?? current.bal_qty) + qty;
      const reserved = numberValue(current.reserved_qty);
      await patchRows("inventory_current", { id: `eq.${current.id}` }, {
        on_hand_qty: onHand,
        available_qty: onHand - reserved,
        bal_qty: onHand,
        last_movement_at: now,
        updated_at: now,
      });
    } else {
      await insertRows("inventory_current", {
        warehouse_id: warehouseId,
        product_id: text(item.product_id),
        sku,
        on_hand_qty: qty,
        reserved_qty: 0,
        available_qty: qty,
        last_movement_at: now,
        updated_at: now,
        prod_cd: text(product.product_code || product.prod_cd || sku),
        prod_name: productName(product),
        size_des: productOption(product),
        bal_qty: qty,
        base_date: purchaseDate.replace(/\D/g, ""),
        synced_at: now,
      });
    }
  }

  const allocationRows = allocations.map((item, index) => ({
    import_order_id: Number(item.import_order_id),
    import_order_item_id: text(item.import_order_item_id) ? Number(item.import_order_item_id) : null,
    import_product_id: Number(item.import_product_id),
    import_option_key: text(item.import_option_key) || null,
    import_option_name: text(item.import_option_name) || null,
    product_id: text(item.product_id),
    sku: text(item.sku) || productSku(productMap.get(text(item.product_id)) || {}),
    allocated_qty: numberValue(item.allocated_qty),
    unit_cost: numberValue(item.unit_cost),
    warehouse_id: warehouseId,
    purchase_id: text(savedPurchases[index]?.id) || null,
    created_at: now,
    updated_at: now,
  }));
  const savedAllocations = await insertRows("import_purchase_sku_allocations", allocationRows);
  return {
    ok: true,
    purchases: savedPurchases,
    allocations: savedAllocations,
    count: savedPurchases.length,
  };
}

async function decrementCurrentInventoryForPurchase(row: AnyRecord) {
  const qty = numberValue(row.qty);
  if (qty <= 0) return false;
  const filters: Record<string, string | number> = { limit: 1 };
  const productId = text(row.product_id);
  const warehouseId = text(row.warehouse_id);
  const productCode = text(row.prod_cd || row.product_code || row.sku);
  const warehouseCode = text(row.wh_cd || row.warehouse_code) || "100";
  if (productId) filters.product_id = `eq.${productId}`;
  else if (productCode) filters.prod_cd = `eq.${productCode}`;
  else return false;
  if (warehouseId) filters.warehouse_id = `eq.${warehouseId}`;
  else filters.wh_cd = `eq.${warehouseCode}`;

  const [current] = await selectRows<AnyRecord>("inventory_current", filters).catch(() => []);
  if (!current?.id) return false;
  const previous = numberValue(current.on_hand_qty ?? current.bal_qty);
  const nextQty = previous - qty;
  const reserved = numberValue(current.reserved_qty);
  await patchRows("inventory_current", { id: `eq.${current.id}` }, {
    on_hand_qty: nextQty,
    available_qty: nextQty - reserved,
    bal_qty: nextQty,
    updated_at: nowIso(),
    synced_at: nowIso(),
  });
  return true;
}

async function expectedPurchaseProductCodesForOrder(orderKey: string) {
  const items = await selectRows<AnyRecord>("import_erp_order_items", {
    order_id: `eq.${orderKey}`,
    order: "sort_order.asc",
    limit: 1000,
  }).catch(() => []);
  const codes = new Set<string>();
  for (const item of items) {
    const productId = text(item.product_id);
    if (!productId) continue;
    const allLinks = await listImportProductLinks(productId).catch(() => []);
    const optionValue = text(item.option_value);
    const optionLinks = optionValue ? allLinks.filter((link) => sameImportOption(link, optionValue)) : [];
    const links = optionLinks.length ? optionLinks : allLinks.filter((link) => !linkOptionName(link));
    const skuAllocations = parseSkuAllocation(item.sku_allocation_json || item.sku_allocations || item.linked_sku_qty);
    for (const link of links) {
      const savedQty = text(skuAllocations[skuAllocationKey(link)]);
      const defaultQty = numberValue(link.default_qty);
      const lineQty = numberValue(savedQty || defaultQty || item.quantity || 0);
      if (lineQty <= 0) continue;
      const product = (link.product as AnyRecord) || {};
      const code = productSku(product) || text(link.sku);
      if (code && code !== "-") codes.add(code);
    }
  }
  return Array.from(codes);
}

async function fallbackImportEntryPurchases(orderKey: string, arrivalDate?: string) {
  const purchaseDate = dateKey(arrivalDate);
  if (!arrivalDate || !purchaseDate) return [];
  const productCodes = await expectedPurchaseProductCodesForOrder(orderKey);
  if (!productCodes.length) return [];
  const baseFilters = {
    cust_name: "eq.FN해외 상품 구매(소싱)",
    prod_cd: sqlList(productCodes),
    limit: 1000,
  };
  const rows = [
    ...await selectRows<AnyRecord>("purchases", { ...baseFilters, io_date: `eq.${purchaseDate}` }).catch(() => []),
    ...await selectRows<AnyRecord>("purchases", { ...baseFilters, purchase_date: `eq.${purchaseDate}` }).catch(() => []),
  ];
  const safeSourcePattern = /^import-order-|^manual-purchase-/;
  return rows.filter((row) => {
    const sourceRef = text(row.source_ref_id);
    const sourceFile = text(row.source_file_name);
    return safeSourcePattern.test(sourceRef)
      || sourceFile === "FN_OS_IMPORT_PURCHASE_ENTRY"
      || sourceFile === "FN_OS_PURCHASE_ENTRY";
  });
}

export async function deleteImportReceiptForOrder(orderId: string | number, options: { arrivalDate?: string } = {}) {
  if (!hasDbConfig()) throw new Error("Supabase environment variables are not configured.");
  const orderKey = text(orderId);
  if (!orderKey) throw new Error("orderId is required.");

  const allocations = await selectRows<AnyRecord>("import_purchase_sku_allocations", {
    import_order_id: `eq.${orderKey}`,
    limit: 1000,
  }).catch(() => []);
  const allocationPurchaseIds = allocations.map((row) => text(row.purchase_id)).filter(Boolean);
  const purchasesByAllocation = await Promise.all(allocationPurchaseIds.map((purchaseId) => (
    selectRows<AnyRecord>("purchases", { id: `eq.${purchaseId}`, limit: 1 }).then((rows) => rows[0]).catch(() => null)
  )));
  const directPurchases = await selectRows<AnyRecord>("purchases", {
    source_type: "eq.import_order",
    source_ref_id: `eq.${orderKey}`,
    limit: 1000,
  }).catch(() => []);
  const entryPurchases = await selectRows<AnyRecord>("purchases", {
    source_ref_id: `like.import-order-${orderKey}-%`,
    limit: 1000,
  }).catch(() => []);
  const entryBasePurchases = await selectRows<AnyRecord>("purchases", {
    source_ref_id: `eq.import-order-${orderKey}`,
    limit: 1000,
  }).catch(() => []);
  const fallbackPurchases = await fallbackImportEntryPurchases(orderKey, options.arrivalDate).catch(() => []);
  const purchaseMap = new Map<string, AnyRecord>();
  for (const row of [...purchasesByAllocation, ...directPurchases, ...entryPurchases, ...entryBasePurchases, ...fallbackPurchases]) {
    if (!row) continue;
    const purchase = row as AnyRecord;
    const key = text(purchase.id || purchase.source_ref_id);
    if (key) purchaseMap.set(key, purchase);
  }
  const purchases = Array.from(purchaseMap.values());

  let inventoryAdjusted = 0;
  for (const purchase of purchases) {
    if (await decrementCurrentInventoryForPurchase(purchase)) inventoryAdjusted += 1;
  }

  let movementsDeleted = 0;
  let purchasesDeleted = 0;
  for (const purchase of purchases) {
    const purchaseId = text(purchase.id);
    const purchaseSourceRefId = text(purchase.source_ref_id);
    if (purchaseId) {
      movementsDeleted += (await deleteRows<AnyRecord>("inventory_movements", {
        source_type: "eq.purchases",
        source_ref_id: `eq.${purchaseId}`,
      }).catch(() => [])).length;
      if (purchaseSourceRefId) {
        movementsDeleted += (await deleteRows<AnyRecord>("inventory_movements", {
          source_type: "eq.purchases",
          source_ref_id: `eq.${purchaseSourceRefId}`,
        }).catch(() => [])).length;
      }
      purchasesDeleted += (await deleteRows<AnyRecord>("purchases", { id: `eq.${purchaseId}` }).catch(() => [])).length;
    } else {
      if (purchaseSourceRefId) {
        purchasesDeleted += (await deleteRows<AnyRecord>("purchases", { source_ref_id: `eq.${purchaseSourceRefId}` }).catch(() => [])).length;
      }
    }
  }
  const allocationsDeleted = (await deleteRows<AnyRecord>("import_purchase_sku_allocations", {
    import_order_id: `eq.${orderKey}`,
  }).catch(() => [])).length;

  return {
    ok: true,
    purchases_deleted: purchasesDeleted,
    allocations_deleted: allocationsDeleted,
    movements_deleted: movementsDeleted,
    inventory_adjusted: inventoryAdjusted,
  };
}
