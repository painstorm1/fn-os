"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type ImportLink = {
  import_product_id?: string;
  import_product_name?: string;
  import_option_name?: string;
  image_url?: string;
  product_url?: string;
  options?: string;
  hs_code?: string;
  moq?: number;
  source_price?: number;
  currency?: string;
  source_note?: string;
};

type Product = {
  id: string;
  product_code?: string;
  product_name?: string;
  current_stock?: number;
  cost_price?: number;
  standard_price?: number;
  import_links?: ImportLink[];
  raw?: { image_url?: string; note?: string };
};

type SalesMapping = {
  id?: string;
  fn_product_id?: string;
  product_code?: string;
  channel_name?: string;
  channel_code?: string;
  mall_product_name?: string;
  mall_product_code?: string;
  mall_product_key?: string;
};

type ProductKnowledge = {
  id: string;
  source_ref?: string;
  processing_status?: string;
  obsidian_path?: string;
  error_message?: string;
};

const controlClass = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
const processingLabel: Record<string, string> = { idle: "미등록", queued: "카드 생성 대기", running: "카드 생성 중", success: "카드 등록 완료", failed: "카드 등록 실패" };

function obsidianHref(path?: string) {
  return path ? `obsidian://open?vault=${encodeURIComponent("Obs_FN_Cool")}&file=${encodeURIComponent(path.replace(/\.md$/i, ""))}` : "";
}

function imageFor(product: Product) {
  return product.raw?.image_url || product.import_links?.find((item) => item.image_url)?.image_url || "";
}

