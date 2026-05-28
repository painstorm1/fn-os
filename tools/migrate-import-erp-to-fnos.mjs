import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { envValue, loadEnvFiles } from "./env-utils.mjs";

const rootDir = process.cwd();
loadEnvFiles(rootDir);

const TARGET_DATABASE_URL =
  envValue("DATABASE_URL") ||
  envValue("POSTGRES_URL") ||
  envValue("SUPABASE_DB_URL") ||
  envValue("SUPABASE_POOLER_URL");

const IMPORT_ERP_ENV_PATH =
  process.env.IMPORT_ERP_ENV_PATH ||
  path.resolve(rootDir, "..", "수입ERP", ".env");

const TABLES = [
  "categories",
  "factories",
  "products",
  "product_materials",
  "material_movements",
  "orders",
  "order_items",
  "order_item_margin_calc",
  "attachments",
  "fx_rates",
];

function die(message) {
  console.error(message);
  process.exit(1);
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const importEnv = readEnvFile(IMPORT_ERP_ENV_PATH);
const SOURCE_DATABASE_URL =
  process.env.IMPORT_ERP_DATABASE_URL ||
  importEnv.DATABASE_URL ||
  importEnv.SUPABASE_DATABASE_URL;

if (!TARGET_DATABASE_URL) die("FN OS DATABASE_URL이 없습니다. .env.local을 확인해 주세요.");
if (!SOURCE_DATABASE_URL) die(`수입ERP DATABASE_URL이 없습니다. 확인 경로: ${IMPORT_ERP_ENV_PATH}`);

function qname(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function targetTableName(table) {
  return `import_erp_${table}`;
}

function columnType(column) {
  const type = column.udt_name;
  if (type === "int8") return "bigint";
  if (type === "int4") return "integer";
  if (type === "float8") return "double precision";
  if (type === "float4") return "real";
  if (type === "timestamptz") return "timestamptz";
  if (type === "timestamp") return "timestamp";
  if (type === "bool") return "boolean";
  if (type === "jsonb") return "jsonb";
  if (type === "json") return "json";
  if (type === "date") return "date";
  return "text";
}

async function tableExists(client, table) {
  const result = await client.query(
    "select exists (select 1 from information_schema.tables where table_schema='public' and table_name=$1) as exists",
    [table],
  );
  return Boolean(result.rows[0]?.exists);
}

async function sourceColumns(client, table) {
  const result = await client.query(
    `select column_name, udt_name, data_type, ordinal_position
       from information_schema.columns
      where table_schema='public' and table_name=$1
      order by ordinal_position`,
    [table],
  );
  return result.rows;
}

function conflictColumnsFor(table, columns) {
  const names = columns.map((column) => column.column_name);
  if (names.includes("id")) return ["id"];
  if (table === "fx_rates" && names.includes("currency")) return ["currency"];
  return [];
}

async function dedupeTargetRows(target, targetName, conflictColumns, columns) {
  if (!conflictColumns.length) return;
  const partition = conflictColumns.map(qname).join(", ");
  const columnNames = columns.map((column) => column.column_name);
  const orderColumns = [
    columnNames.includes("updated_at") ? "updated_at desc nulls last" : null,
    columnNames.includes("created_at") ? "created_at desc nulls last" : null,
    "migrated_at desc nulls last",
    "ctid desc",
  ].filter(Boolean).join(", ");
  await target.query(
    `delete from ${qname(targetName)} t
      using (
        select ctid,
               row_number() over (
                 partition by ${partition}
                 order by ${orderColumns}
               ) as rn
          from ${qname(targetName)}
      ) d
      where t.ctid = d.ctid
        and d.rn > 1`,
  );
}

async function ensureTargetTable(target, table, columns) {
  const targetName = targetTableName(table);
  const columnDefs = columns.map((column) => `${qname(column.column_name)} ${columnType(column)}`);
  columnDefs.push(`migrated_at timestamptz not null default now()`);
  await target.query(`create table if not exists ${qname(targetName)} (${columnDefs.join(", ")})`);
  for (const column of columns) {
    await target.query(`alter table ${qname(targetName)} add column if not exists ${qname(column.column_name)} ${columnType(column)}`);
  }
  await target.query(`alter table ${qname(targetName)} add column if not exists migrated_at timestamptz not null default now()`);
  const conflictColumns = conflictColumnsFor(table, columns);
  if (conflictColumns.length) {
    await dedupeTargetRows(target, targetName, conflictColumns, columns);
    await target.query(`create unique index if not exists ${qname(`${targetName}_${conflictColumns.join("_")}_uidx`)} on ${qname(targetName)} (${conflictColumns.map(qname).join(", ")})`);
  }
}

async function fetchRows(source, table, columns) {
  const columnNames = columns.map((column) => qname(column.column_name)).join(", ");
  const result = await source.query(`select ${columnNames} from ${qname(table)} order by ${columns.some((column) => column.column_name === "id") ? "id" : "1"}`);
  return result.rows;
}

async function upsertRows(target, table, columns, rows) {
  const targetName = targetTableName(table);
  if (!rows.length) return 0;
  const columnNames = columns.map((column) => column.column_name);
  const conflictColumns = conflictColumnsFor(table, columns);
  const insertColumns = [...columnNames, "migrated_at"];
  const insertSqlColumns = insertColumns.map(qname).join(", ");
  const updateColumns = columnNames.filter((name) => !conflictColumns.includes(name));
  const conflictSql = conflictColumns.length
    ? ` on conflict (${conflictColumns.map(qname).join(", ")}) do update set ${[
        ...updateColumns.map((name) => `${qname(name)} = excluded.${qname(name)}`),
        `migrated_at = now()`,
      ].join(", ")}`
    : "";

  const batchSize = 250;
  let count = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = [];
    const placeholders = batch.map((row) => {
      const rowValues = columnNames.map((name) => row[name]);
      rowValues.push(new Date());
      const start = values.length;
      values.push(...rowValues);
      return `(${rowValues.map((_, valueIndex) => `$${start + valueIndex + 1}`).join(", ")})`;
    });
    await target.query(
      `insert into ${qname(targetName)} (${insertSqlColumns}) values ${placeholders.join(", ")}${conflictSql}`,
      values,
    );
    count += batch.length;
  }
  return count;
}

async function main() {
  const source = new pg.Client({ connectionString: SOURCE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const target = new pg.Client({ connectionString: TARGET_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await source.connect();
  await target.connect();

  const summary = [];
  try {
    for (const table of TABLES) {
      if (!(await tableExists(source, table))) {
        summary.push({ table, status: "missing_source", rows: 0 });
        continue;
      }
      const columns = await sourceColumns(source, table);
      await ensureTargetTable(target, table, columns);
      const rows = await fetchRows(source, table, columns);
      const copied = await upsertRows(target, table, columns, rows);
      summary.push({ table, target_table: targetTableName(table), rows: copied });
    }
  } finally {
    await source.end();
    await target.end();
  }

  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
