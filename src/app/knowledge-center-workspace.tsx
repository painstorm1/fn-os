"use client";

import dynamic from "next/dynamic";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const ArchiveWorkspace = dynamic(() => import("./archive-workspace"), { loading: () => null });
const ProductKnowledgeWorkspace = dynamic(() => import("./product-knowledge-workspace"), { loading: () => <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">제품 도구 불러오는 중...</div> });

type View = "today" | "review" | "products" | "company" | "personal";
type KnowledgeItem = {
  id: string; title: string; scope: "company" | "personal"; status: "confirmed" | "pending" | "rejected";
  confirmation_method?: "merge" | "new" | null; relationship?: string; target_hint?: string; source_type?: string; source_url?: string;
  category?: string; source_date?: string; value_score?: number | null; value_label?: string;
  source_card_path: string; obsidian_path?: string; preview?: string; processing_status?: string; error_message?: string;
};
type DailyEntry = { id: string; entry_date: string; title: string; scope: string; entry_preview: string; processing_status?: string; obsidian_path?: string; error_message?: string };

const tabs: Array<[View, string]> = [["today", "오늘"], ["review", "검토함/원자료"], ["company", "회사·업무"], ["personal", "개인"], ["products", "제품 리스트"]];
const statusLabel: Record<string, string> = { confirmed: "지식확정", pending: "대기", rejected: "지식적용X", queued: "처리 대기", running: "처리 중", success: "처리 완료", failed: "처리 실패", idle: "미처리" };
const controlClass = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";

function obsidianHref(path?: string) {
  return path ? `obsidian://open?vault=${encodeURIComponent("Obs_FN_Cool")}&file=${encodeURIComponent(path.replace(/\.md$/i, ""))}` : "";
}

export default function KnowledgeCenterWorkspace() {
  const [view, setView] = useState<View>("today");
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ q: "", status: "", scope: "", relationship: "", source_type: "", category: "", source_date: "", processing_status: "", sort: "recommended" });
  const [daily, setDaily] = useState({ title: "", preview: "", scope: "company" });
  const selected = items.find((item) => item.id === selectedId) || null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    const response = await fetch(`/api/fnos/knowledge-center?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || "지식센터 조회 실패");
    const nextItems = data.items || [];
    setItems(nextItems);
    setSelectedIds((current) => current.filter((id) => nextItems.some((item: KnowledgeItem) => item.id === id)));
    setDailyEntries(data.dailyEntries || []);
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((reason) => setError(reason instanceof Error ? reason.message : "지식센터 조회 실패"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const relationships = useMemo(() => Array.from(new Set(items.map((item) => item.relationship).filter(Boolean))).sort() as string[], [items]);
  const sources = useMemo(() => Array.from(new Set(items.map((item) => item.source_type).filter(Boolean))).sort() as string[], [items]);
  const categories = useMemo(() => Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort() as string[], [items]);
  const confirmed = items.filter((item) => item.status === "confirmed" && item.processing_status === "success" && item.scope === view);

  async function submitDaily(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fnos/knowledge-center", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "daily_entry", ...daily }) });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "오늘 입력 실패");
      setDaily({ title: "", preview: "", scope: daily.scope });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "오늘 입력 실패"); } finally { setBusy(false); }
  }

  async function decide(action: "pending" | "rejected" | "confirm_new" | "confirm_merge" | "retry") {
    if (!selected) return;
    let targetPath = selected.obsidian_path || "";
    if (action === "confirm_new" || action === "confirm_merge") {
      targetPath = window.prompt(action === "confirm_new" ? "새 지식 Obsidian 경로(.md)" : "통합할 기존 지식 Obsidian 경로(.md)", targetPath) || "";
      if (!targetPath) return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fnos/knowledge-center", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selected.id, action, target_path: targetPath }) });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "지식 판정 실패");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "지식 판정 실패"); } finally { setBusy(false); }
  }

  async function updateTitle() {
    if (!selected) return;
    const title = window.prompt("지식 제목 수정", selected.title)?.trim();
    if (!title || title === selected.title) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fnos/knowledge-center", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selected.id, action: "update_title", title }) });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "제목 수정 실패");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "제목 수정 실패"); } finally { setBusy(false); }
  }

  async function bulkDecision(decision: "pending" | "rejected") {
    if (!selectedIds.length) return;
    if (!window.confirm(`선택한 ${selectedIds.length.toLocaleString("ko-KR")}개 항목을 ${decision === "pending" ? "대기" : "지식적용X"} 처리할까요?`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fnos/knowledge-center", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "bulk", decision, ids: selectedIds }) });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "일괄 판정 실패");
      const failed = (data.results || []).filter((result: { ok?: boolean }) => !result.ok).length;
      if (failed) setError(`${failed}개 항목은 처리하지 못했습니다.`);
      else setSelectedIds([]);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "일괄 판정 실패"); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">Cooljam Knowledge Center</p>
        <h1 className="mt-1 text-2xl font-black">Cooljam 지식센터</h1>
        <p className="mt-2 text-sm text-slate-500">원문은 Obsidian에 보존하고 FNOS에는 짧은 미리보기와 처리 상태만 색인합니다.</p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="지식센터 화면">
          {tabs.map(([key, label]) => <button key={key} type="button" onClick={() => setView(key)} className={`rounded-md px-4 py-2 text-sm font-black ${view === key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>{label}</button>)}
        </nav>
      </header>

      {error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}

      {view === "today" && <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <form onSubmit={submitDaily} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">오늘 입력</h2>
          <label className="block text-sm font-bold">제목<input className={`${controlClass} mt-1 w-full`} value={daily.title} maxLength={500} onChange={(event) => setDaily({ ...daily, title: event.target.value })} required /></label>
          <label className="block text-sm font-bold">범위<select className={`${controlClass} mt-1 w-full`} value={daily.scope} onChange={(event) => setDaily({ ...daily, scope: event.target.value })}><option value="company">회사·업무</option><option value="personal">개인</option></select></label>
          <label className="block text-sm font-bold">짧은 입력<textarea className={`${controlClass} mt-1 min-h-36 w-full`} value={daily.preview} maxLength={500} onChange={(event) => setDaily({ ...daily, preview: event.target.value })} required /></label>
          <p className="text-xs text-slate-500">본문·첨부는 Supabase에 저장하지 않습니다. 500자 이내 요약만 입력합니다.</p>
          <button disabled={busy} className="rounded-md bg-orange-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">저장</button>
        </form>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-3 text-lg font-black">날짜별 입력</h2><div className="space-y-2">{dailyEntries.map((entry) => <article key={entry.id} className="rounded-md border border-slate-200 p-3"><div className="flex justify-between gap-3"><strong>{entry.title}</strong><span className="text-xs text-slate-500">{entry.entry_date}</span></div><p className="mt-2 text-sm text-slate-600">{entry.entry_preview}</p><div className="mt-2 flex items-center gap-3 text-xs font-bold"><span className="text-slate-500">{statusLabel[entry.processing_status || "idle"]}{entry.error_message ? ` · ${entry.error_message}` : ""}</span>{entry.processing_status === "success" && entry.obsidian_path && <a href={obsidianHref(entry.obsidian_path)} className="text-violet-600">Obsidian 열기 ↗</a>}</div></article>)}</div></div>
      </div>}

      {view === "products" && <ProductKnowledgeWorkspace />}

      {view === "review" && <>
        <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3 xl:grid-cols-5">
          <input aria-label="검색" placeholder="제목·미리보기 검색" className={controlClass} value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
          <select aria-label="상태" className={controlClass} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">상태 전체</option><option value="pending">대기</option><option value="confirmed">지식확정</option><option value="rejected">지식적용X</option></select>
          <select aria-label="범위" className={controlClass} value={filters.scope} onChange={(event) => setFilters({ ...filters, scope: event.target.value })}><option value="">범위 전체</option><option value="company">회사·업무</option><option value="personal">개인</option></select>
          <select aria-label="카테고리" className={controlClass} value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="">카테고리 전체</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
          <input aria-label="자료 날짜" type="date" className={controlClass} value={filters.source_date} onChange={(event) => setFilters({ ...filters, source_date: event.target.value })} />
          <select aria-label="관계" className={controlClass} value={filters.relationship} onChange={(event) => setFilters({ ...filters, relationship: event.target.value })}><option value="">관계 전체</option>{relationships.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="출처" className={controlClass} value={filters.source_type} onChange={(event) => setFilters({ ...filters, source_type: event.target.value })}><option value="">출처 전체</option>{sources.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="처리 상태" className={controlClass} value={filters.processing_status} onChange={(event) => setFilters({ ...filters, processing_status: event.target.value })}><option value="">처리 전체</option><option value="queued">처리 대기</option><option value="running">처리 중</option><option value="success">완료</option><option value="failed">실패</option></select>
          <select aria-label="정렬" className={controlClass} value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}><option value="recommended">중요도·추천순</option><option value="recent">최근순</option></select>
          <div className="flex gap-2"><button type="button" disabled={busy || !selectedIds.length} onClick={() => void bulkDecision("pending")} className="rounded-md bg-amber-100 px-3 py-2 text-xs font-black text-amber-800 disabled:opacity-40">선택 대기</button><button type="button" disabled={busy || !selectedIds.length} onClick={() => void bulkDecision("rejected")} className="rounded-md bg-slate-200 px-3 py-2 text-xs font-black disabled:opacity-40">선택 적용X</button></div>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="max-h-[620px] divide-y divide-slate-100 overflow-auto">{items.map((item) => <article key={item.id} className={selectedId === item.id ? "bg-orange-50" : "hover:bg-slate-50"}><div className="flex items-start gap-3 p-4"><input type="checkbox" aria-label={`${item.title} 선택`} checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} className="mt-1 size-4" /><button type="button" onClick={() => setSelectedId(item.id)} className="min-w-0 flex-1 text-left"><div className="flex items-start justify-between gap-3"><strong>{item.title}</strong><span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-black">{statusLabel[item.status]}</span></div><p className="mt-2 line-clamp-2 text-sm text-slate-500">{item.preview || "미리보기 없음"}</p><div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400"><span>{item.scope === "personal" ? "개인" : "회사·업무"}</span><span>{item.category || "카테고리 미분류"}</span><span>{item.source_date || "날짜 미분류"}</span><span>{item.value_score == null ? "추천점수 없음" : `추천 ${item.value_score}/5${item.value_label ? ` ${item.value_label}` : ""}`}</span><span>{item.relationship || "관계 미분류"}</span><span>{item.source_type || "출처 미분류"}</span><span>{statusLabel[item.processing_status || "idle"]}</span></div></button></div></article>)}</div></div>
          <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{selected ? <div className="space-y-4"><div><div className="flex items-start justify-between gap-3"><h2 className="text-lg font-black">{selected.title}</h2><button type="button" disabled={busy} onClick={() => void updateTitle()} className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-black">제목 수정</button></div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{selected.preview || "원문 미리보기가 없습니다."}</p>{selected.target_hint && <p className="mt-2 rounded-md bg-blue-50 p-2 text-xs text-blue-800"><strong>AI 추천 대상:</strong> {selected.target_hint}</p>}</div><dl className="space-y-2 text-sm"><div><dt className="font-black">원본 카드</dt><dd className="break-all text-slate-500">{selected.source_card_path}</dd></div><div><dt className="font-black">Obsidian 경로</dt><dd className="break-all text-slate-500">{selected.obsidian_path || "미지정"}</dd></div><div><dt className="font-black">처리 상태</dt><dd>{statusLabel[selected.processing_status || "idle"]}{selected.error_message ? ` · ${selected.error_message}` : ""}</dd></div></dl><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void decide("confirm_merge")} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-black text-white">기존 지식에 통합</button><button disabled={busy} onClick={() => void decide("confirm_new")} className="rounded-md bg-blue-700 px-3 py-2 text-xs font-black text-white">새 지식으로 등록</button><button disabled={busy} onClick={() => void decide("pending")} className="rounded-md bg-amber-100 px-3 py-2 text-xs font-black text-amber-800">대기</button><button disabled={busy} onClick={() => void decide("rejected")} className="rounded-md bg-slate-200 px-3 py-2 text-xs font-black">지식적용X</button>{selected.processing_status === "failed" && <button disabled={busy} onClick={() => void decide("retry")} className="rounded-md bg-rose-700 px-3 py-2 text-xs font-black text-white">실패 재시도</button>}</div>{selected.source_url && <a href={selected.source_url} target="_blank" rel="noreferrer" className="block text-sm font-bold text-orange-600">원문 출처 열기 ↗</a>}{selected.obsidian_path && <a href={obsidianHref(selected.obsidian_path)} className="block text-sm font-bold text-violet-600">Obsidian에서 열기 ↗</a>}</div> : <p className="text-sm text-slate-500">검토할 항목을 선택하세요.</p>}</aside>
        </div>
        <details className="rounded-xl border border-slate-200 bg-white shadow-sm"><summary className="cursor-pointer p-5 text-lg font-black">기존 원자료 관리 (Archive)</summary><div className="border-t border-slate-200 p-4"><ArchiveWorkspace /></div></details>
      </>}

      {(view === "company" || view === "personal") && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{confirmed.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex justify-between gap-2"><h2 className="font-black">{item.title}</h2><span className="text-xs font-black text-emerald-700">지식확정</span></div><p className="mt-3 text-sm text-slate-600">{item.preview || "미리보기 없음"}</p><p className="mt-3 break-all text-xs text-slate-400">{item.obsidian_path || item.source_card_path}</p><div className="mt-3 flex gap-3 text-xs font-bold">{item.obsidian_path && <a href={obsidianHref(item.obsidian_path)} className="text-violet-600">Obsidian ↗</a>}{item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer" className="text-orange-600">근거 ↗</a>}</div></article>)}</div>}
    </section>
  );
}
