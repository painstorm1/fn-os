import { createUploadBatch, hasDbConfig, patchRows, selectRows, updateUploadBatch } from "./fnos-db";

type RawRow = Record<string, unknown>;
type QueryValue = string | number | boolean | null | undefined;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function dateKey(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{8}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10).replace(/\D/g, "");
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10).replace(/\D/g, "");
  return raw.replace(/\D/g, "").slice(0, 8);
}

function isoDateFromCompact(value: string) {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : "";
}

function decodeGroupKeyPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function groupFilters(groupKey: string) {
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
    if (dateValues.length) filters.or = `(${dateValues.flatMap((value) => [`io_date.eq.${value}`, `purchase_date.eq.${value}`]).join(",")})`;
    if (customerCode) filters.cust_code = `eq.${customerCode}`;
    if (customerName) filters.cust_name = `eq.${customerName}`;
    return filters;
  }
  if (key.startsWith("batch:")) return { upload_batch_id: `eq.${key.slice(6)}` };
  if (key.startsWith("manual:")) return { source_ref_id: `ilike.${key.slice(7)}%` };
  if (key.startsWith("source:")) return { source_ref_id: `ilike.${key.slice(7)}%` };
  if (key.startsWith("row:")) return { id: `eq.${key.slice(4)}` };
  if (key.startsWith("manual-purchase-")) return { source_ref_id: `ilike.${key}%` };
  return { upload_batch_id: `eq.${key}` };
}

function purchaseDate(row: RawRow) {
  return dateKey(row.io_date ?? row.purchase_date ?? row.created_at);
}

function purchaseCustomerName(row: RawRow) {
  return text(row.cust_name || row.customer_name || row.supplier_name);
}

function purchaseCustomerCode(row: RawRow) {
  return text(row.cust_code || row.customer_code || row.supplier_code);
}

function sortPurchaseRowsForMerge(rows: RawRow[]) {
  return rows.slice().sort((left, right) => {
    const dateDiff = purchaseDate(left).localeCompare(purchaseDate(right));
    if (dateDiff !== 0) return dateDiff;
    const leftNo = Number(left.upload_ser_no || Number.POSITIVE_INFINITY);
    const rightNo = Number(right.upload_ser_no || Number.POSITIVE_INFINITY);
    if (Number.isFinite(leftNo) && Number.isFinite(rightNo) && leftNo !== rightNo) return leftNo - rightNo;
    return text(left.created_at).localeCompare(text(right.created_at));
  });
}

export async function mergePurchaseEntryGroups(groupKeys: string[]) {
  const uniqueGroupKeys = Array.from(new Set(groupKeys.map(text).filter(Boolean)));
  if (uniqueGroupKeys.length < 2) throw new Error("전표통합할 구매 전표를 2개 이상 선택해 주세요.");
  if (!hasDbConfig()) throw new Error("Supabase environment variables are not configured.");

  const rowsByGroup = await Promise.all(uniqueGroupKeys.map(async (groupKey) => {
    const rows = await selectRows<RawRow>("purchases", { ...groupFilters(groupKey), order: "created_at.asc", limit: 1000 });
    return { groupKey, rows };
  }));
  const missingGroup = rowsByGroup.find((group) => group.rows.length === 0);
  if (missingGroup) throw new Error("선택한 구매 전표를 DB에서 찾을 수 없습니다.");

  const rows = rowsByGroup.flatMap((group) => group.rows);
  const dates = new Set(rows.map(purchaseDate).filter(Boolean));
  const customerNames = new Set(rows.map(purchaseCustomerName).filter(Boolean));
  if (dates.size !== 1 || customerNames.size !== 1 || rows.some((row) => !purchaseDate(row) || !purchaseCustomerName(row))) {
    throw new Error("일자, 구매처명이 동일하지 않아서 전표통합 불가능");
  }

  const batch = await createUploadBatch("purchases", "FN_OS_PURCHASE_VOUCHER_MERGE", rows.length);
  const now = new Date().toISOString();
  const sortedRows = sortPurchaseRowsForMerge(rows);
  const canonicalName = Array.from(customerNames)[0] || purchaseCustomerName(sortedRows[0]);
  const canonicalCode = sortedRows.map(purchaseCustomerCode).find(Boolean) || "";
  let updatedCount = 0;
  for (let index = 0; index < sortedRows.length; index += 1) {
    const row = sortedRows[index];
    const id = text(row.id);
    if (!id) continue;
    const updatedRows = await patchRows<RawRow>("purchases", { id: `eq.${id}` }, {
      upload_batch_id: batch.id,
      upload_ser_no: String(index + 1),
      cust_code: canonicalCode,
      cust_name: canonicalName,
      updated_at: now,
    });
    updatedCount += updatedRows.length;
  }
  await updateUploadBatch(batch.id, updatedCount, Math.max(0, rows.length - updatedCount)).catch(() => null);

  return {
    ok: true,
    merged_group_count: uniqueGroupKeys.length,
    merged_row_count: updatedCount,
    batch_id: batch.id,
    date: Array.from(dates)[0],
    customer_name: canonicalName,
    customer_code: canonicalCode,
  };
}
