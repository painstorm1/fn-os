import pg from "pg";
import { envValue, loadEnvFiles } from "./env-utils.mjs";

const rootDir = process.cwd();
loadEnvFiles(rootDir);

const DATABASE_URL =
  envValue("DATABASE_URL") ||
  envValue("POSTGRES_URL") ||
  envValue("SUPABASE_DB_URL") ||
  envValue("SUPABASE_POOLER_URL");
const SUPABASE_URL = envValue("SUPABASE_URL") || envValue("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY =
  envValue("SUPABASE_SERVICE_ROLE_KEY") ||
  envValue("SUPABASE_SERVICE_KEY") ||
  envValue("SUPABASE_ANON_KEY");
const SUPABASE_STORAGE_BUCKET = envValue("SUPABASE_STORAGE_BUCKET") || "archive";

function die(message) {
  console.error(message);
  process.exit(1);
}

if (!DATABASE_URL) die("DATABASE_URL is required.");
if (!SUPABASE_URL || !SUPABASE_KEY) die("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

function imageInfo(dataUrl, id) {
  const match = String(dataUrl).match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  return {
    bytes: Buffer.from(match[2], "base64"),
    mimeType,
    objectPath: `import-erp/products/migrated/${id}.${extension}`,
  };
}

async function uploadImage(info) {
  const url = new URL(`/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${info.objectPath}`, SUPABASE_URL);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": info.mimeType,
      "x-upsert": "true",
    },
    body: info.bytes,
  });
  if (!response.ok) {
    throw new Error(`Storage upload failed: ${response.status} ${await response.text().catch(() => "")}`);
  }
  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${info.objectPath}`;
}

async function ensureBucket() {
  const bucketUrl = new URL(`/storage/v1/bucket/${SUPABASE_STORAGE_BUCKET}`, SUPABASE_URL);
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
  const existing = await fetch(bucketUrl, { headers });
  if (existing.ok) return;
  const create = await fetch(new URL("/storage/v1/bucket", SUPABASE_URL), {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: SUPABASE_STORAGE_BUCKET,
      name: SUPABASE_STORAGE_BUCKET,
      public: true,
      file_size_limit: 52428800,
    }),
  });
  if (!create.ok && create.status !== 409) {
    throw new Error(`Storage bucket create failed: ${create.status} ${await create.text().catch(() => "")}`);
  }
}

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    await ensureBucket();
    const { rows } = await client.query(
      `select id, name, image_path
         from import_erp_products
        where image_path like 'data:image/%;base64,%'
        order by id`,
    );
    const summary = [];
    for (const row of rows) {
      const info = imageInfo(row.image_path, row.id);
      if (!info) continue;
      const imageUrl = await uploadImage(info);
      await client.query(
        `update import_erp_products
            set image_path=$1, updated_at=coalesce(updated_at, now())
          where id=$2`,
        [imageUrl, row.id],
      );
      summary.push({ id: row.id, name: row.name, bytes: info.bytes.length, image_url: imageUrl });
    }
    console.log(JSON.stringify({ ok: true, migrated: summary.length, summary }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
