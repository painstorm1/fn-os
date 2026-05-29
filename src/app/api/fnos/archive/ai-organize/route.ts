import { NextRequest, NextResponse } from "next/server";

type CategoryGroup = "교육" | "업무" | "개인";

const categoryTree: Record<CategoryGroup, string[]> = {
  교육: ["영어", "포토샵", "일러스트", "AI"],
  업무: ["소싱", "광고소재", "상세페이지", "업무방법", "경쟁사", "디자인참고"],
  개인: ["캠핑", "요리", "살림", "육아", "여행", "동기부여", "유머", "기타"],
};

const validGroups = Object.keys(categoryTree) as CategoryGroup[];
const validSources = ["instagram", "youtube", "naver", "coupang", "smartstore", "taobao", "1688", "amazon", "rakuten", "web", "manual", "file"];

function sourceFromUrl(url: string) {
  const lower = url.toLowerCase();
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("smartstore.naver.com")) return "smartstore";
  if (lower.includes("naver.com")) return "naver";
  if (lower.includes("coupang.com")) return "coupang";
  if (lower.includes("taobao.com")) return "taobao";
  if (lower.includes("1688.com")) return "1688";
  if (lower.includes("amazon.")) return "amazon";
  if (lower.includes("rakuten.")) return "rakuten";
  return "web";
}

function urlSlug(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).at(-1) || parsed.hostname;
  } catch {
    return url.split("?")[0].split("/").filter(Boolean).at(-1) || url;
  }
}

function shortTitle(value: string, fallback: string) {
  const normalized = decodeURIComponent(value || fallback).replace(/^www\./, "").replace(/\s+/g, " ").trim();
  return Array.from(normalized || fallback).slice(0, 10).join("");
}

function normalizeUrl(url: string) {
  return url
    .trim()
    .replace(/[)\],.]+$/g, "")
    .replace(/^https?:\/\/(?:wany|wwv|wvw)\.instagram/i, "https://www.instagram")
    .replace(/(instagram\.com\/(?:reel|p)\/[A-Za-z0-9_-]{8,})(?:L2|I2|12)&igsh/gi, "$1/?igsh");
}

function fallbackDrafts(text: string) {
  const compactText = text
    .replace(/\u200B/g, "")
    .replace(/(^|[\s([{<])ttps:\/\//gi, "$1https://")
    .replace(/(^|[\s([{<])(?:[a-z]{1,8})?instagram\.com/gi, "$1https://www.instagram.com");
  const seen = new Set<string>();
  return Array.from(compactText.matchAll(/https?:\/\/[^\s"'<>]+/g)).flatMap((match) => {
    const url = normalizeUrl(match[0]);
    if (seen.has(url)) return [];
    seen.add(url);
    const sourceType = sourceFromUrl(url);
    return [{
      url,
      title: shortTitle(sourceType === "instagram" ? `릴스 ${urlSlug(url)}` : urlSlug(url), sourceType),
      memo: "",
      source_type: sourceType,
      content_type: sourceType === "instagram" || sourceType === "youtube" ? "ad_reference" : "link",
      category_group: "업무",
      category_name: sourceType === "instagram" || sourceType === "youtube" ? "광고소재" : "업무방법",
    }];
  });
}

function sanitizeDrafts(value: unknown, fallbackText: string) {
  const rawDrafts = Array.isArray((value as { drafts?: unknown[] })?.drafts) ? (value as { drafts: unknown[] }).drafts : [];
  const seen = new Set<string>();
  const drafts = rawDrafts.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const url = normalizeUrl(String(item.url || ""));
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const sourceType = validSources.includes(String(item.source_type || "")) ? String(item.source_type) : sourceFromUrl(url);
    const group = validGroups.includes(item.category_group as CategoryGroup) ? item.category_group as CategoryGroup : "업무";
    const categoryOptions = categoryTree[group];
    const categoryName = categoryOptions.includes(String(item.category_name || "")) ? String(item.category_name) : categoryOptions[0];
    const memo = String(item.memo || "").replace(/^\s*[\d,]+\s+likes?\s*,\s*[\d,]+\s+comments?\s*$/i, "").trim();
    return [{
      url,
      title: shortTitle(String(item.title || ""), sourceType === "instagram" ? `릴스 ${urlSlug(url)}` : urlSlug(url)),
      memo,
      source_type: sourceType,
      content_type: String(item.content_type || (sourceType === "instagram" || sourceType === "youtube" ? "ad_reference" : "link")),
      category_group: group,
      category_name: categoryName,
    }];
  });
  return drafts.length ? drafts : fallbackDrafts(fallbackText);
}

function responseText(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output as Array<Record<string, unknown>> : [];
  return output.flatMap((item) => Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [])
    .map((content) => String(content.text || ""))
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "OPENAI_API_KEY가 없어 기본 OCR로 처리합니다." }, { status: 503 });

    const formData = await request.formData();
    const image = formData.get("image");
    const text = String(formData.get("text") || "");
    if (!(image instanceof File)) return NextResponse.json({ ok: false, error: "분석할 이미지가 없습니다." }, { status: 400 });

    const bytes = Buffer.from(await image.arrayBuffer());
    const imageUrl = `data:${image.type || "image/png"};base64,${bytes.toString("base64")}`;
    const model = process.env.ARCHIVE_AI_MODEL || "gpt-4.1-mini";

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "카카오톡/웹 스크린샷 이미지에서 아카이브 저장 후보를 추출해 JSON만 반환해.",
                "목표: 링크 추출, 10자 내외 제목, category_group/category_name 추천.",
                `허용 category_group/category_name: ${JSON.stringify(categoryTree)}`,
                `허용 source_type: ${validSources.join(", ")}`,
                "memo는 사용자가 직접 적은 의미 있는 메모만 넣어. likes/comments/view count/date/time 같은 수치는 memo에 넣지 마.",
                "인스타그램 URL이 줄바꿈/공백/OCR 오류로 깨져 있으면 가능한 정상 URL로 복원해.",
                `보조 텍스트: ${text}`,
                '반환 형식: {"text":"이미지에서 읽은 원문 요약","drafts":[{"url":"","title":"","memo":"","source_type":"","content_type":"","category_group":"","category_name":""}]}',
              ].join("\n"),
            },
            { type: "input_image", image_url: imageUrl },
          ],
        }],
        text: { format: { type: "json_object" } },
      }),
    });

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(String((data.error as { message?: string } | undefined)?.message || "OpenAI 이미지 분석 실패"));
    const output = responseText(data);
    const parsed = JSON.parse(output || "{}") as Record<string, unknown>;
    return NextResponse.json({ ok: true, text: String(parsed.text || ""), drafts: sanitizeDrafts(parsed, text) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "AI 이미지 정리 실패" }, { status: 500 });
  }
}
