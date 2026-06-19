import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { envValue, loadEnvFiles } from "./env-utils.mjs";

const rootDir = process.cwd();
loadEnvFiles(rootDir);

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;
const writeBackup = !args.has("--no-backup");

const databaseUrl =
  envValue("DATABASE_URL") ||
  envValue("POSTGRES_URL") ||
  envValue("SUPABASE_DB_URL") ||
  envValue("SUPABASE_POOLER_URL");

if (!databaseUrl) {
  console.error("DATABASE_URL/POSTGRES_URL/SUPABASE_DB_URL/SUPABASE_POOLER_URL is required.");
  process.exit(1);
}

const archiveTrackingParams = new Set(["fbclid", "gclid", "igsh", "si", "feature", "app", "share_id"]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeArchiveUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

    const removable = [];
    url.searchParams.forEach((_paramValue, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith("utm_") || archiveTrackingParams.has(lowerKey)) removable.push(key);
    });
    removable.forEach((key) => url.searchParams.delete(key));
    url.searchParams.sort();

    const pathname = url.pathname.replace(/\/+$/, "");
    const normalizedPath = pathname === "/" ? "" : pathname;
    const search = url.searchParams.toString();
    return `${url.protocol.toLowerCase()}//${url.hostname}${url.port ? `:${url.port}` : ""}${normalizedPath}${search ? `?${search}` : ""}`;
  } catch {
    return raw.split("#")[0].replace(/\/+$/, "");
  }
}

function archiveUrlHash(value) {
  const normalizedUrl = normalizeArchiveUrl(value);
  if (!normalizedUrl) return "";
  return createHash("sha256").update(normalizedUrl, "utf8").digest("hex");
}

function backupDir() {
  const base = process.env.HERMES_PROFILE_DIR || path.join(process.env.LOCALAPPDATA || path.join(process.env.HOME || rootDir, "AppData", "Local"), "hermes", "profiles", "fn_cool");
  return path.join(base, "backups", "fnos_archive_migrations");
}

async function columnExists(client, columnName) {
  const { rows } = await client.query(
    `select exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'archive_items'
         and column_name = $1
     ) as exists`,
    [columnName],
  );
  return Boolean(rows[0]?.exists);
}

async function indexExists(client, indexName) {
  const { rows } = await client.query(
    `select exists (
       select 1
       from pg_indexes
       where schemaname = 'public'
         and tablename = 'archive_items'
         and indexname = $1
     ) as exists`,
    [indexName],
  );
  return Boolean(rows[0]?.exists);
}

