import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envValue, loadEnvFiles } from "./env-utils.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
loadEnvFiles(repoRoot);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const vaultArg = args.find((arg) => arg.startsWith("--vault="))?.slice("--vault=".length);
const vault = path.resolve(vaultArg || process.env.FNOS_OBSIDIAN_VAULT || "D:/Obs_FN_Cool");
const cardsRoot = path.join(vault, "03_INBOX", "Resource_Triage_Cards");

function cleanScalar(value = "") {
  const next = String(value).trim();
  if ((next.startsWith('"') && next.endsWith('"')) || (next.startsWith("'") && next.endsWith("'"))) return next.slice(1, -1);
  return next;
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
    const colon = line.indexOf(":");
    return colon > 0 && !/^\s/.test(line) ? [[line.slice(0, colon).trim(), cleanScalar(line.slice(colon + 1))]] : [];
  }));
}

function frontmatterList(markdown, key) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return [];
  const lines = match[1].split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start < 0) return [];
  const values = [];
  for (const line of lines.slice(start + 1)) {
    const item = line.match(/^\s+-\s+(.+)$/);
    if (!item) break;
    values.push(cleanScalar(item[1]).replace(/^\[\[|\]\]$/g, ""));
  }
  return values.filter(Boolean);
}

function preview(markdown) {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const summary = body.match(/## 3줄 요약\s*([\s\S]*?)(?=\n## |$)/)?.[1] || body;
  return summary
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^[#>*-]+\s*/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function walkMarkdown(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? walkMarkdown(full) : entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [full] : [];
  });
}

function statusFor(decision) {
  const key = cleanScalar(decision).toLowerCase();
  if (key === "promoted") return ["confirmed", "new"];
  if (key === "discarded") return ["rejected", null];
  return ["pending", null];
}

if (!fs.existsSync(cardsRoot)) throw new Error(`Triage card root not found: ${cardsRoot}`);
const files = walkMarkdown(cardsRoot).sort();
let rows = files.map((file) => {
  const markdown = fs.readFileSync(file, "utf8");
  const meta = frontmatter(markdown);
  const archiveId = cleanScalar(meta.archive_id || meta.fnos_archive_id);
  const legacyDecision = cleanScalar(meta.decision);
  const [status, confirmationMethod] = statusFor(legacyDecision);
  const targetHint = cleanScalar(meta.knowledge_candidate);
  const relationship = cleanScalar(meta.knowledge_relation);
  const category = cleanScalar(meta.category);
  const scope = /personal|개인/.test(`${targetHint} ${category}`.toLowerCase()) ? "personal" : "company";
  const sourceCardPath = path.relative(vault, file).split(path.sep).join("/");
  const sourceDate = sourceCardPath.match(/\/(\d{4}-\d{2}-\d{2})\//)?.[1] || null;
  const promotedPaths = frontmatterList(markdown, "promoted_to").filter((candidate) => (
    !path.isAbsolute(candidate)
    && candidate.toLowerCase().endsWith(".md")
    && !candidate.split(/[\\/]/).includes("..")
  ));
  const promotedReadback = promotedPaths.length > 0
    && promotedPaths.every((candidate) => fs.existsSync(path.join(vault, ...candidate.split(/[\\/]/))));
  const score = Number(cleanScalar(meta.value_score));
  return {
    ...(archiveId ? { archive_id: archiveId } : {}),
    source_card_path: sourceCardPath,
    title: cleanScalar(meta.title) || path.basename(file, path.extname(file)),
    scope,
    category: category || null,
    source_date: sourceDate,
    value_score: Number.isFinite(score) && score >= 0 && score <= 5 ? score : null,
    value_label: cleanScalar(meta.value_label) || null,
    status,
    confirmation_method: confirmationMethod,
    relationship: relationship || null,
    target_hint: targetHint || null,
    source_type: cleanScalar(meta.source_type) || null,
    source_url: cleanScalar(meta.source_url) || null,
    obsidian_path: promotedReadback ? promotedPaths[0] : null,
    preview: preview(markdown),
    legacy_decision: legacyDecision || null,
    legacy_decided_at: cleanScalar(meta.decided_at) || null,
    processing_status: status === "confirmed" && promotedReadback ? "success" : "idle",
    updated_at: new Date().toISOString(),
  };
});

const archiveIds = rows.map((row) => row.archive_id).filter(Boolean);
const uniqueArchiveIds = new Set(archiveIds);
if (archiveIds.length !== uniqueArchiveIds.size) throw new Error("Duplicate Archive IDs found in triage cards.");

if (dryRun) {
  const statuses = rows.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {});
  const confirmedReadback = rows.filter((row) => row.status === "confirmed" && row.processing_status === "success" && row.obsidian_path).length;
  console.log(JSON.stringify({ ok: true, dry_run: true, count: rows.length, unique_archive_ids: uniqueArchiveIds.size, statuses, confirmed_readback: confirmedReadback }, null, 2));
  process.exit(0);
}

const supabaseUrl = envValue("SUPABASE_URL") || envValue("NEXT_PUBLIC_SUPABASE_URL");
const supabaseKey = envValue("SUPABASE_SERVICE_ROLE_KEY") || envValue("SUPABASE_SERVICE_KEY");
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase service configuration is required for real sync.");

const readback = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/knowledge_index?select=source_card_path,archive_id,status,confirmation_method,legacy_decision,legacy_decided_at,decided_at,requested_action,processing_status,automation_job_id,obsidian_path&limit=1000`, {
  headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` },
});
if (!readback.ok) throw new Error(`knowledge_index preservation readback failed: ${readback.status} ${(await readback.text()).slice(0, 500)}`);
const existingByPath = new Map((await readback.json()).map((row) => [row.source_card_path, row]));
const preserveKeys = ["archive_id", "status", "confirmation_method", "legacy_decision", "legacy_decided_at", "decided_at", "requested_action", "processing_status", "automation_job_id", "obsidian_path"];
rows = rows.map((row) => {
  const existing = existingByPath.get(row.source_card_path);
  if (!existing) return row;
  return {
    ...row,
    ...Object.fromEntries(preserveKeys.filter((key) => existing[key] !== undefined && existing[key] !== null).map((key) => [key, existing[key]])),
  };
});

for (let index = 0; index < rows.length; index += 100) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/knowledge_index?on_conflict=source_card_path`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows.slice(index, index + 100)),
  });
  if (!response.ok) throw new Error(`knowledge_index upsert failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
}
console.log(JSON.stringify({ ok: true, dry_run: false, count: rows.length, unique_archive_ids: uniqueArchiveIds.size }));
