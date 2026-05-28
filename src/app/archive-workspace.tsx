"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";

type ArchiveItem = {
  id: string;
  title?: string;
  url?: string;
  source_type?: string;
  content_type?: string;
  summary?: string;
  description?: string;
  memo?: string;
  preview_image_url?: string;
  preview_status?: string;
  preview_error?: string;
  preview_generated_at?: string;
  thumbnail_url?: string;
  file_url?: string;
  status?: string;
  category_id?: string;
  created_at?: string;
};
type ArchiveCategory = { id: string; category_name: string; sort_order?: number };
type ArchiveTag = { id: string; tag_name: string };
type ArchiveItemTag = { archive_item_id?: string; tag_id?: string };
type ArchiveLink = { id: string; archive_item_id?: string; linked_type?: string; linked_id?: string };
type ArchiveData = { items: ArchiveItem[]; categories: ArchiveCategory[]; tags: ArchiveTag[]; itemTags: ArchiveItemTag[]; links: ArchiveLink[] };
type ArchiveFilters = { q: string; categoryGroup: string; category: string; source: string; dateFrom: string; dateTo: string };
type AutoArchiveDraft = {
  url: string;
  title: string;
  memo: string;
  source_type: string;
  content_type: string;
  category_group: CategoryGroup;
  category_name: string;
};

type CategoryGroup = "교육" | "업무" | "개인";
type ActiveMenu = "save" | "all" | CategoryGroup;

const categoryTree: Record<CategoryGroup, string[]> = {
  교육: ["영어", "포토샵", "일러스트", "AI"],
  업무: ["소싱", "광고소재", "상세페이지", "업무방법", "경쟁사", "디자인참고"],
  개인: ["캠핑", "요리", "살림", "육아", "여행", "동기부여", "유머", "기타"],
};

const sources = ["instagram", "youtube", "naver", "coupang", "smartstore", "taobao", "1688", "amazon", "rakuten", "web", "manual", "file"];
const contentTypes = ["link", "image", "video", "file", "memo", "product", "ad_reference", "detail_page", "supplier"];

function cleanTitle(value: string) {
  return value
    .replace(/^www\./, "")
    .replace(/\.(com|co\.kr|net|jp)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function shortenTitle(value: string, fallback: string) {
  const base = cleanTitle(decodeURIComponent(value || fallback)).replace(/\s+/g, " ");
  const chars = Array.from(base || fallback);
  return chars.slice(0, 10).join("");
}

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
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.at(-1) || parsed.hostname;
  } catch {
    return url.split("?")[0].split("/").filter(Boolean).at(-1) || url;
  }
}

function classifyAutoDraft(url: string, context: string): AutoArchiveDraft {
  const sourceType = sourceFromUrl(url);
  const lower = `${url} ${context}`.toLowerCase();
  let categoryGroup: CategoryGroup = "업무";
  let categoryName = "업무방법";
  let contentType = "link";

  if (sourceType === "instagram" || sourceType === "youtube") {
    categoryName = "광고소재";
    contentType = "ad_reference";
  } else if (["taobao", "1688", "amazon", "rakuten"].includes(sourceType)) {
    categoryName = "소싱";
    contentType = "product";
  } else if (["coupang", "smartstore"].includes(sourceType)) {
    categoryName = "경쟁사";
    contentType = "product";
  }
  if (lower.includes("photoshop") || context.includes("포토샵")) {
    categoryGroup = "교육";
    categoryName = "포토샵";
  } else if (lower.includes("illustrator") || context.includes("일러스트")) {
    categoryGroup = "교육";
    categoryName = "일러스트";
  } else if (lower.includes("english") || context.includes("영어")) {
    categoryGroup = "교육";
    categoryName = "영어";
  } else if (lower.includes("ai") || context.includes("AI")) {
    categoryGroup = "교육";
    categoryName = "AI";
  }
  if (lower.includes("detail") || context.includes("상세")) {
    categoryName = "상세페이지";
    contentType = "detail_page";
  }
  if (lower.includes("camp") || context.includes("캠핑")) {
    categoryGroup = "개인";
    categoryName = "캠핑";
  } else if (context.includes("요리")) {
    categoryGroup = "개인";
    categoryName = "요리";
  } else if (context.includes("육아")) {
    categoryGroup = "개인";
    categoryName = "육아";
  } else if (context.includes("여행")) {
    categoryGroup = "개인";
    categoryName = "여행";
  }

  const titleSeed = sourceType === "instagram" ? `릴스 ${urlSlug(url)}` : urlSlug(url);
  return {
    url,
    title: shortenTitle(titleSeed, sourceType),
    memo: "",
    source_type: sourceType,
    content_type: contentType,
    category_group: categoryGroup,
    category_name: categoryName,
  };
}

