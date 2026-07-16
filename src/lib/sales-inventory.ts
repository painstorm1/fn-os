import { createUploadBatch, deleteRows, hasDbConfig, insertRows, patchRows, selectRows, updateUploadBatch, upsertRows } from "./fnos-db";

type RawRow = Record<string, unknown>;
type QueryValue = string | number | boolean | null | undefined;

export type ImportResult = {
  ok: boolean;
  message: string;
  db_saved_count: number;
  success_count: number;
  fail_count: number;
  errors: string[];
  batch_id?: string;
  inventory_movement_count?: number;
  duplicate_count?: number;
  external_sync_enabled?: false;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function first(row: RawRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{8}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10).replace(/\D/g, "");
  return raw.replace(/\D/g, "").slice(0, 8);
}

function todayCompact() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/\D/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function cleanForRef(value: unknown) {
  return text(value).replace(/\s+/g, " ");
}

function buildSourceRef(sourceFileName: string | undefined, date: string, sequence: string, productCode: string, qty: number) {
  return [sourceFileName || "FN_OS_WEB", date, sequence, productCode, qty].map(cleanForRef).join("|");
}

function importEntryDate(row: RawRow, keys: string[]) {
  return text(first(row, keys)) || todayCompact();
}

function groupKeyPart(value: unknown) {
  return encodeURIComponent(text(value));
}

function decodeGroupKeyPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isoDateFromCompact(value: string) {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : "";
}

function entryCustomerCode(row: RawRow) {
  return text(row.cust_code || row.customer_code || row.supplier_code || row.CUST);
}

function entryCustomerName(row: RawRow) {
  return text(row.cust_name || row.customer_name || row.supplier_name || row.CUST_DES);
}

function batchEntryGroupKey(row: RawRow, mode: "sales" | "purchases") {
  const batchId = text(row.upload_batch_id);
  if (!batchId) return "";
  const date = dateKey(row.io_date ?? (mode === "sales" ? row.sale_date : row.purchase_date) ?? row.created_at);
  const customerCode = entryCustomerCode(row);
  const customerName = entryCustomerName(row);
  if (!date || !(customerCode || customerName)) return `batch:${batchId}`;
  return ["batch-entry", batchId, date, customerCode, customerName].map(groupKeyPart).join(":");
}

function legacyProductEntryRequiredError(row: RawRow, mode: "sales" | "purchases", index: number) {
  const productCode = text(first(row, ["품목코드", "product_code", "prod_cd", "PROD_CD"]));
  const productName = text(first(row, ["품목명", "product_name", "prod_name", "PROD_DES"]));
  if (productCode || productName) return "";
  return `${mode === "sales" ? "판매" : "구매"} ${index + 1}행: 품목코드 또는 품목명이 필요합니다.`;
}

function vatIsExcluded(row: RawRow) {
  const vatType = text(first(row, ["VAT 포함/별도", "vat_type", "VAT_TYPE"])).toLowerCase();
  return vatType.includes("별도") || vatType.includes("excluded");
}

function calculatedAmounts(row: RawRow) {
  const qty = numberValue(first(row, ["수량", "qty", "QTY"]));
  const explicitTax = numberValue(first(row, ["세액", "부가세", "tax_amt", "vat_amount", "VAT_AMT"]));
  const explicitSupply = numberValue(first(row, ["공급가액", "정산예정금액", "supply_amt", "SUPPLY_AMT"]));
  const rawPrice = numberValue(first(row, ["단가(vat포함)", "단가", "price", "PRICE"]));
  const price = rawPrice || explicitSupply;
  const tax = explicitTax || (vatIsExcluded(row) ? qty * price * 0.1 : 0);
  const calculatedSupply = qty * price + tax;
  const supplyAmt = explicitSupply || calculatedSupply;
  const totalAmt = numberValue(first(row, ["합계금액", "총금액", "판매금액", "구매금액", "total_amount", "TOTAL_AMOUNT"])) || supplyAmt;
  return { qty, price, tax, supplyAmt, totalAmt };
}

function legacyEntryRequiredError(row: RawRow, kind: "sales" | "purchases", index: number) {
  const date = text(first(row, ["일자", "판매일", "구매일", "sale_date", "purchase_date", "io_date", "IO_DATE"]));
  const customer = text(first(row, ["거래처코드", "거래처명", "공급처코드", "공급처", "customer_code", "customer_name", "supplier_code", "supplier_name", "cust_code", "cust_name", "CUST", "CUST_DES"]));
  const warehouse = text(first(row, ["입고창고", "출하창고", "창고코드", "warehouse_code", "wh_cd", "WH_CD"]));
  const product = text(first(row, ["품목코드", "품목명", "product_code", "product_name", "prod_cd", "prod_name", "PROD_CD", "PROD_DES"]));
  const qty = numberValue(first(row, ["수량", "qty", "QTY"]));
  const missing: string[] = [];
  if (!date) missing.push("일자");
  if (!customer) missing.push("거래처코드 또는 거래처명");
  if (!warehouse) missing.push(kind === "purchases" ? "입고창고" : "창고");
  if (!product) missing.push("품목코드 또는 품목명");
  if (qty <= 0) missing.push("수량");
  return missing.length ? `${index + 1}행 필수값 누락: ${missing.join(", ")}` : "";
}

