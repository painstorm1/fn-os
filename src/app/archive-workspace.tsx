"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ArchiveItem = {
  id: string;
  title?: string;
  url?: string;
  source_type?: string;
  content_type?: string;
  summary?: string;
  memo?: string;
  thumbnail_url?: string;
  file_url?: string;
  status?: string;
  is_favorite?: boolean;
  category_id?: string;
  reference_type?: string;
  created_at?: string;
};
type ArchiveCategory = { id: string; category_name: string; sort_order?: number };
type ArchiveTag = { id: string; tag_name: string };
type ArchiveItemTag = { archive_item_id?: string; tag_id?: string };
type ArchiveLink = { id: string; archive_item_id?: string; linked_type?: string; linked_id?: string };
type ArchiveData = { items: ArchiveItem[]; categories: ArchiveCategory[]; tags: ArchiveTag[]; itemTags: ArchiveItemTag[]; links: ArchiveLink[] };

const sources = ["instagram", "youtube", "naver", "coupang", "smartstore", "taobao", "1688", "amazon", "rakuten", "web", "manual", "file"];
const contentTypes = ["link", "image", "video", "file", "memo", "product", "ad_reference", "detail_page", "supplier"];
const referenceTypes = ["후킹 문구", "썸네일", "모델컷", "상세페이지 구조", "리뷰 강조", "가격 소구", "비교 광고", "육아 타겟", "남성 타겟", "여성 타겟"];

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-black text-slate-950">{value}</p>
      <p className="mt-2 text-sm font-bold text-orange-600">{note}</p>
    </article>
  );
}

