import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(resolve(process.cwd(), ".env.local"));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const APRIL_FROM = process.env.ACCOUNTING_RESET_FROM || "2026-04-01";
const APRIL_TO = process.env.ACCOUNTING_RESET_TO || "2026-04-30";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY.");
  process.exit(1);
}

async function request(table, query = {}) {
  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  Object.entries({ select: "*", ...query }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${table} ${res.status}: ${await res.text()}`);
  return res.json();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

const transactions = await request("accounting_transactions", {
  transaction_date: `gte.${APRIL_FROM}`,
  transaction_date_lte: undefined,
  order: "transaction_date.asc",
  limit: 10000,
});
const aprilTransactions = transactions.filter((row) => {
  const date = String(row.transaction_date || "");
  return date >= APRIL_FROM && date <= APRIL_TO;
});
const batchIds = unique(aprilTransactions.map((row) => row.batch_id));
const transactionIds = unique(aprilTransactions.map((row) => row.id));
const batches = batchIds.length
  ? await request("accounting_import_batches", { id: `in.(${batchIds.map((id) => `"${id}"`).join(",")})`, limit: 10000 })
  : [];
const reviewQueue = transactionIds.length
  ? await request("accounting_review_queue", { transaction_id: `in.(${transactionIds.map((id) => `"${id}"`).join(",")})`, limit: 10000 })
  : [];
const settlements = await request("accounting_card_settlements", {
  or: `(settlement_start.gte.${APRIL_FROM},settlement_end.gte.${APRIL_FROM},payment_due_date.gte.${APRIL_FROM})`,
  limit: 10000,
});
const aprilSettlements = settlements.filter((row) => {
  const dates = [row.settlement_start, row.settlement_end, row.payment_due_date].map((value) => String(value || ""));
  return dates.some((date) => date >= APRIL_FROM && date <= "2026-06-30");
});
const rules = await request("accounting_category_rules", { limit: 10000 });
const autoRules = rules.filter((row) => {
  const created = String(row.created_at || "");
  const sourceName = String(row.source_name || "");
  const memo = `${row.memo || ""} ${row.review_reason || ""}`;
  return (
    (created >= `${APRIL_FROM}T00:00:00` && created <= `${new Date().toISOString().slice(0, 10)}T23:59:59`) &&
    (sourceName || /검토|자동|salary_private_withdrawal|급여/.test(memo))
  );
});

const result = {
  mode: "dry-run-only",
  target_period: { from: APRIL_FROM, to: APRIL_TO },
  delete_candidates: [
    { table: "accounting_review_queue", count: reviewQueue.length, basis: "transaction_id in April accounting_transactions" },
    { table: "accounting_card_settlements", count: aprilSettlements.length, basis: "April test settlement/payment period" },
    { table: "accounting_transactions", count: aprilTransactions.length, basis: "transaction_date in target period" },
    { table: "accounting_import_batches", count: batches.length, basis: "batch_id referenced by target transactions" },
  ],
  manual_confirmation_candidates: [
    { table: "accounting_category_rules", count: autoRules.length, basis: "possibly learned/test rules; review before deleting" },
  ],
  preserved_tables: [
    "accounting_bank_accounts",
    "accounting_card_accounts",
    "accounting_categories",
    "accounting_fixed_costs",
    "accounting_loans",
    "fnos_settings",
  ],
  batch_files: batches.map((row) => ({ id: row.id, file: row.source_file_name, count: row.new_count ?? row.total_count, created_at: row.created_at })),
  source_names: unique(aprilTransactions.map((row) => row.source_name)),
  possible_learned_rules: autoRules.map((row) => ({
    id: row.id,
    source_type: row.source_type,
    source_name: row.source_name,
    keyword: row.keyword,
    amount_condition: row.amount_condition,
    category: [row.category_large, row.category_middle].filter(Boolean).join(" > "),
    memo: row.memo,
    created_at: row.created_at,
  })),
};

console.log(JSON.stringify(result, null, 2));
