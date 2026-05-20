import { NextResponse } from "next/server";
import { hasEcountConfig } from "@/lib/ecount-client";
import { hasDbConfig, selectRows } from "@/lib/fnos-db";

const REQUIRED_TABLES = [
  "upload_batches",
  "sales",
  "purchases",
  "products",
  "product_mappings",
  "inventory_snapshots",
  "ecount_sync_logs",
];

async function checkTable(table: string) {
  try {
    await selectRows(table, { limit: 1 });
    return { table, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { table, ok: false, message };
  }
}

export async function GET() {
  const dbConfigured = hasDbConfig();
  const ecountConfigured = hasEcountConfig();
  const tables = dbConfigured ? await Promise.all(REQUIRED_TABLES.map(checkTable)) : [];
  const dbReady = dbConfigured && tables.every((item) => item.ok);

  return NextResponse.json({
    ok: dbReady,
    db_configured: dbConfigured,
    db_ready: dbReady,
    ecount_configured: ecountConfigured,
    tables,
    next_steps: [
      dbConfigured ? null : "Vercel 환경변수에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 입력하세요.",
      dbConfigured && !dbReady ? "Supabase SQL Editor에서 schema_sales_inventory.sql을 실행하세요." : null,
      ecountConfigured ? null : "ECOUNT_ZONE, ECOUNT_BASE_URL, ECOUNT_COM_CODE, ECOUNT_USER_ID, ECOUNT_API_CERT_KEY를 입력하세요.",
    ].filter(Boolean),
  });
}
