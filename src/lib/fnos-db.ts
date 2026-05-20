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
    throw new FnosDbError(text || `Supabase request failed: ${response.status}`, response.status);
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
    source_file_name: sourceFileName || null,
    total_count: totalCount,
    success_count: 0,
    fail_count: 0,
  });
  return batch;
}

export async function updateUploadBatch(id: string, successCount: number, failCount: number) {
  return patchRows("upload_batches", { id: `eq.${id}` }, { success_count: successCount, fail_count: failCount });
}

