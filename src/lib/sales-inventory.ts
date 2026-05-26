import { createUploadBatch, hasDbConfig, insertRows, patchRows, selectRows, updateUploadBatch, upsertRows } from "./fnos-db";

type RawRow = Record<string, unknown>;

export type ImportResult = {
  ok: boolean;
  message: string;
  db_saved_count: number;
  success_count: number;
  fail_count: number;
  errors: string[];
  batch_id?: string;
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

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/\D/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSale(row: RawRow, index: number, batchId: string, sourceFileName?: string) {
  const qty = numberValue(first(row, ["수량", "qty", "QTY"]));
  const price = numberValue(first(row, ["단가(vat포함)", "단가", "price", "PRICE"]));
  const supplyAmt = numberValue(first(row, ["공급가액", "supply_amt", "SUPPLY_AMT"])) || qty * price;
  const totalAmt = numberValue(first(row, ["정산예정금액", "총금액", "total_amount", "TOTAL_AMOUNT"])) || supplyAmt;

  return {
    source_type: "fn_os",
    source_file_name: sourceFileName || null,
    upload_batch_id: batchId,
    io_date: text(first(row, ["일자", "sale_date", "io_date", "IO_DATE"])) || todayCompact(),
    sale_date: text(first(row, ["일자", "sale_date", "io_date", "IO_DATE"])) || todayCompact(),
    upload_ser_no: text(first(row, ["순번", "upload_ser_no", "UPLOAD_SER_NO"])) || String(index + 1),
    cust_code: text(first(row, ["거래처코드", "customer_code", "cust_code", "CUST"])),
    cust_name: text(first(row, ["거래처명", "customer_name", "cust_name", "CUST_DES"])),
    emp_cd: text(first(row, ["담당자", "emp_cd", "EMP_CD"])),
    wh_cd: text(first(row, ["출하창고", "warehouse_code", "wh_cd", "WH_CD"])) || "100",
    io_type: text(first(row, ["거래유형", "io_type", "IO_TYPE"])),
    currency: text(first(row, ["통화", "currency", "CURRENCY"])),
    exchange_rate: numberValue(first(row, ["환율", "exchange_rate", "EXCHANGE_RATE"])),
    prod_cd: text(first(row, ["품목코드", "product_code", "prod_cd", "PROD_CD"])),
    prod_name: text(first(row, ["품목명", "product_name", "prod_name", "PROD_DES"])),
    size_des: text(first(row, ["규격", "size_des", "SIZE_DES"])),
    sku: text(first(row, ["SKU", "sku"])),
    qty,
    price,
    unit_price: price,
    foreign_amt: numberValue(first(row, ["외화금액", "foreign_amt", "FOREIGN_AMT"])),
    supply_amt: supplyAmt,
    supply_amount: supplyAmt,
    vat_amount: numberValue(first(row, ["부가세", "vat_amount", "VAT_AMT"])),
    total_amount: totalAmt,
    remarks: text(first(row, ["적요", "remarks", "REMARKS"])),
    make_flag: text(first(row, ["생산전표생성", "make_flag", "MAKE_FLAG"])),
    sale_status: "saved",
    sync_status: "SAVED",
    sync_message: "FN OS DB saved",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function normalizePurchase(row: RawRow, index: number, batchId: string, sourceFileName?: string) {
  const qty = numberValue(first(row, ["수량", "qty", "QTY"]));
  const price = numberValue(first(row, ["단가(vat포함)", "단가", "price", "PRICE"]));
  const supplyAmt = numberValue(first(row, ["공급가액", "supply_amt", "SUPPLY_AMT"])) || qty * price;
  const totalAmt = numberValue(first(row, ["총금액", "total_amount", "TOTAL_AMOUNT"])) || supplyAmt;

  return {
    source_type: "fn_os",
    source_file_name: sourceFileName || null,
    upload_batch_id: batchId,
    io_date: text(first(row, ["일자", "purchase_date", "io_date", "IO_DATE"])) || todayCompact(),
    purchase_date: text(first(row, ["일자", "purchase_date", "io_date", "IO_DATE"])) || todayCompact(),
    upload_ser_no: text(first(row, ["순번", "upload_ser_no", "UPLOAD_SER_NO"])) || String(index + 1),
    cust_code: text(first(row, ["거래처코드", "supplier_code", "cust_code", "CUST"])),
    cust_name: text(first(row, ["거래처명", "supplier_name", "cust_name", "CUST_DES"])),
    wh_cd: text(first(row, ["입고창고", "출하창고", "warehouse_code", "wh_cd", "WH_CD"])) || "100",
    prod_cd: text(first(row, ["품목코드", "product_code", "prod_cd", "PROD_CD"])),
    prod_name: text(first(row, ["품목명", "product_name", "prod_name", "PROD_DES"])),
    sku: text(first(row, ["SKU", "sku"])),
    qty,
    price,
    unit_price: price,
    supply_amt: supplyAmt,
    supply_amount: supplyAmt,
    vat_amt: numberValue(first(row, ["부가세", "vat_amt", "VAT_AMT"])),
    vat_amount: numberValue(first(row, ["부가세", "vat_amount", "VAT_AMT"])),
    total_amount: totalAmt,
    remarks: text(first(row, ["적요", "remarks", "REMARKS"])),
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

export async function importSalesRows(rows: RawRow[], sourceFileName?: string): Promise<ImportResult> {
  if (!hasDbConfig()) return noDbResult(rows);

  const batch = await createUploadBatch("sales", sourceFileName, rows.length);
  const normalized = rows.map((row, index) => normalizeSale(row, index, batch.id, sourceFileName));
  const saved = normalized.length ? await insertRows("sales", normalized) : [];
  await updateUploadBatch(batch.id, saved.length, Math.max(0, rows.length - saved.length));

  return {
    ok: true,
    message: `FN OS sales DB saved ${saved.length} rows.`,
    db_saved_count: saved.length,
    success_count: saved.length,
    fail_count: Math.max(0, rows.length - saved.length),
    errors: [],
    batch_id: batch.id,
    external_sync_enabled: false,
  };
}

export async function importPurchaseRows(rows: RawRow[], sourceFileName?: string): Promise<ImportResult> {
  if (!hasDbConfig()) return noDbResult(rows);

  const batch = await createUploadBatch("purchases", sourceFileName, rows.length);
  const normalized = rows.map((row, index) => normalizePurchase(row, index, batch.id, sourceFileName));
  const saved = normalized.length ? await insertRows("purchases", normalized) : [];
  await updateUploadBatch(batch.id, saved.length, Math.max(0, rows.length - saved.length));

  return {
    ok: true,
    message: `FN OS purchases DB saved ${saved.length} rows.`,
    db_saved_count: saved.length,
    success_count: saved.length,
    fail_count: Math.max(0, rows.length - saved.length),
    errors: [],
    batch_id: batch.id,
    external_sync_enabled: false,
  };
}

export async function dashboardSummary() {
  const [sales, purchases, inventory, logs] = await Promise.all([
    selectRows<Record<string, unknown>>("sales", { order: "created_at.desc", limit: 200 }),
    selectRows<Record<string, unknown>>("purchases", { order: "created_at.desc", limit: 100 }),
    selectRows<Record<string, unknown>>("inventory_current", { order: "updated_at.desc", limit: 200 }),
    selectRows<Record<string, unknown>>("api_sync_logs", { order: "created_at.desc", limit: 20 }),
  ]);

  const today = todayCompact();
  const month = today.slice(0, 6);
  const saleRows = Array.isArray(sales) ? sales : [];
  const purchaseRows = Array.isArray(purchases) ? purchases : [];
  const inventoryRows = Array.isArray(inventory) ? inventory : [];
  const syncRows = Array.isArray(logs) ? logs : [];

  const todaySales = saleRows
    .filter((row) => text(row.io_date ?? row.sale_date) === today)
    .reduce((sum, row) => sum + numberValue(row.supply_amt ?? row.supply_amount ?? row.total_amount), 0);
  const monthSales = saleRows
    .filter((row) => text(row.io_date ?? row.sale_date).startsWith(month))
    .reduce((sum, row) => sum + numberValue(row.supply_amt ?? row.supply_amount ?? row.total_amount), 0);
  const monthPurchases = purchaseRows
    .filter((row) => text(row.io_date ?? row.purchase_date).startsWith(month))
    .reduce((sum, row) => sum + numberValue(row.supply_amt ?? row.supply_amount ?? row.total_amount), 0);
  const todayQty = saleRows
    .filter((row) => text(row.io_date ?? row.sale_date) === today)
    .reduce((sum, row) => sum + numberValue(row.qty), 0);
  const riskSku = inventoryRows.filter((row) => numberValue(row.available_qty ?? row.on_hand_qty ?? row.bal_qty) <= 5).length;
  const failCount = syncRows.filter((row) => text(row.status).toUpperCase() === "FAIL").length;

  return {
    today_sales: todaySales,
    month_sales: monthSales,
    today_qty: todayQty,
    month_purchases: monthPurchases,
    risk_sku: riskSku,
    fail_count: failCount,
    recent_sales: saleRows.slice(0, 20),
    recent_purchases: purchaseRows.slice(0, 20),
    inventory: inventoryRows.slice(0, 50),
    sync_logs: syncRows,
  };
}

export async function searchProducts(query: string) {
  const keyword = text(query);
  if (!keyword) return [];
  const escaped = keyword.replace(/[%*]/g, "");
  const [byCode, bySku, byName] = await Promise.all([
    selectRows<Record<string, unknown>>("products", { product_code: `ilike.*${escaped}*`, limit: 20 }).catch(() => []),
    selectRows<Record<string, unknown>>("products", { sku: `ilike.*${escaped}*`, limit: 20 }).catch(() => []),
    selectRows<Record<string, unknown>>("products", { product_name: `ilike.*${escaped}*`, limit: 20 }).catch(() => []),
  ]);
  const map = new Map<string, Record<string, unknown>>();
  [...byCode, ...bySku, ...byName].forEach((row) => map.set(text(row.id || row.product_code || row.sku || row.prod_cd), row));
  return Array.from(map.values()).slice(0, 20);
}

export async function syncProducts(_payload?: unknown) {
  return {
    ok: false,
    count: 0,
    message: "External product sync is disabled. Use channel adapters or Excel upload in the next phase.",
  };
}

export async function syncInventory(_payload?: unknown) {
  return {
    ok: false,
    count: 0,
    message: "External inventory sync is disabled. FN OS inventory will be managed from its own DB.",
  };
}

export async function upsertLocalProducts(rows: Record<string, unknown>[]) {
  return upsertRows("products", rows, "product_code");
}

export async function markBatchStatus(id: string, status: string) {
  return patchRows("upload_batches", { id: `eq.${id}` }, { status });
}

