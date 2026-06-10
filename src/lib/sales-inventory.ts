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
  return new Date().toISOString().slice(0, 10).replace(/\D/g, "");
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
  const price = numberValue(first(row, ["단가(vat포함)", "단가", "price", "PRICE"]));
  const explicitTax = numberValue(first(row, ["세액", "부가세", "tax_amt", "vat_amount", "VAT_AMT"]));
  const tax = explicitTax || (vatIsExcluded(row) ? qty * price * 0.1 : 0);
  const calculatedSupply = qty * price + tax;
  const supplyAmt = numberValue(first(row, ["공급가액", "정산예정금액", "supply_amt", "SUPPLY_AMT"])) || calculatedSupply;
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
  const saleDate = text(first(row, ["일자", "판매일", "sale_date", "io_date", "IO_DATE"])) || todayCompact();
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
  const purchaseDate = text(first(row, ["일자", "구매일", "purchase_date", "io_date", "IO_DATE"])) || todayCompact();
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

function groupFilters(groupKey: string) {
  const key = text(groupKey);
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
  return patchRows(table, groupFilters(groupKey), updateValues);
}

export async function deleteEntryGroups(table: "sales" | "purchases", groupKeys: string[]) {
  if (!hasDbConfig()) throw new Error("Supabase environment variables are not configured.");
  const deleted: RawRow[] = [];
  for (const groupKey of groupKeys) {
    const rows = await deleteRows<RawRow>(table, groupFilters(groupKey));
    deleted.push(...rows);
  }
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
  const existing = new Set<string>();
  for (const ref of uniqueRefs) {
    const rows = await optionalRows(table, { source_ref_id: `eq.${ref}`, limit: 1 });
    if (rows.length) existing.add(ref);
  }
  return existing;
}