function extractArchiveDrafts(rawText: string) {
  let compactText = rawText
    .replace(/\u200B/g, "")
    .replace(/(^|[\s([{<])ttps:\/\//gi, "$1https://")
    .replace(/(^|[\s([{<])h\s+ttps:\/\//gi, "$1https://")
    .replace(/h\s*t\s*t\s*p\s*s?\s*:?\s*(?:\/\s*\/)?\s*(?:www|w{2,3}|wany|suns|sun|sns)?[\s.,]*(?:i|l|1)?\s*n\s*s?\s*t\s*a\s*g\s*r\s*a\s*m[\s.,]*com/gi, "https://www.instagram.com")
    .replace(/(?:i|l|1)?\s*n\s*s?\s*t\s*a\s*g\s*r\s*a\s*m[\s.,]+com/gi, "instagram.com")
    .replace(/(^|[\s([{<])(?:[a-z]{1,8})?instagram\.com/gi, "$1https://www.instagram.com")
    .replace(/\/?2\s*img[\s_-]*index/gi, "/?img_index")
    .replace(/\bimg[\s_-]+index/gi, "img_index")
    .replace(/([0-9])\s*igsh/gi, "$1&igsh");
  for (let index = 0; index < 5; index += 1) {
    compactText = compactText.replace(/(https?:\/\/[^\s"'<>]+)\s+(?!https?:\/\/)([A-Za-z][A-Za-z0-9?=&_%./-]{2,})/g, "$1$2");
  }
  const matches = Array.from(compactText.matchAll(/https?:\/\/[^\s"'<>]+/g));
  const seen = new Set<string>();
  return matches.flatMap((match) => {
    const url = match[0]
      .replace(/[)\],.]+$/g, "")
      .replace(/^https?:\/\/(?:wany|wwv|wvw)\.instagram/i, "https://www.instagram")
      .replace(/(instagram\.com\/(?:reel|p)\/[A-Za-z0-9_-]{8,})(?:L2|I2|12)&igsh/gi, "$1/?igsh");
    if (seen.has(url)) return [];
    seen.add(url);
    const start = Math.max(0, match.index - 100);
    const end = Math.min(compactText.length, match.index + url.length + 100);
    return [classifyAutoDraft(url, compactText.slice(start, end))];
  });
}

function categoryNamesForGroup(group: CategoryGroup | "all") {
  if (group === "all") return Object.values(categoryTree).flat();
  return categoryTree[group];
}

function categoryGroupOf(categoryName: string) {
  return (Object.keys(categoryTree) as CategoryGroup[]).find((group) => categoryTree[group].includes(categoryName)) || "";
}

function categoryDisplayLabel(categoryName?: string) {
  if (!categoryName) return "미분류";
  const group = categoryGroupOf(categoryName);
  return group ? `${group} / ${categoryName}` : categoryName;
}

function categoryOptionEntries() {
  return (Object.keys(categoryTree) as CategoryGroup[]).flatMap((group) => categoryTree[group].map((category) => ({ group, category, label: `${group} / ${category}` })));
}

function normalizeDateInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function displayDateInput(value: string) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return value;
  const [year, month, day] = normalized.split("-");
  return `${year}.${month}.${day}`;
}

export default function ArchiveWorkspace() {
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>("save");
  const [saveMode, setSaveMode] = useState<"auto" | "manual">("auto");
  const [manualType, setManualType] = useState<"link" | "file">("link");
  const [activeSubCategory, setActiveSubCategory] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [data, setData] = useState<ArchiveData>({ items: [], categories: [], tags: [], itemTags: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [autoText, setAutoText] = useState("");
  const [autoDrafts, setAutoDrafts] = useState<AutoArchiveDraft[]>([]);
  const [autoImagePreview, setAutoImagePreview] = useState("");
  const [autoWorking, setAutoWorking] = useState(false);
  const [filters, setFilters] = useState<ArchiveFilters>({ q: "", categoryGroup: "", category: "", source: "", dateFrom: "", dateTo: "" });
  const [linkForm, setLinkForm] = useState({ url: "", title: "", memo: "", category_id: "", category_name: "업무방법", content_type: "link", source_type: "" });
  const [fileForm, setFileForm] = useState({ title: "", memo: "", category_id: "", category_name: "업무방법", content_type: "" });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const autoImageRef = useRef<HTMLInputElement | null>(null);
  const autoImageFileRef = useRef<File | null>(null);

  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);
  const categoryIdByName = useMemo(() => new Map(data.categories.map((category) => [category.category_name, category.id])), [data.categories]);

  const categoryFilteredItems = useMemo(() => data.items.filter((item) => {
    if (filters.categoryGroup) return true;
    if (activeMenu === "all" || activeMenu === "save") return true;
    const categoryName = categoryById.get(String(item.category_id || ""))?.category_name || "";
    const allowed = activeSubCategory ? [activeSubCategory] : categoryNamesForGroup(activeMenu);
    return allowed.includes(categoryName);
  }), [activeMenu, activeSubCategory, categoryById, data.items, filters.categoryGroup]);

  const filteredItems = useMemo(() => categoryFilteredItems.filter((item) => {
    const categoryName = categoryById.get(String(item.category_id || ""))?.category_name || "";
    const haystack = `${item.title || ""} ${item.url || ""} ${item.memo || ""} ${item.summary || ""} ${categoryName}`.toLowerCase();
    if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
    if (filters.categoryGroup && categoryGroupOf(categoryName) !== filters.categoryGroup) return false;
    if (filters.category && categoryName !== filters.category) return false;
    if (filters.source && item.source_type !== filters.source) return false;
    const createdDate = (item.created_at || "").slice(0, 10);
    const dateFrom = normalizeDateInput(filters.dateFrom);
    const dateTo = normalizeDateInput(filters.dateTo);
    if (dateFrom && createdDate < dateFrom) return false;
    if (dateTo && createdDate > dateTo) return false;
    return true;
  }), [categoryById, categoryFilteredItems, filters]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/fnos/archive", { cache: "no-store" });
      const next = await res.json();
      if (!res.ok || next.ok === false) throw new Error(next.error || "아카이브 조회 실패");
      setData({ items: next.items || [], categories: next.categories || [], tags: next.tags || [], itemTags: next.itemTags || [], links: next.links || [] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "아카이브 조회 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (autoImagePreview) URL.revokeObjectURL(autoImagePreview);
    };
  }, [autoImagePreview]);

  useEffect(() => {
    if (!message) return;
    const shouldPopup = /(실패|선택|입력|없습니다)/.test(message) && !message.includes("미리보기를 생성할 URL");
    if (shouldPopup) window.alert(message);
    setMessage("");
  }, [message]);

  async function postJson(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok || result.ok === false) throw new Error(result.error || "저장 실패");
    return result;
  }

  async function requestPreview(id?: string, force = false) {
    if (!id) return;
    try {
      await postJson("/api/fnos/archive/preview", { id, force });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "미리보기 생성 실패");
    }
  }

  async function updateArchiveItem(item: ArchiveItem) {
    try {
      const res = await fetch("/api/fnos/archive", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
      const result = await res.json();
      if (!res.ok || result.ok === false) throw new Error(result.error || "아카이브 수정 실패");
      setMessage("아카이브를 수정했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "아카이브 수정 실패");
    }
  }

  async function updateArchiveItems(items: ArchiveItem[]) {
    try {
      await Promise.all(items.map(async (item) => {
        const res = await fetch("/api/fnos/archive", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
        const result = await res.json();
        if (!res.ok || result.ok === false) throw new Error(result.error || "아카이브 수정 실패");
      }));
      setMessage(`${items.length.toLocaleString("ko-KR")}개 항목을 수정했습니다.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "아카이브 수정 실패");
    }
  }

  async function runOcr(file: File) {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const result = await worker.recognize(file);
      return result.data.text || "";
    } finally {
      await worker.terminate();
    }
  }

  function setAutoDraftCategory(index: number, categoryName: string) {
    setAutoDrafts((prev) => prev.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const group = (Object.keys(categoryTree) as CategoryGroup[]).find((key) => categoryTree[key].includes(categoryName)) || item.category_group;
      return { ...item, category_group: group, category_name: categoryName };
    }));
  }

  function extractFromText(nextText = autoText) {
    const drafts = extractArchiveDrafts(nextText);
    setAutoDrafts(drafts);
    setMessage(drafts.length ? `${drafts.length.toLocaleString("ko-KR")}개 링크를 자동 정리했습니다.` : "추출된 링크가 없습니다.");
  }

  async function processImageFile(file?: File) {
    if (!file) return setMessage("링크가 보이는 이미지 파일을 선택해 주세요.");
    autoImageFileRef.current = file;
    setAutoImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setAutoWorking(true);
    setMessage("이미지에서 링크를 읽는 중입니다.");
    try {
      const text = await runOcr(file);
      setAutoText((prev) => [prev, text].filter(Boolean).join("\n\n"));
      extractFromText(text);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지 링크 추출 실패");
    } finally {
      setAutoWorking(false);
    }
  }

  function imageFromClipboard(data: DataTransfer) {
    const fileImage = Array.from(data.files).find((file) => file.type.startsWith("image/"));
    if (fileImage) return fileImage;
    const itemImage = Array.from(data.items).find((item) => item.type.startsWith("image/"));
    return itemImage?.getAsFile() || undefined;
  }

  async function onPasteAuto(event: ClipboardEvent<HTMLTextAreaElement | HTMLDivElement>) {
    const image = imageFromClipboard(event.clipboardData);
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    await processImageFile(image);
  }

  async function saveAutoDrafts() {
    if (!autoDrafts.length) return setMessage("저장할 자동 정리 항목이 없습니다.");
    setAutoWorking(true);
    setMessage("자동 정리 항목을 저장 중입니다.");
    try {
      const results = await Promise.all(autoDrafts.map((draft) => {
        const payload = {
          ...draft,
          category_id: categoryIdByName.get(draft.category_name) || null,
          tags: "",
          status: "active",
        };
        if (!autoImageFileRef.current) return postJson("/api/fnos/archive", payload);
        const formData = new FormData();
        Object.entries(payload).forEach(([key, value]) => formData.set(key, String(value ?? "")));
        formData.set("file", autoImageFileRef.current as File);
        return fetch("/api/fnos/archive", { method: "POST", body: formData }).then(async (res) => {
          const result = await res.json();
          if (!res.ok || result.ok === false) throw new Error(result.error || "저장 실패");
          return result;
        });
      }));
      void Promise.all(results.map((result) => requestPreview(result?.saved?.id)));
      const savedCount = autoDrafts.length;
      setAutoDrafts([]);
      setAutoText("");
      autoImageFileRef.current = null;
      setAutoImagePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      if (autoImageRef.current) autoImageRef.current.value = "";
      setMessage(`${savedCount.toLocaleString("ko-KR")}개 항목을 아카이브에 저장했습니다.`);
      await refresh();
      setActiveMenu("all");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자동 정리 저장 실패");
    } finally {
      setAutoWorking(false);
    }
  }

  async function saveLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("링크 저장 중...");
    try {
      const title = linkForm.title || shortenTitle(urlSlug(linkForm.url), sourceFromUrl(linkForm.url));
      const result = await postJson("/api/fnos/archive", { ...linkForm, title, status: "active" });
      void requestPreview(result?.saved?.id);
      setLinkForm({ url: "", title: "", memo: "", category_id: "", category_name: "업무방법", content_type: "link", source_type: "" });
      setMessage("링크를 저장했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "링크 저장 실패");
    }
  }

  async function saveFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setMessage("업로드할 파일을 선택해 주세요.");
    setMessage("파일 업로드 중...");
    try {
      const formData = new FormData();
      formData.set("file", file);
      Object.entries(fileForm).forEach(([key, value]) => formData.set(key, value));
      if (!fileForm.title) formData.set("title", shortenTitle(file.name.replace(/\.[^.]+$/, ""), "파일"));
      const res = await fetch("/api/fnos/archive", { method: "POST", body: formData });
      const result = await res.json();
      if (!res.ok || result.ok === false) throw new Error(result.error || "파일 저장 실패");
      void requestPreview(result?.saved?.id);
      setFileForm({ title: "", memo: "", category_id: "", category_name: "업무방법", content_type: "" });
      if (fileRef.current) fileRef.current.value = "";
      setMessage("파일을 저장했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파일 저장 실패");
    }
  }

  function openMenu(menu: ActiveMenu) {
    setActiveMenu(menu);
    setActiveSubCategory("");
    if (menu === "save") setSaveMode("auto");
    if (menu === "all" || menu === "save") {
      setFilters((prev) => ({ ...prev, categoryGroup: "", category: "" }));
    } else {
      setFilters((prev) => ({ ...prev, categoryGroup: menu, category: "" }));
    }
  }

  const menuItems: Array<[ActiveMenu, string]> = [
    ["save", "새로 저장"],
    ["all", "전체"],
    ["교육", "교육"],
    ["업무", "업무"],
    ["개인", "개인"],
  ];

  function categoryCount(categoryName: string) {
    return data.items.filter((item) => categoryById.get(String(item.category_id || ""))?.category_name === categoryName).length;
  }

  function groupCount(group: CategoryGroup) {
    const names = categoryTree[group];
    return data.items.filter((item) => names.includes(categoryById.get(String(item.category_id || ""))?.category_name || "")).length;
  }

  function menuCount(menu: ActiveMenu) {
    if (menu === "all") return data.items.length;
    if (menu === "save") return null;
    return groupCount(menu);
  }

  const category2Options = filters.categoryGroup && categoryTree[filters.categoryGroup as CategoryGroup]
    ? categoryTree[filters.categoryGroup as CategoryGroup]
    : categoryOptionEntries().map((entry) => entry.category);

  return (
    <div className="space-y-4" onPaste={activeMenu === "save" && saveMode === "auto" ? onPasteAuto : undefined}>
      <div>
        <h1 className="text-2xl font-black">아카이브</h1>
        <p className="mt-1 text-sm font-bold text-slate-500">링크, 이미지, 파일, 아이디어를 정리하고 업무 자료로 다시 꺼내 씁니다.</p>
      </div>

      <section>
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {menuItems.map(([key, label]) => (
              <button key={key} type="button" onClick={() => openMenu(key)} className={`h-10 rounded-md border px-3 text-sm font-black ${activeMenu === key ? "border-orange-500 bg-orange-500 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
                {label}{menuCount(key) !== null ? ` ${menuCount(key)}` : ""}
              </button>
            ))}
          </div>
          {activeMenu !== "save" && (
            <div className="grid w-full grid-cols-[56px_minmax(140px,1fr)_110px_110px_110px_52px_96px_12px_96px] items-center gap-2">
              <button type="button" onClick={() => setSelectMode((prev) => !prev)} className={`h-10 whitespace-nowrap rounded-md border px-2 text-sm font-black ${selectMode ? "border-orange-500 bg-orange-500 text-white" : "border-slate-950 bg-slate-950 text-white"}`}>
                선택
              </button>
              <input className="field-input h-10 min-w-0 rounded-md border border-slate-200 px-3 text-sm" placeholder="검색" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
              <select className="field-input h-10 min-w-0 rounded-md border border-slate-200 px-2 text-sm" value={filters.categoryGroup} onChange={(event) => {
                const group = event.target.value;
                setFilters({ ...filters, categoryGroup: group, category: "" });
                setActiveMenu(group ? group as CategoryGroup : "all");
                setActiveSubCategory("");
              }}>
                <option value="">카테고리1</option>
                {(Object.keys(categoryTree) as CategoryGroup[]).map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
              <select className="field-input h-10 min-w-0 rounded-md border border-slate-200 px-2 text-sm" value={filters.category} onChange={(event) => {
                setFilters({ ...filters, category: event.target.value });
                setActiveSubCategory(event.target.value);
              }}>
                <option value="">카테고리2</option>
                {category2Options.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <select className="field-input h-10 min-w-0 rounded-md border border-slate-200 px-2 text-sm" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}>
                <option value="">소스 전체</option>
                {sources.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
              <span className="text-xs font-black text-slate-500">기간선택</span>
              <input className="field-input h-10 rounded-md border border-slate-200 px-1.5 text-xs font-bold" placeholder="2026.05.27" value={displayDateInput(filters.dateFrom)} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} aria-label="시작일" />
              <span className="text-center text-sm font-black text-slate-400">~</span>
              <input className="field-input h-10 rounded-md border border-slate-200 px-1.5 text-xs font-bold" placeholder="2026.05.27" value={displayDateInput(filters.dateTo)} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} aria-label="종료일" />
            </div>
          )}
        </div>
      </section>

      {activeMenu === "save" && (
        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm" onPaste={onPasteAuto}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black">새로 저장</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">이미지는 붙여넣기, 링크는 텍스트 붙여넣기로 바로 정리합니다.</p>
              </div>
              <div className="flex rounded-md bg-slate-100 p-1">
                <button type="button" onClick={() => setSaveMode("auto")} className={`h-8 rounded px-3 text-xs font-black ${saveMode === "auto" ? "bg-white text-orange-600 shadow-sm" : "text-slate-500"}`}>자동정리</button>
                <button type="button" onClick={() => setSaveMode("manual")} className={`h-8 rounded px-3 text-xs font-black ${saveMode === "manual" ? "bg-white text-orange-600 shadow-sm" : "text-slate-500"}`}>수동업로드</button>
              </div>
            </div>

            {saveMode === "auto" ? (
              <>
                <textarea
                  className="field-input min-h-56 w-full rounded-md border border-slate-200 p-3 text-sm"
                  placeholder={"카톡 텍스트를 붙여넣거나, 이 칸에 이미지 자체를 Ctrl+V로 붙여넣으세요."}
                  value={autoText}
                  onPaste={onPasteAuto}
                  onChange={(event) => setAutoText(event.target.value)}
                />
                {autoImagePreview && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-2 text-xs font-black text-slate-500">붙여넣은 이미지 미리보기</div>
                    <img src={autoImagePreview} alt="붙여넣은 이미지 미리보기" className="max-h-48 w-full rounded border border-slate-200 bg-white object-contain" />
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:border-orange-300 hover:text-orange-600">
                    이미지 선택
                    <input ref={autoImageRef} className="hidden" type="file" accept="image/*" onChange={(event) => void processImageFile(event.target.files?.[0])} />
                  </label>
                  <button type="button" onClick={() => void processImageFile(autoImageRef.current?.files?.[0] || autoImageFileRef.current || undefined)} disabled={autoWorking} className="h-10 rounded-md border border-orange-200 bg-orange-50 px-4 text-sm font-black text-orange-600 disabled:opacity-50">이미지에서 추출</button>
                  <button type="button" onClick={() => extractFromText()} disabled={autoWorking} className="h-10 rounded-md bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50">텍스트 정리</button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setManualType("link")} className={`h-9 rounded-md px-3 text-sm font-black ${manualType === "link" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>링크</button>
                  <button type="button" onClick={() => setManualType("file")} className={`h-9 rounded-md px-3 text-sm font-black ${manualType === "file" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>파일</button>
                </div>
                {manualType === "link" ? (
                  <form onSubmit={saveLink} className="grid gap-3 lg:grid-cols-2">
                    <input className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm lg:col-span-2" placeholder="URL" value={linkForm.url} onChange={(event) => setLinkForm({ ...linkForm, url: event.target.value })} required />
                    <input className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" placeholder="제목 자동 생성, 필요시 입력" value={linkForm.title} onChange={(event) => setLinkForm({ ...linkForm, title: event.target.value })} />
                    <select className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" value={linkForm.category_name} onChange={(event) => setLinkForm({ ...linkForm, category_name: event.target.value, category_id: categoryIdByName.get(event.target.value) || "" })}>
                      {categoryOptionEntries().map((entry) => <option key={`${entry.group}-${entry.category}`} value={entry.category}>{entry.label}</option>)}
                    </select>
                    <textarea className="field-input min-h-24 rounded-md border border-slate-200 p-3 text-sm lg:col-span-2" placeholder="메모" value={linkForm.memo} onChange={(event) => setLinkForm({ ...linkForm, memo: event.target.value })} />
                    <button className="h-10 rounded-md bg-orange-500 px-4 text-sm font-black text-white lg:col-span-2">링크 저장</button>
                  </form>
                ) : (
                  <form onSubmit={saveFile} className="grid gap-3 lg:grid-cols-2">
                    <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:border-orange-300 hover:text-orange-600 lg:col-span-2">
                      파일 선택
                      <input ref={fileRef} className="hidden" type="file" accept="image/*,.pdf,.xlsx,.xls,.doc,.docx,.ppt,.pptx,.csv" required />
                    </label>
                    <input className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" placeholder="제목 자동 생성, 필요시 입력" value={fileForm.title} onChange={(event) => setFileForm({ ...fileForm, title: event.target.value })} />
                    <select className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" value={fileForm.category_name} onChange={(event) => setFileForm({ ...fileForm, category_name: event.target.value, category_id: categoryIdByName.get(event.target.value) || "" })}>
                      {categoryOptionEntries().map((entry) => <option key={`${entry.group}-${entry.category}`} value={entry.category}>{entry.label}</option>)}
                    </select>
                    <textarea className="field-input min-h-24 rounded-md border border-slate-200 p-3 text-sm lg:col-span-2" placeholder="메모" value={fileForm.memo} onChange={(event) => setFileForm({ ...fileForm, memo: event.target.value })} />
                    <button className="h-10 rounded-md bg-orange-500 px-4 text-sm font-black text-white lg:col-span-2">파일 저장</button>
                  </form>
                )}
              </div>
            )}
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black">저장 전 확인</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">제목은 10자 내외로 자동 생성됩니다. 자료 포인트는 메모가 아니라 참고 유형입니다.</p>
              </div>
              <button type="button" onClick={saveAutoDrafts} disabled={autoWorking || !autoDrafts.length} className="h-10 rounded-md bg-orange-500 px-4 text-sm font-black text-white disabled:bg-slate-300">{autoWorking ? "처리 중" : "전체 저장"}</button>
            </div>
            <div className="mt-4 space-y-3">
              {autoDrafts.map((draft, index) => (
                <div key={`${draft.url}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="grid gap-2 md:grid-cols-[minmax(0,3fr)_minmax(110px,1fr)_minmax(110px,1fr)]">
                    <input className="field-input h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold" value={draft.title} maxLength={24} onChange={(event) => setAutoDrafts((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
                    <select className="field-input h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={draft.category_group} onChange={(event) => {
                      const group = event.target.value as CategoryGroup;
                      const firstCategory = categoryTree[group][0];
                      setAutoDrafts((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, category_group: group, category_name: firstCategory } : item));
                    }}>
                      {(Object.keys(categoryTree) as CategoryGroup[]).map((group) => <option key={group}>{group}</option>)}
                    </select>
                    <select className="field-input h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={draft.category_name} onChange={(event) => setAutoDraftCategory(index, event.target.value)}>
                      {categoryTree[draft.category_group].map((category) => <option key={category}>{category}</option>)}
                    </select>
                  </div>
                  <a className="mt-2 block truncate text-sm font-black text-orange-600" href={draft.url} target="_blank" rel="noreferrer">{draft.url}</a>
                  <input className="field-input mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={draft.memo} onChange={(event) => setAutoDrafts((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, memo: event.target.value } : item))} />
                </div>
              ))}
              {!autoDrafts.length && <p className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">아직 정리된 링크가 없습니다.</p>}
            </div>
          </div>
        </section>
      )}

      {(activeMenu === "all" || activeMenu === "교육" || activeMenu === "업무" || activeMenu === "개인") && (
        <ArchiveList
          items={filteredItems}
          categoryById={categoryById}
          selectMode={selectMode}
          data={data}
          onRegeneratePreview={requestPreview}
          onUpdateItem={updateArchiveItem}
          onUpdateItems={updateArchiveItems}
        />
      )}
    </div>
  );
}

function ArchiveList({
  items,
  categoryById,
  selectMode,
  data,
  onRegeneratePreview,
  onUpdateItem,
  onUpdateItems,
}: {
  items: ArchiveItem[];
  categoryById: Map<string, ArchiveCategory>;
  selectMode: boolean;
  data: ArchiveData;
  onRegeneratePreview: (id?: string, force?: boolean) => void;
  onUpdateItem: (item: ArchiveItem) => Promise<void>;
  onUpdateItems: (items: ArchiveItem[]) => Promise<void>;
}) {
  const [editDraft, setEditDraft] = useState<ArchiveItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCategoryName, setBulkCategoryName] = useState("");
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));

  function startEdit(item: ArchiveItem) {
    setEditDraft({ ...item });
  }

  async function saveEdit() {
    if (!editDraft) return;
    await onUpdateItem(editDraft);
    setEditDraft(null);
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => checked ? Array.from(new Set([...prev, id])) : prev.filter((itemId) => itemId !== id));
  }

  async function moveSelectedCategory() {
    const category = data.categories.find((item) => item.category_name === bulkCategoryName);
    if (!category || !selectedItems.length) return;
    await onUpdateItems(selectedItems.map((item) => ({ ...item, category_id: category.id })));
    setSelectedIds([]);
    setBulkCategoryName("");
  }

  async function regenerateSelectedPreviews() {
    await Promise.all(selectedItems.map((item) => onRegeneratePreview(item.id, true)));
    setSelectedIds([]);
  }

  useEffect(() => {
    if (!selectMode) setSelectedIds([]);
  }, [selectMode]);

  return (
    <div className="space-y-4">
      {selectMode && (
        <section className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 p-2 text-sm">
          <span className="font-black text-orange-700">{selectedIds.length.toLocaleString("ko-KR")}개 선택</span>
          <select className="field-input h-8 min-w-0 flex-1 rounded-md border border-orange-200 bg-white px-3 text-xs" value={bulkCategoryName} onChange={(event) => setBulkCategoryName(event.target.value)}>
            <option value="">이동할 카테고리</option>
            {categoryOptionEntries().map((entry) => <option key={`${entry.group}-${entry.category}`} value={entry.category}>{entry.label}</option>)}
          </select>
          <button type="button" onClick={() => void moveSelectedCategory()} disabled={!bulkCategoryName} className="h-8 rounded-md bg-orange-500 px-3 text-xs font-black text-white disabled:bg-slate-300">
            카테고리 이동
          </button>
          <button type="button" onClick={() => void regenerateSelectedPreviews()} className="h-8 rounded-md border border-orange-200 bg-white px-3 text-xs font-black text-orange-700">
            미리보기 재생성
          </button>
          <button type="button" onClick={() => setSelectedIds(items.map((item) => item.id))} className="h-8 rounded-md border border-orange-200 bg-white px-3 text-xs font-black text-orange-700">
            모두선택
          </button>
          <button type="button" onClick={() => setSelectedIds([])} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-black text-slate-600">
            모두해제
          </button>
        </section>
      )}

      <section className="grid grid-cols-6 gap-3">
        {items.map((item) => {
          const category = categoryById.get(String(item.category_id || ""));
          const href = item.url || item.file_url || "";
          const previewUrl = item.preview_image_url || item.thumbnail_url || "";
          return (
            <article key={item.id} className={`relative min-h-[220px] w-full overflow-hidden rounded-md border bg-white shadow-sm ${selectedIds.includes(item.id) ? "border-orange-300 ring-2 ring-orange-100" : "border-slate-200"}`}>
              {selectMode && (
                <label className="absolute left-2 top-2 z-10 flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white/95 px-2 text-xs font-black text-slate-700 shadow-sm">
                  <input type="checkbox" className="h-4 w-4 accent-orange-500" checked={selectedIds.includes(item.id)} onChange={(event) => toggleSelected(item.id, event.target.checked)} aria-label="아카이브 선택" />
                  선택
                </label>
              )}
              <a href={href || undefined} target={href ? "_blank" : undefined} rel="noreferrer" className="block">
                <div className="flex h-[138px] w-full items-center justify-center bg-slate-100">
                  {previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-cover" /> : <ArchivePreviewFallback item={item} />}
                </div>
              </a>
              <div className="p-2">
                <div className="flex items-center gap-2">
                  <h2 className="min-w-0 flex-1 truncate text-sm font-black text-slate-950">{item.title || "제목 없음"}</h2>
                  <button type="button" onClick={() => startEdit(item)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-200 text-slate-500 hover:border-orange-300 hover:text-orange-600" aria-label="수정" title="수정">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                      <path d="M4 16.5V20h3.5L18.1 9.4l-3.5-3.5L4 16.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <path d="M13.5 7l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs font-black">
                  <span className="truncate rounded bg-slate-100 px-2 py-1 text-slate-600">{item.source_type || "-"}</span>
                  <span className="truncate rounded bg-slate-100 px-2 py-1 text-slate-600">{categoryDisplayLabel(category?.category_name)}</span>
                </div>
                {item.memo && <p className="mt-1 line-clamp-1 text-xs font-bold leading-4 text-slate-500">{item.memo}</p>}
              </div>
            </article>
          );
        })}
        {!items.length && <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-black text-slate-400 md:col-span-2 2xl:col-span-3">저장된 아카이브가 없습니다.</div>}
      </section>
      {editDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-md bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-950">아카이브 수정</h2>
              <button type="button" onClick={() => setEditDraft(null)} className="h-8 w-8 rounded border border-slate-200 text-sm font-black text-slate-500">X</button>
            </div>
            <div className="space-y-2">
              <input className="field-input h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-bold" value={editDraft.title || ""} placeholder="제목" onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} />
              <input className="field-input h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={editDraft.url || ""} placeholder="URL" onChange={(event) => setEditDraft({ ...editDraft, url: event.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <select className="field-input h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={editDraft.source_type || ""} onChange={(event) => setEditDraft({ ...editDraft, source_type: event.target.value })}>
                  <option value="">소스</option>
                  {sources.map((source) => <option key={source} value={source}>{source}</option>)}
                </select>
                <select className="field-input h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={categoryById.get(String(editDraft.category_id || ""))?.category_name || ""} onChange={(event) => {
                  const category = data.categories.find((candidate) => candidate.category_name === event.target.value);
                  setEditDraft({ ...editDraft, category_id: category?.id || "" });
                }}>
                  <option value="">카테고리</option>
                  {categoryOptionEntries().map((entry) => <option key={`${entry.group}-${entry.category}`} value={entry.category}>{entry.label}</option>)}
                </select>
              </div>
              <input className="field-input h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={editDraft.preview_image_url || ""} placeholder="미리보기 이미지 URL" onChange={(event) => setEditDraft({ ...editDraft, preview_image_url: event.target.value, preview_status: event.target.value ? "manual" : editDraft.preview_status })} />
              <textarea className="field-input min-h-24 w-full rounded-md border border-slate-200 bg-white p-3 text-sm" value={editDraft.memo || ""} placeholder="메모" onChange={(event) => setEditDraft({ ...editDraft, memo: event.target.value })} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setEditDraft(null)} className="h-10 rounded-md border border-slate-200 bg-white text-sm font-black text-slate-600">취소</button>
              <button type="button" onClick={() => void saveEdit()} className="h-10 rounded-md bg-orange-500 text-sm font-black text-white">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArchivePreviewFallback({ item }: { item: ArchiveItem }) {
  const source = String(item.source_type || "web").toLowerCase();
  const styles: Record<string, string> = {
    instagram: "from-pink-500 via-orange-400 to-purple-600 text-white",
    naver: "from-emerald-500 to-green-600 text-white",
    smartstore: "from-emerald-500 to-green-600 text-white",
    taobao: "from-orange-500 to-amber-500 text-white",
    "1688": "from-orange-500 to-amber-500 text-white",
    youtube: "from-red-500 to-rose-600 text-white",
  };
  const labels: Record<string, string> = {
    instagram: "INSTAGRAM",
    naver: "NAVER",
    smartstore: "NAVER",
    taobao: "SOURCING",
    "1688": "SOURCING",
    youtube: "YOUTUBE",
  };
  return (
    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${styles[source] || "from-slate-600 to-slate-800 text-white"}`}>
      <span className="text-xs font-black tracking-wide">{labels[source] || "ARCHIVE"}</span>
    </div>
  );
}
