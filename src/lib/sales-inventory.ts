import { createUploadBatch, insertRows, selectRows, updateUploadBatch, upsertRows } from "./fnos-db";
import { fetchEcountInventory, fetchEcountProducts, hasEcountConfig, savePurchases, saveSales } from "./ecount-client";

export type ImportResult = {
  ok: boolean;
  batch_id?: string;
  total_count: number;
  success_count: number;
  fail_count: number;
  ecount_enabled: boolean;
  results: Array<{ index: number; ok: boolean; message?: string; slip_no?: string | null }>;
};

function pick(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function num(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const next = String(value).trim();
  return next ? next : null;
}

export function normalizeSaleRow(row: Record<string, unknown>, batchId?: string, sourceFileName?: string) {
  return {
    source_type: "excel",
    source_file_name: sourceFileName || null,
    upload_batch_id: batchId || null,
    io_date: text(pick(row, ["io_date", "IO_DATE", "일자", "A 일자"])),
    upload_ser_no: text(pick(row, ["upload_ser_no", "UPLOAD_SER_NO", "순번", "B 순번"])),
    cust_code: text(pick(row, ["cust_code", "CUST", "거래처코드", "C 거래처코드"])),
    cust_name: text(pick(row, ["cust_name", "거래처명", "D 거래처명"])),
    emp_cd: text(pick(row, ["emp_cd", "담당자", "E 담당자"])),
    wh_cd: text(pick(row, ["wh_cd", "WH_CD", "출하창고", "F 출하창고"])),
    io_type: text(pick(row, ["io_type", "거래유형", "G 거래유형"])),
    currency: text(pick(row, ["currency", "통화", "H 통화"])),
    exchange_rate: num(pick(row, ["exchange_rate", "환율", "I 환율"])),
    prod_cd: text(pick(row, ["prod_cd", "PROD_CD", "품목코드", "J 품목코드"])),
    prod_name: text(pick(row, ["prod_name", "품목명", "K 품목명"])),
    size_des: text(pick(row, ["size_des", "규격", "L 규격"])),
    qty: num(pick(row, ["qty", "QTY", "수량", "M 수량"])),
    price: num(pick(row, ["price", "PRICE", "단가(vat포함)", "N 단가(vat포함)"])),
    foreign_amt: num(pick(row, ["foreign_amt", "외화금액", "O 외화금액"])),
    supply_amt: num(pick(row, ["supply_amt", "공급가액", "P 공급가액"])),
    remarks: text(pick(row, ["remarks", "적요", "Q 적요"])),
    make_flag: text(pick(row, ["make_flag", "생산전표생성", "R 생산전표생성"])),
    ecount_sync_status: "PENDING",
  };
}

export function normalizePurchaseRow(row: Record<string, unknown>, batchId?: string, sourceFileName?: string) {
  return {
    upload_batch_id: batchId || null,
    source_file_name: sourceFileName || null,
    io_date: text(pick(row, ["io_date", "IO_DATE", "일자"])),
    ord_date: text(pick(row, ["ord_date", "주문일자"])),
    ord_no: text(pick(row, ["ord_no", "주문번호"])),
    cust_code: text(pick(row, ["cust_code", "CUST", "거래처코드"])),
    cust_name: text(pick(row, ["cust_name", "거래처명"])),
    wh_cd: text(pick(row, ["wh_cd", "WH_CD", "입고창고", "출하창고"])),
    prod_cd: text(pick(row, ["prod_cd", "PROD_CD", "품목코드"])),
    prod_name: text(pick(row, ["prod_name", "품목명"])),
    qty: num(pick(row, ["qty", "QTY", "수량"])),
    price: num(pick(row, ["price", "PRICE", "단가(vat포함)"])),
    supply_amt: num(pick(row, ["supply_amt", "공급가액"])),
    vat_amt: num(pick(row, ["vat_amt", "부가세"])),
    remarks: text(pick(row, ["remarks", "적요"])),
    ecount_sync_status: "PENDING",
  };
}

function extractSlipNo(response: Record<string, unknown>) {
  const data = response.Data as Record<string, unknown> | undefined;
  return text(data?.SlipNo || data?.SLIP_NO || response.SlipNo || response.SLIP_NO);
}

export async function importSalesRows(rows: Array<Record<string, unknown>>, options: { sourceFileName?: string; syncEcount?: boolean } = {}): Promise<ImportResult> {
  const batch = await createUploadBatch("sales", options.sourceFileName, rows.length);
  const normalized = rows.map((row) => normalizeSaleRow(row, batch.id, options.sourceFileName));
  const inserted = await insertRows<{ id: string }>("sales", normalized);
  const shouldSync = Boolean(options.syncEcount && hasEcountConfig());
  const results: ImportResult["results"] = inserted.map((_, index) => ({ index, ok: true, message: "FN OS 저장 완료" }));

  if (shouldSync && rows.length) {
    try {
      const response = await saveSales(normalized);
      const slipNo = extractSlipNo(response);
      results.forEach((item) => {
        item.message = "이카운트 전송 완료";
        item.slip_no = slipNo;
      });
    } catch (error) {
      results.forEach((item) => {
        item.ok = false;
        item.message = error instanceof Error ? error.message : "이카운트 전송 실패";
      });
    }
  }

  const success = results.filter((item) => item.ok).length;
  await updateUploadBatch(batch.id, success, rows.length - success);
  return { ok: true, batch_id: batch.id, total_count: rows.length, success_count: success, fail_count: rows.length - success, ecount_enabled: shouldSync, results };
}

export async function importPurchaseRows(rows: Array<Record<string, unknown>>, options: { sourceFileName?: string; syncEcount?: boolean } = {}): Promise<ImportResult> {
  const batch = await createUploadBatch("purchases", options.sourceFileName, rows.length);
  const normalized = rows.map((row) => normalizePurchaseRow(row, batch.id, options.sourceFileName));
  const inserted = await insertRows<{ id: string }>("purchases", normalized);
  const shouldSync = Boolean(options.syncEcount && hasEcountConfig());
  const results: ImportResult["results"] = inserted.map((_, index) => ({ index, ok: true, message: "FN OS 저장 완료" }));

  if (shouldSync && rows.length) {
    try {
      const response = await savePurchases(normalized);
      const slipNo = extractSlipNo(response);
      results.forEach((item) => {
        item.message = "이카운트 전송 완료";
        item.slip_no = slipNo;
      });
    } catch (error) {
      results.forEach((item) => {
        item.ok = false;
        item.message = error instanceof Error ? error.message : "이카운트 전송 실패";
      });
    }
  }

  const success = results.filter((item) => item.ok).length;
  await updateUploadBatch(batch.id, success, rows.length - success);
  return { ok: true, batch_id: batch.id, total_count: rows.length, success_count: success, fail_count: rows.length - success, ecount_enabled: shouldSync, results };
}

export async function dashboardSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const [sales, purchases, inventory, logs] = await Promise.all([
    selectRows<Record<string, unknown>>("sales", { order: "io_date.desc,created_at.desc", limit: 50 }),
    selectRows<Record<string, unknown>>("purchases", { order: "io_date.desc,created_at.desc", limit: 50 }),
    selectRows<Record<string, unknown>>("inventory_snapshots", { order: "synced_at.desc", limit: 200 }),
    selectRows<Record<string, unknown>>("ecount_sync_logs", { order: "created_at.desc", limit: 20 }),
  ]);

  const todaySales = sales.filter((row) => String(row.io_date || "").startsWith(today));
  const monthSales = sales.filter((row) => String(row.io_date || "").startsWith(month));
  const salesAmount = (rows: Record<string, unknown>[]) => rows.reduce((sum, row) => sum + Number(row.supply_amt || 0), 0);

  return {
    today_sales: salesAmount(todaySales),
    month_sales: salesAmount(monthSales),
    today_qty: todaySales.reduce((sum, row) => sum + Number(row.qty || 0), 0),
    month_purchase_amount: purchases.filter((row) => String(row.io_date || "").startsWith(month)).reduce((sum, row) => sum + Number(row.supply_amt || 0), 0),
    inventory_risk_count: inventory.filter((row) => Number(row.bal_qty || 0) <= 5).length,
    sync_fail_count: logs.filter((row) => row.status === "FAIL").length,
    recent_sales: sales.slice(0, 10),
    recent_purchases: purchases.slice(0, 10),
    inventory: inventory.slice(0, 30),
    logs,
  };
}

