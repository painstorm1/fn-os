type QueryValue = string | number | boolean | null | undefined;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

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
  if (/PGRST205|Could not find the table|schema cache|upload_batches|sales|purchases|products|customers|warehouses|inventory_current|inventory_snapshots|api_sync_logs/i.test(text)) {
    return "FN OS 매출/재고 DB 테이블이 아직 준비되지 않았습니다. Supabase SQL Editor에서 schema_sales_inventory.sql 전체를 실행해 주세요.";
  }
  if (/row-level security|violates row-level security/i.test(text)) {
    return "Supabase 권한 정책 때문에 요청이 차단되었습니다. Vercel에 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있는지 확인해 주세요.";
  }
  return text || `Supabase request failed: ${status}`;
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

export async function createUploadBatch(batchType: string, sourceFileName: string | undefined, totalCount: number) {
  const [batch] = await insertRows<{ id: string }>("upload_batches", {
    batch_type: batchType,
    source_name: "fn_os",
    source_file_name: sourceFileName || null,
    total_count: totalCount,
    success_count: 0,
    fail_count: 0,
    status: "SAVED",
  });
  return batch;
}

export async function updateUploadBatch(id: string, successCount: number, failCount: number) {
  return patchRows("upload_batches", { id: `eq.${id}` }, { success_count: successCount, fail_count: failCount });
}
