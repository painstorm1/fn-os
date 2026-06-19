import { createHash } from "node:crypto";
import { deleteRows, insertRows, patchRows, selectRows, uploadStorageFile } from "./fnos-db";
import { getYoutubeThumbnailUrl } from "./archive-preview";

type AnyRecord = Record<string, unknown>;

export type ArchiveInput = {
  title?: string;
  url?: string;
  source_type?: string;
  content_type?: string;
  summary?: string;
  original_url?: string;
  description?: string;
  preview_image_url?: string;
  preview_status?: string;
  preview_error?: string;
  preview_generated_at?: string;
  memo?: string;
  thumbnail_url?: string;
  file_url?: string;
  status?: string;
  is_favorite?: boolean;
  category_id?: string | null;
  category_name?: string;
  tags?: string[] | string;
  reference_type?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

const archiveTrackingParams = new Set(["fbclid", "gclid", "igsh", "si", "feature", "app", "share_id"]);

export function normalizeArchiveUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

    const removable: string[] = [];
    url.searchParams.forEach((_paramValue, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith("utm_") || archiveTrackingParams.has(lowerKey)) removable.push(key);
    });
    removable.forEach((key) => url.searchParams.delete(key));
    url.searchParams.sort();

    const pathname = url.pathname.replace(/\/+$/, "");
    const path = pathname === "/" ? "" : pathname;
    const search = url.searchParams.toString();
    return `${url.protocol.toLowerCase()}//${url.hostname}${url.port ? `:${url.port}` : ""}${path}${search ? `?${search}` : ""}`;
  } catch {
    return raw.split("#")[0].replace(/\/+$/, "");
  }
}

export function archiveUrlHash(value: unknown) {
  const normalizedUrl = normalizeArchiveUrl(value);
  if (!normalizedUrl) return "";
  return createHash("sha256").update(normalizedUrl, "utf8").digest("hex");
}

function cleanList(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferSourceType(url: string, fallback?: string) {
  if (fallback) return fallback;
  const lower = url.toLowerCase();
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("smartstore.naver.com") || lower.includes("naver.com")) return "naver";
  if (lower.includes("coupang.com")) return "coupang";
  if (lower.includes("taobao.com")) return "taobao";
  if (lower.includes("1688.com")) return "1688";
  if (lower.includes("amazon.")) return "amazon";
  if (lower.includes("rakuten.")) return "rakuten";
  return url ? "web" : "manual";
}

function inferContentType(fileName: string, fallback?: string) {
  if (fallback) return fallback;
  const lower = fileName.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(lower)) return "image";
  if (/\.(mp4|mov|webm|avi)$/i.test(lower)) return "video";
  if (fileName) return "file";
  return "memo";
}

async function ensureCategory(input?: string) {
  const categoryName = text(input);
  if (!categoryName) return null;
  const existing = await selectRows<AnyRecord>("archive_categories", { category_name: `eq.${categoryName}`, limit: 1 }).catch(() => []);
  if (existing[0]?.id) return text(existing[0].id);
  const [saved] = await insertRows<AnyRecord>("archive_categories", { category_name: categoryName });
  return saved?.id ? text(saved.id) : null;
}

async function saveTags(itemId: string, tags: string[] | string | undefined) {
  const names = cleanList(tags);
  if (!names.length) return [];
  await deleteRows("archive_item_tags", { archive_item_id: `eq.${itemId}` }).catch(() => []);
  const savedTags: AnyRecord[] = [];
  for (const tagName of names) {
    const existing = await selectRows<AnyRecord>("archive_tags", { tag_name: `eq.${tagName}`, limit: 1 }).catch(() => []);
    const tag = existing[0] || (await insertRows<AnyRecord>("archive_tags", { tag_name: tagName }))[0];
    if (tag?.id) {
      savedTags.push(tag);
      await insertRows("archive_item_tags", { archive_item_id: itemId, tag_id: tag.id }).catch(() => []);
    }
  }
  return savedTags;
}

function usableExistingArchiveRow(row: AnyRecord | undefined, excludeId?: string) {
  if (!row || (excludeId && text(row.id) === excludeId)) return null;
  return row;
}

async function findArchiveItemByUrlIdentity(urlHash: string, normalizedUrl: string, sourceUrl: string, excludeId?: string) {
  if (urlHash) {
    const rows = await selectRows<AnyRecord>("archive_items", { url_hash: `eq.${urlHash}`, limit: 1 });
    const row = usableExistingArchiveRow(rows[0], excludeId);
    if (row) return row;
  }
  if (normalizedUrl) {
    const rows = await selectRows<AnyRecord>("archive_items", { normalized_url: `eq.${normalizedUrl}`, limit: 1 }).catch(() => []);
    const row = usableExistingArchiveRow(rows[0], excludeId);
    if (row) return row;
  }
  if (sourceUrl) {
    const rows = await selectRows<AnyRecord>("archive_items", { url: `eq.${sourceUrl}`, limit: 1 }).catch(() => []);
    const row = usableExistingArchiveRow(rows[0], excludeId);
    if (row) return row;
  }
  return null;
}

