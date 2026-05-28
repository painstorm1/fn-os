import { patchRows, selectRows, uploadStorageFile } from "./fnos-db";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function titleContent(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1].replace(/\s+/g, " ")) : "";
}

function absoluteUrl(value: string, base: string) {
  if (!value) return "";
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

function shouldReplaceTitle(item: AnyRecord) {
  const title = text(item.title);
  const url = text(item.url || item.original_url);
  if (!title) return true;
  if (title === url) return true;
  if (/^https?:\/\//i.test(title)) return true;
  return false;
}

export async function fetchOpenGraph(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (compatible; FNOSArchivePreview/1.0)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OG fetch failed: ${response.status}`);
    const html = await response.text();
    const finalUrl = response.url || url;
    const image = absoluteUrl(metaContent(html, "og:image") || metaContent(html, "twitter:image"), finalUrl);
    return {
      title: metaContent(html, "og:title") || metaContent(html, "twitter:title") || titleContent(html),
      description: metaContent(html, "og:description") || metaContent(html, "description"),
      image,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function capturePreview(url: string, itemId: string) {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
  const { chromium } = await dynamicImport("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);
    const image = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 675 } });
    const file = new File([image], `${itemId}.png`, { type: "image/png" });
    const uploaded = await uploadStorageFile(file, "previews");
    return uploaded.url;
  } finally {
    await browser.close();
  }
}

export async function generateArchivePreview(id: string, options: { force?: boolean } = {}) {
  const [item] = await selectRows<AnyRecord>("archive_items", { id: `eq.${id}`, limit: 1 });
  if (!item) throw new Error("아카이브 항목을 찾을 수 없습니다.");
  const url = text(item.url || item.original_url);
  if (!url) throw new Error("미리보기를 생성할 URL이 없습니다.");
  if (!options.force && text(item.preview_status) === "success" && text(item.preview_image_url)) return item;

  await patchRows("archive_items", { id: `eq.${id}` }, {
    preview_status: "processing",
    preview_error: null,
    updated_at: new Date().toISOString(),
  });

  try {
    const og = await fetchOpenGraph(url);
    let previewImageUrl = og.image;
    let screenshotError = "";
    if (!previewImageUrl) {
      try {
        previewImageUrl = await capturePreview(url, id);
      } catch (error) {
        screenshotError = error instanceof Error ? error.message : "Playwright capture failed";
      }
    }

    if (!previewImageUrl) throw new Error(screenshotError || "OG image not found");
    const [saved] = await patchRows<AnyRecord>("archive_items", { id: `eq.${id}` }, {
      title: shouldReplaceTitle(item) && og.title ? og.title : text(item.title),
      description: og.description || text(item.description) || null,
      preview_image_url: previewImageUrl,
      preview_status: "success",
      preview_error: null,
      preview_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return saved;
  } catch (error) {
    const [saved] = await patchRows<AnyRecord>("archive_items", { id: `eq.${id}` }, {
      preview_status: "failed",
      preview_error: error instanceof Error ? error.message : "Preview generation failed",
      preview_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return saved;
  }
}

export async function processPendingArchivePreviews(limit = 5) {
  const rows = await selectRows<AnyRecord>("archive_items", { preview_status: "eq.pending", order: "created_at.asc", limit });
  const results = [];
  for (const row of rows) {
    results.push(await generateArchivePreview(text(row.id)));
  }
  return results;
}