function normalizeSale(row: RawRow, index: number, batchId: string, sourceFileName?: string) {
  const { qty, price, tax, supplyAmt, totalAmt } = calculatedAmounts(row);
  const saleDate = importEntryDate(row, ["일자", "판매일", "sale_date", "io_date", "IO_DATE"]);
  const uploadSerNo = text(first(row, ["순번", "upload_ser_no", "UPLOAD_SER_NO"])) || String(index + 1);
  const productCode = text(first(row, ["품목코드", "product_code", "prod_cd", "PROD_CD"]));
  const prodName = text(first(row, ["품목명", "product_name", "prod_name", "PROD_DES"]));
  const sku = text(first(row, ["SKU", "sku"])) || productCode;
  const productKey = productCode || prodName;

  return {
    source_type: "fn_os",
    source_file_name: sourceFileName || null,
    source_ref_id: text(first(row, ["source_ref_id", "SOURCE_REF_ID"])) || buildSourceRef(sourceFileName, saleDate, uploadSerNo, productKey, qty),
    upload_batch_id: batchId,
    io_date: saleDate,
    sale_date: saleDate,
    upload_ser_no: uploadSerNo,
    cust_code: text(first(row, ["거래처코드", "customer_code", "cust_code", "CUST"])),
    cust_name: text(first(row, ["거래처명", "쇼핑몰", "customer_name", "cust_name", "CUST_DES"])),
    emp_cd: text(first(row, ["담당자", "emp_cd", "EMP_CD"])),
    wh_cd: text(first(row, ["출하창고", "입고창고", "창고코드", "warehouse_code", "wh_cd", "WH_CD"])) || "100",
    io_type: text(first(row, ["거래유형", "io_type", "IO_TYPE"])),
    currency: text(first(row, ["통화", "currency", "CURRENCY"])),
    exchange_rate: numberValue(first(row, ["환율", "exchange_rate", "EXCHANGE_RATE"])),
    prod_cd: productCode,
    prod_name: prodName,
    size_des: text(first(row, ["규격", "옵션", "size_des", "SIZE_DES"])),
    sku,
    qty,
    price,
    unit_price: price,
    foreign_amt: numberValue(first(row, ["외화금액", "foreign_amt", "FOREIGN_AMT"])),
    supply_amt: supplyAmt,
    supply_amount: supplyAmt,
    vat_amount: tax,
    total_amount: totalAmt,
    remarks: text(first(row, ["적요", "배송요청사항", "remarks", "REMARKS"])),
    make_flag: text(first(row, ["생산전표생성", "make_flag", "MAKE_FLAG"])),
    sale_status: "saved",
    sync_status: "SAVED",
    sync_message: "FN OS DB saved",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function normalizePurchase(row: RawRow, index: number, batchId: string, sourceFileName?: string) {
  const { qty, price, tax, supplyAmt, totalAmt } = calculatedAmounts(row);
  const purchaseDate = importEntryDate(row, ["일자", "구매일", "purchase_date", "io_date", "IO_DATE"]);
  const uploadSerNo = text(first(row, ["순번", "upload_ser_no", "UPLOAD_SER_NO"])) || String(index + 1);
  const productCode = text(first(row, ["품목코드", "product_code", "prod_cd", "PROD_CD"]));
  const prodName = text(first(row, ["품목명", "product_name", "prod_name", "PROD_DES"]));
  const sku = text(first(row, ["SKU", "sku"])) || productCode;
  const productKey = productCode || prodName;

  return {
    source_type: "fn_os",
    source_file_name: sourceFileName || null,
    source_ref_id: text(first(row, ["source_ref_id", "SOURCE_REF_ID"])) || buildSourceRef(sourceFileName, purchaseDate, uploadSerNo, productKey, qty),
    upload_batch_id: batchId,
    io_date: purchaseDate,
    purchase_date: purchaseDate,
    upload_ser_no: uploadSerNo,
    cust_code: text(first(row, ["거래처코드", "공급처코드", "supplier_code", "cust_code", "CUST"])),
    cust_name: text(first(row, ["거래처명", "공급처", "supplier_name", "cust_name", "CUST_DES"])),
    wh_cd: text(first(row, ["입고창고", "출하창고", "창고코드", "warehouse_code", "wh_cd", "WH_CD"])) || "100",
    prod_cd: productCode,
    prod_name: prodName,
    sku,
    qty,
    price,
    unit_price: price,
    supply_amt: supplyAmt,
    supply_amount: supplyAmt,
    vat_amt: tax,
    vat_amount: tax,
    total_amount: totalAmt,
    remarks: text(first(row, ["적요", "memo", "remarks", "REMARKS"])),
    sync_status: "SAVED",
    sync_message: "FN OS DB saved",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function noDbResult(rows: RawRow[]): ImportResult {
  return {
    ok: false,
    message: "Supabase environment variables are not configured.",
    db_saved_count: 0,
    success_count: 0,
    fail_count: rows.length,
    errors: ["Supabase environment variables are not configured."],
    external_sync_enabled: false,
  };
}

async function optionalRows(table: string, query?: Record<string, QueryValue>) {
  return selectRows<Record<string, unknown>>(table, query).catch(() => []);
}

function groupFilters(table: "sales" | "purchases", groupKey: string) {
  const key = text(groupKey);
  if (key.startsWith("batch-entry:")) {
    const [, batchPart = "", datePart = "", codePart = "", namePart = ""] = key.split(":");
    const batchId = decodeGroupKeyPart(batchPart);
    const date = decodeGroupKeyPart(datePart);
    const customerCode = decodeGroupKeyPart(codePart);
    const customerName = decodeGroupKeyPart(namePart);
    const filters: Record<string, QueryValue> = { upload_batch_id: `eq.${batchId}` };
    const isoDate = isoDateFromCompact(date);
    const dateValues = Array.from(new Set([date, isoDate].filter(Boolean)));
    if (dateValues.length) {
      const documentDateColumn = table === "sales" ? "sale_date" : "purchase_date";
      filters.or = `(${dateValues.flatMap((value) => [`io_date.eq.${value}`, `${documentDateColumn}.eq.${value}`]).join(",")})`;
    }
    if (customerCode) filters.cust_code = `eq.${customerCode}`;
    if (customerName) filters.cust_name = `eq.${customerName}`;
    return filters;
  }
  if (key.startsWith("batch:")) return { upload_batch_id: `eq.${key.slice(6)}` };
  if (key.startsWith("manual:")) return { source_ref_id: `ilike.${key.slice(7)}%` };
  if (key.startsWith("source:")) return { source_ref_id: `ilike.${key.slice(7)}%` };
  if (key.startsWith("row:")) return { id: `eq.${key.slice(4)}` };
  if (key.startsWith("manual-sale-") || key.startsWith("manual-purchase-")) return { source_ref_id: `ilike.${key}%` };
  return { upload_batch_id: `eq.${key}` };
}

export async function updateEntryGroup(table: "sales" | "purchases", groupKey: string, values: RawRow) {
  if (!hasDbConfig()) throw new Error("Supabase environment variables are not configured.");
  const date = text(values.io_date || values.sale_date || values.purchase_date);
  const updateValues: RawRow = {
    updated_at: nowIso(),
  };
  if (date) {
    updateValues.io_date = date;
    if (table === "sales") updateValues.sale_date = date;
    else updateValues.purchase_date = date;
  }
  if (text(values.cust_code)) updateValues.cust_code = text(values.cust_code);
  if (text(values.cust_name)) updateValues.cust_name = text(values.cust_name);
  if (text(values.wh_cd)) updateValues.wh_cd = text(values.wh_cd);
  if (text(values.vat_type)) updateValues.vat_type = text(values.vat_type);
  return patchRows(table, groupFilters(table, groupKey), updateValues);
}

export async function deleteEntryGroups(table: "sales" | "purchases", groupKeys: string[]) {
  if (!hasDbConfig()) throw new Error("Supabase environment variables are not configured.");
  const deleted: RawRow[] = [];
  for (const groupKey of groupKeys) {
    const rows = await deleteRows<RawRow>(table, groupFilters(table, groupKey));
    deleted.push(...rows);
  }
  if (deleted.length) await reverseDeletedEntryInventoryMovements(table, deleted);
  return deleted;
}

function missingColumnName(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.match(/컬럼 '([^']+)'/)?.[1] || message.match(/Could not find the ['"]?([^'"\s]+)['"]? column/i)?.[1] || "";
}

async function insertRowsWithSchemaFallback(table: string, rows: RawRow[]) {
  let nextRows = rows.map((row) => ({ ...row }));
  const removedColumns = new Set<string>();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const saved = nextRows.length ? await insertRows<RawRow>(table, nextRows) : [];
      return { saved, removedColumns: Array.from(removedColumns) };
    } catch (error) {
      const column = missingColumnName(error);
      if (!column || removedColumns.has(column)) throw error;
      removedColumns.add(column);
      nextRows = nextRows.map((row) => {
        const { [column]: _removed, ...rest } = row;
        return rest;
      });
    }
  }
  throw new Error(`${table} 저장 가능 컬럼 확인에 실패했습니다.`);
}

async function patchRowsWithSchemaFallback(table: string, filters: Record<string, QueryValue>, values: RawRow) {
  let nextValues = { ...values };
  const removedColumns = new Set<string>();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await patchRows(table, filters, nextValues);
    } catch (error) {
      const column = missingColumnName(error);
      if (!column || removedColumns.has(column) || !(column in nextValues)) throw error;
      removedColumns.add(column);
      const { [column]: _removed, ...rest } = nextValues;
      nextValues = rest;
    }
  }
  throw new Error(`${table} 수정 가능 컬럼 확인에 실패했습니다.`);
}

function sum(rows: RawRow[], pick: (row: RawRow) => unknown) {
  return rows.reduce((total, row) => total + numberValue(pick(row)), 0);
}

function groupRows(rows: RawRow[], labelFor: (row: RawRow) => string, amountFor: (row: RawRow) => unknown) {
  const groups = new Map<string, { label: string; amount: number; qty: number; count: number }>();
  for (const row of rows) {
    const label = labelFor(row) || "-";
    const current = groups.get(label) || { label, amount: 0, qty: 0, count: 0 };
    current.amount += numberValue(amountFor(row));
    current.qty += numberValue(row.qty);
    current.count += 1;
    groups.set(label, current);
  }
  return Array.from(groups.values()).sort((a, b) => b.amount - a.amount);
}

async function existingSourceRefs(table: "sales" | "purchases", refs: string[]) {
  const uniqueRefs = Array.from(new Set(refs.filter(Boolean)));
  if (!uniqueRefs.length) return new Set<string>();
  const existing = new Set<string>();
  const chunkSize = 100;
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueRefs.length; index += chunkSize) {
    chunks.push(uniqueRefs.slice(index, index + chunkSize));
  }
  const batchSize = 12;
  for (let index = 0; index < chunks.length; index += batchSize) {
    const rowGroups = await Promise.all(chunks.slice(index, index + batchSize).map((chunk) => {
      const escaped = chunk.map((ref) => `"${String(ref).replace(/"/g, '\\"')}"`).join(",");
      return optionalRows(table, { source_ref_id: `in.(${escaped})`, limit: chunk.length });
    }));
    rowGroups.flat().forEach((row) => {
      const ref = text(row.source_ref_id);
      if (ref) existing.add(ref);
    });
  }
  return existing;
}