export default function ProductKnowledgeWorkspace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [mappings, setMappings] = useState<SalesMapping[]>([]);
  const [knowledge, setKnowledge] = useState<ProductKnowledge[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [form, setForm] = useState({ image_source: "", image_notes: "", extra_context: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [productResponse, mappingResponse, knowledgeResponse] = await Promise.all([
      fetch("/api/fnos/products/master?relation=import&page=1&pageSize=5000", { cache: "no-store" }),
      fetch("/api/fnos/sales-channel-product-mappings?limit=5000", { cache: "no-store" }),
      fetch("/api/fnos/knowledge-center?scope=company&source_type=fnos-product&sort=recent", { cache: "no-store" }),
    ]);
    const [productData, mappingData, knowledgeData] = await Promise.all([productResponse.json(), mappingResponse.json(), knowledgeResponse.json()]);
    if (!productResponse.ok || productData.ok === false) throw new Error(productData.error || "직수입 제품 조회 실패");
    if (!mappingResponse.ok || mappingData.ok === false) throw new Error(mappingData.error || "판매채널 연결 조회 실패");
    if (!knowledgeResponse.ok || knowledgeData.ok === false) throw new Error(knowledgeData.error || "제품 카드 상태 조회 실패");
    setProducts(productData.products || []);
    setMappings(mappingData.mappings || []);
    setKnowledge(knowledgeData.items || []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : "제품 도구 조회 실패")), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = products.find((product) => product.id === selectedId) || null;
  const knowledgeByProduct = useMemo(() => new Map(knowledge.map((item) => [item.source_ref, item])), [knowledge]);
  const salesByProduct = useMemo(() => {
    const map = new Map<string, SalesMapping[]>();
    mappings.forEach((item) => {
      [item.fn_product_id, item.product_code].filter(Boolean).forEach((key) => map.set(key as string, [...(map.get(key as string) || []), item]));
    });
    return map;
  }, [mappings]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return products.filter((product) => {
      const state = knowledgeByProduct.get(product.id)?.processing_status || "idle";
      if (cardFilter === "success" && state !== "success") return false;
      if (cardFilter === "missing" && state === "success") return false;
      if (!normalized) return true;
      return `${product.product_code || ""} ${product.product_name || ""} ${(product.import_links || []).map((item) => `${item.import_product_name || ""} ${item.options || ""}`).join(" ")}`.toLowerCase().includes(normalized);
    });
  }, [cardFilter, knowledgeByProduct, products, query]);

  async function requestCard(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/fnos/knowledge-center", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "product_card_request", product_id: selected.id, ...form }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "제품 카드 요청 실패");
      setNotice("제품 카드 생성/갱신 요청을 MiniPC 처리 큐에 등록했습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "제품 카드 요청 실패");
    } finally {
      setBusy(false);
    }
  }

  const selectedKnowledge = selected ? knowledgeByProduct.get(selected.id) : undefined;
  const selectedSales = selected ? Array.from(new Map([...(salesByProduct.get(selected.id) || []), ...(salesByProduct.get(selected.product_code || "") || [])].map((item) => [item.id || `${item.channel_name}:${item.mall_product_key}`, item])).values()) : [];

  return <div className="space-y-5">
    <section className="grid gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 md:grid-cols-[1fr_auto_auto]">
      <div><h2 className="font-black text-orange-950">직수입 제품 지식 도구</h2><p className="mt-1 text-sm text-orange-900">FNOS 품목의 직수입 연결·스펙·원문·판매채널 연결을 읽어 Obsidian 제품 카드로 만듭니다.</p></div>
      <div className="rounded-lg bg-white px-4 py-3 text-center"><strong className="block text-xl">{products.length.toLocaleString("ko-KR")}</strong><span className="text-xs text-slate-500">직수입 연결 제품</span></div>
      <div className="rounded-lg bg-white px-4 py-3 text-center"><strong className="block text-xl">{knowledge.filter((item) => item.processing_status === "success").length.toLocaleString("ko-KR")}</strong><span className="text-xs text-slate-500">Obsidian 카드</span></div>
    </section>

    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer font-black">이미지로 제품 카드 등록하는 방법</summary>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600"><li>Telegram/Slack에 제품 이미지를 첨부하고 <code>옵시디언에 아이템 등록해줘</code>라고 요청합니다.</li><li>Hermes가 이미지의 표시 스펙을 판독하고 FNOS 직수입 제품을 코드/제품명으로 매칭합니다.</li><li>이 도구와 같은 MiniPC 큐로 정해진 제품 카드 폼을 생성하고, readback 성공 뒤 목록에 <strong>카드 등록 완료</strong>로 표시합니다.</li></ol>
      <p className="mt-2 text-xs text-slate-500">웹에서는 MiniPC가 읽을 수 있는 이미지 파일 경로 또는 이미지 URL을 직접 넣어 같은 작업을 요청할 수 있습니다.</p>
    </details>

    {error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}
    {notice && <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{notice}</div>}

    <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_220px]">
      <input aria-label="제품 검색" placeholder="제품코드·제품명·수입 옵션/스펙 검색" className={controlClass} value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="제품 카드 상태" className={controlClass} value={cardFilter} onChange={(event) => setCardFilter(event.target.value)}><option value="all">카드 상태 전체</option><option value="success">카드 등록 완료</option><option value="missing">미등록·처리 중·실패</option></select>
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="max-h-[720px] divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {filtered.map((product) => {
          const card = knowledgeByProduct.get(product.id);
          const image = imageFor(product);
          return <button type="button" key={product.id} onClick={() => { setSelectedId(product.id); setForm({ image_source: "", image_notes: "", extra_context: "" }); setNotice(""); }} className={`grid w-full grid-cols-[72px_1fr_auto] gap-3 p-4 text-left ${selectedId === product.id ? "bg-orange-50" : "hover:bg-slate-50"}`}>
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-slate-100">{image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-slate-400">이미지 없음</span>}</div>
            <div className="min-w-0"><strong className="block truncate">{product.product_name || "제품명 없음"}</strong><span className="text-xs font-bold text-slate-500">{product.product_code || "코드 없음"}</span><div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400"><span>수입 연결 {product.import_links?.length || 0}</span><span>판매채널 {(salesByProduct.get(product.id) || salesByProduct.get(product.product_code || "") || []).length}</span><span>재고 {(product.current_stock || 0).toLocaleString("ko-KR")}</span></div></div>
            <span className={`h-fit rounded-full px-2 py-1 text-xs font-black ${card?.processing_status === "success" ? "bg-emerald-100 text-emerald-800" : card?.processing_status === "failed" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-600"}`}>{processingLabel[card?.processing_status || "idle"]}</span>
          </button>;
        })}
        {!filtered.length && <p className="p-8 text-center text-sm text-slate-500">조건에 맞는 직수입 제품이 없습니다.</p>}
      </div>

      <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {selected ? <div className="space-y-5">
          <div className="flex gap-4"><div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">{imageFor(selected) ? <img src={imageFor(selected)} alt={selected.product_name || ""} className="h-full w-full object-cover" /> : <span className="text-xs text-slate-400">이미지 없음</span>}</div><div><h2 className="text-lg font-black">{selected.product_name}</h2><p className="text-sm font-bold text-slate-500">{selected.product_code}</p><p className="mt-2 text-xs text-slate-500">현재 재고 {(selected.current_stock || 0).toLocaleString("ko-KR")} · 기준가 {(selected.standard_price || 0).toLocaleString("ko-KR")}원</p></div></div>
          <section><h3 className="font-black">직수입 스펙·원문</h3><div className="mt-2 space-y-2">{(selected.import_links || []).map((item, index) => <article key={`${item.import_product_id}-${index}`} className="rounded-md border border-slate-200 p-3 text-sm"><strong>{item.import_product_name || item.import_product_id}</strong><p className="mt-1 text-slate-600">{[item.import_option_name, item.options, item.hs_code ? `HS ${item.hs_code}` : "", item.moq ? `MOQ ${item.moq}` : ""].filter(Boolean).join(" · ") || "상세 스펙 없음"}</p>{item.product_url && <a href={item.product_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-black text-orange-600">수입/제품 원문 ↗</a>}</article>)}</div></section>
          <section><h3 className="font-black">판매채널 연결</h3><div className="mt-2 space-y-2">{selectedSales.map((item, index) => { const name = item.mall_product_name || selected.product_name || ""; const search = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(name)}`; return <div key={item.id || index} className="rounded-md bg-slate-50 p-3 text-sm"><strong>{item.channel_name || item.channel_code || "채널 미상"}</strong><p className="text-slate-600">{name} · {item.mall_product_code || item.mall_product_key || "상품코드 없음"}</p><a href={search} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-600">판매페이지 검색 ↗</a></div>; })}{!selectedSales.length && <p className="text-sm text-slate-500">판매채널 코드연결이 없습니다.</p>}</div></section>
          <form onSubmit={requestCard} className="space-y-3 rounded-lg border border-slate-200 p-4"><h3 className="font-black">Obsidian 제품 카드 생성/갱신</h3><label className="block text-xs font-bold">이미지 경로 또는 URL<input className={`${controlClass} mt-1 w-full`} value={form.image_source} onChange={(event) => setForm({ ...form, image_source: event.target.value })} placeholder="D:/FN_images/... 또는 https://..." /></label><label className="block text-xs font-bold">이미지에서 확인된 스펙<textarea className={`${controlClass} mt-1 min-h-20 w-full`} maxLength={500} value={form.image_notes} onChange={(event) => setForm({ ...form, image_notes: event.target.value })} placeholder="이미지 판독 결과를 FNOS DB 값과 구분해 기록" /></label><label className="block text-xs font-bold">제품 맥락 메모<textarea className={`${controlClass} mt-1 min-h-20 w-full`} maxLength={500} value={form.extra_context} onChange={(event) => setForm({ ...form, extra_context: event.target.value })} placeholder="고객, 사용상황, USP, 관련 자료 등" /></label><button disabled={busy} className="rounded-md bg-orange-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{selectedKnowledge?.processing_status === "success" ? "제품 카드 갱신 요청" : "제품 카드 생성 요청"}</button>{selectedKnowledge?.processing_status === "failed" && <p className="text-xs font-bold text-rose-700">{selectedKnowledge.error_message || "처리 실패 — 다시 요청할 수 있습니다."}</p>}{selectedKnowledge?.processing_status === "success" && selectedKnowledge.obsidian_path && <a href={obsidianHref(selectedKnowledge.obsidian_path)} className="ml-3 text-sm font-black text-violet-600">Obsidian 카드 열기 ↗</a>}</form>
        </div> : <p className="py-20 text-center text-sm text-slate-500">왼쪽에서 직수입 제품을 선택하세요.</p>}
      </aside>
    </div>
  </div>;
}
