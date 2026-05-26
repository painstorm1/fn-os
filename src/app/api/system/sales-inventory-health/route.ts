import { NextResponse } from "next/server";
import { hasDbConfig, selectRows } from "@/lib/fnos-db";

const REQUIRED_TABLES = [
  "sales_channels",
  "customers",
  "products",
  "warehouses",
  "orders",
  "order_items",
  "shipments",
  "sales",
  "purchases",
  "inventory_current",
  "inventory_movements",
  "upload_batches",
  "api_sync_logs",
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
  const tables = dbConfigured ? await Promise.all(REQUIRED_TABLES.map(checkTable)) : [];
  const dbReady = dbConfigured && tables.every((item) => item.ok);

  return NextResponse.json({
    ok: dbReady,
    db_configured: dbConfigured,
    db_ready: dbReady,
    tables,
    mode: "fn_os_erp",
    next_steps: [
      dbConfigured ? null : "Vercel 환경변수에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 입력하세요.",
      dbConfigured && !dbReady ? "Supabase SQL Editor에서 schema_sales_inventory.sql을 실행하세요." : null,
    ].filter(Boolean),
  });
}