async function findProduct(row: RawRow) {
  const productId = text(row.product_id);
  if (productId) {
    const [byId] = await optionalRows("products", { id: `eq.${productId}`, limit: 1 });
    if (byId) return byId;
  }
  const productCode = text(row.prod_cd || row.product_code);
  const sku = text(row.sku) || productCode;
  const name = text(row.prod_name || row.product_name);
  const byCode = productCode ? await optionalRows("products", { product_code: `eq.${productCode}`, limit: 1 }) : [];
  if (byCode[0]) return byCode[0];
  const byLegacyCode = productCode ? await optionalRows("products", { prod_cd: `eq.${productCode}`, limit: 1 }) : [];
  if (byLegacyCode[0]) return byLegacyCode[0];
  const bySku = sku ? await optionalRows("products", { sku: `eq.${sku}`, limit: 1 }) : [];
  if (bySku[0]) return bySku[0];
  const byProductName = name ? await optionalRows("products", { product_name: `eq.${name}`, limit: 1 }) : [];
  if (byProductName[0]) return byProductName[0];
  const byLegacyName = name ? await optionalRows("products", { prod_name: `eq.${name}`, limit: 1 }) : [];
  return byLegacyName[0] || null;
}

function productCode(row: RawRow | null | undefined) {
  return text(row?.product_code || row?.prod_cd || row?.sku);
}

function productName(row: RawRow | null | undefined) {
  return text(row?.product_name || row?.prod_name || row?.name);
}

function normalizeInventoryProductAttribute(value: unknown) {
  const normalized = text(value).toLowerCase();
  if (normalized === "set" || normalized === "세트" || normalized === "ng" || normalized.includes("[ng")) return "set";
  if (normalized === "rg" || normalized === "로켓그로스") return "rg";
  return "plain";
}

function isVirtualInventoryProduct(row: RawRow | null | undefined) {
  const attribute = normalizeInventoryProductAttribute(row?.product_attribute);
  const kind = normalizeInventoryProductAttribute(row?.product_kind || row?.item_kind || row?.product_type);
  const marker = `${productCode(row)} ${productName(row)}`;
  return attribute === "set" || attribute === "rg" || kind === "set" || kind === "rg" || /(^|\s)\[(RG|SET|NG)[\]\}]/i.test(marker);
}

async function findBomComponent(item: RawRow) {
  const componentId = text(item.component_product_id || item.product_id);
  if (componentId) {
    const [component] = await optionalRows("products", { id: `eq.${componentId}`, limit: 1 });
    if (component) return component;
  }
  const componentSku = text(item.component_sku || item.sku || item.product_code || item.prod_cd);
  if (!componentSku) return null;
  const [byCode] = await optionalRows("products", { product_code: `eq.${componentSku}`, limit: 1 });
  if (byCode) return byCode;
  const [byLegacyCode] = await optionalRows("products", { prod_cd: `eq.${componentSku}`, limit: 1 });
  if (byLegacyCode) return byLegacyCode;
  const [bySku] = await optionalRows("products", { sku: `eq.${componentSku}`, limit: 1 });
  return bySku || null;
}

function canonicalCustomerCode(row: RawRow | null | undefined) {
  return text(row?.customer_code || row?.cust_code);
}

function canonicalCustomerName(row: RawRow | null | undefined) {
  return text(row?.customer_name || row?.cust_name);
}

function warehouseCode(row: RawRow | null | undefined) {
  return text(row?.warehouse_code || row?.wh_cd);
}

function warehouseName(row: RawRow | null | undefined) {
  return text(row?.warehouse_name || row?.wh_name);
}

async function findWarehouse(row: RawRow) {
  const warehouseId = text(row.warehouse_id);
  if (warehouseId) {
    const [byId] = await optionalRows("warehouses", { id: `eq.${warehouseId}`, limit: 1 });
    if (byId) return byId;
  }
  const whCd = text(row.wh_cd || row.warehouse_code) || "100";
  const byCode = whCd ? await optionalRows("warehouses", { warehouse_code: `eq.${whCd}`, limit: 1 }) : [];
  if (byCode[0]) return byCode[0];
  const byLegacyCode = whCd ? await optionalRows("warehouses", { wh_cd: `eq.${whCd}`, limit: 1 }) : [];
  if (byLegacyCode[0]) return byLegacyCode[0];
  const whName = text(row.wh_name || row.warehouse_name);
  const byName = whName ? await optionalRows("warehouses", { warehouse_name: `eq.${whName}`, limit: 1 }) : [];
  if (byName[0]) return byName[0];
  const byLegacyName = whName ? await optionalRows("warehouses", { wh_name: `eq.${whName}`, limit: 1 }) : [];
  return byLegacyName[0] || null;
}

function lookupKey(value: unknown) {
  return text(value).toLowerCase();
}

function pushLookup(map: Map<string, RawRow[]>, value: unknown, row: RawRow) {
  const key = lookupKey(value);
  if (!key) return;
  const current = map.get(key) || [];
  if (current.some((item) => sameReference(item, row))) return;
  map.set(key, [...current, row]);
}

function sameReference(left: RawRow | null | undefined, right: RawRow | null | undefined) {
  if (!left || !right) return false;
  const leftId = text(left.id);
  const rightId = text(right.id);
  if (leftId && rightId) return leftId === rightId;
  return left === right;
}

function matchesAny(value: string, candidates: string[]) {
  const key = lookupKey(value);
  return Boolean(key) && candidates.some((candidate) => lookupKey(candidate) === key);
}

async function allReferenceRows(table: "customers" | "products" | "warehouses") {
  return optionalRows(table, { order: "created_at.asc", limit: 50000 });
}