async function findProduct(row: RawRow) {
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

async function expandSaleInventoryRows(row: RawRow) {
  const product = await findProduct(row);
  const productId = text(product?.id);
  const items = await activeBomItems(productId);
  const saleQty = Math.abs(numberValue(row.qty));
  if (!items.length || saleQty === 0) return [{ row, movementType: "sale_out" }];

  const expanded: Array<{ row: RawRow; movementType: "bom_consume" }> = [];
  for (const item of items) {
    const componentId = text(item.component_product_id);
    const [component] = componentId ? await optionalRows("products", { id: `eq.${componentId}`, limit: 1 }) : [];
    const code = productCode(component) || text(item.component_sku);
    if (!code) continue;
    const componentQty = saleQty * numberValue(item.qty_per_unit ?? 1);
    expanded.push({
      movementType: "bom_consume",
      row: {
        ...row,
        product_id: componentId || null,
        prod_cd: code,
        product_code: code,
        sku: text(component?.sku) || code,
        prod_name: productName(component) || text(row.prod_name),
        qty: componentQty,
        remarks: `${text(row.remarks)} BOM 구성품 차감`.trim(),
      },
    });
  }

  return expanded.length ? expanded : [{ row, movementType: "sale_out" }];
}

async function updateCurrentInventory(row: RawRow, deltaQty: number) {
  const product = text(row.product_id) ? row : await findProduct(row);
  const productId = text(row.product_id || product?.id);
  const productCode = text(row.prod_cd || product?.product_code || product?.prod_cd);
  const productName = text(row.prod_name || product?.product_name || product?.prod_name);
  const sku = text(row.sku || product?.sku || productCode);
  const whCd = text(row.wh_cd) || "100";
  const currentRows = await optionalRows("inventory_current", {
    wh_cd: `eq.${whCd}`,
    prod_cd: `eq.${productCode}`,
    limit: 1,
  });
  const now = nowIso();
  const current = currentRows[0];
  const prevQty = numberValue(current?.on_hand_qty ?? current?.bal_qty);
  const nextQty = prevQty + deltaQty;

  const values = {
    product_id: productId || null,
    sku,
    wh_cd: whCd,
    wh_name: text(current?.wh_name),
    prod_cd: productCode,
    prod_name: productName,
    size_des: text(row.size_des || product?.size_des),
    on_hand_qty: nextQty,
    available_qty: nextQty - numberValue(current?.reserved_qty),
    bal_qty: nextQty,
    last_movement_at: now,
    updated_at: now,
    synced_at: now,
  };

  if (current?.id) {
    await patchRowsWithSchemaFallback("inventory_current", { id: `eq.${current.id}` }, values);
    return;
  }
  await insertRowsWithSchemaFallback("inventory_current", [values]);
}

async function writeInventoryMovements(rows: RawRow[], movementType: "sale_out" | "purchase_in" | "return_in" | "exchange_out") {
  const expandedRows = movementType === "sale_out" || movementType === "exchange_out"
    ? (await Promise.all(rows.map(expandSaleInventoryRows))).flat()
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
          product_id: text(item.row.product_id) || null,
          sku: text(item.row.sku || item.row.prod_cd),
          prod_cd: text(item.row.prod_cd || item.row.sku),
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
  await Promise.all(movementPairs.map((pair) => updateCurrentInventory(pair.sourceRow, numberValue(pair.movement.qty))));
  return saved.length;
}

function salesInventoryEntryRequiredError(row: RawRow, kind: "sales" | "purchases", index: number) {
  const date = text(first(row, ["date", "sale_date", "purchase_date", "io_date", "IO_DATE", "일자"]));
  const customer = text(first(row, ["customer_code", "customer_name", "supplier_code", "supplier_name", "cust_code", "cust_name", "CUST", "CUST_DES", "거래처코드", "거래처명", "공급처코드", "공급처"]));
  const warehouse = text(first(row, ["warehouse_code", "wh_cd", "WH_CD", "입고창고", "출하창고", "창고코드"]));
  const product = text(first(row, ["product_code", "product_name", "prod_cd", "prod_name", "PROD_CD", "PROD_DES", "품목코드", "품목명"]));
  const qty = numberValue(first(row, ["qty", "QTY", "수량"]));
  const missing: string[] = [];
  if (!date) missing.push("date");
  if (!customer) missing.push("customer");
  if (!warehouse) missing.push(kind === "purchases" ? "purchase warehouse" : "warehouse");
  if (!product) missing.push("product");
  if (qty <= 0) missing.push("qty");
  return missing.length ? `${index + 1}: missing ${missing.join(", ")}` : "";
}

export async function importSalesRows(rows: RawRow[], sourceFileName?: string): Promise<ImportResult> {
  if (!hasDbConfig()) return noDbResult(rows);

  const batch = await createUploadBatch("sales", sourceFileName, rows.length);
  const invalidErrors = rows.map((row, index) => salesInventoryEntryRequiredError(row, "sales", index)).filter(Boolean);
  const validRows = rows.filter((row, index) => !salesInventoryEntryRequiredError(row, "sales", index));
  const normalized = validRows.map((row, index) => normalizeSale(row, index, batch.id, sourceFileName));
  const existingRefs = await existingSourceRefs("sales", normalized.map((row) => row.source_ref_id));
  const freshRows = normalized.filter((row) => !existingRefs.has(row.source_ref_id));
  const { saved, removedColumns } = freshRows.length ? await insertRowsWithSchemaFallback("sales", freshRows) : { saved: [], removedColumns: [] };
  const movementCount = await writeInventoryMovements(saved, "sale_out").catch(() => 0);
  await updateUploadBatch(batch.id, saved.length, rows.length - saved.length).catch(() => null);

  return {
    ok: true,
    message: removedColumns.length
      ? `FN OS sales DB saved ${saved.length} rows. Skipped unavailable columns: ${removedColumns.join(", ")}.`
      : `FN OS sales DB saved ${saved.length} rows.`,
    db_saved_count: saved.length,
    success_count: saved.length,
    fail_count: rows.length - saved.length,
    duplicate_count: validRows.length - freshRows.length,
    inventory_movement_count: movementCount,
    errors: invalidErrors,
    batch_id: batch.id,
    external_sync_enabled: false,
  };
}

export async function importReturnExchangeRows(rows: RawRow[], sourceFileName?: string): Promise<ImportResult> {
  if (!hasDbConfig()) return noDbResult(rows);

  const batch = await createUploadBatch("return_exchange", sourceFileName, rows.length);
  const invalidErrors = rows.map((row, index) => salesInventoryEntryRequiredError(row, "sales", index)).filter(Boolean);
  const validRows = rows.filter((row, index) => !salesInventoryEntryRequiredError(row, "sales", index));
  const normalized = validRows.map((row, index) => {
    const kind = text(row.return_exchange_type || row.io_type).includes("exchange") || text(row.io_type).includes("교환") ? "exchange_out" : "return_in";
    return {
      ...normalizeSale(row, index, batch.id, sourceFileName || "FN_OS_RETURN_EXCHANGE_ENTRY"),
      io_type: kind,
      source_file_name: sourceFileName || "FN_OS_RETURN_EXCHANGE_ENTRY",
      sale_status: kind,
      remarks: text(row.remarks || row.memo),
    };
  });
  const existingRefs = await existingSourceRefs("sales", normalized.map((row) => row.source_ref_id));
  const freshRows = normalized.filter((row) => !existingRefs.has(row.source_ref_id));
  const { saved, removedColumns } = freshRows.length ? await insertRowsWithSchemaFallback("sales", freshRows) : { saved: [], removedColumns: [] };
  const returnRows = saved.filter((row) => returnExchangeKindFromRow(row) !== "exchange_out");
  const exchangeRows = saved.filter((row) => returnExchangeKindFromRow(row) === "exchange_out");
  const movementCount =
    await writeInventoryMovements(returnRows, "return_in").catch(() => 0) +
    await writeInventoryMovements(exchangeRows, "exchange_out").catch(() => 0);
  await updateUploadBatch(batch.id, saved.length, rows.length - saved.length).catch(() => null);

  return {
    ok: true,
    message: removedColumns.length
      ? `FN OS return/exchange DB saved ${saved.length} rows. Skipped unavailable columns: ${removedColumns.join(", ")}.`
      : `FN OS return/exchange DB saved ${saved.length} rows.`,
    db_saved_count: saved.length,
    success_count: saved.length,
    fail_count: rows.length - saved.length,
    duplicate_count: validRows.length - freshRows.length,
    inventory_movement_count: movementCount,
    errors: invalidErrors,
    batch_id: batch.id,
    external_sync_enabled: false,
  };
}

export async function importPurchaseRows(rows: RawRow[], sourceFileName?: string): Promise<ImportResult> {
  if (!hasDbConfig()) return noDbResult(rows);

  const batch = await createUploadBatch("purchases", sourceFileName, rows.length);
  const invalidErrors = rows.map((row, index) => salesInventoryEntryRequiredError(row, "purchases", index)).filter(Boolean);
  const validRows = rows.filter((row, index) => !salesInventoryEntryRequiredError(row, "purchases", index));
  const normalized = validRows.map((row, index) => normalizePurchase(row, index, batch.id, sourceFileName));
  const existingRefs = await existingSourceRefs("purchases", normalized.map((row) => row.source_ref_id));
  const freshRows = normalized.filter((row) => !existingRefs.has(row.source_ref_id));
  const { saved, removedColumns } = freshRows.length ? await insertRowsWithSchemaFallback("purchases", freshRows) : { saved: [], removedColumns: [] };
  const movementCount = await writeInventoryMovements(saved, "purchase_in").catch(() => 0);
  await updateUploadBatch(batch.id, saved.length, rows.length - saved.length).catch(() => null);

  return {
    ok: true,
    message: removedColumns.length
      ? `FN OS purchases DB saved ${saved.length} rows. Skipped unavailable columns: ${removedColumns.join(", ")}.`
      : `FN OS purchases DB saved ${saved.length} rows.`,
    db_saved_count: saved.length,
    success_count: saved.length,
    fail_count: rows.length - saved.length,
    duplicate_count: validRows.length - freshRows.length,
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
  const [allSales, purchases, inventory, orders, orderItems, shipments, channels, ads, expenses, legacyExpenses, importOrders, archives, logs] = await Promise.all([
    optionalRows("sales", { order: "created_at.desc", limit: 500 }),
    optionalRows("purchases", { order: "created_at.desc", limit: 300 }),
    optionalRows("inventory_current", { order: "updated_at.desc", limit: 300 }),
    optionalRows("orders", { order: "created_at.desc", limit: 300 }),
    optionalRows("order_items", { order: "created_at.desc", limit: 300 }),
    optionalRows("shipments", { order: "created_at.desc", limit: 300 }),
    optionalRows("sales_channels", { order: "channel_code.asc", limit: 100 }),
    optionalRows("ad_daily_metrics", { order: "metric_date.desc", limit: 120 }),
    optionalRows("expenses", { order: "expense_date.desc", limit: 120 }),
    optionalRows("expense_entries", { order: "expense_date.desc", limit: 120 }),
    optionalRows("import_purchase_orders", { order: "created_at.desc", limit: 50 }),
    optionalRows("archive_items", { order: "created_at.desc", limit: 50 }),
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
    recent_archives: archives.slice(0, 10),
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
  return {
    ok: true,
    count: 0,
    message: "FN OS inventory_current is updated from purchases, sales, and inventory_movements.",
  };
}

export async function upsertLocalProducts(rows: Record<string, unknown>[]) {
  return upsertRows("products", rows, "product_code");
}

export async function markBatchStatus(id: string, status: string) {
  return patchRows("upload_batches", { id: `eq.${id}` }, { status });
}
