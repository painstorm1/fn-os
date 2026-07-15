import { createAutomationJob, updateAutomationJob } from "./automation-jobs";
import { FnosDbError, hasDbConfig, insertRows, patchRows, selectRows } from "./fnos-db";

export const KNOWLEDGE_ACTIONS = ["pending", "rejected", "confirm_new", "confirm_merge"] as const;
export type KnowledgeAction = (typeof KNOWLEDGE_ACTIONS)[number];
export type KnowledgeStatus = "confirmed" | "pending" | "rejected";
export type KnowledgeScope = "company" | "personal";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeScope(value: unknown): KnowledgeScope {
  const scope = text(value) || "company";
  if (scope === "company" || scope === "personal") return scope;
  throw new FnosDbError("지원하지 않는 지식 범위입니다.", 400);
}

export function truncateKnowledgePreview(value: unknown) {
  return text(value).replace(/\s+/g, " ").slice(0, 500);
}

export function normalizeKnowledgeSearch(value: unknown) {
  return truncateKnowledgePreview(value)
    .replace(/[(),.*:%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function knowledgeDate(value: unknown) {
  const date = text(value);
  if (!date) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FnosDbError("날짜 형식이 올바르지 않습니다.", 400);
  return date;
}

export function safeVaultRelativePath(value: unknown) {
  const raw = text(value).replace(/\\/g, "/");
  if (raw.includes("\0")) throw new FnosDbError("허용되지 않은 Obsidian 경로입니다.", 400);
  if (!raw || raw.startsWith("/") || raw.includes(":") || !raw.toLowerCase().endsWith(".md")) {
    throw new FnosDbError("허용되지 않은 Obsidian 경로입니다.", 400);
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new FnosDbError("허용되지 않은 Obsidian 경로입니다.", 400);
  }
  return parts.join("/");
}

export function knowledgeTodayKst(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function sourceCardPath(value: unknown) {
  const path = safeVaultRelativePath(value);
  if (!path.startsWith("03_INBOX/Resource_Triage_Cards/")) {
    throw new FnosDbError("지식 처리 원본은 Resource_Triage_Cards 아래 카드만 허용됩니다.", 400);
  }
  return path;
}

function targetPathForScope(value: unknown, scopeValue: unknown) {
  const path = safeVaultRelativePath(value);
  const scope = normalizeScope(scopeValue);
  const upper = path.toUpperCase();
  const personalPath = upper.startsWith("80_PERSONAL_EXECUTION/") || upper.startsWith("99_PRIVATE/");
  if (scope === "personal" && !personalPath) {
    throw new FnosDbError("개인 지식은 80_PERSONAL_EXECUTION 또는 99_PRIVATE 아래 경로만 허용됩니다.", 400);
  }
  if (scope === "company" && personalPath) {
    throw new FnosDbError("회사·업무 지식은 80_PERSONAL_EXECUTION 또는 99_PRIVATE 경로에 저장할 수 없습니다.", 400);
  }
  return path;
}

function activeProcessingStatus(value: unknown) {
  return ["queued", "running"].includes(text(value));
}

function rowCasFilters(item: AnyRecord) {
  const jobId = text(item.automation_job_id);
  return {
    id: `eq.${text(item.id)}`,
    processing_status: `eq.${text(item.processing_status) || "idle"}`,
    automation_job_id: jobId ? `eq.${jobId}` : "is.null",
  };
}

export function normalizeKnowledgeDecision(value: unknown): { action: KnowledgeAction; status: KnowledgeStatus; confirmation_method: "new" | "merge" | null } {
  const action = text(value) as KnowledgeAction;
  if (action === "pending") return { action, status: "pending", confirmation_method: null };
  if (action === "rejected") return { action, status: "rejected", confirmation_method: null };
  if (action === "confirm_new") return { action, status: "confirmed", confirmation_method: "new" };
  if (action === "confirm_merge") return { action, status: "confirmed", confirmation_method: "merge" };
  throw new FnosDbError("지원하지 않는 지식 판정입니다.", 400);
}

export async function listKnowledgeCenter(filters: Record<string, unknown> = {}) {
  if (!hasDbConfig()) return { items: [], dailyEntries: [] };
  const query: Record<string, string | number> = {
    order: text(filters.sort) === "recent" ? "updated_at.desc" : "value_score.desc.nullslast,updated_at.desc",
    limit: 500,
  };
  const q = normalizeKnowledgeSearch(filters.q);
  const status = text(filters.status);
  const scope = text(filters.scope);
  const processing = text(filters.processing_status);
  const relationship = truncateKnowledgePreview(filters.relationship);
  const sourceType = truncateKnowledgePreview(filters.source_type);
  const category = truncateKnowledgePreview(filters.category);
  const sourceDate = knowledgeDate(filters.source_date);
  if (q) query.or = `(title.ilike.*${q}*,preview.ilike.*${q}*)`;
  if (["confirmed", "pending", "rejected"].includes(status)) query.status = `eq.${status}`;
  if (["company", "personal"].includes(scope)) query.scope = `eq.${scope}`;
  if (["idle", "queued", "running", "success", "failed"].includes(processing)) query.processing_status = `eq.${processing}`;
  if (relationship) query.relationship = `eq.${relationship}`;
  if (sourceType) query.source_type = `eq.${sourceType}`;
  if (category) query.category = `eq.${category}`;
  if (sourceDate) query.source_date = `eq.${sourceDate}`;
  const [items, dailyEntries] = await Promise.all([
    selectRows<AnyRecord>("knowledge_index", query),
    selectRows<AnyRecord>("knowledge_daily_entries", { entry_date: `eq.${knowledgeTodayKst()}`, order: "created_at.desc", limit: 200 }),
  ]);
  return { items, dailyEntries };
}

function productCardFileName(codeValue: unknown, nameValue: unknown) {
  const code = text(codeValue).replace(/[^0-9A-Za-z가-힣._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const name = text(nameValue).replace(/[^0-9A-Za-z가-힣._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const fileName = [code, name].filter(Boolean).join("_") || "product";
  return `50_BUSINESS_KNOWLEDGE/Products/Cards/${fileName}.md`;
}

function compactObject(row: AnyRecord, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, row[key]]).filter(([, value]) => value !== undefined && value !== null && text(value) !== ""));
}

export async function createProductCardRequest(body: AnyRecord) {
  if (!hasDbConfig()) throw new FnosDbError("Supabase 환경변수가 설정되지 않았습니다.", 503);
  const productId = text(body.product_id);
  if (!productId) throw new FnosDbError("FNOS 제품 ID가 필요합니다.", 400);
  const [product] = await selectRows<AnyRecord>("products", { id: `eq.${productId}`, limit: 1 });
  if (!product || text(product.status).toLowerCase() === "deleted" || product.is_active === false) {
    throw new FnosDbError("활성 FNOS 제품을 찾을 수 없습니다.", 404);
  }
  const productCode = text(product.product_code || product.prod_cd || product.sku);
  const productName = truncateKnowledgePreview(product.product_name || product.prod_name);
  if (!productCode || !productName) throw new FnosDbError("제품 코드와 제품명이 필요합니다.", 400);
  const importLinks = await selectRows<AnyRecord>("import_product_sku_links", { product_id: `eq.${productId}`, order: "created_at.asc", limit: 100 });
  if (!importLinks.length) throw new FnosDbError("직수입 연결이 있는 제품만 제품 지식카드로 등록할 수 있습니다.", 409);
  const importIds = Array.from(new Set(importLinks.map((row) => text(row.import_product_id)).filter(Boolean)));
  const importProducts = importIds.length
    ? await selectRows<AnyRecord>("import_erp_products", { id: `in.(${importIds.join(",")})`, order: "id.asc", limit: 100 })
    : [];
  const mappingsById = await selectRows<AnyRecord>("sales_channel_product_mappings", { fn_product_id: `eq.${productId}`, order: "updated_at.desc", limit: 200 });
  const mappingsByCode = await selectRows<AnyRecord>("sales_channel_product_mappings", { product_code: `eq.${productCode}`, order: "updated_at.desc", limit: 200 });
  const salesMappings = Array.from(new Map([...mappingsById, ...mappingsByCode].map((row) => [text(row.id) || `${text(row.channel_name)}:${text(row.mall_product_key)}`, row])).values());
  const targetPath = safeVaultRelativePath(productCardFileName(productCode, productName));
  const sourceRef = productId;
  const sourceUrl = text(importProducts.find((row) => text(row.product_url))?.product_url);
  const imageSource = text(body.image_source).slice(0, 1000);
  const imageNotes = truncateKnowledgePreview(body.image_notes);
  const extraContext = truncateKnowledgePreview(body.extra_context);
  const now = new Date().toISOString();
  const [existing] = await selectRows<AnyRecord>("knowledge_index", { source_type: "eq.fnos-product", source_ref: `eq.${sourceRef}`, limit: 1 });
  if (existing && activeProcessingStatus(existing.processing_status)) {
    throw new FnosDbError("이미 제품 지식카드 작업이 처리 중입니다.", 409);
  }
  const indexValues = {
    source_card_path: targetPath,
    title: productName,
    scope: "company",
    category: "직수입제품",
    status: "confirmed",
    confirmation_method: "new",
    relationship: "보강",
    target_hint: targetPath,
    source_type: "fnos-product",
    source_ref: sourceRef,
    source_url: sourceUrl || null,
    obsidian_path: targetPath,
    preview: truncateKnowledgePreview(`${productCode} · 직수입 연결 ${importLinks.length}건 · 판매채널 연결 ${salesMappings.length}건${extraContext ? ` · ${extraContext}` : ""}`),
    requested_action: null,
    decided_at: now,
    updated_at: now,
  };
  const [indexItem] = existing
    ? await patchRows<AnyRecord>("knowledge_index", { id: `eq.${text(existing.id)}` }, indexValues)
    : await insertRows<AnyRecord>("knowledge_index", {
      ...indexValues,
      processing_status: "idle",
      automation_job_id: null,
      error_message: null,
      created_at: now,
    });
  if (!indexItem) throw new FnosDbError("제품 지식 색인을 생성하지 못했습니다.", 500);
  const [enqueueItem] = await selectRows<AnyRecord>("knowledge_index", { id: `eq.${text(indexItem.id)}`, limit: 1 });
  if (!enqueueItem) throw new FnosDbError("제품 지식 색인을 다시 읽지 못했습니다.", 409);
  if (activeProcessingStatus(enqueueItem.processing_status)) {
    throw new FnosDbError("이미 제품 지식카드 작업이 처리 중입니다.", 409);
  }
  const casFilters = rowCasFilters(enqueueItem);
  let job: Awaited<ReturnType<typeof createAutomationJob>> | null = null;
  try {
    job = await createAutomationJob({
      job_type: "product_card_upsert",
      title: `제품 지식카드 · ${productName}`,
      status: "waiting_approval",
      requested_by: "knowledge-center",
      assigned_agent: "mini-pc-knowledge-worker",
      source: "fnos-knowledge-center",
      trigger_type: "manual",
      input_json: {
        knowledge_id: text(enqueueItem.id),
        target_path: targetPath,
        image_source: imageSource,
        image_notes: imageNotes,
        extra_context: extraContext,
        product: compactObject(product, ["id", "product_code", "prod_cd", "sku", "product_name", "prod_name", "image_url", "cost_price", "standard_price", "currency", "status", "note"]),
        import_links: importLinks.map((row) => compactObject(row, ["id", "import_product_id", "import_option_name", "import_option_key", "match_group_label", "variant_label", "default_qty", "default_ratio"])),
        import_products: importProducts.map((row) => compactObject(row, ["id", "sku", "name", "product_name", "factory_id", "image_url", "image_path", "product_url", "options", "hs_code", "moq", "std_price", "standard_price", "price", "currency", "status", "note"])),
        sales_mappings: salesMappings.map((row) => compactObject(row, ["id", "channel_name", "channel_code", "mall_product_code", "mall_product_key", "mall_product_name", "product_code", "product_name", "source_type"])),
      },
    });
    const [saved] = await patchRows<AnyRecord>("knowledge_index", casFilters, {
      processing_status: "queued",
      automation_job_id: job.id,
      updated_at: new Date().toISOString(),
    });
    if (!saved) throw new FnosDbError("제품 지식 색인과 자동화 작업을 연결하지 못했습니다.", 409);
    job = await updateAutomationJob(job.id, { status: "queued" });
    return { item: saved, job };
  } catch (error) {
    const message = truncateKnowledgePreview(error instanceof Error ? error.message : "제품 지식카드 작업 생성 실패");
    if (job) await updateAutomationJob(job.id, { status: "failed", error_message: message }).catch(() => null);
    if (job) {
      await patchRows<AnyRecord>("knowledge_index", {
        id: `eq.${text(enqueueItem.id)}`,
        automation_job_id: `eq.${job.id}`,
      }, {
        processing_status: "failed",
        error_message: message,
        updated_at: new Date().toISOString(),
      }).catch(() => null);
    }
    throw error;
  }
}

function dailyTargetPath(item: AnyRecord) {
  const id = text(item.id);
  if (!/^[0-9A-Za-z-]+$/.test(id)) throw new FnosDbError("오늘 입력 ID가 올바르지 않습니다.", 400);
  const date = knowledgeDate(item.entry_date);
  return safeVaultRelativePath(`03_INBOX/Daily_Inbox/${date}/FNOS-${id}.md`);
}

async function getDailyEntry(idValue: unknown) {
  const id = text(idValue);
  if (!id) throw new FnosDbError("오늘 입력 ID가 필요합니다.", 400);
  const [item] = await selectRows<AnyRecord>("knowledge_daily_entries", { id: `eq.${id}`, limit: 1 });
  if (!item) throw new FnosDbError("오늘 입력을 찾을 수 없습니다.", 404);
  return item;
}

export async function createKnowledgeDailyEntry(body: AnyRecord) {
  const requestedId = text(body.daily_id || body.id);
  let dailyItem: AnyRecord;
  if (requestedId) {
    dailyItem = await getDailyEntry(requestedId);
    if (activeProcessingStatus(dailyItem.processing_status)) {
      throw new FnosDbError("이미 오늘 입력 저장 작업이 처리 중입니다.", 409);
    }
  } else {
    const title = truncateKnowledgePreview(body.title);
    const preview = truncateKnowledgePreview(body.preview ?? body.entry_preview);
    if (!title) throw new FnosDbError("오늘 입력 제목이 필요합니다.", 400);
    if (!preview) throw new FnosDbError("오늘 입력 내용이 필요합니다.", 400);
    const [saved] = await insertRows<AnyRecord>("knowledge_daily_entries", {
      entry_date: knowledgeDate(body.entry_date) || knowledgeTodayKst(),
      title,
      scope: normalizeScope(body.scope),
      entry_preview: preview,
      processing_status: "idle",
      automation_job_id: null,
      error_message: null,
    });
    if (!saved) throw new FnosDbError("오늘 입력을 저장하지 못했습니다.", 500);
    dailyItem = saved;
  }

  const [enqueueItem] = await selectRows<AnyRecord>("knowledge_daily_entries", { id: `eq.${text(dailyItem.id)}`, limit: 1 });
  if (!enqueueItem) throw new FnosDbError("오늘 입력을 다시 읽지 못했습니다.", 409);
  if (activeProcessingStatus(enqueueItem.processing_status)) {
    throw new FnosDbError("이미 오늘 입력 저장 작업이 처리 중입니다.", 409);
  }
  const targetPath = dailyTargetPath(enqueueItem);
  const casFilters = rowCasFilters(enqueueItem);
  let job: Awaited<ReturnType<typeof createAutomationJob>> | null = null;
  try {
    job = await createAutomationJob({
      job_type: "knowledge_daily_capture",
      title: `오늘 입력 · ${truncateKnowledgePreview(enqueueItem.title)}`,
      status: "waiting_approval",
      requested_by: "knowledge-center",
      assigned_agent: "mini-pc-knowledge-worker",
      source: "fnos-knowledge-center",
      trigger_type: "manual",
      input_json: {
        daily_id: text(enqueueItem.id),
        entry_date: knowledgeDate(enqueueItem.entry_date),
        title: truncateKnowledgePreview(enqueueItem.title),
        entry_preview: truncateKnowledgePreview(enqueueItem.entry_preview),
        target_path: targetPath,
        dry_run: body.dry_run === true,
      },
    });
    const [saved] = await patchRows<AnyRecord>("knowledge_daily_entries", casFilters, {
      processing_status: "queued",
      automation_job_id: job.id,
      error_message: null,
      updated_at: new Date().toISOString(),
    });
    if (!saved) throw new FnosDbError("오늘 입력과 자동화 작업을 연결하지 못했습니다.", 409);
    job = await updateAutomationJob(job.id, { status: "queued" });
    return { saved, job };
  } catch (error) {
    const message = truncateKnowledgePreview(error instanceof Error ? error.message : "오늘 입력 작업 생성 실패");
    if (job) {
      await updateAutomationJob(job.id, { status: "failed", error_message: message }).catch(() => null);
      await patchRows<AnyRecord>("knowledge_daily_entries", {
        id: `eq.${text(enqueueItem.id)}`,
        automation_job_id: `eq.${job.id}`,
      }, {
        processing_status: "failed",
        error_message: message,
        updated_at: new Date().toISOString(),
      }).catch(() => null);
    }
    throw error;
  }
}

async function getKnowledgeItem(idValue: unknown) {
  const id = text(idValue);
  if (!id) throw new FnosDbError("지식 항목 ID가 필요합니다.", 400);
  const [item] = await selectRows<AnyRecord>("knowledge_index", { id: `eq.${id}`, limit: 1 });
  if (!item) throw new FnosDbError("지식 항목을 찾을 수 없습니다.", 404);
  return item;
}

async function queueKnowledgeAction(
  item: AnyRecord,
  action: KnowledgeAction,
  targetPath?: string,
  dryRun = false,
  decision?: ReturnType<typeof normalizeKnowledgeDecision>,
) {
  const [enqueueItem] = await selectRows<AnyRecord>("knowledge_index", { id: `eq.${text(item.id)}`, limit: 1 });
  if (!enqueueItem) throw new FnosDbError("지식 항목을 다시 읽지 못했습니다.", 409);
  if (activeProcessingStatus(enqueueItem.processing_status)) {
    throw new FnosDbError("이미 지식 처리 작업이 진행 중입니다.", 409);
  }
  const cardPath = sourceCardPath(enqueueItem.source_card_path);
  const effectiveTargetPath = targetPath ? targetPathForScope(targetPath, enqueueItem.scope) : undefined;
  const casFilters = rowCasFilters(enqueueItem);
  let job: Awaited<ReturnType<typeof createAutomationJob>> | null = null;
  try {
    job = await createAutomationJob({
      job_type: "knowledge_action",
      title: `지식센터 · ${truncateKnowledgePreview(enqueueItem.title) || cardPath}`,
      status: "waiting_approval",
      requested_by: "knowledge-center",
      assigned_agent: "mini-pc-knowledge-worker",
      source: "fnos-knowledge-center",
      trigger_type: "manual",
      input_json: {
        knowledge_id: text(enqueueItem.id),
        action,
        source_card_path: cardPath,
        ...(effectiveTargetPath ? { target_path: effectiveTargetPath } : {}),
        dry_run: dryRun,
      },
    });
    const [saved] = await patchRows<AnyRecord>("knowledge_index", casFilters, {
      ...(decision ? {
        status: decision.status,
        confirmation_method: decision.confirmation_method,
        obsidian_path: effectiveTargetPath || enqueueItem.obsidian_path || null,
        decided_at: new Date().toISOString(),
      } : {}),
      requested_action: action,
      processing_status: "queued",
      automation_job_id: job.id,
      error_message: null,
      updated_at: new Date().toISOString(),
    });
    if (!saved) throw new FnosDbError("지식 항목과 자동화 작업을 연결하지 못했습니다.", 409);
    job = await updateAutomationJob(job.id, { status: "queued" });
    return { item: saved, job };
  } catch (error) {
    const message = truncateKnowledgePreview(error instanceof Error ? error.message : "지식 처리 작업 생성 실패");
    if (job) {
      await updateAutomationJob(job.id, { status: "failed", error_message: message }).catch(() => null);
      await patchRows<AnyRecord>("knowledge_index", {
        id: `eq.${text(enqueueItem.id)}`,
        automation_job_id: `eq.${job.id}`,
      }, {
        requested_action: action,
        processing_status: "failed",
        ...(effectiveTargetPath ? { obsidian_path: effectiveTargetPath } : {}),
        error_message: message,
        updated_at: new Date().toISOString(),
      }).catch(() => null);
    }
    throw error;
  }
}

export async function decideKnowledgeItem(body: AnyRecord) {
  const item = await getKnowledgeItem(body.id);
  const decision = normalizeKnowledgeDecision(body.action);
  const targetPath = decision.confirmation_method
    ? targetPathForScope(body.target_path || item.obsidian_path, item.scope)
    : undefined;
  return queueKnowledgeAction(item, decision.action, targetPath, body.dry_run === true, decision);
}

export async function retryKnowledgeItem(body: AnyRecord) {
  const item = await getKnowledgeItem(body.id);
  if (text(item.processing_status) !== "failed") throw new FnosDbError("실패한 지식 처리만 재시도할 수 있습니다.", 409);
  const decision = normalizeKnowledgeDecision(item.requested_action);
  const targetPath = decision.confirmation_method ? targetPathForScope(item.obsidian_path, item.scope) : undefined;
  return queueKnowledgeAction(item, decision.action, targetPath, body.dry_run === true);
}

export async function updateKnowledgeTitle(body: AnyRecord) {
  const item = await getKnowledgeItem(body.id);
  const title = truncateKnowledgePreview(body.title);
  if (!title) throw new FnosDbError("지식 제목이 필요합니다.", 400);
  const [saved] = await patchRows<AnyRecord>("knowledge_index", { id: `eq.${text(item.id)}` }, {
    title,
    updated_at: new Date().toISOString(),
  });
  return saved;
}

export async function decideKnowledgeItems(body: AnyRecord) {
  const ids = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map(text).filter(Boolean))).slice(0, 50) : [];
  if (!ids.length) throw new FnosDbError("일괄 처리할 지식 항목이 필요합니다.", 400);
  const decision = text(body.decision);
  if (decision !== "pending" && decision !== "rejected") {
    throw new FnosDbError("일괄 처리는 대기 또는 지식적용X만 지원합니다.", 400);
  }
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    try {
      await decideKnowledgeItem({ id, action: decision, dry_run: body.dry_run === true });
      results.push({ id, ok: true });
    } catch (error) {
      results.push({ id, ok: false, error: error instanceof Error ? error.message : "일괄 판정 실패" });
    }
  }
  return results;
}

export async function applyKnowledgeReceipt(body: AnyRecord) {
  const item = await getKnowledgeItem(body.id || body.knowledge_id);
  const ok = body.ok !== false;
  const receipt = body.receipt && typeof body.receipt === "object" ? body.receipt as AnyRecord : {};
  const jobId = text(receipt.job_id);
  if (!jobId || jobId !== text(item.automation_job_id)) {
    throw new FnosDbError("현재 지식 처리 작업과 일치하지 않는 receipt입니다.", 409);
  }
  const targetPath = text(receipt.target_path) ? targetPathForScope(receipt.target_path, item.scope) : text(item.obsidian_path) || null;
  const [saved] = await patchRows<AnyRecord>("knowledge_index", { id: `eq.${text(item.id)}`, automation_job_id: `eq.${jobId}` }, {
    processing_status: ok ? "success" : "failed",
    obsidian_path: targetPath,
    error_message: ok ? null : truncateKnowledgePreview(body.error_message || receipt.error),
    updated_at: new Date().toISOString(),
  });
  if (!saved) throw new FnosDbError("지식 처리 작업이 변경되어 receipt를 반영하지 않았습니다.", 409);
  return saved;
}

export async function applyKnowledgeDailyReceipt(body: AnyRecord) {
  const item = await getDailyEntry(body.daily_id || body.id);
  const ok = body.ok !== false;
  const receipt = body.receipt && typeof body.receipt === "object" ? body.receipt as AnyRecord : {};
  const jobId = text(receipt.job_id);
  if (!jobId || jobId !== text(item.automation_job_id)) {
    throw new FnosDbError("현재 오늘 입력 작업과 일치하지 않는 receipt입니다.", 409);
  }
  const expectedPath = dailyTargetPath(item);
  const receiptPath = text(receipt.target_path) ? safeVaultRelativePath(receipt.target_path) : expectedPath;
  if (receiptPath !== expectedPath) throw new FnosDbError("오늘 입력 receipt 경로가 고정 경로와 일치하지 않습니다.", 409);
  if (ok && receipt.readback_verified !== true) {
    throw new FnosDbError("오늘 입력 파일 readback이 확인되지 않았습니다.", 409);
  }
  const [saved] = await patchRows<AnyRecord>("knowledge_daily_entries", {
    id: `eq.${text(item.id)}`,
    automation_job_id: `eq.${jobId}`,
  }, {
    processing_status: ok ? "success" : "failed",
    obsidian_path: receiptPath,
    error_message: ok ? null : truncateKnowledgePreview(body.error_message || receipt.error),
    updated_at: new Date().toISOString(),
  });
  if (!saved) throw new FnosDbError("오늘 입력 작업이 변경되어 receipt를 반영하지 않았습니다.", 409);
  return saved;
}