export async function syncProducts(payload: Record<string, unknown> = {}) {
  const response = await fetchEcountProducts(payload);
  const rows = Array.isArray(response.Data) ? response.Data : Array.isArray(response.data) ? response.data : [];
  const normalized = rows.map((row: Record<string, unknown>) => ({
    prod_cd: text(row.PROD_CD || row.prod_cd),
    prod_name: text(row.PROD_DES || row.PROD_NAME || row.prod_name),
    size_des: text(row.SIZE_DES || row.size_des),
    prod_type: text(row.PROD_TYPE || row.prod_type),
    barcode: text(row.BAR_CODE || row.BARCODE || row.barcode),
    is_active: row.USE_YN === "N" ? false : true,
    last_synced_at: new Date().toISOString(),
  })).filter((row) => row.prod_cd);
  if (normalized.length) await upsertRows("products", normalized, "prod_cd");
  return { ok: true, count: normalized.length, raw: response };
}

export async function syncInventory(payload: Record<string, unknown> = {}) {
  const response = await fetchEcountInventory(payload);
  const rows = Array.isArray(response.Data) ? response.Data : Array.isArray(response.data) ? response.data : [];
  const today = new Date().toISOString().slice(0, 10);
  const normalized = rows.map((row: Record<string, unknown>) => ({
    snapshot_date: today,
    wh_cd: text(row.WH_CD || row.wh_cd),
    wh_name: text(row.WH_DES || row.WH_NAME || row.wh_name),
    prod_cd: text(row.PROD_CD || row.prod_cd),
    prod_name: text(row.PROD_DES || row.PROD_NAME || row.prod_name),
    size_des: text(row.SIZE_DES || row.size_des),
    bal_qty: num(row.BAL_QTY || row.qty || row.BALANCE_QTY) || 0,
    synced_at: new Date().toISOString(),
  })).filter((row) => row.prod_cd);
  if (normalized.length) await insertRows("inventory_snapshots", normalized);
  return { ok: true, count: normalized.length, raw: response };
}

