import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import pg from "pg";
import { envValue, loadEnvFiles } from "./env-utils.mjs";

const rootDir = process.cwd();
loadEnvFiles(rootDir);

const databaseUrl =
  envValue("DATABASE_URL") ||
  envValue("POSTGRES_URL") ||
  envValue("SUPABASE_DB_URL") ||
  envValue("SUPABASE_POOLER_URL");
if (!databaseUrl) {
  console.error(
    "DATABASE_URL이 없습니다. Supabase Project Settings > Database > Connection string 값을 .env.local에 DATABASE_URL로 넣은 뒤 다시 실행해 주세요. IPv6 직결이 막히면 Session pooler URL을 DATABASE_URL로 넣어도 됩니다."
  );
  process.exit(1);
}

const schemaPath = path.join(rootDir, "schema_sales_inventory.sql");
if (!fs.existsSync(schemaPath)) {
  console.error(`schema_sales_inventory.sql 파일을 찾지 못했습니다: ${schemaPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(schemaPath, "utf8");

function dbHost(value) {
  try {
    return new URL(value.replace(/^postgres(ql)?:\/\//, "https://")).host;
  } catch {
    return "";
  }
}

async function warnIfHostLooksWrong() {
  const host = dbHost(databaseUrl);
  const supabaseUrl = envValue("SUPABASE_URL");
  if (!host) return;

  try {
    await dns.lookup(host.replace(/:\d+$/, ""));
  } catch {
    console.warn(
      `DATABASE_URL 호스트를 DNS에서 찾지 못했습니다: ${host}. Supabase Dashboard의 Session pooler connection string을 DATABASE_URL로 다시 넣어주세요.`
    );
  }

  if (!supabaseUrl) return;
  try {
    const dbRef = host.match(/^db\.([^.]+)\.supabase\.co(?::\d+)?$/)?.[1] || "";
    const apiRef = new URL(supabaseUrl).host.match(/^([^.]+)\.supabase\.co$/)?.[1] || "";
    if (dbRef && apiRef && dbRef !== apiRef) {
      console.warn("DATABASE_URL 프로젝트 ref와 SUPABASE_URL 프로젝트 ref가 서로 다릅니다. 같은 Supabase 프로젝트 값인지 확인해 주세요.");
    }
  } catch {
    // Ignore URL parse warnings here; connection failure will provide the real error.
  }
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("supabase.") ? { rejectUnauthorized: false } : undefined,
});

try {
  await warnIfHostLooksWrong();
  await client.connect();
  await client.query(sql);
  console.log("FN OS 매출/재고 스키마 실행 완료");
} catch (error) {
  console.error(`FN OS 매출/재고 스키마 실행 실패: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
