import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { envValue, loadEnvFiles } from "./env-utils.mjs";

const rootDir = process.cwd();
loadEnvFiles(rootDir);

const databaseUrl = envValue("DATABASE_URL");
if (!databaseUrl) {
  console.error(
    "DATABASE_URL이 없습니다. Supabase Project Settings > Database > Connection string 값을 .env.local에 DATABASE_URL로 넣은 뒤 다시 실행해 주세요."
  );
  process.exit(1);
}

const schemaPath = path.join(rootDir, "schema_sales_inventory.sql");
if (!fs.existsSync(schemaPath)) {
  console.error(`schema_sales_inventory.sql 파일을 찾지 못했습니다: ${schemaPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(schemaPath, "utf8");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("supabase.") ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  await client.query(sql);
  console.log("FN OS 매출/재고 스키마 실행 완료");
} catch (error) {
  console.error(`FN OS 매출/재고 스키마 실행 실패: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