function dateText(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

function tagMap(data: ArchiveData) {
  const byId = new Map(data.tags.map((tag) => [tag.id, tag]));
  const map = new Map<string, ArchiveTag[]>();
  data.itemTags.forEach((link) => {
    const itemId = String(link.archive_item_id || "");
    const tag = byId.get(String(link.tag_id || ""));
    if (itemId && tag) map.set(itemId, [...(map.get(itemId) || []), tag]);
  });
  return map;
}

export default function ArchiveWorkspace() {
  const [activeTab, setActiveTab] = useState<"all" | "link" | "file" | "taxo" | "connect" | "reference">("all");
  const [data, setData] = useState<ArchiveData>({ items: [], categories: [], tags: [], itemTags: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({ q: "", category: "", tag: "", source: "", status: "", date: "", favorite: false });
  const [linkForm, setLinkForm] = useState({ url: "", title: "", memo: "", category_id: "", tags: "", content_type: "link", source_type: "", reference_type: "" });
  const [fileForm, setFileForm] = useState({ title: "", memo: "", category_id: "", tags: "", content_type: "" });
  const [categoryForm, setCategoryForm] = useState({ category_name: "", sort_order: "" });
  const [tagForm, setTagForm] = useState({ tag_name: "", from_tag_id: "", to_tag_id: "" });
  const [connectForm, setConnectForm] = useState({ archive_item_id: "", linked_type: "product", linked_id: "", query: "" });
  const [productResults, setProductResults] = useState<Array<{ code?: string; name?: string; size?: string; raw?: Record<string, unknown> }>>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);
  const tagsByItem = useMemo(() => tagMap(data), [data]);
  const linkCountByItem = useMemo(() => {
    const map = new Map<string, number>();
    data.links.forEach((link) => {
      const id = String(link.archive_item_id || "");
      if (id) map.set(id, (map.get(id) || 0) + 1);
    });
    return map;
  }, [data.links]);

  const filteredItems = useMemo(() => data.items.filter((item) => {
    const tagNames = (tagsByItem.get(item.id) || []).map((tag) => tag.tag_name).join(" ");
    const haystack = `${item.title || ""} ${item.url || ""} ${item.memo || ""} ${item.summary || ""} ${tagNames}`.toLowerCase();
    if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
    if (filters.category && item.category_id !== filters.category) return false;
    if (filters.tag && !(tagsByItem.get(item.id) || []).some((tag) => tag.id === filters.tag)) return false;
    if (filters.source && item.source_type !== filters.source) return false;
    if (filters.status && (item.status || "active") !== filters.status) return false;
    if (filters.date && !(item.created_at || "").startsWith(filters.date)) return false;
    if (filters.favorite && !item.is_favorite) return false;
    return true;
  }), [data.items, filters, tagsByItem]);

  const referenceItems = filteredItems.filter((item) => item.content_type === "ad_reference" || item.reference_type);
  const unclassifiedCount = data.items.filter((item) => !item.category_id).length;
  const sourcingCount = data.items.filter((item) => categoryById.get(String(item.category_id || ""))?.category_name.includes("소싱")).length;

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

  async function postJson(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok || result.ok === false) throw new Error(result.error || "저장 실패");
    return result;
  }

  async function saveLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("링크 저장 중...");
    try {
      await postJson("/api/fnos/archive", { ...linkForm, status: "active" });
      setLinkForm({ url: "", title: "", memo: "", category_id: "", tags: "", content_type: "link", source_type: "", reference_type: "" });
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
      const res = await fetch("/api/fnos/archive", { method: "POST", body: formData });
      const result = await res.json();
      if (!res.ok || result.ok === false) throw new Error(result.error || "파일 저장 실패");
      setFileForm({ title: "", memo: "", category_id: "", tags: "", content_type: "" });
      if (fileRef.current) fileRef.current.value = "";
      setMessage("파일을 저장했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파일 저장 실패");
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/fnos/archive/categories", categoryForm);
      setCategoryForm({ category_name: "", sort_order: "" });
      setMessage("카테고리를 저장했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "카테고리 저장 실패");
    }
  }

  async function saveTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/fnos/archive/tags", tagForm);
      setTagForm({ tag_name: "", from_tag_id: "", to_tag_id: "" });
      setMessage("태그를 저장했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "태그 저장 실패");
    }
  }

  async function mergeTags() {
    try {
      await postJson("/api/fnos/archive/tags", { action: "merge", from_tag_id: tagForm.from_tag_id, to_tag_id: tagForm.to_tag_id });
      setMessage("태그를 병합했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "태그 병합 실패");
    }
  }

  async function searchProductsForLink() {
    if (!connectForm.query.trim()) return;
    const res = await fetch("/api/fnos/quick-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: connectForm.query }) });
    const result = await res.json();
    setProductResults(result.products || []);
    if (!res.ok || result.ok === false) setMessage(result.error || "상품 검색 실패");
  }

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/fnos/archive/links", connectForm);
      setConnectForm((prev) => ({ ...prev, linked_id: "" }));
      setMessage("연결을 추가했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "연결 저장 실패");
    }
  }

  async function removeConnection(id: string) {
    const res = await fetch(`/api/fnos/archive/links?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const result = await res.json();
    setMessage(result.ok ? "연결을 해제했습니다." : result.error || "연결 해제 실패");
    if (result.ok) await refresh();
  }

  async function toggleFavorite(item: ArchiveItem) {
    const res = await fetch("/api/fnos/archive", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...item, is_favorite: !item.is_favorite }) });
    const result = await res.json();
    if (!res.ok || result.ok === false) setMessage(result.error || "즐겨찾기 저장 실패");
    await refresh();
  }

  const tabs = [
    ["all", "전체 아카이브"],
    ["link", "링크 저장"],
    ["file", "파일 저장"],
    ["taxo", "카테고리/태그"],
    ["connect", "상품/수입관리 연결"],
    ["reference", "광고/콘텐츠 레퍼런스"],
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">아카이브</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">소싱 링크, 광고 레퍼런스, 상세페이지 자료, 파일과 메모를 FN OS DB에 저장합니다.</p>
        </div>
        <button type="button" onClick={refresh} className="h-10 rounded-md bg-orange-500 px-4 text-sm font-black text-white">새로고침</button>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="전체 저장" value={`${data.items.length.toLocaleString("ko-KR")}건`} note={loading ? "불러오는 중" : "아카이브 아이템"} />
        <Metric label="미분류" value={`${unclassifiedCount.toLocaleString("ko-KR")}건`} note="카테고리 지정 필요" />
        <Metric label="최근 소싱 후보" value={`${sourcingCount.toLocaleString("ko-KR")}건`} note="소싱 카테고리 기준" />
        <Metric label="광고 레퍼런스" value={`${referenceItems.length.toLocaleString("ko-KR")}건`} note="후킹/소재 분류" />
      </section>

      {message && <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-black text-orange-700">{message}</div>}

      <div className="flex flex-wrap gap-2">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-10 rounded-md border px-3 text-sm font-black ${activeTab === key ? "border-orange-500 bg-orange-500 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "all" && (
        <div className="space-y-4">
          <section className="grid gap-2 rounded-md border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-7">
            <input className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm md:col-span-2" placeholder="검색" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            <select className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
              <option value="">카테고리 전체</option>
              {data.categories.map((category) => <option key={category.id} value={category.id}>{category.category_name}</option>)}
            </select>
            <select className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })}>
              <option value="">태그 전체</option>
              {data.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.tag_name}</option>)}
            </select>
            <select className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
              <option value="">소스 전체</option>
              {sources.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
            <select className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">상태 전체</option>
              <option value="active">active</option>
              <option value="review">review</option>
              <option value="done">done</option>
              <option value="archived">archived</option>
            </select>
            <input className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />
            <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-black text-slate-600">
              <input type="checkbox" checked={filters.favorite} onChange={(e) => setFilters({ ...filters, favorite: e.target.checked })} />
              즐겨찾기
            </label>
          </section>

          <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filteredItems.map((item) => {
              const tags = tagsByItem.get(item.id) || [];
              const category = categoryById.get(String(item.category_id || ""));
              return (
                <article key={item.id} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                  <div className="flex h-36 items-center justify-center bg-slate-100">
                    {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <span className="text-sm font-black text-slate-400">{item.content_type || "archive"}</span>}
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="min-w-0 text-base font-black text-slate-950">{item.title || "제목 없음"}</h2>
                      <button type="button" onClick={() => toggleFavorite(item)} className={`h-8 w-8 rounded-md border text-sm font-black ${item.is_favorite ? "border-orange-300 bg-orange-50 text-orange-600" : "border-slate-200 text-slate-400"}`}>★</button>
                    </div>
                    <div className="flex flex-wrap gap-1 text-xs font-black">
                      <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{item.source_type || "-"}</span>
                      <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{category?.category_name || "미분류"}</span>
                      <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{dateText(item.created_at)}</span>
                      {linkCountByItem.get(item.id) ? <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">연결됨</span> : null}
                    </div>
                    <p className="line-clamp-2 min-h-[40px] text-sm text-slate-600">{item.memo || item.summary || item.url || "메모 없음"}</p>
                    <div className="flex flex-wrap gap-1">{tags.map((tag) => <span key={tag.id} className="rounded bg-orange-50 px-2 py-1 text-xs font-black text-orange-700">#{tag.tag_name}</span>)}</div>
                    {(item.url || item.file_url) && <a className="inline-flex text-sm font-black text-orange-600" href={item.url || item.file_url} target="_blank" rel="noreferrer">열기</a>}
                  </div>
                </article>
              );
            })}
            {!filteredItems.length && <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-black text-slate-400 md:col-span-2 2xl:col-span-3">저장된 아카이브가 없습니다.</div>}
          </section>
        </div>
      )}

      {activeTab === "link" && (
        <form onSubmit={saveLink} className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-2">
          <input className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm lg:col-span-2" placeholder="URL" value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })} required />
          <input className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" placeholder="제목" value={linkForm.title} onChange={(e) => setLinkForm({ ...linkForm, title: e.target.value })} />
          <select className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" value={linkForm.content_type} onChange={(e) => setLinkForm({ ...linkForm, content_type: e.target.value })}>{contentTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
          <select className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" value={linkForm.category_id} onChange={(e) => setLinkForm({ ...linkForm, category_id: e.target.value })}>
            <option value="">카테고리 선택</option>
            {data.categories.map((category) => <option key={category.id} value={category.id}>{category.category_name}</option>)}
          </select>
          <select className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" value={linkForm.source_type} onChange={(e) => setLinkForm({ ...linkForm, source_type: e.target.value })}>
            <option value="">소스 자동/선택</option>
            {sources.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
          <select className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" value={linkForm.reference_type} onChange={(e) => setLinkForm({ ...linkForm, reference_type: e.target.value })}>
            <option value="">광고/콘텐츠 분류 없음</option>
            {referenceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" placeholder="태그, 쉼표로 구분" value={linkForm.tags} onChange={(e) => setLinkForm({ ...linkForm, tags: e.target.value })} />
          <textarea className="field-input min-h-28 rounded-md border border-slate-200 p-3 text-sm lg:col-span-2" placeholder="메모" value={linkForm.memo} onChange={(e) => setLinkForm({ ...linkForm, memo: e.target.value })} />
          <button className="h-11 rounded-md bg-orange-500 px-4 text-sm font-black text-white lg:col-span-2">링크 저장</button>
        </form>
      )}

      {activeTab === "file" && (
        <form onSubmit={saveFile} className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-2">
          <input ref={fileRef} className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm lg:col-span-2" type="file" accept="image/*,.pdf,.xlsx,.xls,.doc,.docx,.ppt,.pptx,.csv" required />
          <input className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" placeholder="제목" value={fileForm.title} onChange={(e) => setFileForm({ ...fileForm, title: e.target.value })} />
          <select className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" value={fileForm.category_id} onChange={(e) => setFileForm({ ...fileForm, category_id: e.target.value })}>
            <option value="">카테고리 선택</option>
            {data.categories.map((category) => <option key={category.id} value={category.id}>{category.category_name}</option>)}
          </select>
          <select className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" value={fileForm.content_type} onChange={(e) => setFileForm({ ...fileForm, content_type: e.target.value })}>
            <option value="">파일 유형 자동</option>
            {contentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input className="field-input h-11 rounded-md border border-slate-200 px-3 text-sm" placeholder="태그, 쉼표로 구분" value={fileForm.tags} onChange={(e) => setFileForm({ ...fileForm, tags: e.target.value })} />
          <textarea className="field-input min-h-28 rounded-md border border-slate-200 p-3 text-sm lg:col-span-2" placeholder="메모" value={fileForm.memo} onChange={(e) => setFileForm({ ...fileForm, memo: e.target.value })} />
          <button className="h-11 rounded-md bg-orange-500 px-4 text-sm font-black text-white lg:col-span-2">파일 저장</button>
        </form>
      )}

      {activeTab === "taxo" && (
        <section className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={saveCategory} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black">카테고리</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
              <input className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" placeholder="카테고리명" value={categoryForm.category_name} onChange={(e) => setCategoryForm({ ...categoryForm, category_name: e.target.value })} />
              <input className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" placeholder="정렬" value={categoryForm.sort_order} onChange={(e) => setCategoryForm({ ...categoryForm, sort_order: e.target.value })} />
              <button className="h-10 rounded-md bg-orange-500 px-4 text-sm font-black text-white">저장</button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">{data.categories.map((category) => <span key={category.id} className="rounded bg-slate-100 px-3 py-2 text-sm font-black text-slate-700">{category.category_name}</span>)}</div>
          </form>
          <form onSubmit={saveTag} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black">태그</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" placeholder="태그명" value={tagForm.tag_name} onChange={(e) => setTagForm({ ...tagForm, tag_name: e.target.value })} />
              <button className="h-10 rounded-md bg-orange-500 px-4 text-sm font-black text-white">저장</button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <select className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" value={tagForm.from_tag_id} onChange={(e) => setTagForm({ ...tagForm, from_tag_id: e.target.value })}><option value="">합칠 태그</option>{data.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.tag_name}</option>)}</select>
              <select className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" value={tagForm.to_tag_id} onChange={(e) => setTagForm({ ...tagForm, to_tag_id: e.target.value })}><option value="">남길 태그</option>{data.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.tag_name}</option>)}</select>
              <button type="button" onClick={mergeTags} className="h-10 rounded-md border border-orange-200 bg-orange-50 px-4 text-sm font-black text-orange-600">병합</button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">{data.tags.map((tag) => <span key={tag.id} className="rounded bg-orange-50 px-3 py-2 text-sm font-black text-orange-700">#{tag.tag_name}</span>)}</div>
          </form>
        </section>
      )}

      {activeTab === "connect" && (
        <section className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={saveConnection} className="space-y-3 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black">상품/수입관리 연결</h2>
            <select className="field-input h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={connectForm.archive_item_id} onChange={(e) => setConnectForm({ ...connectForm, archive_item_id: e.target.value })}><option value="">아카이브 선택</option>{data.items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input className="field-input h-10 rounded-md border border-slate-200 px-3 text-sm" placeholder="상품명 검색" value={connectForm.query} onChange={(e) => setConnectForm({ ...connectForm, query: e.target.value })} />
              <button type="button" onClick={searchProductsForLink} className="h-10 rounded-md border border-orange-200 bg-orange-50 px-4 text-sm font-black text-orange-600">검색</button>
            </div>
            <div className="max-h-52 space-y-2 overflow-auto">
              {productResults.map((product, index) => {
                const raw = product.raw || {};
                const id = String(raw.id || product.code || index);
                return <button key={`${id}-${index}`} type="button" onClick={() => setConnectForm({ ...connectForm, linked_id: id })} className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:border-orange-300"><b>{product.name || "-"}</b><span className="ml-2 text-slate-500">{product.code || product.size || ""}</span></button>;
              })}
            </div>
            <select className="field-input h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={connectForm.linked_type} onChange={(e) => setConnectForm({ ...connectForm, linked_type: e.target.value })}>
              <option value="product">product</option>
              <option value="import_product">import_product</option>
              <option value="ad_campaign">ad_campaign</option>
              <option value="sales_channel">sales_channel</option>
              <option value="supplier">supplier</option>
            </select>
            <input className="field-input h-10 w-full rounded-md border border-slate-200 px-3 text-sm" placeholder="linked_id" value={connectForm.linked_id} onChange={(e) => setConnectForm({ ...connectForm, linked_id: e.target.value })} required />
            <button className="h-10 w-full rounded-md bg-orange-500 px-4 text-sm font-black text-white">연결 추가</button>
          </form>
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black">연결된 항목</h2>
            <div className="mt-4 space-y-2">
              {data.links.map((link) => {
                const item = data.items.find((archive) => archive.id === link.archive_item_id);
                return <div key={link.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm"><span><b>{item?.title || "아카이브"}</b> · {link.linked_type}:{link.linked_id}</span><button type="button" onClick={() => removeConnection(link.id)} className="font-black text-rose-600">해제</button></div>;
              })}
              {!data.links.length && <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-400">연결된 항목이 없습니다.</p>}
            </div>
          </div>
        </section>
      )}

      {activeTab === "reference" && (
        <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {referenceItems.map((item) => (
            <article key={item.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black text-orange-600">{item.reference_type || item.content_type}</p>
              <h2 className="mt-2 text-base font-black">{item.title}</h2>
              <p className="mt-2 line-clamp-3 text-sm text-slate-600">{item.memo || item.summary || item.url}</p>
              <div className="mt-3 flex flex-wrap gap-1">{(tagsByItem.get(item.id) || []).map((tag) => <span key={tag.id} className="rounded bg-orange-50 px-2 py-1 text-xs font-black text-orange-700">#{tag.tag_name}</span>)}</div>
            </article>
          ))}
          {!referenceItems.length && <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-black text-slate-400 md:col-span-2 2xl:col-span-3">광고/콘텐츠 레퍼런스가 없습니다.</div>}
        </section>
      )}
    </div>
  );
}