function archiveUrlIdentity(input: ArchiveInput) {
  const originalUrl = text(input.original_url || input.url);
  const sourceUrl = text(input.url) || originalUrl;
  const normalizedUrl = normalizeArchiveUrl(sourceUrl);
  return {
    originalUrl,
    normalizedUrl,
    urlHash: archiveUrlHash(normalizedUrl),
  };
}

export async function listArchiveData() {
  const [items, categories, tags, itemTags, links] = await Promise.all([
    selectRows<AnyRecord>("archive_items", {
      select: "id,title,url,normalized_url,url_hash,source_type,content_type,summary,original_url,description,memo,preview_image_url,preview_status,preview_error,preview_generated_at,thumbnail_url,file_url,status,category_id,created_at",
      order: "created_at.desc",
      limit: 500,
    }),
    selectRows<AnyRecord>("archive_categories", { select: "id,category_name,sort_order", order: "sort_order.asc,category_name.asc", limit: 300 }).catch(() => []),
    selectRows<AnyRecord>("archive_tags", { select: "id,tag_name", order: "tag_name.asc", limit: 500 }).catch(() => []),
    selectRows<AnyRecord>("archive_item_tags", { select: "archive_item_id,tag_id,created_at", order: "created_at.desc", limit: 2000 }).catch(() => []),
    selectRows<AnyRecord>("archive_links", { select: "id,archive_item_id,linked_type,linked_id,created_at", order: "created_at.desc", limit: 2000 }).catch(() => []),
  ]);
  return { items, categories, tags, itemTags, links };
}

export async function createArchiveItem(input: ArchiveInput) {
  const title = text(input.title) || text(input.url) || "제목 없음";
  const url = text(input.url);
  const { originalUrl, normalizedUrl, urlHash } = archiveUrlIdentity(input);
  const existing = await findArchiveItemByUrlIdentity(urlHash, normalizedUrl, url || originalUrl);
  if (existing) return existing;
  const categoryId = text(input.category_id) || await ensureCategory(input.category_name);
  const contentType = input.content_type || (url ? "link" : "memo");
  const previewImageUrl = text(input.preview_image_url) || getYoutubeThumbnailUrl(url);
  const previewStatus = text(input.preview_status) || (previewImageUrl ? "success" : url ? "pending" : "manual");
  const previewGeneratedAt = text(input.preview_generated_at) || (previewImageUrl ? new Date().toISOString() : null);
  let saved: AnyRecord | undefined;
  try {
    [saved] = await insertRows<AnyRecord>("archive_items", {
      title,
      url: url || null,
      normalized_url: normalizedUrl || null,
      url_hash: urlHash || null,
      source_type: inferSourceType(url, text(input.source_type)),
      content_type: contentType,
      summary: text(input.summary) || null,
      original_url: originalUrl || null,
      description: text(input.description) || null,
      preview_image_url: previewImageUrl || null,
      preview_status: previewStatus,
      preview_error: text(input.preview_error) || null,
      preview_generated_at: previewGeneratedAt,
      memo: text(input.memo) || null,
      thumbnail_url: text(input.thumbnail_url) || null,
      file_url: text(input.file_url) || null,
      status: text(input.status) || "active",
      is_favorite: Boolean(input.is_favorite),
      category_id: categoryId,
      reference_type: text(input.reference_type) || null,
    });
  } catch (error) {
    const duplicate = await findArchiveItemByUrlIdentity(urlHash, normalizedUrl, url || originalUrl).catch(() => null);
    if (duplicate) return duplicate;
    throw error;
  }
  if (saved?.id) await saveTags(text(saved.id), input.tags);
  return saved;
}

export async function createArchiveFileItem(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) throw new Error("업로드할 파일이 없습니다.");
  const uploaded = await uploadStorageFile(file);
  const url = text(formData.get("url"));
  if (url) {
    return createArchiveItem({
      title: text(formData.get("title")) || url,
      url,
      file_url: uploaded.url,
      source_type: text(formData.get("source_type")),
      content_type: text(formData.get("content_type")) || "link",
      memo: text(formData.get("memo")),
      category_id: text(formData.get("category_id")) || null,
      category_name: text(formData.get("category_name")),
      tags: text(formData.get("tags")),
      status: text(formData.get("status")) || "active",
      thumbnail_url: file.type.startsWith("image/") ? uploaded.url : text(formData.get("thumbnail_url")),
    });
  }
  return createArchiveItem({
    title: text(formData.get("title")) || file.name,
    file_url: uploaded.url,
    source_type: "file",
    content_type: inferContentType(file.name, text(formData.get("content_type"))),
    memo: text(formData.get("memo")),
    category_id: text(formData.get("category_id")) || null,
    category_name: text(formData.get("category_name")),
    tags: text(formData.get("tags")),
    status: text(formData.get("status")) || "active",
    thumbnail_url: file.type.startsWith("image/") ? uploaded.url : "",
  });
}

