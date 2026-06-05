type QueryValue = string | number | boolean | null | undefined;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "archive";

export class FnosDbError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "FnosDbError";
    this.status = status;
  }
}

export function hasDbConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function friendlySupabaseError(text: string, status: number) {
  const missingColumn = text.match(/Could not find the ['"]?([^'"\s]+)['"]? column/i) || text.match(/column ['"]?([^'"\s]+)['"]? does not exist/i);
  if (missingColumn?.[1]) {
    return `FN OS DB 컬럼 '${missingColumn[1]}'이 현재 Supabase 스키마에 없습니다. 저장 가능한 기존 컬럼만으로 다시 시도합니다.`;
  }
  if (/PGRST205|Could not find the table|schema cache|fnos_settings|upload_batches|sales|purchases|products|product_boms|product_bom_items|customers|warehouses|sales_channels|sales_channel_credentials|inventory_current|inventory_snapshots|api_sync_logs|ad_daily_metrics|expense_entries|expense_categories|expense_upload_batches|expenses|payment_records|customer_payables|accounting_import_batches|accounting_transaction_sources|accounting_categories|accounting_category_rules|accounting_transactions|accounting_review_queue|accounting_card_settlements|accounting_fixed_costs|accounting_loans|accounting_bank_accounts|accounting_card_accounts|import_product_sku_links|import_purchase_sku_allocations|archive_items/i.test(text)) {
    return "FN OS DB 테이블이 아직 준비되지 않았습니다. Supabase SQL Editor에서 schema_sales_inventory.sql 전체를 실행해 주세요.";
  }
  if (/row-level security|violates row-level security/i.test(text)) {
    return "Supabase 권한 정책 때문에 요청이 차단되었습니다. Vercel에 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있는지 확인해 주세요.";
  }
  return text || `Supabase request failed: ${status}`;
}

function missingColumnName(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.match(/컬럼 '([^']+)'/)?.[1] || message.match(/Could not find the ['"]?([^'"\s]+)['"]? column/i)?.[1] || "";
}

function restUrl(table: string, query?: Record<string, QueryValue>) {
  if (!hasDbConfig()) throw new FnosDbError("Supabase environment variables are not configured.", 503);
  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function request<T>(table: string, init: RequestInit = {}, query?: Record<string, QueryValue>): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_KEY);
  headers.set("Authorization", `Bearer ${SUPABASE_KEY}`);
  headers.set("Content-Type", "application/json");
  if (!headers.has("Prefer") && init.method && init.method !== "GET") {
    headers.set("Prefer", "return=representation");
  }

  const response = await fetch(restUrl(table, query), {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new FnosDbError(friendlySupabaseError(text, response.status), response.status);
  }

  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export async function selectRows<T>(table: string, query?: Record<string, QueryValue>) {
  return request<T[]>(table, { method: "GET" }, { select: "*", ...(query || {}) });
}

export async function insertRows<T>(table: string, rows: Record<string, unknown> | Record<string, unknown>[]) {
  return request<T[]>(table, {
    method: "POST",
    body: JSON.stringify(rows),
  });
}

export async function upsertRows<T>(table: string, rows: Record<string, unknown> | Record<string, unknown>[], conflictTarget?: string) {
  return request<T[]>(
    table,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows),
    },
    conflictTarget ? { on_conflict: conflictTarget } : undefined,
  );
}

export async function patchRows<T>(table: string, filters: Record<string, QueryValue>, values: Record<string, unknown>) {
  return request<T[]>(
    table,
    {
      method: "PATCH",
      body: JSON.stringify(values),
    },
    filters,
  );
}

export async function deleteRows<T>(table: string, filters: Record<string, QueryValue>) {
  return request<T[]>(
    table,
    {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    },
    filters,
  );
}

export async function uploadStorageFile(file: File, pathPrefix = "archive") {
  if (!hasDbConfig()) throw new FnosDbError("Supabase environment variables are not configured.", 503);
  const safePrefix = pathPrefix
    .split("/")
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "item")
    .join("/");
  const nameParts = file.name.split(".");
  const ext = nameParts.length > 1 ? `.${String(nameParts.pop() || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}` : "";
  const baseName = nameParts.join(".") || "upload";
  const safeName =
    baseName
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "upload";
  const date = new Date().toISOString().slice(0, 10);
  const objectPath = `${safePrefix}/${date}/${crypto.randomUUID()}-${safeName}${ext.toLowerCase()}`;
  const url = new URL(`/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${objectPath}`, SUPABASE_URL);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: await file.arrayBuffer(),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new FnosDbError(friendlySupabaseError(text, response.status), response.status);
  }

  return {
    bucket: SUPABASE_STORAGE_BUCKET,
    path: objectPath,
    url: `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${objectPath}`,
  };
}

export async function createUploadBatch(batchType: string, sourceFileName: string | undefined, totalCount: number) {
  let values: Record<string, unknown> = {
    batch_type: batchType,
    source_name: "fn_os",
    source_file_name: sourceFileName || null,
    total_count: totalCount,
    success_count: 0,
    fail_count: 0,
    status: "SAVED",
  };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const [batch] = await insertRows<{ id: string }>("upload_batches", values);
      return batch;
    } catch (error) {
      const column = missingColumnName(error);
      if (!column || !(column in values)) throw error;
      const { [column]: _removed, ...rest } = values;
      values = rest;
    }
  }
  throw new FnosDbError("업로드 배치 저장 가능 컬럼 확인에 실패했습니다.");
}

export async function updateUploadBatch(id: string, successCount: number, failCount: number) {
  return patchRows("upload_batches", { id: `eq.${id}` }, { success_count: successCount, fail_count: failCount });
}