function summarizeDuplicateGroup(items) {
  return {
    hash: items[0].urlHash,
    normalized_url: items[0].normalizedUrl,
    count: items.length,
    canonical_id: items[0].id,
    duplicate_ids: items.slice(1).map((item) => item.id),
    titles: items.slice(0, 5).map((item) => cleanText(item.title)).filter(Boolean),
  };
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("supabase.") ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();

  const before = {
    normalizedColumn: await columnExists(client, "normalized_url"),
    hashColumn: await columnExists(client, "url_hash"),
    normalizedIndex: await indexExists(client, "idx_archive_normalized_url"),
    hashUniqueIndex: await indexExists(client, "archive_items_url_hash_uidx"),
  };

  if (!dryRun) {
    await client.query("begin");
    await client.query("alter table archive_items add column if not exists normalized_url text");
    await client.query("alter table archive_items add column if not exists url_hash text");
    await client.query("create index if not exists idx_archive_normalized_url on archive_items(normalized_url)");
  }

  const normalizedSelect = before.normalizedColumn ? "normalized_url" : "null::text as normalized_url";
  const hashSelect = before.hashColumn ? "url_hash" : "null::text as url_hash";
  const { rows } = await client.query(
    `select id, title, url, original_url, ${normalizedSelect}, ${hashSelect}
       from archive_items
      where coalesce(url, original_url, '') <> ''
      order by created_at asc nulls last, id asc`,
  );

  const computed = rows
    .map((row) => {
      const sourceUrl = cleanText(row.url) || cleanText(row.original_url);
      const normalizedUrl = normalizeArchiveUrl(sourceUrl);
      const urlHash = archiveUrlHash(normalizedUrl);
      return { ...row, sourceUrl, normalizedUrl, urlHash };
    })
    .filter((row) => row.normalizedUrl && row.urlHash);

  const groups = new Map();
  for (const row of computed) {
    if (!groups.has(row.urlHash)) groups.set(row.urlHash, []);
    groups.get(row.urlHash).push(row);
  }

  const duplicateGroups = [...groups.values()].filter((items) => items.length > 1);
  const duplicateIds = new Set(duplicateGroups.flatMap((items) => items.slice(1).map((item) => item.id)));
  const candidates = computed.filter((row) => !duplicateIds.has(row.id));
  const needsUpdate = candidates.filter(
    (row) => row.normalized_url !== row.normalizedUrl || row.url_hash !== row.urlHash,
  );
  const duplicateRowsToNormalizeOnly = computed.filter(
    (row) => duplicateIds.has(row.id) && row.normalized_url !== row.normalizedUrl,
  );

  let backupPath = "";
  if (writeBackup) {
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = path.join(dir, `archive-url-dedupe-${stamp}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          mode: dryRun ? "dry-run" : "apply",
          before,
          row_count: rows.length,
          computed_count: computed.length,
          updatable_hash_count: needsUpdate.length,
          duplicate_group_count: duplicateGroups.length,
          duplicate_rows_not_hashed: duplicateIds.size,
          duplicate_groups: duplicateGroups.map(summarizeDuplicateGroup),
          previous_values: rows.map((row) => ({
            id: row.id,
            title: row.title,
            url: row.url,
            original_url: row.original_url,
            normalized_url: row.normalized_url,
            url_hash: row.url_hash,
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  if (!dryRun) {
    for (const row of needsUpdate) {
      await client.query(
        "update archive_items set normalized_url = $1, url_hash = $2, updated_at = now() where id = $3",
        [row.normalizedUrl, row.urlHash, row.id],
      );
    }
    for (const row of duplicateRowsToNormalizeOnly) {
      await client.query(
        "update archive_items set normalized_url = $1, url_hash = null, updated_at = now() where id = $2",
        [row.normalizedUrl, row.id],
      );
    }
    await client.query("create unique index if not exists archive_items_url_hash_uidx on archive_items(url_hash) where url_hash is not null");
    await client.query("commit");
  }

  const after = {
    normalizedColumn: dryRun ? before.normalizedColumn : await columnExists(client, "normalized_url"),
    hashColumn: dryRun ? before.hashColumn : await columnExists(client, "url_hash"),
    normalizedIndex: dryRun ? before.normalizedIndex : await indexExists(client, "idx_archive_normalized_url"),
    hashUniqueIndex: dryRun ? before.hashUniqueIndex : await indexExists(client, "archive_items_url_hash_uidx"),
  };

  const verification = dryRun
    ? { hashed_rows: null, duplicate_hashes: null }
    : {
        hashed_rows: Number((await client.query("select count(*)::int as count from archive_items where url_hash is not null")).rows[0]?.count || 0),
        duplicate_hashes: Number(
          (
            await client.query(
              `select count(*)::int as count
                 from (
                   select url_hash
                     from archive_items
                    where url_hash is not null
                    group by url_hash
                   having count(*) > 1
                 ) d`,
            )
          ).rows[0]?.count || 0,
        ),
      };

  console.log(JSON.stringify({
    status: dryRun ? "dry-run" : "applied",
    before,
    after,
    archive_rows_with_url: rows.length,
    computed_url_identities: computed.length,
    rows_backfill_hash: needsUpdate.length,
    duplicate_groups_detected: duplicateGroups.length,
    duplicate_rows_left_unhashed_for_manual_merge: duplicateIds.size,
    duplicate_rows_normalized_only: duplicateRowsToNormalizeOnly.length,
    verification,
    backup_path: backupPath,
  }, null, 2));
} catch (error) {
  try { if (!dryRun) await client.query("rollback"); } catch {}
  console.error(`Archive URL dedupe migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