export async function updateArchiveItem(id: string, input: ArchiveInput) {
  const url = text(input.url);
  const { originalUrl, normalizedUrl, urlHash } = archiveUrlIdentity(input);
  const existing = await findArchiveItemByUrlIdentity(urlHash, normalizedUrl, url || originalUrl, id);
  if (existing) return existing;
  const previewImageUrl = text(input.preview_image_url) || getYoutubeThumbnailUrl(url);
  const previewStatus = text(input.preview_status) || (previewImageUrl ? "success" : url ? "pending" : "manual");
  const previewGeneratedAt = text(input.preview_generated_at) || (previewImageUrl ? new Date().toISOString() : null);
  let saved: AnyRecord | undefined;
  try {
    [saved] = await patchRows<AnyRecord>("archive_items", { id: `eq.${id}` }, {
      title: text(input.title),
      url: url || null,
      normalized_url: normalizedUrl || null,
      url_hash: urlHash || null,
      source_type: inferSourceType(url, text(input.source_type)),
      content_type: text(input.content_type) || "link",
      summary: text(input.summary) || null,
      original_url: originalUrl || null,
      description: text(input.description) || null,
      preview_image_url: previewImageUrl || null,
      preview_status: previewStatus,
      preview_error: text(input.preview_error) || null,
      preview_generated_at: previewGeneratedAt,
      memo: text(input.memo) || null,
      thumbnail_url: text(input.thumbnail_url) || null,
      file_url: text(input.file_url) || null,
      status: text(input.status) || "active",
      is_favorite: Boolean(input.is_favorite),
      category_id: text(input.category_id) || null,
      reference_type: text(input.reference_type) || null,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    const duplicate = await findArchiveItemByUrlIdentity(urlHash, normalizedUrl, url || originalUrl, id).catch(() => null);
    if (duplicate) return duplicate;
    throw error;
  }
  await saveTags(id, input.tags);
  return saved;
}

export async function deleteArchiveItems(ids: string[]) {
  const cleanIds = ids.map(text).filter(Boolean);
  if (!cleanIds.length) throw new Error("삭제할 아카이브를 선택해 주세요.");
  const inFilter = `in.(${cleanIds.join(",")})`;
  await deleteRows("archive_item_tags", { archive_item_id: inFilter }).catch(() => []);
  await deleteRows("archive_links", { archive_item_id: inFilter }).catch(() => []);
  await deleteRows("archive_items", { id: inFilter });
  return { deleted: cleanIds.length };
}

export async function saveArchiveCategory(input: AnyRecord) {
  const id = text(input.id);
  const values = {
    category_name: text(input.category_name || input.name),
    parent_category_id: text(input.parent_category_id) || null,
    sort_order: Number(input.sort_order || 0),
    updated_at: new Date().toISOString(),
  };
  if (!values.category_name) throw new Error("카테고리명을 입력해 주세요.");
  if (id) return (await patchRows("archive_categories", { id: `eq.${id}` }, values))[0];
  return (await insertRows("archive_categories", values))[0];
}

export async function saveArchiveTag(input: AnyRecord) {
  const id = text(input.id);
  const values = { tag_name: text(input.tag_name || input.name) };
  if (!values.tag_name) throw new Error("태그명을 입력해 주세요.");
  if (id) return (await patchRows("archive_tags", { id: `eq.${id}` }, values))[0];
  return (await insertRows("archive_tags", values))[0];
}

export async function mergeArchiveTags(fromTagId: string, toTagId: string) {
  if (!fromTagId || !toTagId || fromTagId === toTagId) throw new Error("병합할 태그를 다시 선택해 주세요.");
  const links = await selectRows<AnyRecord>("archive_item_tags", { tag_id: `eq.${fromTagId}`, limit: 2000 }).catch(() => []);
  for (const link of links) {
    await insertRows("archive_item_tags", { archive_item_id: link.archive_item_id, tag_id: toTagId }).catch(() => []);
  }
  await deleteRows("archive_item_tags", { tag_id: `eq.${fromTagId}` }).catch(() => []);
  await deleteRows("archive_tags", { id: `eq.${fromTagId}` }).catch(() => []);
  return { merged: links.length };
}

export async function saveArchiveLink(input: AnyRecord) {
  const itemId = text(input.archive_item_id);
  const linkedType = text(input.linked_type);
  const linkedId = text(input.linked_id);
  if (!itemId || !linkedType || !linkedId) throw new Error("연결할 아카이브와 대상을 선택해 주세요.");
  return (await insertRows("archive_links", { archive_item_id: itemId, linked_type: linkedType, linked_id: linkedId }))[0];
}

export async function deleteArchiveLink(id: string) {
  return deleteRows("archive_links", { id: `eq.${id}` });
}