function uniqueLookupValues(values: unknown[]) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function sqlInFilter(values: string[]) {
  return `in.(${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
}

function referenceRowDedupeKey(row: RawRow, fallbackIndex: number) {
  return text(row.id)
    || [row.customer_code, row.cust_code, row.product_code, row.prod_cd, row.sku, row.warehouse_code, row.wh_cd, row.customer_name, row.product_name, row.warehouse_name]
      .map(text)
      .filter(Boolean)
      .join("::")
    || `row-${fallbackIndex}`;
}

async function lookupReferenceRows(
  table: "customers" | "products" | "warehouses",
  filters: Record<string, unknown[]>,
) {
  const distinctLookupValues = uniqueLookupValues(Object.values(filters).flat());
  if (!distinctLookupValues.length) return [] as RawRow[];
  if (distinctLookupValues.length > 120) return allReferenceRows(table);

  const rowMap = new Map<string, RawRow>();
  const entries = Object.entries(filters)
    .map(([column, values]) => [column, uniqueLookupValues(values)] as const)
    .filter(([, values]) => values.length > 0);

  await Promise.all(entries.map(async ([column, values]) => {
    const limit = Math.min(50000, Math.max(50, values.length * 20));
    const rows = await optionalRows(table, { [column]: sqlInFilter(values), order: "created_at.asc", limit });
    rows.forEach((row, index) => rowMap.set(referenceRowDedupeKey(row, rowMap.size + index), row));
  }));
  return Array.from(rowMap.values());
}

async function referenceRowsForEntries(rows: RawRow[]) {
  return Promise.all([
    lookupReferenceRows("customers", {
      customer_code: rows.map((row) => row.cust_code || row.customer_code),
      cust_code: rows.map((row) => row.cust_code || row.customer_code),
      customer_name: rows.map((row) => row.cust_name || row.customer_name),
      cust_name: rows.map((row) => row.cust_name || row.customer_name),
    }),
    lookupReferenceRows("products", {
      product_code: rows.map((row) => row.prod_cd || row.product_code || row.sku),
      prod_cd: rows.map((row) => row.prod_cd || row.product_code || row.sku),
      sku: rows.map((row) => row.sku || row.prod_cd || row.product_code),
      product_name: rows.map((row) => row.prod_name || row.product_name),
      prod_name: rows.map((row) => row.prod_name || row.product_name),
    }),
    lookupReferenceRows("warehouses", {
      warehouse_code: rows.map((row) => row.wh_cd || row.warehouse_code),
      wh_cd: rows.map((row) => row.wh_cd || row.warehouse_code),
      warehouse_name: rows.map((row) => row.wh_name || row.warehouse_name),
      wh_name: rows.map((row) => row.wh_name || row.warehouse_name),
    }),
  ]);
}

async function validateEntryReferences(rows: RawRow[], kind: "sales" | "purchases") {
  const [customers, products, warehouses] = await referenceRowsForEntries(rows);

  const customerByCode = new Map<string, RawRow[]>();
  const customerByName = new Map<string, RawRow[]>();
  customers.forEach((row) => {
    pushLookup(customerByCode, row.customer_code, row);
    pushLookup(customerByCode, row.cust_code, row);
    pushLookup(customerByName, row.customer_name, row);
    pushLookup(customerByName, row.cust_name, row);
  });

  const productByCode = new Map<string, RawRow[]>();
  const productByName = new Map<string, RawRow[]>();
  products.forEach((row) => {
    pushLookup(productByCode, row.product_code, row);
    pushLookup(productByCode, row.prod_cd, row);
    pushLookup(productByCode, row.sku, row);
    pushLookup(productByName, row.product_name, row);
    pushLookup(productByName, row.prod_name, row);
  });

  const warehouseByCode = new Map<string, RawRow[]>();
  const warehouseByName = new Map<string, RawRow[]>();
  warehouses.forEach((row) => {
    pushLookup(warehouseByCode, row.warehouse_code, row);
    pushLookup(warehouseByCode, row.wh_cd, row);
    pushLookup(warehouseByName, row.warehouse_name, row);
    pushLookup(warehouseByName, row.wh_name, row);
  });

  const errors: string[] = [];
  const normalizedRows = rows.map((row, index) => {
    const next = { ...row };
    const rowLabel = `${index + 1}행`;

    const customerCodeValue = text(next.cust_code || next.customer_code);
    const customerNameValue = text(next.cust_name || next.customer_name);
    const customerCodeMatches = customerCodeValue ? customerByCode.get(lookupKey(customerCodeValue)) || [] : [];
    const customerNameMatches = customerNameValue ? customerByName.get(lookupKey(customerNameValue)) || [] : [];
    const customerByCodeRow = customerCodeMatches[0] || null;
    const customerByNameRow = customerNameMatches[0] || null;

    const customer = customerByCodeRow || customerByNameRow;
    if (customerCodeValue && !customerByCodeRow) {
      errors.push(`${rowLabel}: 거래처코드 '${customerCodeValue}'가 기초관리 거래처 DB에 없습니다.`);
    }
    if (customerNameValue && !customerByNameRow && !customerByCodeRow) {
      errors.push(`${rowLabel}: 거래처명 '${customerNameValue}'가 기초관리 거래처 DB에 없습니다.`);
    }
    if (!customerCodeValue && customerNameMatches.length > 1) {
      errors.push(`${rowLabel}: 거래처명 '${customerNameValue}'와 일치하는 거래처가 여러 개입니다. 거래처코드를 입력해 주세요.`);
    }
    if (customerCodeValue && customerNameValue && customerByCodeRow && customerByNameRow && !sameReference(customerByCodeRow, customerByNameRow)) {
      errors.push(`${rowLabel}: 거래처코드 '${customerCodeValue}'와 거래처명 '${customerNameValue}'가 서로 다른 거래처입니다.`);
    }
    if (customerByCodeRow && customerNameValue && !matchesAny(customerNameValue, [text(customerByCodeRow.customer_name), text(customerByCodeRow.cust_name)])) {
      errors.push(`${rowLabel}: 거래처코드 '${customerCodeValue}'의 기초관리 거래처명은 '${canonicalCustomerName(customerByCodeRow)}'입니다.`);
    }
    if (customer) {
      next.cust_code = canonicalCustomerCode(customer);
      next.cust_name = canonicalCustomerName(customer);
    }

    const whValue = text(next.wh_cd || next.warehouse_code);
    const whNameValue = text(next.wh_name || next.warehouse_name);
    const whCodeMatches = whValue ? warehouseByCode.get(lookupKey(whValue)) || [] : [];
    const whNameMatches = whNameValue ? warehouseByName.get(lookupKey(whNameValue)) || [] : [];
    const whByCodeRow = whCodeMatches[0] || null;
    const whByNameRow = whNameMatches[0] || null;
    const warehouse = whByCodeRow || whByNameRow;
    if (whValue && !whByCodeRow) {
      errors.push(`${rowLabel}: ${kind === "purchases" ? "입고창고" : "출하창고"} '${whValue}'가 기초관리 창고 DB에 없습니다.`);
    }
    if (!whValue && whNameValue && !whByNameRow) {
      errors.push(`${rowLabel}: 창고명 '${whNameValue}'가 기초관리 창고 DB에 없습니다.`);
    }
    if (!whValue && whNameMatches.length > 1) {
      errors.push(`${rowLabel}: 창고명 '${whNameValue}'와 일치하는 창고가 여러 개입니다. 창고코드를 입력해 주세요.`);
    }
    if (whValue && whNameValue && whByCodeRow && whByNameRow && !sameReference(whByCodeRow, whByNameRow)) {
      errors.push(`${rowLabel}: 창고코드 '${whValue}'와 창고명 '${whNameValue}'가 서로 다른 창고입니다.`);
    }
    if (warehouse) {
      next.wh_cd = warehouseCode(warehouse);
      next.warehouse_id = text(warehouse.id) || null;
      if (warehouseName(warehouse)) next.wh_name = warehouseName(warehouse);
    }

    const productCodeValue = text(next.prod_cd || next.product_code || next.sku);
    const productNameValue = text(next.prod_name || next.product_name);
    const productCodeMatches = productCodeValue ? productByCode.get(lookupKey(productCodeValue)) || [] : [];
    const productNameMatches = productNameValue ? productByName.get(lookupKey(productNameValue)) || [] : [];
    const productByCodeRow = productCodeMatches[0] || null;
    const productByNameRow = productNameMatches[0] || null;
    const product = productByCodeRow || productByNameRow;
    if (productCodeValue && !productByCodeRow) {
      errors.push(`${rowLabel}: 품목코드 '${productCodeValue}'가 기초관리 품목 DB에 없습니다.`);
    }
    if (productNameValue && !productByNameRow && !productByCodeRow) {
      errors.push(`${rowLabel}: 품목명 '${productNameValue}'가 기초관리 품목 DB에 없습니다.`);
    }
    if (!productCodeValue && productNameMatches.length > 1) {
      errors.push(`${rowLabel}: 품목명 '${productNameValue}'와 일치하는 품목이 여러 개입니다. 품목코드를 입력해 주세요.`);
    }
    if (!productByCodeRow && productByNameRow && productCodeValue && text(productByNameRow.product_code || productByNameRow.prod_cd || productByNameRow.sku) && !matchesAny(productCodeValue, [text(productByNameRow.product_code), text(productByNameRow.prod_cd), text(productByNameRow.sku)])) {
      errors.push(`${rowLabel}: 품목명 '${productNameValue}'의 기초관리 품목코드는 '${productCode(productByNameRow)}'입니다.`);
    }
    if (product) {
      const code = productCode(product);
      next.prod_cd = code;
      next.product_code = code;
      next.sku = text(product.sku) || code;
      next.prod_name = productName(product);
      next.product_name = productName(product);
      next.product_id = text(product.id) || null;
      next.size_des = text(next.size_des || product.size_des);
    }

    return next;
  });

  return { rows: normalizedRows, errors };
}

function blockedImportResult(rows: RawRow[], errors: string[]): ImportResult {
  return {
    ok: false,
    message: errors[0] || "FN OS DB reference validation failed.",
    db_saved_count: 0,
    success_count: 0,
    fail_count: rows.length,
    errors,
    external_sync_enabled: false,
  };
}

async function activeBomItems(productId: string) {
  if (!productId) return [];
  const boms = await optionalRows("product_boms", {
    parent_product_id: `eq.${productId}`,
    is_active: "eq.true",
    order: "created_at.asc",
    limit: 1,
  });
  const bom = boms[0];
  if (!bom?.id) return [];
  return optionalRows("product_bom_items", { bom_id: `eq.${bom.id}`, order: "created_at.asc", limit: 200 });
}

async function expandBomInventoryRows(row: RawRow, fallbackMovementType: "sale_out" | "return_in" | "exchange_out", componentMovementType: "bom_consume" | "return_in") {
  const product = await findProduct(row);
  const productId = text(product?.id);
  const virtualInventoryProduct = isVirtualInventoryProduct(product || row);
  const items = await activeBomItems(productId);
  const saleQty = Math.abs(numberValue(row.qty));
  if (!items.length || saleQty === 0) return virtualInventoryProduct ? [] : [{ row, movementType: fallbackMovementType }];

  const expanded: Array<{ row: RawRow; movementType: "bom_consume" | "return_in" }> = [];
  for (const item of items) {
    const component = await findBomComponent(item);
    const componentId = text(component?.id || item.component_product_id);
    const code = productCode(component) || text(item.component_sku);
    const componentQtyPerUnit = numberValue(item.qty_per_unit ?? 1);
    if (!code || componentQtyPerUnit <= 0) continue;
    const componentName = productName(component) || text(item.component_product_name || item.component_name || code);
    const componentQty = saleQty * componentQtyPerUnit;
    expanded.push({
      movementType: componentMovementType,
      row: {
        ...row,
        product_id: componentId || null,
        prod_cd: code,
        product_code: code,
        sku: text(component?.sku) || code,
        prod_name: componentName,
        product_name: componentName,
        size_des: text(component?.size_des || item.size_des),
        qty: componentQty,
        parent_product_id: productId || text(row.product_id) || null,
        parent_prod_cd: productCode(product) || text(row.prod_cd || row.product_code),
        parent_prod_name: productName(product) || text(row.prod_name || row.product_name),
        remarks: `${text(row.remarks)} BOM 구성품 차감`.trim(),
      },
    });
  }

  return expanded.length ? expanded : virtualInventoryProduct ? [] : [{ row, movementType: fallbackMovementType }];
}

async function validateVirtualInventoryBomRows(rows: RawRow[]) {
  const errors: string[] = [];
  const batchSize = 12;
  for (let startIndex = 0; startIndex < rows.length; startIndex += batchSize) {
    const batchErrors = await Promise.all(rows.slice(startIndex, startIndex + batchSize).map(async (row, offset) => {
      const index = startIndex + offset;
      const product = await findProduct(row);
      if (!isVirtualInventoryProduct(product || row)) return "";
      const productId = text(product?.id);
      const items = await activeBomItems(productId);
      const validItems = items.filter((item) => numberValue(item.qty_per_unit ?? 1) > 0 && (text(item.component_product_id || item.product_id) || text(item.component_sku || item.sku || item.product_code || item.prod_cd)));
      if (validItems.length) return "";
      const code = productCode(product) || text(row.prod_cd || row.product_code || row.sku);
      const name = productName(product) || text(row.prod_name || row.product_name) || code || "RG/SET 품목";
      return `${index + 1}행: RG/SET 품목 '${name}'${code ? `(${code})` : ""}은 활성 BOM 구성품이 없어 재고 차감 대상이 없습니다. BOM 등록 후 저장해 주세요.`;
    }));
    errors.push(...batchErrors.filter(Boolean));
  }
  return errors;
}

async function updateCurrentInventory(row: RawRow, deltaQty: number) {
  const hasResolvedProduct = text(row.product_id)
    && text(row.prod_cd || row.product_code || row.sku)
    && text(row.prod_name || row.product_name)
    && text(row.size_des);
  const hasResolvedWarehouse = text(row.warehouse_id)
    && text(row.wh_cd || row.warehouse_code)
    && text(row.wh_name || row.warehouse_name);
  const [product, warehouse] = await Promise.all([
    hasResolvedProduct ? null : findProduct(row),
    hasResolvedWarehouse ? null : findWarehouse(row),
  ]);
  const productId = text(row.product_id || product?.id);
  const productCode = text(row.prod_cd || row.product_code || product?.product_code || product?.prod_cd || row.sku);
  const productName = text(row.prod_name || row.product_name || product?.product_name || product?.prod_name);
  const sku = text(row.sku || product?.sku || productCode);
  const whCd = text(row.wh_cd || row.warehouse_code || warehouseCode(warehouse)) || "100";
  const warehouseId = text(row.warehouse_id || warehouse?.id);
  const currentRows = productId
    ? await optionalRows("inventory_current", { product_id: `eq.${productId}`, wh_cd: `eq.${whCd}`, limit: 100 })
    : [];
  const currentRowsByWarehouseId = !currentRows.length && productId && warehouseId
    ? await optionalRows("inventory_current", { product_id: `eq.${productId}`, warehouse_id: `eq.${warehouseId}`, limit: 100 })
    : [];
  const legacyRows = !currentRows.length && !currentRowsByWarehouseId.length && productCode
    ? await optionalRows("inventory_current", { wh_cd: `eq.${whCd}`, prod_cd: `eq.${productCode}`, limit: 100 })
    : [];
  const mergedRows = currentRows.length ? currentRows : currentRowsByWarehouseId.length ? currentRowsByWarehouseId : legacyRows;
  const now = nowIso();
  const current = mergedRows[0];
  const duplicateRows = mergedRows.slice(1);
  let prevQty = 0;
  for (const item of mergedRows) prevQty += numberValue(item.on_hand_qty ?? item.bal_qty);
  const nextQty = prevQty + deltaQty;

  const values = {
    warehouse_id: warehouseId || text(current?.warehouse_id) || null,
    product_id: productId || null,
    sku,
    wh_cd: whCd,
    wh_name: text(row.wh_name || row.warehouse_name) || warehouseName(warehouse) || text(current?.wh_name),
    prod_cd: productCode,
    prod_name: productName,
    size_des: text(row.size_des || product?.size_des || current?.size_des),
    on_hand_qty: nextQty,
    available_qty: nextQty - numberValue(current?.reserved_qty),
    bal_qty: nextQty,
    last_movement_at: now,
    updated_at: now,
    synced_at: now,
  };

  if (current?.id) {
    await patchRowsWithSchemaFallback("inventory_current", { id: `eq.${current.id}` }, values);
    await Promise.all(duplicateRows.map((item) => text(item.id) ? deleteRows("inventory_current", { id: `eq.${item.id}` }) : Promise.resolve([])));
    return;
  }
  await insertRowsWithSchemaFallback("inventory_current", [values]);
}

function inventoryCurrentGroupKey(row: RawRow) {
  const wh = text(row.wh_cd || row.warehouse_code || row.warehouse_id);
  const code = text(row.prod_cd || row.product_code || row.sku || row.product_id);
  return wh && code ? `${wh}::${code}` : "";
}

async function consolidateInventoryCurrentDuplicates() {
  const rows = await optionalRows("inventory_current", { order: "updated_at.desc", limit: 10000 });
  const groups = new Map<string, RawRow[]>();
  rows.forEach((row) => {
    const key = inventoryCurrentGroupKey(row);
    if (!key) return;
    groups.set(key, [...(groups.get(key) || []), row]);
  });
  let removed = 0;
  for (const group of Array.from(groups.values())) {
    if (group.length <= 1) continue;
    const [keep, ...duplicates] = group;
    const qty = group.reduce((total, row) => total + numberValue(row.on_hand_qty ?? row.bal_qty), 0);
    const reservedQty = group.reduce((total, row) => total + numberValue(row.reserved_qty), 0);
    await patchRowsWithSchemaFallback("inventory_current", { id: `eq.${keep.id}` }, {
      on_hand_qty: qty,
      reserved_qty: reservedQty,
      available_qty: qty - reservedQty,
      bal_qty: qty,
      updated_at: nowIso(),
      synced_at: nowIso(),
    });
    for (const row of duplicates) {
      if (!text(row.id)) continue;
      await deleteRows("inventory_current", { id: `eq.${row.id}` });
      removed += 1;
    }
  }
  return removed;
}

function inventoryMovementUpdateKey(row: RawRow) {
  const whKey = text(row.wh_cd || row.warehouse_code || row.warehouse_id) || "100";
  const productKey = text(row.product_id) || text(row.prod_cd || row.product_code || row.sku) || text(row.prod_name || row.product_name);
  return whKey && productKey ? `${whKey}::${lookupKey(productKey)}` : "";
}

async function updateCurrentInventoryForMovements(movementPairs: Array<{ sourceRow: RawRow; movement: RawRow }>) {
  const grouped = new Map<string, { sourceRow: RawRow; deltaQty: number }>();
  const ungrouped: Array<{ sourceRow: RawRow; deltaQty: number }> = [];

  for (const pair of movementPairs) {
    const deltaQty = numberValue(pair.movement.qty);
    const key = inventoryMovementUpdateKey(pair.sourceRow);
    if (!key) {
      ungrouped.push({ sourceRow: pair.sourceRow, deltaQty });
      continue;
    }
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { sourceRow: pair.sourceRow, deltaQty });
      continue;
    }
    current.deltaQty += deltaQty;
    if (!text(current.sourceRow.product_id) && text(pair.sourceRow.product_id)) current.sourceRow = pair.sourceRow;
  }

  const updates = [...Array.from(grouped.values()), ...ungrouped].filter((item) => item.deltaQty !== 0);
  const batchSize = 12;
  for (let index = 0; index < updates.length; index += batchSize) {
    const batch = updates.slice(index, index + batchSize);
    await Promise.all(batch.map((item) => updateCurrentInventory(item.sourceRow, item.deltaQty)));
  }
}

async function writeInventoryMovements(rows: RawRow[], movementType: "sale_out" | "purchase_in" | "return_in" | "exchange_out") {
  const expandedRows = movementType === "sale_out" || movementType === "exchange_out"
    ? (await Promise.all(rows.map((row) => expandBomInventoryRows(row, movementType, "bom_consume")))).flat()
    : movementType === "return_in"
      ? (await Promise.all(rows.map((row) => expandBomInventoryRows(row, "return_in", "return_in")))).flat()
      : rows.map((row) => ({ row, movementType }));
  const movementPairs = expandedRows
    .filter((item) => numberValue(item.row.qty) !== 0 && (text(item.row.prod_cd) || text(item.row.sku)))
    .map((item) => {
      const qty = item.movementType === "purchase_in" || item.movementType === "return_in" ? Math.abs(numberValue(item.row.qty)) : -Math.abs(numberValue(item.row.qty));
      return {
        sourceRow: item.row,
        movement: {
          movement_date: nowIso(),
          movement_type: item.movementType,
          warehouse_id: text(item.row.warehouse_id) || null,
          product_id: text(item.row.product_id) || null,
          sku: text(item.row.prod_cd || item.row.product_code || item.row.sku),
          prod_cd: text(item.row.prod_cd || item.row.product_code || item.row.sku),
          wh_cd: text(item.row.wh_cd) || "100",
          qty,
          source_type: item.movementType === "purchase_in" ? "purchases" : "sales",
          source_ref_id: text(item.row.id || item.row.source_ref_id),
          memo: text(item.row.remarks),
          created_at: nowIso(),
        },
      };
    });

  const movementRows = movementPairs.map((pair) => pair.movement);
  if (!movementRows.length) return 0;
  const { saved } = await insertRowsWithSchemaFallback("inventory_movements", movementRows);
  await updateCurrentInventoryForMovements(movementPairs);
  return saved.length;
}

function deletedEntryRefValues(row: RawRow) {
  return [text(row.id), text(row.source_ref_id)].filter(Boolean);
}

async function movementRowsForDeletedEntries(table: "sales" | "purchases", deletedRows: RawRow[]) {
  const refs = Array.from(new Set(deletedRows.flatMap(deletedEntryRefValues)));
  if (!refs.length) return [] as RawRow[];
  const rowsById = new Map<string, RawRow>();
  const chunkSize = 100;
  for (let index = 0; index < refs.length; index += chunkSize) {
    const chunk = refs.slice(index, index + chunkSize);
    const movements = await optionalRows("inventory_movements", {
      source_type: `eq.${table}`,
      source_ref_id: sqlInFilter(chunk),
      limit: Math.max(100, chunk.length * 20),
    });
    movements.forEach((row) => rowsById.set(text(row.id || `${row.source_ref_id}-${row.movement_date}-${row.qty}`), row));
  }
  return Array.from(rowsById.values());
}

function deletedEntryByReference(rows: RawRow[]) {
  const map = new Map<string, RawRow>();
  rows.forEach((row) => {
    deletedEntryRefValues(row).forEach((ref) => map.set(ref, row));
  });
  return map;
}

function reversalSourceRowForMovement(movement: RawRow, deletedRow: RawRow | undefined): RawRow {
  const productKey = text(movement.prod_cd || movement.product_code || movement.sku || deletedRow?.prod_cd || deletedRow?.product_code || deletedRow?.sku);
  return {
    warehouse_id: text(movement.warehouse_id || deletedRow?.warehouse_id) || null,
    wh_cd: text(movement.wh_cd || deletedRow?.wh_cd || deletedRow?.warehouse_code),
    wh_name: text(deletedRow?.wh_name || deletedRow?.warehouse_name),
    product_id: text(movement.product_id || deletedRow?.product_id) || null,
    prod_cd: productKey,
    product_code: productKey,
    sku: text(movement.sku || movement.prod_cd || deletedRow?.sku || deletedRow?.prod_cd || productKey),
    prod_name: text(movement.prod_name || deletedRow?.prod_name || deletedRow?.product_name),
    product_name: text(movement.prod_name || deletedRow?.prod_name || deletedRow?.product_name),
  };
}

async function reverseDeletedEntryInventoryMovements(table: "sales" | "purchases", deletedRows: RawRow[]) {
  const movements = await movementRowsForDeletedEntries(table, deletedRows);
  if (!movements.length) return 0;
  const deletedByRef = deletedEntryByReference(deletedRows);
  const now = nowIso();
  const movementPairs = movements
    .map((movement) => {
      const sourceRef = text(movement.source_ref_id);
      const deletedRow = deletedByRef.get(sourceRef);
      const sourceRow = reversalSourceRowForMovement(movement, deletedRow);
      const qty = -numberValue(movement.qty);
      if (!qty) return null;
      const warehouseKey = text(sourceRow.wh_cd || sourceRow.warehouse_id);
      const productKey = text(sourceRow.product_id || sourceRow.prod_cd || sourceRow.sku);
      if (!warehouseKey || !productKey) return null;
      return {
        sourceRow,
        movement: {
          movement_date: now,
          movement_type: `${text(movement.movement_type) || "movement"}_delete_reversal`,
          warehouse_id: text(sourceRow.warehouse_id) || null,
          product_id: text(sourceRow.product_id) || null,
          sku: text(sourceRow.sku || sourceRow.prod_cd),
          prod_cd: text(sourceRow.prod_cd || sourceRow.sku),
          wh_cd: text(sourceRow.wh_cd),
          qty,
          source_type: "inventory_manual",
          source_ref_id: `delete-reversal-${text(movement.id || sourceRef || Date.now())}`,
          memo: `FN_INV_HISTORY ${JSON.stringify({
            kind: "delete_reversal",
            sourceTable: table,
            sourceRefId: sourceRef,
            originalMovementId: text(movement.id),
            originalMovementType: text(movement.movement_type),
            productCode: text(sourceRow.prod_cd || sourceRow.sku),
            productName: text(sourceRow.prod_name || sourceRow.product_name),
            warehouseCode: text(sourceRow.wh_cd),
            warehouseName: text(sourceRow.wh_name),
            changeQty: qty,
            qty: Math.abs(qty),
            userMemo: "판매/구매 삭제에 따른 재고 자동 되돌림",
          })}`,
          created_at: now,
        },
      };
    })
    .filter(Boolean) as Array<{ sourceRow: RawRow; movement: RawRow }>;
  if (!movementPairs.length) return 0;
  const { saved } = await insertRowsWithSchemaFallback("inventory_movements", movementPairs.map((pair) => pair.movement));
  await updateCurrentInventoryForMovements(movementPairs);
  return saved.length;
}

function salesInventoryEntryRequiredError(row: RawRow, kind: "sales" | "purchases", index: number, options?: { requireDate?: boolean }) {
  const date = text(first(row, ["date", "sale_date", "purchase_date", "io_date", "IO_DATE", "일자"]));
  const customer = text(first(row, ["customer_code", "customer_name", "supplier_code", "supplier_name", "cust_code", "cust_name", "CUST", "CUST_DES", "거래처코드", "거래처명", "공급처코드", "공급처"]));
  const warehouse = text(first(row, ["warehouse_code", "wh_cd", "WH_CD", "입고창고", "출하창고", "창고코드"]));
  const product = text(first(row, ["product_code", "product_name", "prod_cd", "prod_name", "PROD_CD", "PROD_DES", "품목코드", "품목명"]));
  const qty = numberValue(first(row, ["qty", "QTY", "수량"]));
  const missing: string[] = [];
  if (options?.requireDate !== false && !date) missing.push("date");
  if (!customer) missing.push("customer");
  if (!warehouse) missing.push(kind === "purchases" ? "purchase warehouse" : "warehouse");
  if (!product) missing.push("product");
  if (qty <= 0) missing.push("qty");
  return missing.length ? `${index + 1}: missing ${missing.join(", ")}` : "";
}

export async function importSalesRows(rows: RawRow[], sourceFileName?: string): Promise<ImportResult> {
  if (!hasDbConfig()) return noDbResult(rows);

  const invalidErrors = rows.map((row, index) => salesInventoryEntryRequiredError(row, "sales", index, { requireDate: false })).filter(Boolean);
  if (invalidErrors.length) return blockedImportResult(rows, invalidErrors);

  const batch = await createUploadBatch("sales", sourceFileName, rows.length);
  const normalized = rows.map((row, index) => normalizeSale(row, index, batch.id, sourceFileName));
  const referenceResult = await validateEntryReferences(normalized, "sales");
  if (referenceResult.errors.length) {
    await updateUploadBatch(batch.id, 0, rows.length).catch(() => null);
    return blockedImportResult(rows, referenceResult.errors);
  }
  const virtualBomErrors = await validateVirtualInventoryBomRows(referenceResult.rows);
  if (virtualBomErrors.length) {
    await updateUploadBatch(batch.id, 0, rows.length).catch(() => null);
    return blockedImportResult(rows, virtualBomErrors);
  }
  const existingRefs = await existingSourceRefs("sales", normalized.map((row) => row.source_ref_id));
  const freshRows = referenceResult.rows.filter((row) => !existingRefs.has(text(row.source_ref_id)));
  const { saved, removedColumns } = freshRows.length ? await insertRowsWithSchemaFallback("sales", freshRows) : { saved: [], removedColumns: [] };
  const movementCount = await writeInventoryMovements(saved, "sale_out");
  await updateUploadBatch(batch.id, saved.length, rows.length - saved.length).catch(() => null);

  return {
    ok: true,
    message: removedColumns.length
      ? `FN OS sales DB saved ${saved.length} rows. Skipped unavailable columns: ${removedColumns.join(", ")}.`
      : `FN OS sales DB saved ${saved.length} rows.`,
    db_saved_count: saved.length,
    success_count: saved.length,
    fail_count: rows.length - saved.length,
    duplicate_count: referenceResult.rows.length - freshRows.length,
    inventory_movement_count: movementCount,
    errors: invalidErrors,
    batch_id: batch.id,
    external_sync_enabled: false,
  };
}

export async function importReturnExchangeRows(rows: RawRow[], sourceFileName?: string): Promise<ImportResult> {
  if (!hasDbConfig()) return noDbResult(rows);

  const invalidErrors = rows.map((row, index) => salesInventoryEntryRequiredError(row, "sales", index)).filter(Boolean);
  if (invalidErrors.length) return blockedImportResult(rows, invalidErrors);

  const batch = await createUploadBatch("return_exchange", sourceFileName, rows.length);
  const normalized = rows.map((row, index) => {
    const kind = text(row.return_exchange_type || row.io_type).includes("exchange") || text(row.io_type).includes("교환") ? "exchange_out" : "return_in";
    return {
      ...normalizeSale(row, index, batch.id, sourceFileName || "FN_OS_RETURN_EXCHANGE_ENTRY"),
      io_type: kind,
      source_file_name: sourceFileName || "FN_OS_RETURN_EXCHANGE_ENTRY",
      sale_status: kind,
      remarks: text(row.remarks || row.memo),
    };
  });
  const referenceResult = await validateEntryReferences(normalized, "sales");
  if (referenceResult.errors.length) {
    await updateUploadBatch(batch.id, 0, rows.length).catch(() => null);
    return blockedImportResult(rows, referenceResult.errors);
  }
  const virtualBomErrors = await validateVirtualInventoryBomRows(referenceResult.rows);
  if (virtualBomErrors.length) {
    await updateUploadBatch(batch.id, 0, rows.length).catch(() => null);
    return blockedImportResult(rows, virtualBomErrors);
  }
  const existingRefs = await existingSourceRefs("sales", normalized.map((row) => row.source_ref_id));
  const freshRows = referenceResult.rows.filter((row) => !existingRefs.has(text(row.source_ref_id)));
  const { saved, removedColumns } = freshRows.length ? await insertRowsWithSchemaFallback("sales", freshRows) : { saved: [], removedColumns: [] };
  const returnRows = saved.filter((row) => returnExchangeKindFromRow(row) !== "exchange_out");
  const exchangeRows = saved.filter((row) => returnExchangeKindFromRow(row) === "exchange_out");
  const returnMovementCount = await writeInventoryMovements(returnRows, "return_in");
  const exchangeMovementCount = await writeInventoryMovements(exchangeRows, "exchange_out");
  const movementCount = returnMovementCount + exchangeMovementCount;
  await updateUploadBatch(batch.id, saved.length, rows.length - saved.length).catch(() => null);

  return {
    ok: true,
    message: removedColumns.length
      ? `FN OS return/exchange DB saved ${saved.length} rows. Skipped unavailable columns: ${removedColumns.join(", ")}.`
      : `FN OS return/exchange DB saved ${saved.length} rows.`,
    db_saved_count: saved.length,
    success_count: saved.length,
    fail_count: rows.length - saved.length,
    duplicate_count: referenceResult.rows.length - freshRows.length,
    inventory_movement_count: movementCount,
    errors: invalidErrors,
    batch_id: batch.id,
    external_sync_enabled: false,
  };
}

export async function importPurchaseRows(rows: RawRow[], sourceFileName?: string): Promise<ImportResult> {
  if (!hasDbConfig()) return noDbResult(rows);

  const invalidErrors = rows.map((row, index) => salesInventoryEntryRequiredError(row, "purchases", index, { requireDate: false })).filter(Boolean);
  if (invalidErrors.length) return blockedImportResult(rows, invalidErrors);

  const batch = await createUploadBatch("purchases", sourceFileName, rows.length);
  const normalized = rows.map((row, index) => normalizePurchase(row, index, batch.id, sourceFileName));
  const referenceResult = await validateEntryReferences(normalized, "purchases");
  if (referenceResult.errors.length) {
    await updateUploadBatch(batch.id, 0, rows.length).catch(() => null);
    return blockedImportResult(rows, referenceResult.errors);
  }
  const existingRefs = await existingSourceRefs("purchases", normalized.map((row) => row.source_ref_id));
  const freshRows = referenceResult.rows.filter((row) => !existingRefs.has(text(row.source_ref_id)));
  const { saved, removedColumns } = freshRows.length ? await insertRowsWithSchemaFallback("purchases", freshRows) : { saved: [], removedColumns: [] };
  const movementCount = await writeInventoryMovements(saved, "purchase_in");
  await updateUploadBatch(batch.id, saved.length, rows.length - saved.length).catch(() => null);

  return {
    ok: true,
    message: removedColumns.length
      ? `FN OS purchases DB saved ${saved.length} rows. Skipped unavailable columns: ${removedColumns.join(", ")}.`
      : `FN OS purchases DB saved ${saved.length} rows.`,
    db_saved_count: saved.length,
    success_count: saved.length,
    fail_count: rows.length - saved.length,
    duplicate_count: referenceResult.rows.length - freshRows.length,
    inventory_movement_count: movementCount,
    errors: invalidErrors,
    batch_id: batch.id,
    external_sync_enabled: false,
  };
}

function returnExchangeKindFromRow(row: RawRow) {
  const value = text(row.return_exchange_type || row.io_type || row.sale_status || row.source_file_name || row.source_ref_id).toLowerCase();
  return value.includes("exchange") || value.includes("교환") ? "exchange_out" : "return_in";
}

function isReturnExchangeRow(row: RawRow) {
  const value = text(row.return_exchange_type || row.io_type || row.sale_status || row.source_file_name || row.source_ref_id);
  return /RETURN_EXCHANGE|RETURN|EXCHANGE|return_in|exchange_out|manual-return|manual-exchange|반품|교환/i.test(value);
}

export async function dashboardSummary() {
  const [allSales, purchases, inventory, orders, orderItems, shipments, channels, ads, expenses, legacyExpenses, importOrders, logs] = await Promise.all([
    optionalRows("sales", { order: "created_at.desc", limit: 500 }),
    optionalRows("purchases", { order: "created_at.desc", limit: 300 }),
    optionalRows("inventory_current", { order: "updated_at.desc", limit: 300 }),
    optionalRows("orders", { order: "collected_at.desc", limit: 300 }),
    optionalRows("order_items", { order: "created_at.desc", limit: 300 }),
    optionalRows("shipments", { order: "created_at.desc", limit: 300 }),
    optionalRows("sales_channels", { order: "channel_code.asc", limit: 100 }),
    optionalRows("ad_daily_metrics", { order: "metric_date.desc", limit: 120 }),
    optionalRows("expenses", { order: "expense_date.desc", limit: 120 }),
    optionalRows("expense_entries", { order: "expense_date.desc", limit: 120 }),
    optionalRows("import_purchase_orders", { order: "created_at.desc", limit: 50 }),
    optionalRows("api_sync_logs", { order: "created_at.desc", limit: 20 }),
  ]);
  const returnExchangeRows = allSales.filter(isReturnExchangeRow);
  const sales = allSales.filter((row) => !isReturnExchangeRow(row));

  const today = todayCompact();
  const month = today.slice(0, 6);
  const todaySalesRows = sales.filter((row) => dateKey(row.io_date ?? row.sale_date ?? row.created_at) === today);
  const monthSalesRows = sales.filter((row) => dateKey(row.io_date ?? row.sale_date ?? row.created_at).startsWith(month));
  const todayOrders = orders.filter((row) => dateKey(row.order_date ?? row.created_at) === today);
  const waitingShipments = shipments.filter((row) => ["pending", "ready", "waiting", "출고대기"].includes(text(row.shipment_status).toLowerCase()));
  const missingTracking = shipments.filter((row) => !text(row.tracking_no));
  const unmappedItems = orderItems.filter((row) => text(row.mapping_status || "UNMAPPED").toUpperCase() !== "MAPPED");
  const riskInventory = inventory.filter((row) => numberValue(row.available_qty ?? row.on_hand_qty ?? row.bal_qty) <= 5);
  const monthAds = ads.filter((row) => dateKey(row.metric_date ?? row.created_at).startsWith(month));
  const expenseRows = expenses.length ? expenses : legacyExpenses;
  const monthExpenses = expenseRows.filter((row) => dateKey(row.expense_date ?? row.created_at).startsWith(month));
  const purchaseDue = importOrders.filter((row) => !["done", "closed", "입고완료"].includes(text(row.status).toLowerCase()));
  const unpaidCustomers = new Set(
    expenseRows
      .filter((row) => ["unpaid", "pending", "미납"].includes(text(row.payment_status).toLowerCase()))
      .map((row) => text(row.customer_id || row.customer_name || row.title))
      .filter(Boolean),
  );

  const todaySales = sum(todaySalesRows, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt);
  const monthSales = sum(monthSalesRows, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt);
  const monthPurchaseRows = purchases.filter((row) => dateKey(row.io_date ?? row.purchase_date ?? row.created_at).startsWith(month));
  const adSpend = sum(monthAds, (row) => row.spend_amount);
  const expenseTotal = sum(monthExpenses, (row) => row.total_amount ?? row.amount ?? row.supply_amount);
  const purchaseTotal = sum(monthPurchaseRows, (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt);
  const estimatedProfit = monthSales - purchaseTotal - adSpend - expenseTotal;
  const marginRate = monthSales ? (estimatedProfit / monthSales) * 100 : 0;

  return {
    today_sales: todaySales,
    month_sales: monthSales,
    today_order_count: todayOrders.length,
    today_qty: sum(todaySalesRows, (row) => row.qty),
    waiting_shipment_count: waitingShipments.length,
    missing_tracking_count: missingTracking.length,
    unmapped_product_count: unmappedItems.length,
    inventory_risk_count: riskInventory.length,
    risk_sku: riskInventory.length,
    ad_spend: adSpend,
    expense_amount: expenseTotal,
    estimated_profit: estimatedProfit,
    margin_rate: marginRate,
    month_purchases: purchaseTotal,
    month_purchase_amount: purchaseTotal,
    purchase_due_count: purchaseDue.length,
    unpaid_customer_count: unpaidCustomers.size,
    recent_sales: sales.slice(0, 30),
    recent_returns: returnExchangeRows.slice(0, 100),
    recent_purchases: purchases.slice(0, 30),
    recent_orders: orders.slice(0, 30),
    recent_order_items: orderItems.slice(0, 30),
    recent_shipments: shipments.slice(0, 30),
    sales_channels: channels,
    sales_by_date: groupRows(sales, (row) => dateKey(row.io_date ?? row.sale_date ?? row.created_at), (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
    sales_by_customer: groupRows(sales, (row) => text(row.cust_name || row.customer_name || row.cust_code), (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
    sales_by_product: groupRows(sales, (row) => text(row.prod_name || row.product_name || row.prod_cd || row.sku), (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
    purchases_by_customer: groupRows(purchases, (row) => text(row.cust_name || row.supplier_name || row.cust_code), (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
    purchases_by_product: groupRows(purchases, (row) => text(row.prod_name || row.product_name || row.prod_cd || row.sku), (row) => row.total_amount ?? row.supply_amount ?? row.supply_amt),
    recent_inventory_movements: await optionalRows("inventory_movements", { order: "created_at.desc", limit: 30 }),
    recent_import_orders: importOrders.slice(0, 10),
    recent_ads: ads.slice(0, 10),
    inventory: riskInventory.length ? riskInventory.slice(0, 50) : inventory.slice(0, 50),
    logs,
    sync_logs: logs,
  };
}

export async function searchProducts(query: string) {
  const keyword = text(query);
  if (!keyword) return [];
  const escaped = keyword.replace(/[%*]/g, "");
  const [byCode, byLegacyCode, bySku, byName] = await Promise.all([
    optionalRows("products", { product_code: `ilike.*${escaped}*`, limit: 20 }),
    optionalRows("products", { prod_cd: `ilike.*${escaped}*`, limit: 20 }),
    optionalRows("products", { sku: `ilike.*${escaped}*`, limit: 20 }),
    optionalRows("products", { product_name: `ilike.*${escaped}*`, limit: 20 }),
  ]);
  const map = new Map<string, Record<string, unknown>>();
  [...byCode, ...byLegacyCode, ...bySku, ...byName].forEach((row) => map.set(text(row.id || row.product_code || row.sku || row.prod_cd), row));
  return Array.from(map.values()).slice(0, 20);
}

export async function syncProducts(_payload?: unknown) {
  return {
    ok: false,
    count: 0,
    message: "External product sync is disabled. Use FN OS DB, channel adapters, or Excel upload.",
  };
}

export async function syncInventory(_payload?: unknown) {
  if (!hasDbConfig()) return noDbResult([]);

  const [allSales, purchases, movements] = await Promise.all([
    optionalRows("sales", { order: "created_at.asc", limit: 5000 }),
    optionalRows("purchases", { order: "created_at.asc", limit: 5000 }),
    optionalRows("inventory_movements", { order: "created_at.desc", limit: 10000 }),
  ]);
  const movementRefs = new Set(movements.map((row) => text(row.source_ref_id)).filter(Boolean));
  const missingMovement = (row: RawRow) => {
    const id = text(row.id);
    const sourceRef = text(row.source_ref_id);
    return (!id || !movementRefs.has(id)) && (!sourceRef || !movementRefs.has(sourceRef));
  };
  const missingSales = allSales.filter(missingMovement);
  const missingPurchases = purchases.filter(missingMovement);
  const missingReturns = missingSales.filter((row) => returnExchangeKindFromRow(row) !== "exchange_out" && isReturnExchangeRow(row));
  const missingExchanges = missingSales.filter((row) => returnExchangeKindFromRow(row) === "exchange_out");
  const missingNormalSales = missingSales.filter((row) => !isReturnExchangeRow(row));

  const movementCount =
    await writeInventoryMovements(missingPurchases, "purchase_in") +
    await writeInventoryMovements(missingNormalSales, "sale_out") +
    await writeInventoryMovements(missingReturns, "return_in") +
    await writeInventoryMovements(missingExchanges, "exchange_out");
  const consolidated_inventory_rows = await consolidateInventoryCurrentDuplicates();

  return {
    ok: true,
    count: movementCount,
    consolidated_inventory_rows,
    purchase_backfill_count: missingPurchases.length,
    sales_backfill_count: missingNormalSales.length,
    return_backfill_count: missingReturns.length,
    exchange_backfill_count: missingExchanges.length,
    message: `FN OS inventory_current updated from ${movementCount.toLocaleString("ko-KR")} missing sales/purchase movements.`,
  };
}

export async function upsertLocalProducts(rows: Record<string, unknown>[]) {
  return upsertRows("products", rows, "product_code");
}

export async function markBatchStatus(id: string, status: string) {
  return patchRows("upload_batches", { id: `eq.${id}` }, { status });
}
