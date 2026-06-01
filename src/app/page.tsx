"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, KeyboardEvent, MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import type { CellObject, WorkSheet } from "xlsx-js-style";
import {
  ActionButton,
  Card,
  EmptyState,
  FilterBar,
  FormField,
  KpiCard,
  PageHeader,
  SectionHeader,
  SelectionModal,
  FormModal,
  StatusBadge,
  modalInputClass,
  modalSelectClass,
  modalTextareaClass,
  useEscapeToClose,
} from "@/components/fn-ui";
import { cachedJson as cachedClientJson, invalidateClientCache, readCachedJson } from "@/lib/client-cache";

const MainDashboard = dynamic(() => import("./main-dashboard"), {
  loading: () => <div className="rounded-md border border-slate-200 bg-white p-6 text-sm font-bold text-slate-500">대시보드를 불러오는 중...</div>,
});
const ArchiveWorkspace = dynamic(() => import("./archive-workspace"), {
  loading: () => <div className="rounded-md border border-slate-200 bg-white p-6 text-sm font-bold text-slate-500">아카이브를 불러오는 중...</div>,
});

type XlsxModule = typeof import("xlsx-js-style");

let xlsxModulePromise: Promise<XlsxModule> | null = null;

function loadXlsxModule() {
  xlsxModulePromise ||= import("xlsx-js-style");
  return xlsxModulePromise;
}

function preventEnterSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter") return;
  if (event.nativeEvent.isComposing) return;
  const target = event.target;
  if (target instanceof HTMLTextAreaElement) return;
  if (target instanceof HTMLButtonElement) return;
  event.preventDefault();
}

function useF2Navigate(enabled: boolean, href: string) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "F2") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement
      ) return;
      event.preventDefault();
      window.location.href = href;
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, href]);
}

const mainMenus = [
  "매출/재고",
  "수입관리",
  "광고분석",
  "회계/비용",
  "아카이브",
];

const importSubMenus = [
  { label: "발주", path: "/orders" },
  { label: "제품", path: "/products" },
  { label: "설정", path: "/settings" },
];

const salesSubMenus = [
  { label: "온라인 발주", section: "online" },
  { label: "판매/구매", section: "history" },
  { label: "재고현황", section: "inventory" },
  { label: "기초관리", section: "master" },
];

const menuSlugs: Record<string, string> = {
  대시보드: "dashboard",
  "매출/재고": "sales",
  수입관리: "import",
  광고분석: "ads",
  "회계/비용": "accounting",
  아카이브: "archive",
};

const slugMenus = Object.fromEntries(Object.entries(menuSlugs).map(([key, value]) => [value, key]));

function goToInternal(href: string) {
  window.location.href = href;
}

const kpis = [
  { label: "오늘 매출", value: "1,284,000원", tone: "text-emerald-600", note: "+12.4%" },
  { label: "광고비", value: "182,500원", tone: "text-sky-600", note: "ROAS 421%" },
  { label: "예상 순이익", value: "386,000원", tone: "text-orange-600", note: "마진 30.1%" },
  { label: "재고 위험", value: "7 SKU", tone: "text-rose-600", note: "3개 긴급" },
];

function formatDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function compactDateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[1].slice(2)}.${match[2]}.${match[3]}`;
}

type CalendarServerMemo = {
  memo: string;
  order_id?: number;
  order_code?: string;
};

function CalendarMemo() {
  const today = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(formatDateKey(today));
  const [memoText, setMemoText] = useState("");
  const [memos, setMemos] = useState<Record<string, string[]>>({});
  const [serverMemos, setServerMemos] = useState<Record<string, CalendarServerMemo[]>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setMemos(JSON.parse(localStorage.getItem("fn-import-erp-calendar-memos") || "{}"));
      } catch {
        setMemos({});
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    function loadServerMemos() {
      cachedJson<Record<string, Array<string | CalendarServerMemo>>>("/api/fnos/calendar-production-memos", 30_000)
        .then((data) => {
          if (!alive) return;
          const normalized = Object.fromEntries(
            Object.entries(data || {}).map(([date, items]) => [
              date,
              (Array.isArray(items) ? items : []).map((item) => (
                typeof item === "string" ? { memo: item } : item as CalendarServerMemo
              )),
            ]),
          );
          setServerMemos(normalized);
        })
        .catch(() => {
          if (alive) setServerMemos({});
        });
    }
    loadServerMemos();
    const refreshTimer = window.setInterval(loadServerMemos, 60000);
    window.addEventListener("fnos-calendar-refresh", loadServerMemos);
    window.addEventListener("focus", loadServerMemos);
    return () => {
      alive = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("fnos-calendar-refresh", loadServerMemos);
      window.removeEventListener("focus", loadServerMemos);
    };
  }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const blanks = Array.from({ length: first.getDay() });
  const days = Array.from({ length: last.getDate() }, (_, index) => index + 1);

  function saveMemos(next: Record<string, string[]>) {
    setMemos(next);
    localStorage.setItem("fn-import-erp-calendar-memos", JSON.stringify(next));
  }

  function addMemo() {
    const text = memoText.trim();
    if (!text) return;
    saveMemos({ ...memos, [selected]: [...(memos[selected] || []), text] });
    setMemoText("");
  }

  function deleteMemo(index: number) {
    const nextItems = [...(memos[selected] || [])];
    nextItems.splice(index, 1);
    const next = { ...memos };
    if (nextItems.length) next[selected] = nextItems;
    else delete next[selected];
    saveMemos(next);
  }

  return (
    <section className="px-1 py-2">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="h-8 w-8 rounded-md text-lg font-black text-slate-500 hover:bg-slate-100"
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          aria-label="이전 달"
        >
          ‹
        </button>
        <strong className="text-base font-black">{year}년 {month + 1}월</strong>
        <button
          type="button"
          className="h-8 w-8 rounded-md text-lg font-black text-slate-500 hover:bg-slate-100"
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          aria-label="다음 달"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs font-black text-slate-400">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-sm">
        {blanks.map((_, index) => <span key={`blank-${index}`} />)}
        {days.map((day) => {
          const key = formatDateKey(new Date(year, month, day));
          const isSelected = key === selected;
          const hasMemo = Boolean(memos[key]?.length || serverMemos[key]?.length);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              className={`relative h-8 rounded-md font-bold ${
                isSelected ? "bg-orange-500 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {day}
              {hasMemo && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current" />}
            </button>
          );
        })}
      </div>
      <div className="mt-4 pt-2">
        <strong className="text-xs font-bold text-slate-500">{selected}</strong>
        <div className="mt-2 space-y-2">
          {(serverMemos[selected] || []).map((memo, index) => (
            <div key={`server-${memo.memo}-${index}`} className="rounded-md bg-orange-50 px-2 py-1.5 text-xs font-bold text-orange-700">
              {memo.order_id ? (
                <Link href={importHref(`/orders?open=${memo.order_id}`)} className="block break-keep hover:underline">
                  {memo.memo}
                  {memo.order_code ? <span className="ml-1 text-orange-500">({memo.order_code})</span> : null}
                </Link>
              ) : (
                <span className="block break-keep">{memo.memo}</span>
              )}
            </div>
          ))}
          {(memos[selected] || []).map((memo, index) => (
            <div key={`local-${memo}-${index}`} className="flex items-start justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs">
              <span className="break-all">{memo}</span>
              <button type="button" className="font-black text-slate-400 hover:text-rose-500" onClick={() => deleteMemo(index)}>
                삭제
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1">
          <input
            value={memoText}
            onChange={(event) => setMemoText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addMemo();
            }}
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400"
            placeholder="내 메모 입력"
          />
          <button type="button" onClick={addMemo} className="rounded-md bg-orange-500 px-3 text-xs font-black text-white">
            저장
          </button>
        </div>
      </div>
    </section>
  );
}

function PasswordSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    setMode("view");
    setCurrentPassword("");
    setNewPassword("");
    setShowPassword(false);
    setMessage("");
    setError("");
    setLoading(true);

    fetch("/api/login", { method: "GET" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "비밀번호를 불러오지 못했습니다.");
        setCurrentPassword(String(data.password || ""));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  async function savePassword() {
    setLoading(true);
    setError("");
    setMessage("");

    const response = await fetch("/api/login", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setError(data.error || "비밀번호 변경에 실패했습니다.");
      return;
    }

    setCurrentPassword(newPassword);
    setNewPassword("");
    setMode("view");
    setMessage("비밀번호가 변경되었습니다.");
  }

  return (
    <FormModal
      title={mode === "view" ? "설정" : "비밀번호 변경"}
      description={mode === "view" ? "현재 FN OS 로그인 비밀번호를 확인할 수 있습니다." : "새 비밀번호로 변경합니다."}
      onClose={onClose}
      size="md"
      footer={
        <>
          <ActionButton type="button" variant="secondary" onClick={onClose}>닫기</ActionButton>
          {mode === "view" ? (
            <ActionButton
              type="button"
              onClick={() => {
                setMode("edit");
                setMessage("");
                setError("");
              }}
              disabled={loading}
            >
              수정
            </ActionButton>
          ) : (
            <ActionButton
              type="button"
              onClick={() => void savePassword()}
              disabled={loading || !newPassword}
            >
              {loading ? "저장 중..." : "변경"}
            </ActionButton>
          )}
        </>
      }
    >
        <div className="space-y-4">
          <FormField label="현재 비밀번호">
          <div className="flex gap-2">
            <input
              id="current-password"
              className={`${modalInputClass} min-w-0 flex-1`}
              type={showPassword ? "text" : "password"}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              readOnly={mode === "view"}
            />
            <ActionButton
              type="button"
              variant="secondary"
              className="shrink-0"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? "가리기" : "보기"}
            </ActionButton>
          </div>
          </FormField>

          {mode === "edit" && (
            <FormField label="새 비밀번호">
              <input
                id="new-password"
                className={modalInputClass}
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoFocus
              />
            </FormField>
          )}
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}
        {message && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{message}</p>}
    </FormModal>
  );
}

function LeftSidebar({ activeMenu, importPath, salesSection }: { activeMenu: string; importPath: string; salesSection: string }) {
  const [importOpen, setImportOpen] = useState(activeMenu === "수입관리");
  const [salesOpen, setSalesOpen] = useState(activeMenu === "매출/재고");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (activeMenu !== "수입관리") return;
    const timer = window.setTimeout(() => setImportOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [activeMenu]);

  useEffect(() => {
    if (activeMenu !== "매출/재고") return;
    const timer = window.setTimeout(() => setSalesOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [activeMenu]);

  async function logout() {
    await fetch("/api/login", { method: "DELETE" }).catch(() => null);
    window.location.href = "/login";
  }

  return (
    <aside className="hidden min-h-screen w-[280px] shrink-0 border-r border-slate-200 bg-white px-6 py-5 lg:block">
      <PasswordSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Link
        href="/?menu=dashboard"
        className="mb-4 block"
        onClick={(event) => {
          event.preventDefault();
          goToInternal("/?menu=dashboard");
        }}
      >
        <Image src="/fn-logo.jpg" alt="F&" width={88} height={88} className="object-contain" priority />
      </Link>
      <div className="mb-5 flex items-center gap-2 text-xs font-semibold text-gray-500">
        <button
          type="button"
          onClick={() => void logout()}
          className="hover:text-orange-600"
          title="로그아웃"
        >
          로그아웃
        </button>
        <span className="text-gray-300">|</span>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="hover:text-orange-600"
          title="설정"
        >
          설정
        </button>
      </div>

      <nav className="space-y-1">
        {mainMenus.map((item) => (
          <div key={item}>
            {item === "매출/재고" ? (
              <Link
                href="/?menu=sales&salesSection=online"
                onClick={(event) => {
                  if (activeMenu === "매출/재고") {
                    event.preventDefault();
                    setSalesOpen((open) => !open);
                    return;
                  }
                  event.preventDefault();
                  goToInternal("/?menu=sales&salesSection=online");
                }}
                className={`flex h-11 w-full items-center rounded-md px-3 text-left text-sm font-black transition ${
                  item === activeMenu ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item}
              </Link>
            ) : item === "수입관리" ? (
              <Link
                href="/?menu=import"
                onMouseEnter={() => warmImportCache(importPath)}
                onFocus={() => warmImportCache(importPath)}
                onClick={(event) => {
                  warmImportCache(importPath);
                  if (activeMenu === "수입관리") {
                    event.preventDefault();
                    setImportOpen((open) => !open);
                    return;
                  }
                  event.preventDefault();
                  goToInternal("/?menu=import");
                }}
                className={`flex h-11 w-full items-center rounded-md px-3 text-left text-sm font-black transition ${
                  item === activeMenu ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item}
              </Link>
            ) : item === "광고분석" ? (
              <Link
                href="/?menu=ads"
                onClick={(event) => {
                  event.preventDefault();
                  goToInternal("/?menu=ads");
                }}
                className={`flex h-11 w-full items-center rounded-md px-3 text-left text-sm font-black transition ${
                  item === activeMenu ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item}
              </Link>
            ) : (
              <Link
                href={`/?menu=${menuSlugs[item]}`}
                onClick={(event) => {
                  event.preventDefault();
                  goToInternal(`/?menu=${menuSlugs[item]}`);
                }}
                className={`flex h-11 w-full items-center rounded-md px-3 text-left text-sm font-black transition ${
                  item === activeMenu ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item}
              </Link>
            )}
            {item === "매출/재고" && activeMenu === "매출/재고" && salesOpen && (
              <div className="ml-3 mt-1 space-y-1 border-l border-slate-200 pl-3">
                {salesSubMenus.map((sub) => (
                  <Link
                    key={sub.section}
                    href={`/?menu=sales&salesSection=${sub.section}`}
                    onClick={(event) => {
                      event.preventDefault();
                      goToInternal(`/?menu=sales&salesSection=${sub.section}`);
                    }}
                    className={`block rounded-md px-3 py-2 text-xs font-black ${
                      salesSection === sub.section ? "bg-orange-50 text-orange-600" : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {sub.label}
                  </Link>
                ))}
              </div>
            )}
            {item === "수입관리" && activeMenu === "수입관리" && importOpen && (
              <div className="ml-3 mt-2 space-y-2 border-l border-gray-200 pl-4">
                {importSubMenus.map((sub) => (
                  <Link
                    key={sub.path}
                    href={`/?menu=import&section=${encodeURIComponent(sub.path)}`}
                    onMouseEnter={() => warmImportCache(sub.path)}
                    onFocus={() => warmImportCache(sub.path)}
                    onClick={(event) => {
                      event.preventDefault();
                      goToInternal(`/?menu=import&section=${encodeURIComponent(sub.path)}`);
                    }}
                    className={`block py-1.5 text-sm font-semibold transition ${
                      importPath === sub.path ? "text-[#ff6a00]" : "text-gray-500 hover:text-[#c2410c]"
                    }`}
                  >
                    {sub.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="mt-5">
        <CalendarMemo />
      </div>
    </aside>
  );
}

function ToolSection({
  title,
  children,
  defaultOpen = false,
  href,
  showChevron = true,
  iconSrc,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  href?: string;
  showChevron?: boolean;
  iconSrc?: string;
}) {
  return (
    <details className="mb-3 rounded-md border border-slate-200 bg-white" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-md bg-slate-50 px-3 py-3 text-sm font-black [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          {showChevron ? "▼" : ""}
          {iconSrc && <img src={iconSrc} alt="" className="h-4 w-4 rounded-sm object-contain" />}
          <span>{title}</span>
        </span>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-orange-600"
            title="사이트 열기"
          >
            ↗
          </a>
        )}
      </summary>
      <div className="border-t border-slate-100 p-3">{children}</div>
    </details>
  );
}

function AddressBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const displayText = text.replace(/\s*:\s*/g, "\n");

  async function copy() {
    await navigator.clipboard.writeText(displayText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-500 hover:text-orange-600"
      >
        {copied ? "완료" : "복사"}
      </button>
      <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 pr-14 text-xs leading-7 text-slate-700">{displayText}</pre>
    </div>
  );
}

function RightTools() {
  const [lcl, setLcl] = useState({ method: "LCL(월수금)", w: "", d: "", h: "", box: "", origin: false });
  const [lclResult, setLclResult] = useState("CBM을 입력하면 배송비가 계산됩니다.");

  function lclCbm() {
    return (
      (Number(lcl.w) || 0) *
      (Number(lcl.d) || 0) *
      (Number(lcl.h) || 0) *
      (Number(lcl.box) || 0) /
      1000000
    );
  }

  async function calcLcl(next = lcl) {
    const cbm =
      (Number(next.w) || 0) *
      (Number(next.d) || 0) *
      (Number(next.h) || 0) *
      (Number(next.box) || 0) /
      1000000;
    if (!cbm) {
      setLclResult("CBM을 입력하면 배송비가 계산됩니다.");
      return;
    }
    try {
      const res = await fetch(apiUrl(`/api/lcl-fee?method=${encodeURIComponent(next.method)}&cbm=${encodeURIComponent(cbm.toFixed(3))}`), {
        credentials: "include",
      });
      const data = await res.json();
      const originFee = next.origin ? data.origin_certificate : 0;
      const total = data.shipping_fee + originFee + data.bl_charge + data.forwarder_hc + data.cwc_krw;
      const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
      setLclResult([
        `배송방식: ${next.method}`,
        `총 CBM: ${cbm.toFixed(3)}`,
        `해운비: ${won(data.shipping_fee)}`,
        `원산지 증명: ${next.origin ? won(originFee) : "-"}`,
        `BL 차지비: ${won(data.bl_charge)}`,
        `포워더 HC: ${won(data.forwarder_hc)}`,
        `CWC: $${data.cwc_usd} x USD환율 ${Math.round(data.usd_rate).toLocaleString("ko-KR")} = ${won(data.cwc_krw)}`,
        `총 금액: ${won(total)}`,
      ].join("\n"));
    } catch {
      setLclResult("수입관리 서버 연결을 확인해 주세요. localhost:5500이 켜져 있어야 계산됩니다.");
    }
  }

  function updateLcl(patch: Partial<typeof lcl>) {
    const next = { ...lcl, ...patch };
    setLcl(next);
    void calcLcl(next);
  }

  return (
    <aside className="hidden w-[320px] shrink-0 border-l border-gray-200 bg-white px-4 py-6 xl:block">
      <ToolSection title="LCL 배송요금" defaultOpen>
        <select
          value={lcl.method}
          onChange={(event) => updateLcl({ method: event.target.value })}
          className="mb-2 w-full rounded-md border border-slate-200 px-2 py-2 text-xs"
        >
          <option>LCL(월수금)</option>
          <option>LCL(화목일)</option>
        </select>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["w", "가로 cm"],
            ["d", "세로 cm"],
            ["h", "높이 cm"],
            ["box", "박스 수"],
          ].map(([key, label]) => (
            <input
              key={key}
              value={lcl[key as "w" | "d" | "h" | "box"]}
              onChange={(event) => updateLcl({ [key]: event.target.value })}
              className="rounded-md border border-slate-200 px-2 py-2 text-xs"
              placeholder={label}
              type="number"
            />
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={lcl.origin} onChange={(event) => updateLcl({ origin: event.target.checked })} />
          원산지 증명
        </label>
        <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">총 CBM {lclCbm().toFixed(3)}</div>
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">{lclResult}</pre>
      </ToolSection>

      <ToolSection title="타배 위해 주소" href="https://www.tabae.co.kr/" showChevron={false} iconSrc="https://www.google.com/s2/favicons?domain=tabae.co.kr&sz=32">
        <AddressBlock
          text={`우편번호(邮政编码) : 264205

성(省) : 山东省

시(市) : 威海市

상세주소(详细地址) : 环翠区凤林街道

나의사서함번호 : 梧桐路南500米景和光
电院内2号仓库/TB77624

연락처(联系方式) : 18563144074`}
        />
      </ToolSection>

      <ToolSection title="짐패스 도쿄(항공) 주소" href="https://www.jimpass.com/" showChevron={false} iconSrc="https://www.google.com/s2/favicons?domain=jimpass.com&sz=32">
        <AddressBlock
          text={`우편번호 (郵便番号) : 103-0015

도도부현 (都道府県) : 東京都

시구, 번지 (住所1) : 中央区日本橋箱崎町44-7

그밖의 주소(住所2) : 4階 JK65203

전화번호 (電話番号) : 03-3527-3876`}
        />
      </ToolSection>

      <ToolSection title="FN 영문주소" showChevron={false} iconSrc="/F&.jpg">
        <AddressBlock
          text={`FN(KIM JAEWOOK)

FNcompany 42-19, Baegok-daero 2101beon-gil, Mohyeon-eup
Cheoin-gu Yongin-si, Gyeonggi-do, Republic of Korea

postcode 17037
Phone (+82), 1033748934`}
        />
      </ToolSection>
    </aside>
  );
}

type ImportOrder = {
  id: number;
  order_code?: string;
  order_date?: string;
  paid_date?: string;
  fn_arrived?: string;
  factory_id?: number;
  factory_name?: string;
  repr_product?: string;
  repr_image?: string;
  line_count?: number;
  child_count?: number;
  attachment_count?: number;
  total_qty?: number;
  total_won?: number;
  status?: string;
  platform?: string;
  currency?: string;
  fx_rate?: number;
  payment_method?: string;
  first_payment_date?: string;
  factory_ship_date?: string;
  badaeji_arrived?: string;
  customs_cleared?: string;
  shipping_method?: string;
  fn_arrival_method?: string;
  production_days?: number | string | null;
  production_due_date?: string | null;
  production_memo?: string | null;
  actual_payment_usd?: number | string | null;
  actual_payment_usd_1?: number | string | null;
  actual_payment_usd_2?: number | string | null;
  actual_payment_currency?: string | null;
  actual_payment_1?: number | string | null;
  actual_payment_2?: number | string | null;
  actual_payment_total?: number | string | null;
  actual_payment_total_krw?: number | string | null;
  china_domestic_shipping?: number;
  china_fee?: number;
  china_other_cost?: number;
  china_other_note?: string;
  china_cost_currency?: string;
  shipping_cost?: number;
  customs_duty?: number;
  vat?: number;
  customs_fee?: number;
  inspection_fee?: number;
  domestic_shipping_cost?: number;
  other_cost?: number;
  note?: string;
};

type StageValues = Record<string, string>;

type ImportProduct = {
  id: number;
  name: string;
  factory_id?: number;
  factory_name?: string;
  image_path?: string;
  options?: string;
  std_price?: number;
  currency?: string;
  status?: string;
  product_url?: string;
  shipping_address?: string;
  hs_code?: string;
  basic_rate?: number;
  fta_rate?: number;
  moq?: number;
  note?: string;
  item_type?: string;
  material_cost?: number;
  material_unit_cost?: number;
  material_display_cost?: number;
  material_safe_qty?: number;
  material_initial_qty?: number;
  material_note?: string;
  material_stock_adjust?: number;
  material_stock?: number;
  material_incoming?: number;
  material_consumed?: number;
  materials?: ProductMaterialLink[];
  linked_products?: MaterialProductLink[];
};

type FnProduct = {
  id: string;
  product_id?: string;
  sku?: string;
  product_code?: string;
  product_name?: string;
  option_name?: string;
  image_url?: string;
  current_stock?: number;
  available_stock?: number;
  standard_price?: number;
  cost_price?: number;
  currency?: string;
  inventory?: ProductInventoryRow[];
  bom?: ProductBomRow[];
  import_links?: ProductImportLinkRow[];
  product_attribute?: ProductAttribute;
  product_attribute_label?: string;
  product_kind?: ProductAttribute;
};

type ProductInventoryRow = {
  id?: string;
  warehouse_id?: string;
  warehouse_code?: string;
  warehouse_name?: string;
  qty?: number;
  available_qty?: number;
};

type WarehouseOption = {
  id?: string;
  warehouse_code: string;
  warehouse_name: string;
};

type FnWarehouse = WarehouseOption & {
  warehouse_type?: string;
  warehouse_type_label?: string;
  memo?: string;
  stock_product_count?: number;
  is_active?: boolean;
};

type ProductBomRow = {
  id?: string;
  bom_id?: string;
  component_product_id: string;
  component_sku?: string;
  component_product_code?: string;
  component_product_name?: string;
  qty_per_unit: number;
};

type ProductImportLinkRow = {
  id?: string;
  import_product_id?: string;
  import_product_name?: string;
  import_option_name?: string;
  default_qty?: number;
  default_ratio?: number;
};

type FnCustomer = {
  id?: string;
  customer_code?: string;
  cust_code?: string;
  customer_name?: string;
  cust_name?: string;
  customer_type?: string;
  customer_type_label?: string;
  business_no?: string;
  ceo_name?: string;
  contact_name?: string;
  phone?: string;
  payment_terms?: string;
  memo?: string;
  is_active?: boolean;
};

type SalesChannelDraft = Record<string, string>;

type SalesChannelCredentialMeta = {
  key: string;
  hint?: string;
  has_value?: boolean;
  is_secret?: boolean;
};

type SalesChannelRow = {
  id?: string;
  channel_code?: string;
  channel_name?: string;
  seller_id?: string;
  customer_id?: string;
  customer_code?: string;
  customer_name?: string;
  seller_site_url?: string;
  api_enabled?: boolean;
  api_status?: string;
  credentials?: SalesChannelCredentialMeta[];
};

type ProductRelationFilter = "plain" | "set" | "rg" | "import" | "all";
type ProductAttribute = "plain" | "set" | "rg";
type CustomerRelationFilter = "general" | "shopping" | "all";
type CustomerAttribute = "general" | "shopping";
type WarehouseAttribute = "general" | "fulfillment";
type ProductBulkField = "product_attribute" | "cost_price" | "standard_price";
type CustomerBulkField = "customer_type" | "business_no" | "contact_name" | "phone" | "memo";
type WarehouseBulkField = "warehouse_type" | "warehouse_address" | "warehouse_phone" | "manager_name" | "manager_phone" | "manager_memo" | "memo";

const salesChannelCredentialKeys = [
  "seller_password",
  "api_client_id",
  "api_client_secret",
  "access_key",
  "secret_key",
  "refresh_token",
] as const;

const salesChannelCredentialLabels: Record<(typeof salesChannelCredentialKeys)[number], string> = {
  seller_password: "seller_password",
  api_client_id: "api_client_id",
  api_client_secret: "api_client_secret",
  access_key: "access_key",
  secret_key: "secret_key",
  refresh_token: "refresh_token",
};

function blankSalesChannelDraft(customer?: Record<string, string>): SalesChannelDraft {
  const code = String(customer?.customer_code || "").trim().toUpperCase();
  const name = String(customer?.customer_name || "").trim();
  return {
    id: "",
    channel_code: code,
    channel_name: name,
    seller_id: "",
    seller_site_url: "",
    api_enabled: "false",
    api_status: "manual",
  };
}

function normalizeSalesChannelDraft(channel: SalesChannelRow | null | undefined, customer?: Record<string, string>): SalesChannelDraft {
  return {
    ...blankSalesChannelDraft(customer),
    id: String(channel?.id || ""),
    channel_code: String(channel?.channel_code || customer?.customer_code || "").trim().toUpperCase(),
    channel_name: String(channel?.channel_name || customer?.customer_name || "").trim(),
    seller_id: String(channel?.seller_id || ""),
    seller_site_url: String(channel?.seller_site_url || ""),
    api_enabled: channel?.api_enabled ? "true" : "false",
    api_status: String(channel?.api_status || "manual"),
  };
}

function blankSalesChannelCredentials() {
  return Object.fromEntries(salesChannelCredentialKeys.map((key) => [key, ""])) as Record<(typeof salesChannelCredentialKeys)[number], string>;
}

function normalizeCustomerAttribute(value: unknown, fallback: CustomerAttribute = "general"): CustomerAttribute {
  const textValue = String(value || "").trim().toLowerCase();
  if (["shopping", "mall", "shop", "쇼핑몰"].includes(textValue)) return "shopping";
  return fallback;
}

function customerAttributeLabel(value: unknown) {
  return normalizeCustomerAttribute(value) === "shopping" ? "쇼핑몰" : "일반";
}

function normalizeWarehouseAttribute(value: unknown): WarehouseAttribute {
  const textValue = String(value || "").trim().toLowerCase();
  if (["fulfillment", "풀필먼트", "3pl", "쿠팡", "네이버", "n배송", "rocket"].includes(textValue)) return "fulfillment";
  return "general";
}

function warehouseAttributeLabel(value: unknown) {
  return normalizeWarehouseAttribute(value) === "fulfillment" ? "풀필먼트" : "일반";
}

function formatBusinessNoInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function normalizeProductAttribute(value: unknown, fallback: ProductAttribute = "plain"): ProductAttribute {
  const textValue = String(value || "").trim().toUpperCase();
  if (!textValue) return fallback;
  if (textValue === "PLAIN" || textValue === "일반") return "plain";
  if (textValue === "SET" || textValue === "세트" || textValue === "NG" || textValue.includes("[NG")) return "set";
  if (textValue === "RG" || textValue === "로켓그로스") return "rg";
  return fallback;
}

function productAttributeFromName(value: unknown): ProductAttribute {
  const textValue = String(value || "").toUpperCase();
  if (/\[SET[\]\}]/.test(textValue)) return "set";
  if (/\[RG[\]\}]/.test(textValue)) return "rg";
  if (/\[NG[\]\}]/.test(textValue)) return "set";
  return "plain";
}

function productAttributeOf(product: Partial<FnProduct>): ProductAttribute {
  return normalizeProductAttribute(product.product_attribute ?? product.product_kind, productAttributeFromName(product.product_name));
}

function productAttributeLabel(attribute: unknown) {
  const normalized = normalizeProductAttribute(attribute);
  if (normalized === "set") return "SET";
  if (normalized === "rg") return "RG";
  return "일반";
}

function productNameWithAttribute(name: string, attribute: unknown) {
  const normalized = normalizeProductAttribute(attribute);
  const baseName = String(name || "").replace(/^\s*\[(RG|SET|NG|NS)[\]\}]\s*/i, "").trim();
  if (normalized === "rg") return `[RG]${baseName}`;
  if (normalized === "set") return `[SET]${baseName}`;
  return baseName;
}

function relatedProductSearchQuery(name: unknown) {
  const baseName = String(name || "")
    .replace(/^\s*\[(RG|SET|NG|NS)[\]\}]\s*/i, "")
    .replace(/\b\d+\s*개\b/gi, "")
    .replace(/[()/_-]/g, " ")
    .trim();
  const tokens = baseName.split(/\s+/).filter((token) => token.length >= 2 && !/^\d+$/.test(token));
  return tokens.slice(0, 4).join(" ");
}

function sortWarehousesByCode(a: WarehouseOption, b: WarehouseOption) {
  return String(a.warehouse_code || "").localeCompare(String(b.warehouse_code || ""), "ko-KR", { numeric: true });
}

function isUsableWarehouse(warehouse: WarehouseOption) {
  const code = String(warehouse.warehouse_code || "").trim();
  const name = String(warehouse.warehouse_name || "").trim();
  if (!code || !name) return false;
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(code) || /^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(name)) return false;
  if (/오전|오후|AM|PM/i.test(code) || /오전|오후|AM|PM/i.test(name)) return false;
  return true;
}

type ImportSkuLink = {
  id?: string;
  import_product_id?: number;
  product_id: string;
  sku?: string;
  option_name?: string;
  group_label?: string;
  import_option_key?: string;
  import_option_name?: string;
  match_group_label?: string;
  variant_label?: string;
  sort_order?: number;
  default_ratio?: number;
  default_qty?: number;
  is_primary?: boolean;
  memo?: string;
  product?: FnProduct | null;
};

type ImportBomStatus = {
  product_id: string;
  sku?: string;
  product_name?: string;
  has_bom?: boolean;
  components?: Array<{ component?: FnProduct | null; component_sku?: string; qty_per_unit?: number; shortage?: boolean }>;
  shortage?: boolean;
  status?: string;
};

type ProductMaterialLink = {
  material_id: number;
  material_name?: string;
  quantity_per_unit: number;
  qty_per_product?: number;
  material_stock?: number;
  material_cost?: number;
  material_unit_cost?: number;
};

type MaterialProductLink = {
  product_id: number;
  product_name?: string;
  quantity_per_unit: number;
  qty_per_product?: number;
};

type ImportFactory = {
  id: number;
  name: string;
  country?: string;
  platform?: string;
  contact?: string;
  note?: string;
  product_count?: number;
  order_count?: number;
};

type ImportFormData = {
  rates: Record<string, number>;
  factories: ImportFactory[];
  products: ImportProduct[];
  materials?: ImportProduct[];
};

function fnProductSku(product?: FnProduct | null) {
  return product?.sku || product?.product_code || product?.id || "-";
}

function fnProductName(product?: FnProduct | null) {
  return product?.product_name || "-";
}

function fnProductOption(product?: FnProduct | null) {
  return product?.option_name || "-";
}

function fnProductPrice(product?: FnProduct | null) {
  return Number(product?.cost_price || product?.standard_price || 0);
}

function importOptionList(value?: string) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function linkOptionName(link?: ImportSkuLink | null) {
  return String(link?.option_name || link?.import_option_name || link?.import_option_key || "").trim();
}

function linkVariantLabel(link?: ImportSkuLink | null) {
  return String(link?.variant_label || link?.memo || "").trim();
}

function sameImportOption(link: ImportSkuLink, optionName: string) {
  return linkOptionName(link) === String(optionName || "").trim();
}

type OrderLine = {
  product_id: string;
  product_name: string;
  option_value: string;
  quantity: string;
  unit_price: string;
  item_currency: string;
  line_note: string;
  image_path?: string;
  item_type?: string;
  materials?: ProductMaterialLink[];
};

type ImportOrderItem = {
  id?: number;
  product_id?: number | string;
  product_name?: string;
  option_value?: string;
  quantity?: string | number;
  unit_price?: string | number;
  item_currency?: string;
  line_note?: string;
  image_path?: string;
  item_type?: string;
  materials?: ProductMaterialLink[];
};

type ImportOrderDetail = {
  ok: boolean;
  order: ImportOrder;
  items: ImportOrderItem[];
  children?: ImportOrder[];
  attachments?: OrderAttachment[];
  margin?: { coupang_price?: number; naver_price?: number; naver_free_shipping?: boolean | number } | null;
  fx_rates?: Record<string, number>;
  native_totals?: Record<string, number>;
  product_won?: number;
  material_unit_cost_total?: number;
  cost_grid?: CostGrid;
  children_total_won?: number;
  unit_cost?: number;
  total_won?: number;
  total_qty?: number;
};

type ActualPaymentCurrency = "KRW" | "USD" | "CNY";

type CostGridRow = {
  order_item_id?: number;
  option_name?: string;
  product_name?: string;
  quantity?: number;
  item_type?: string;
  item_currency?: string;
  unit_price?: number;
  cost_ratio?: number;
  unit_china_extra_cost?: number;
  unit_payment_adjustment?: number;
  unit_extra_cost?: number;
  material_unit_cost?: number;
  estimated_unit_cost?: number;
  coupang_free_price?: number | null;
  naver_free_price?: number | null;
  naver_cod_price?: number | null;
  coupang_margin?: { amount?: number | null; pct?: number | null };
  naver_free_margin?: { amount?: number | null; pct?: number | null };
  naver_cod_margin?: { amount?: number | null; pct?: number | null };
  material_only?: boolean;
};

type CostGrid = {
  rows?: CostGridRow[];
  china_extra_cost?: number;
  korea_extra_cost?: number;
  total_extra_cost?: number;
  product_base_total?: number;
  goods_total_won?: number;
  converted_order_total_won?: number;
  actual_payment_won?: number;
  payment_delta_won?: number;
  costing_base_won?: number;
  total_won?: number;
};

type ImportProductDetail = {
  ok: boolean;
  product: ImportProduct;
  materials?: ProductMaterialLink[];
  history: Array<{ id: number; order_code?: string; order_date?: string; paid_date?: string; factory?: string; quantity?: number; unit_price?: number; item_currency?: string; status?: string }>;
};

type OrderAttachment = {
  id: number;
  order_id?: number;
  file_name?: string;
  file_path?: string;
  file_url?: string;
  doc_type?: string;
  note?: string;
  file_size?: number;
  mime_type?: string;
  uploaded_at?: string;
};

type SalesInventorySummary = {
  ok?: boolean;
  error?: string;
  today_sales?: number;
  month_sales?: number;
  today_qty?: number;
  month_purchase_amount?: number;
  inventory_risk_count?: number;
  sync_fail_count?: number;
  recent_sales?: Array<Record<string, unknown>>;
  sales_by_date?: Array<Record<string, unknown>>;
  sales_by_customer?: Array<Record<string, unknown>>;
  sales_by_product?: Array<Record<string, unknown>>;
  recent_purchases?: Array<Record<string, unknown>>;
  recent_orders?: Array<Record<string, unknown>>;
  recent_order_items?: Array<Record<string, unknown>>;
  recent_shipments?: Array<Record<string, unknown>>;
  recent_inventory_movements?: Array<Record<string, unknown>>;
  sales_channels?: Array<Record<string, unknown>>;
  purchases_by_customer?: Array<Record<string, unknown>>;
  purchases_by_product?: Array<Record<string, unknown>>;
  inventory?: Array<Record<string, unknown>>;
  logs?: Array<Record<string, unknown>>;
};

function apiUrl(path: string) {
  if (path.startsWith("/api/fnos/")) return path;
  return `/api/import-erp${path}`;
}

function needsImportErpServer(path: string) {
  return !path.startsWith("/api/fnos/");
}

const DEFAULT_CACHE_TTL = 45_000;
let importErpEnsurePromise: Promise<unknown> | null = null;
let importErpLastEnsuredAt = 0;

function ensureImportErpServer(force = false) {
  const now = Date.now();
  if (!force && now - importErpLastEnsuredAt < 20_000) return Promise.resolve();
  if (importErpEnsurePromise) return importErpEnsurePromise;
  importErpEnsurePromise = fetch("/api/fnos/import-erp/ensure", { method: "POST", cache: "no-store" })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 202) throw new Error(data.error || `HTTP ${res.status}`);
      importErpLastEnsuredAt = Date.now();
      return data;
    })
    .finally(() => {
      importErpEnsurePromise = null;
    });
  return importErpEnsurePromise;
}

function cachedJson<T>(path: string, ttl = DEFAULT_CACHE_TTL): Promise<T> {
  const key = apiUrl(path);
  const force = ttl <= 0;
  return (needsImportErpServer(path) ? ensureImportErpServer().catch(() => undefined) : Promise.resolve())
    .then(() => cachedClientJson<T>(key, { ttl, storageTtl: force ? 0 : Math.max(ttl, 5 * 60_000), force }));
}

function readImportCache<T>(path: string, maxAge = 5 * 60_000) {
  return readCachedJson<T>(apiUrl(path), { storageTtl: maxAge });
}

function invalidateApiCache(match?: string) {
  if (!match) {
    invalidateClientCache();
    return;
  }
  const needle = apiUrl(match);
  invalidateClientCache(needle);
  if (needle !== match) invalidateClientCache(match);
}

function warmImportCache(section?: string) {
  if (!section || section === "/orders") {
    void cachedJson("/api/fnos/orders", 30_000).catch(() => undefined);
  }
  if (!section || section === "/products") {
    void cachedJson("/api/fnos/products", 60_000).catch(() => undefined);
  }
  if (!section || section === "/settings") {
    void cachedJson("/api/fnos/settings", 60_000).catch(() => undefined);
  }
  if (section?.startsWith("/orders/new") || section?.startsWith("/products/new")) {
    void cachedJson("/api/fnos/form-data", 60_000).catch(() => undefined);
  }
}

function importHref(path: string) {
  return `/?menu=import&section=${encodeURIComponent(path)}`;
}

function assetUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("data:image/")) return path;
  return `/api/import-erp/static/${path.replace(/^\/?static\//, "")}`;
}

function sortFactories(factories?: ImportFactory[]) {
  return [...(factories || [])].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko-KR"));
}

function isMaterial(product?: ImportProduct | null) {
  return String(product?.item_type || "").toUpperCase() === "MATERIAL";
}

function isMaterialOrderLine(line: Pick<OrderLine, "item_type">) {
  return String(line.item_type || "").toUpperCase() === "MATERIAL";
}

function savableOrderLine(line: OrderLine) {
  if (!line.product_name) return false;
  if (isMaterialOrderLine(line)) return true;
  return Boolean(line.quantity && line.unit_price);
}

function isMaterialItem(item?: ImportOrderItem | null) {
  return String(item?.item_type || "").toUpperCase() === "MATERIAL";
}

function isProductItem(item?: ImportOrderItem | null) {
  return String(item?.item_type || "").toUpperCase() === "PRODUCT";
}

function orderItemFxRate(item: ImportOrderItem, detail: ImportOrderDetail) {
  const currency = item.item_currency || detail.order.currency || "CNY";
  return Number(detail.fx_rates?.[currency] || (currency === detail.order.currency ? detail.order.fx_rate : 0) || 1);
}

function materialOnlyRows(detail: ImportOrderDetail, totalWon: number) {
  const items = (detail.items || []).filter((item) => Number(item.quantity || 0) > 0);
  if (!items.length) return [];
  const hasExplicitProduct = items.some((item) => isProductItem(item));
  const allExplicitMaterial = items.every((item) => isMaterialItem(item));
  const hasProductCostRows = Boolean(detail.cost_grid?.rows?.length);
  if (!allExplicitMaterial && (hasExplicitProduct || hasProductCostRows)) return [];
  const baseAmounts = items.map((item) => Number(item.quantity || 0) * Number(item.unit_price || 0) * orderItemFxRate(item, detail));
  const baseTotal = baseAmounts.reduce((sum, value) => sum + value, 0);
  const totalQty = items.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  return items.map((item, index) => {
    const qty = Number(item.quantity || 0);
    const ratio = baseTotal > 0 ? baseAmounts[index] / baseTotal : qty / Math.max(1, totalQty);
    return {
      order_item_id: Number(item.id || index + 1),
      option_name: item.option_value || item.product_name || "부자재",
      product_name: item.product_name || "부자재",
      quantity: qty,
      estimated_unit_cost: qty > 0 ? (totalWon * ratio) / qty : 0,
      material_only: true,
    };
  });
}

function materialOnlyCostSummary(detail: ImportOrderDetail, totalWon: number) {
  const rows = materialOnlyRows(detail, totalWon);
  if (!rows.length) return { cardUnitCost: null as number | null, gridRows: [] as CostGridRow[] };
  const distinctCosts = new Set(rows.map((row) => Math.round(Number(row.estimated_unit_cost || 0) * 100)));
  const totalQty = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  if (rows.length === 1 || distinctCosts.size <= 1) {
    return { cardUnitCost: totalQty > 0 ? totalWon / totalQty : null, gridRows: [] as CostGridRow[] };
  }
  return { cardUnitCost: null as number | null, gridRows: rows };
}

function materialSummary(materials?: ProductMaterialLink[]) {
  if (!materials?.length) return "";
  return materials.map((item) => `${item.material_name || "부자재"} ${Number(item.quantity_per_unit || 1).toLocaleString("ko-KR")}`).join(", ");
}

function materialNeedSummary(materials: ProductMaterialLink[] | undefined, quantity: string | number) {
  const qty = Number(quantity || 0);
  if (!materials?.length || !qty) return "";
  return materials
    .map((item) => {
      const need = qty * Number(item.qty_per_product || item.quantity_per_unit || 1);
      const stock = Number(item.material_stock || 0);
      const shortage = need - stock;
      return shortage > 0
        ? `${item.material_name || "부자재"} ${need.toLocaleString("ko-KR")}개 사용 예정, ${shortage.toLocaleString("ko-KR")}개 부족`
        : `${item.material_name || "부자재"} ${need.toLocaleString("ko-KR")}개 사용 예정`;
    })
    .join(", ");
}

function hasMaterialShortage(materials: ProductMaterialLink[] | undefined, quantity: string | number) {
  const qty = Number(quantity || 0);
  return Boolean(materials?.some((item) => qty * Number(item.qty_per_product || item.quantity_per_unit || 1) > Number(item.material_stock || 0)));
}

function krw(value?: number) {
  return `₩${Math.round(value || 0).toLocaleString("ko-KR")}`;
}

function fileSize(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString("ko-KR")}KB`;
  return `${bytes.toLocaleString("ko-KR")}B`;
}

function fileIconType(name?: string) {
  const ext = (name || "").split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext || "")) return "image";
  if (["xlsx", "xls", "xlsm", "csv"].includes(ext || "")) return "sheet";
  if (["doc", "docx"].includes(ext || "")) return "doc";
  return "file";
}

function isExcelAttachment(item: OrderAttachment) {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(item.file_name || "");
}

function FileTypeIcon({ name }: { name?: string }) {
  const type = fileIconType(name);
  const color = type === "pdf" ? "text-rose-600" : type === "image" ? "text-sky-600" : type === "sheet" ? "text-emerald-600" : type === "doc" ? "text-blue-600" : "text-slate-500";
  const letter = type === "pdf" ? "P" : type === "image" ? "J" : type === "sheet" ? "X" : type === "doc" ? "D" : "F";
  return (
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center ${color}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
        <path d="M14 3v5h5" />
        <text x="12" y="17" textAnchor="middle" className="fill-current stroke-0 text-[12px] font-black">{letter}</text>
      </svg>
    </span>
  );
}

function attachmentViewerUrl(item: OrderAttachment) {
  if (!item.file_url) return "";
  const params = new URLSearchParams({
    url: item.file_url,
    name: item.file_name || "첨부파일",
  });
  return `/attachment-viewer?${params.toString()}`;
}

async function openAttachment(item: OrderAttachment) {
  if (isExcelAttachment(item)) {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (popup) {
      popup.document.write("<title>Google Sheets 열기</title><p style=\"font-family:Arial,sans-serif;padding:24px\">Google Sheets로 여는 중입니다...</p>");
    }
    try {
      const res = await fetch("/api/google/attachment-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachmentId: item.id,
          fileName: item.file_name,
          fileUrl: item.file_url,
          mimeType: item.mime_type,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.url) throw new Error(data.error || "Google Sheets로 열 수 없습니다.");
      if (popup) popup.location.href = data.url;
      else window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      popup?.close();
      alert(error instanceof Error ? error.message : "Google Sheets로 열 수 없습니다.");
    }
    return;
  }
  const url = attachmentViewerUrl(item);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

function fmtPct(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)}%`;
}

function getStageFields(paymentMethod?: string) {
  if (paymentMethod === "T/T송금" || paymentMethod === "TT송금") {
    return [
      { label: "주문", name: "order_date" },
      { label: "1차결제", name: "first_payment_date" },
      { label: "2차결제", name: "paid_date" },
      { label: "공장출고", name: "factory_ship_date" },
      { label: "배대지도착", name: "badaeji_arrived" },
      { label: "통관완료", name: "customs_cleared" },
      { label: "FN입고", name: "fn_arrived" },
    ];
  }
  return [
    { label: "주문", name: "order_date" },
    { label: "결제완료", name: "paid_date" },
    { label: "공장출고", name: "factory_ship_date" },
    { label: "배대지도착", name: "badaeji_arrived" },
    { label: "통관완료", name: "customs_cleared" },
    { label: "FN입고", name: "fn_arrived" },
  ];
}

function stageValuesFromOrder(order?: ImportOrder | null): StageValues {
  return {
    order_date: order ? (order.order_date || "") : formatDateKey(new Date()),
    first_payment_date: order?.first_payment_date || "",
    paid_date: order?.paid_date || "",
    factory_ship_date: order?.factory_ship_date || "",
    badaeji_arrived: order?.badaeji_arrived || "",
    customs_cleared: order?.customs_cleared || "",
    fn_arrived: order?.fn_arrived || "",
  };
}

function orderExtraCost(order?: ImportOrder | null) {
  return ["shipping_cost", "customs_duty", "vat", "customs_fee", "inspection_fee", "domestic_shipping_cost", "other_cost"]
    .reduce((sum, key) => sum + Number(order?.[key as keyof ImportOrder] || 0), 0);
}

function isTTPayment(paymentMethod?: string) {
  return Boolean(paymentMethod?.includes("T/T") || paymentMethod?.includes("TT"));
}

function actualUsdTotal(order?: ImportOrder | null) {
  const first = Number(order?.actual_payment_usd_1 || 0);
  const second = Number(order?.actual_payment_usd_2 || 0);
  if (first || second) return first + second;
  return Number(order?.actual_payment_usd || 0);
}

function actualPaymentCurrency(order?: ImportOrder | null) {
  const currency = String(order?.actual_payment_currency || (actualUsdTotal(order) > 0 ? "USD" : "KRW")).toUpperCase();
  return (["KRW", "USD", "CNY"].includes(currency) ? currency : "KRW") as ActualPaymentCurrency;
}

function actualPaymentWon(amount: number, currency: ActualPaymentCurrency, rates?: Record<string, number>) {
  if (!amount) return 0;
  return currency === "KRW" ? amount : amount * Number(rates?.[currency] || 0);
}

function actualPaymentFirst(order?: ImportOrder | null) {
  return order?.actual_payment_1 != null ? String(order.actual_payment_1) : (order?.actual_payment_usd_1 != null ? String(order.actual_payment_usd_1) : "");
}

function actualPaymentSecond(order?: ImportOrder | null) {
  return order?.actual_payment_2 != null ? String(order.actual_payment_2) : (order?.actual_payment_usd_2 != null ? String(order.actual_payment_usd_2) : "");
}

function actualPaymentSingle(order?: ImportOrder | null) {
  return order?.actual_payment_total != null ? String(order.actual_payment_total) : (order?.actual_payment_usd != null ? String(order.actual_payment_usd) : "");
}

function nativeTotalText(totals?: Record<string, number>, fallbackCurrency = "CNY") {
  const entries = Object.entries(totals || {});
  if (!entries.length) return `0 ${fallbackCurrency}`;
  return entries
    .map(([currency, amount]) => `${Number(amount || 0).toLocaleString("ko-KR", { maximumFractionDigits: currency === "KRW" ? 0 : 2 })} ${currency}`)
    .join(" + ");
}

function nativeAmountText(value: number, currency: string) {
  return `${Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: currency === "KRW" ? 0 : 2 })} ${currency}`;
}

function rateNoteText(rates?: Record<string, number>, currencies: string[] = []) {
  const ordered = Array.from(new Set([...currencies, "CNY", "USD"].filter(Boolean)));
  return ordered.map((currency) => `${currency}=₩${Number(rates?.[currency] || (currency === "KRW" ? 1 : 0)).toLocaleString("ko-KR")}`).join(" · ");
}

function parseLocalDate(value?: string | null) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function productionDueText(order: ImportOrder) {
  if (String(order.fn_arrived || "").trim()) return "-";
  const days = Number(order.production_days || 0);
  const base = parseLocalDate(order.order_date);
  const due = base ? new Date(base) : parseLocalDate(order.production_due_date);
  if (!due || (!days && !order.production_due_date)) return "-";
  if (base && days) due.setDate(base.getDate() + days);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return "D-Day";
  return "-";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyStageDateLane({ paymentMethod, values, onChange }: { paymentMethod?: string; values: StageValues; onChange: (name: string, value: string) => void }) {
  const [openStage, setOpenStage] = useState("");
  return (
    <div className="grid gap-3 md:grid-cols-3 2xl:grid-cols-6">
      {getStageFields(paymentMethod).map((stage, index) => {
        const value = values[stage.name] || "";
        const done = Boolean(value);
        return (
          <div key={stage.name} className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-center">
            <button type="button" className={`mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full text-xl font-black ${done || index === 0 ? "bg-emerald-500 text-white" : "border-2 border-slate-300 text-slate-500"}`} onClick={() => setOpenStage((prev) => prev === stage.name ? "" : stage.name)}>
              {done || index === 0 ? "✓" : "+"}
            </button>
            <strong className="text-sm">{stage.label}</strong>
            <button type="button" className="text-xs font-bold text-slate-500" onClick={() => setOpenStage(stage.name)}>{value || "날짜 선택"}</button>
            {openStage === stage.name && <input className="field-input" type="date" value={value} onChange={(event) => onChange(stage.name, event.target.value)} />}
          </div>
        );
      })}
    </div>
  );
}

function StageProgressLane({ paymentMethod, values, onChange }: { paymentMethod?: string; values: StageValues; onChange: (name: string, value: string) => void }) {
  const [openStage, setOpenStage] = useState("");
  const stages = getStageFields(paymentMethod);

  return (
    <div className="relative px-3 pb-1 pt-4">
      <div className="absolute left-8 right-8 top-[35px] h-px bg-slate-200" />
      <div className="relative grid gap-3" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((stage, index) => {
          const value = values[stage.name] || "";
          const done = Boolean(value);
          return (
            <div key={stage.name} className="grid justify-items-center gap-2 text-center">
              <button
                type="button"
                className={`relative z-10 inline-flex h-12 w-12 items-center justify-center rounded-full text-xl font-black transition ${done ? "bg-emerald-500 text-white" : "border-2 border-slate-300 bg-white text-slate-500 hover:border-orange-300"}`}
                onClick={() => {
                  if (done && stage.name !== "order_date") {
                    onChange(stage.name, "");
                    setOpenStage("");
                    return;
                  }
                  setOpenStage((prev) => prev === stage.name ? "" : stage.name);
                }}
              >
                {done ? "✓" : "+"}
              </button>
              <strong className="text-sm">{stage.label}</strong>
              <button type="button" className="text-xs font-bold text-slate-500" onClick={() => setOpenStage(stage.name)}>
                {value || "날짜 선택"}
              </button>
              {openStage === stage.name && (
                <input
                  className="field-input relative z-30 h-9 w-[112px] max-w-full px-2 text-xs"
                  type="date"
                  value={value}
                  onClick={(event) => {
                    event.stopPropagation();
                    event.currentTarget.showPicker?.();
                  }}
                  onFocus={(event) => event.currentTarget.showPicker?.()}
                  onChange={(event) => onChange(stage.name, event.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NativeImportDashboard({ compact = false }: { compact?: boolean }) {
  const [recent, setRecent] = useState<ImportOrder[]>([]);
  const [monthly, setMonthly] = useState<Array<{ month: string; cnt: number; amount: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const cachedDashboard = readImportCache<{ recent?: ImportOrder[]; monthly?: Array<{ month: string; cnt: number; amount: number }> }>("/api/fnos/dashboard");
    if (cachedDashboard) {
      setRecent(cachedDashboard.recent || []);
      setMonthly(cachedDashboard.monthly || []);
      setLoading(false);
    }
    cachedJson<{ recent?: ImportOrder[]; monthly?: Array<{ month: string; cnt: number; amount: number }> }>("/api/fnos/dashboard")
      .then((data) => {
        if (!alive) return;
        setRecent(data.recent || []);
        setMonthly(data.monthly || []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Panel title="수입제품 현황"><p className="text-sm text-slate-500">수입관리 데이터를 불러오는 중...</p></Panel>;

  return (
    <div className={`grid gap-4 ${compact ? "xl:grid-cols-[1fr_320px]" : "2xl:grid-cols-[1fr_360px]"}`}>
      <Panel title="최근 발주" subtitle="수입관리 데이터 원장 기준 최근 5건">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="py-2">주문날짜</th>
                <th className="py-2">대표 제품</th>
                <th className="py-2">공장</th>
                <th className="py-2 text-right">수량</th>
                <th className="py-2 text-right">금액(원)</th>
                <th className="py-2 text-right">출고예정</th>
                <th className="py-2 text-center">상태</th>
              </tr>
            </thead>
            <tbody>
              {recent.slice(0, 5).map((order) => (
                <tr key={order.id} className="border-b border-slate-100 hover:bg-orange-50">
                  <td className="py-3 font-bold"><Link className="block" href={importHref(`/orders?open=${order.id}`)}>{order.order_date || order.paid_date || "-"}</Link></td>
                  <td className="py-3">
                    <Link className="flex items-center gap-3" href={importHref(`/orders?open=${order.id}`)}>
                      {order.repr_image ? (
                        <img src={assetUrl(order.repr_image)} alt="" className="h-10 w-10 rounded-md object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-slate-100" />
                      )}
                      <div>
                        <div className="font-black">{order.repr_product || "제품 라인 없음"}</div>
                        {(order.line_count || 0) > 1 && <div className="text-xs text-slate-500">외 {(order.line_count || 1) - 1}건</div>}
                      </div>
                    </Link>
                  </td>
                  <td className="py-3"><Link className="block" href={importHref(`/orders?open=${order.id}`)}>{order.factory_name || "-"}</Link></td>
                  <td className="py-3 text-right"><Link className="block" href={importHref(`/orders?open=${order.id}`)}>{Math.round(order.total_qty || 0).toLocaleString("ko-KR")}</Link></td>
                  <td className="py-3 text-right font-black"><Link className="block" href={importHref(`/orders?open=${order.id}`)}>{krw(order.total_won)}</Link></td>
                  <td className="py-3 text-right font-black text-orange-600"><Link className="block" href={importHref(`/orders?open=${order.id}`)}>{productionDueText(order)}</Link></td>
                  <td className="py-3"><Link className="flex justify-center" href={importHref(`/orders?open=${order.id}`)}><StatusPill status={order.status} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="월별 발주" subtitle="최근 6개월">
        <div className="space-y-2">
          {monthly.map((item) => (
            <div key={item.month} className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-3 text-sm">
              <span className="font-bold">{item.month}</span>
              <span className="text-slate-500">{item.cnt}건</span>
              <strong>{krw(item.amount)}</strong>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function NativeImportWorkspace({ path }: { path: string }) {
  const [basePath, queryString = ""] = path.split("?");
  const query = new URLSearchParams(queryString);
  const openOrderId = Number(query.get("open") || 0) || null;
  const copyOrderId = Number(query.get("copy") || 0) || undefined;
  const initialOrderFilters = {
    q: query.get("q") || "",
    dateFrom: query.get("date_from") || "",
    dateTo: query.get("date_to") || "",
  };
  const orderEditMatch = basePath.match(/^\/orders\/(\d+)\/edit/);
  const orderMatch = basePath.match(/^\/orders\/(\d+)/);
  const productEditMatch = basePath.match(/^\/products\/(\d+)\/edit/);
  const productMatch = basePath.match(/^\/products\/(\d+)/);
  useEffect(() => {
    if (!basePath.startsWith("/orders") && !basePath.startsWith("/products") && !basePath.startsWith("/settings")) {
      void ensureImportErpServer().catch(() => undefined);
    }
  }, [basePath]);

  const activeImportPath = basePath.startsWith("/products")
    ? "/products"
    : basePath.startsWith("/settings")
      ? "/settings"
      : "/orders";
  const activeSubMenu = importSubMenus.find((sub) => sub.path === activeImportPath);
  const descriptionByPath: Record<string, string> = {
    "/orders": "수입 발주 목록을 확인하고 클릭해서 바로 수정합니다.",
    "/products": "수입 발주용 제품과 부자재 카탈로그를 관리합니다.",
    "/settings": "환율과 공급사/공장 기준정보를 관리합니다.",
  };
  const content = (() => {
    if (basePath.startsWith("/orders/new")) return <NativeOrderForm copyId={copyOrderId} />;
    if (basePath.startsWith("/products/new")) return <NativeProductForm />;
    if (orderEditMatch) return <NativeOrderForm id={Number(orderEditMatch[1])} />;
    if (orderMatch) return <NativeOrderDetail id={Number(orderMatch[1])} />;
    if (productEditMatch) return <NativeProductForm id={Number(productEditMatch[1])} />;
    if (productMatch) return <NativeProductForm id={Number(productMatch[1])} />;
    if (basePath.startsWith("/products")) return <NativeProducts />;
    if (basePath.startsWith("/settings")) return <NativeSettings />;
    return <NativeOrders initialOpenOrderId={openOrderId} initialFilters={initialOrderFilters} />;
  })();

  return (
    <div className="space-y-5">
      <PageHeader
        title={activeSubMenu?.label || "발주"}
        description={descriptionByPath[activeImportPath]}
      />
      {content}
    </div>
  );
}

function OrderAttachmentModal({ order, onClose, onChanged }: { order: ImportOrder; onClose: () => void; onChanged?: (count: number) => void }) {
  const [attachments, setAttachments] = useState<OrderAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  useEscapeToClose(true, onClose);

  async function loadAttachments() {
    setLoading(true);
    setError("");
    try {
      const data = await cachedJson<{ ok?: boolean; error?: string; attachments?: OrderAttachment[] }>(`/api/fnos/orders/${order.id}/attachments`, 60_000);
      if (data.ok === false) throw new Error(data.error || "첨부파일을 불러오지 못했습니다.");
      const next = Array.isArray(data.attachments) ? data.attachments : [];
      setAttachments(next);
      onChanged?.(next.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "첨부파일을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAttachments();
  }, [order.id]);

  function pickFiles(files: FileList | File[] | null) {
    const next = Array.from(files || []);
    setSelectedFiles(next);
    if (next.length) setError("");
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    pickFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    pickFiles(event.dataTransfer.files);
  }

  async function uploadAttachment() {
    if (!selectedFiles.length) {
      setError("업로드할 파일을 선택해 주세요.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const item of selectedFiles) {
        const form = new FormData();
        form.append("file", item);
        form.append("note", note);
        const res = await fetch(apiUrl(`/api/fnos/orders/${order.id}/attachments`), {
          method: "POST",
          body: form,
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(`${item.name}: ${data.error || "업로드에 실패했습니다."}`);
      }
      setSelectedFiles([]);
      setNote("");
      invalidateApiCache(`/api/fnos/orders/${order.id}/attachments`);
      await loadAttachments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteAttachment(item: OrderAttachment) {
    if (!confirm("이 첨부파일을 삭제할까요?")) return;
    setError("");
    try {
      const res = await fetch(apiUrl(`/api/fnos/attachments/${item.id}`), {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || "삭제에 실패했습니다.");
      invalidateApiCache(`/api/fnos/orders/${order.id}/attachments`);
      await loadAttachments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }

  const title = order.order_code || order.repr_product || `발주 ${order.id}`;

  return (
    <SelectionModal
      title={`첨부파일 - ${title}`}
      description="견적서, 송금증, 인보이스, 사진 자료를 발주건 안에 보관합니다."
      onClose={onClose}
      size="xl"
      className="max-h-[90vh] overflow-hidden"
    >
        <div className="max-h-[calc(90vh-150px)] overflow-y-auto">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`rounded-md border p-4 transition ${dragging ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-slate-50"}`}
          >
            <div className="grid gap-3 md:grid-cols-[1.8fr_0.7fr_110px]">
              <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-orange-200 bg-white px-4 text-sm font-black text-orange-600 shadow-sm hover:bg-orange-50">
                파일 선택
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx"
                  onChange={handleFileInput}
                  className="hidden"
                />
              </label>
              <input value={note} onChange={(event) => setNote(event.target.value)} className={modalInputClass} placeholder="메모" />
              <ActionButton type="button" onClick={uploadAttachment} disabled={uploading}>{uploading ? "업로드 중" : "업로드"}</ActionButton>
            </div>
            <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm font-bold text-slate-500">
              파일을 여기로 끌어다 놓거나, 파일 선택 버튼으로 여러 개를 한 번에 선택하세요.
              {selectedFiles.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {selectedFiles.map((item) => (
                    <span key={`${item.name}-${item.size}-${item.lastModified}`} className="rounded-md bg-orange-50 px-2 py-1 text-xs font-black text-orange-600">
                      {item.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs font-bold text-slate-500">허용: PDF, JPG, PNG, WebP, Excel, DOCX · 파일당 최대 10MB</p>
          {error && <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{error}</div>}
          <div className="mt-5 overflow-hidden rounded-md border border-slate-200">
            <div className="grid grid-cols-[2.4fr_90px_130px_0.5fr_130px] bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
              <span>파일명</span>
              <span>크기</span>
              <span>업로드일</span>
              <span>메모</span>
              <span className="text-center">작업</span>
            </div>
            {loading ? (
              <div className="px-4 py-8 text-sm font-bold text-slate-500">불러오는 중...</div>
            ) : attachments.length ? attachments.map((item) => (
              <div key={item.id} className="grid grid-cols-[2.4fr_90px_130px_0.5fr_130px] items-center border-t border-slate-100 px-4 py-3 text-sm">
                <button type="button" onClick={() => openAttachment(item)} className="flex min-w-0 cursor-pointer items-center gap-2 text-left font-bold underline-offset-4 hover:text-orange-600 hover:underline">
                  <FileTypeIcon name={item.file_name} />
                  <span className="min-w-0 break-all">{item.file_name || "-"}</span>
                </button>
                <span>{fileSize(item.file_size)}</span>
                <span className="text-xs text-slate-500">{String(item.uploaded_at || "").slice(0, 10) || "-"}</span>
                <span className="break-all text-slate-600">{item.note || "-"}</span>
                <span className="flex justify-center gap-2 text-center">
                  <ActionButton type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={() => openAttachment(item)}>열기</ActionButton>
                  <ActionButton type="button" variant="secondary" className="h-8 border-rose-200 px-3 text-xs text-rose-600 hover:bg-rose-50" onClick={() => deleteAttachment(item)}>삭제</ActionButton>
                </span>
              </div>
            )) : (
              <div className="px-4 py-8 text-sm font-bold text-slate-500">아직 첨부파일이 없습니다.</div>
            )}
          </div>
        </div>
    </SelectionModal>
  );
}


function NativeOrders({
  initialOpenOrderId = null,
  initialFilters = { q: "", dateFrom: "", dateTo: "" },
}: {
  initialOpenOrderId?: number | null;
  initialFilters?: { q: string; dateFrom: string; dateTo: string };
}) {
  useF2Navigate(true, importHref("/orders/new"));
  const [orders, setOrders] = useState<ImportOrder[]>([]);
  const [details, setDetails] = useState<Record<number, ImportOrderDetail>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [folderOrder, setFolderOrder] = useState<ImportOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);

  async function loadOrders(nextFilters = appliedFilters) {
    const params = new URLSearchParams();
    if (nextFilters.q.trim()) params.set("q", nextFilters.q.trim());
    if (nextFilters.dateFrom) params.set("date_from", nextFilters.dateFrom);
    if (nextFilters.dateTo) params.set("date_to", nextFilters.dateTo);
    const path = `/api/fnos/orders${params.toString() ? `?${params.toString()}` : ""}`;
    const data = await cachedJson<{ orders?: ImportOrder[] }>(path, 30_000);
    const nextOrders = data.orders || [];
    setOrders(nextOrders);
  }

  useEffect(() => {
    let alive = true;
    const defaultPath = "/api/fnos/orders";
    const cachedOrders = readImportCache<{ orders?: ImportOrder[] }>(defaultPath);
    if (cachedOrders?.orders?.length) {
      setOrders(cachedOrders.orders);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOrders().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function openOrder(orderId: number) {
    setExpandedId(orderId);
    if (!details[orderId]) {
      const detail = await cachedJson<ImportOrderDetail>(`/api/fnos/orders/${orderId}`, 30_000);
      setDetails((prev) => ({ ...prev, [orderId]: detail }));
    }
  }

  async function toggleOrder(orderId: number) {
    if (expandedId === orderId) {
      setExpandedId(null);
      return;
    }
    await openOrder(orderId);
  }

  function updateAttachmentCount(orderId: number, count: number) {
    setOrders((prev) => prev.map((order) => order.id === orderId ? { ...order, attachment_count: count } : order));
    setDetails((prev) => {
      const detail = prev[orderId];
      if (!detail) return prev;
      return { ...prev, [orderId]: { ...detail, order: { ...detail.order, attachment_count: count } } };
    });
    invalidateApiCache("/api/fnos/orders");
    invalidateApiCache("/api/fnos/dashboard");
  }

  useEffect(() => {
    if (loading || !initialOpenOrderId) return;
    void openOrder(initialOpenOrderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, initialOpenOrderId]);

  return (
    <div className="space-y-3">
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <form
            className="grid gap-2 border-b border-slate-200 bg-white p-3 md:grid-cols-[120px_1fr_150px_150px_78px]"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedFilters(filters);
              setExpandedId(null);
              setLoading(true);
              loadOrders(filters).finally(() => setLoading(false));
            }}
          >
            <Link className="inline-flex h-10 items-center justify-center rounded-lg bg-[#ff6a00] px-4 text-sm font-semibold text-white transition hover:bg-[#ea580c]" href={importHref("/orders/new")}>F2 새 발주</Link>
            <input className="field-input" value={filters.q} onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))} placeholder="제품명 or 거래처명" />
            <input className="field-input" type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} />
            <input className="field-input" type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} />
            <button className="rounded-md bg-slate-900 px-3 text-sm font-black text-white" type="submit">찾기</button>
          </form>
          <div className="hidden grid-cols-[120px_1.4fr_1fr_80px_128px_44px_76px_90px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-600 xl:grid">
            <span className="text-left">주문날짜</span><span className="text-left">대표 제품</span><span className="text-left">공장</span><span className="text-right">수량</span><span className="text-right">금액(원)</span><span /><span className="pr-3 text-right">출고예정</span><span className="text-center">상태</span>
          </div>
          {orders.map((order) => (
            <div key={order.id} className={expandedId === order.id ? "border-l-4 border-orange-500 bg-orange-50/40" : "border-l-4 border-transparent"}>
              <div role="button" tabIndex={0} onClick={() => toggleOrder(order.id)} onKeyDown={(event) => { if (event.key === "Enter") void toggleOrder(order.id); }} className="grid w-full cursor-pointer items-center gap-3 border-b border-slate-200 px-4 py-3 text-left text-sm hover:bg-orange-50 xl:grid-cols-[120px_1.4fr_1fr_80px_128px_44px_76px_90px]">
                <span className="font-black">{order.order_date || order.paid_date || "-"}</span>
                <span className="grid grid-cols-[56px_1fr] items-center gap-3">
                  {order.repr_image ? <img src={assetUrl(order.repr_image)} alt="" className="h-14 w-14 rounded-md object-cover" /> : <span className="h-14 w-14 rounded-md bg-slate-100" />}
                  <span><b>{order.repr_product || `${order.line_count || 0}개 라인`}</b>{order.child_count ? <small className="ml-2 text-slate-500">+{order.child_count}</small> : null}</span>
                </span>
                <span className="font-bold text-slate-600">{order.factory_name || "-"}</span>
                <span className="text-right">{Math.round(order.total_qty || 0).toLocaleString("ko-KR")}</span>
                <span className="text-right font-black">{krw(order.total_won)}</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setFolderOrder(order);
                  }}
                  className="relative ml-auto inline-flex h-7 w-7 items-center justify-center text-lg leading-none hover:text-orange-600"
                  aria-label="첨부파일"
                >
                  📁
                  {Number(order.attachment_count || 0) > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white">
                      {order.attachment_count}
                    </span>
                  )}
                </button>
                <span className="pr-3 text-right font-black text-orange-600">{productionDueText(order)}</span>
                <span className="flex justify-center"><StatusPill status={order.status} /></span>
              </div>
              {expandedId === order.id && (
                details[order.id]
                  ? <NativeOrderQuickEditor detail={details[order.id]} onSaved={(next) => {
                    if (!next) {
                      setExpandedId(null);
                      setDetails((prev) => {
                        const copy = { ...prev };
                        delete copy[order.id];
                        return copy;
                      });
                      void loadOrders();
                      return;
                    }
                    setDetails((prev) => ({
                      ...prev,
                      [order.id]: {
                        ...next,
                        items: Array.isArray(next.items) ? next.items : prev[order.id]?.items || [],
                      },
                    }));
                    void loadOrders();
                  }} />
                  : <div className="border-b border-slate-200 p-5 text-sm font-bold text-slate-500">상세 불러오는 중...</div>
              )}
            </div>
          ))}
          {!orders.length && <p className="p-8 text-center text-sm font-bold text-slate-500">아직 발주가 없습니다.</p>}
        </div>
      )}
      {folderOrder && (
        <OrderAttachmentModal
          order={folderOrder}
          onClose={() => setFolderOrder(null)}
          onChanged={(count) => updateAttachmentCount(folderOrder.id, count)}
        />
      )}
    </div>
  );
}

function NativeOrderQuickEditor({ detail, onSaved }: { detail: ImportOrderDetail; onSaved: (detail: ImportOrderDetail | null) => void }) {
  const order = detail.order;
  const [saving, setSaving] = useState(false);
  const [stageValues, setStageValues] = useState<StageValues>(stageValuesFromOrder(order));
  const [costs, setCosts] = useState({
    shipping_method: order.shipping_method || "LCL",
    shipping_cost: String(order.shipping_cost || 0),
    customs_duty: String(order.customs_duty || 0),
    vat: String(order.vat || 0),
    customs_fee: String(order.customs_fee || 0),
    inspection_fee: String(order.inspection_fee || 0),
    domestic_shipping_cost: String(order.domestic_shipping_cost || 0),
    other_cost: String(order.other_cost || 0),
    china_domestic_shipping: String(order.china_domestic_shipping || 0),
    china_fee: String(order.china_fee || 0),
    china_other_cost: String(order.china_other_cost || 0),
    china_other_note: order.china_other_note || "",
    china_cost_currency: order.china_cost_currency || order.currency || "CNY",
    note: order.note || "",
  });
  const [productionDays, setProductionDays] = useState(order.production_days != null ? String(order.production_days) : "");
  const [actualCurrency, setActualCurrency] = useState<ActualPaymentCurrency>(actualPaymentCurrency(order));
  const [actualPayment, setActualPayment] = useState(actualPaymentSingle(order));
  const [actualPayment1, setActualPayment1] = useState(actualPaymentFirst(order));
  const [actualPayment2, setActualPayment2] = useState(actualPaymentSecond(order));
  const productWon = Number(detail.product_won ?? detail.cost_grid?.goods_total_won ?? Math.max(0, Number(detail.total_won || 0) - orderExtraCost(order)));
  const nativeTotals = nativeTotalText(detail.native_totals, order.currency || "CNY");
  const usedCurrencies = Object.keys(detail.native_totals || (order.currency ? { [order.currency]: 0 } : { CNY: 0 }));
  const rateNote = rateNoteText(detail.fx_rates, Array.from(new Set([...usedCurrencies, "CNY", "USD"])));
  const isTT = isTTPayment(order.payment_method);
  const actualPaymentValue = isTT ? Number(actualPayment1 || 0) + Number(actualPayment2 || 0) : Number(actualPayment || 0);
  const actualPaymentKrw = actualPaymentWon(actualPaymentValue, actualCurrency, detail.fx_rates);
  const chinaExtraNative = Number(costs.china_domestic_shipping || 0) + Number(costs.china_fee || 0) + Number(costs.china_other_cost || 0);
  const chinaExtraCurrency = costs.china_cost_currency || order.currency || "CNY";
  const chinaExtraWon = chinaExtraNative * Number(detail.fx_rates?.[chinaExtraCurrency] || order.fx_rate || 1);
  const panelProductWon = productWon;
  const koreaExtraWon = ["shipping_cost", "customs_duty", "vat", "customs_fee", "inspection_fee", "domestic_shipping_cost", "other_cost"].reduce((sum, key) => sum + Number(costs[key as keyof typeof costs] || 0), 0);
  const convertedOrderTotalWon = panelProductWon + chinaExtraWon;
  const supplierPaymentWon = actualPaymentKrw > 0 ? actualPaymentKrw : convertedOrderTotalWon;
  const panelTotalWon = supplierPaymentWon + koreaExtraWon;
  const materialOnlyCost = materialOnlyCostSummary(detail, panelTotalWon);

  useEffect(() => {
    setProductionDays(order.production_days != null ? String(order.production_days) : "");
    setActualCurrency(actualPaymentCurrency(order));
    setActualPayment(actualPaymentSingle(order));
    setActualPayment1(actualPaymentFirst(order));
    setActualPayment2(actualPaymentSecond(order));
    setCosts({
      shipping_method: order.shipping_method || "LCL",
      shipping_cost: String(order.shipping_cost || 0),
      customs_duty: String(order.customs_duty || 0),
      vat: String(order.vat || 0),
      customs_fee: String(order.customs_fee || 0),
      inspection_fee: String(order.inspection_fee || 0),
      domestic_shipping_cost: String(order.domestic_shipping_cost || 0),
      other_cost: String(order.other_cost || 0),
      china_domestic_shipping: String(order.china_domestic_shipping || 0),
      china_fee: String(order.china_fee || 0),
      china_other_cost: String(order.china_other_cost || 0),
      china_other_note: order.china_other_note || "",
      china_cost_currency: order.china_cost_currency || order.currency || "CNY",
      note: order.note || "",
    });
    setStageValues(stageValuesFromOrder(order));
  }, [order.id, order.production_days, order.actual_payment_currency, order.actual_payment_total, order.actual_payment_1, order.actual_payment_2, order.actual_payment_total_krw, order.actual_payment_usd, order.actual_payment_usd_1, order.actual_payment_usd_2, order.china_domestic_shipping, order.china_fee, order.china_other_cost, order.china_other_note, order.china_cost_currency]);

  async function saveQuick() {
    setSaving(true);
    const payload: Record<string, unknown> = {
      factory_id: order.factory_id || "",
      platform: order.platform || "FN_OS",
      currency: order.currency || "CNY",
      fx_rate: order.fx_rate || 1,
      payment_method: order.payment_method || "플랫폼 카드결제",
      production_days: productionDays,
      actual_payment_currency: actualCurrency,
      actual_payment_1: isTT ? actualPayment1 : "",
      actual_payment_2: isTT ? actualPayment2 : "",
      actual_payment_total: actualPaymentValue || "",
      actual_payment_total_krw: actualPaymentKrw || "",
      actual_payment_usd: actualCurrency === "USD" ? actualPaymentValue || "" : "",
      actual_payment_usd_1: actualCurrency === "USD" && isTT ? actualPayment1 : "",
      actual_payment_usd_2: actualCurrency === "USD" && isTT ? actualPayment2 : "",
      ...stageValues,
      ...costs,
    };
    if (Array.isArray(detail.items) && detail.items.length > 0) {
      payload.items = detail.items.map((item) => ({
        product_id: item.product_id || "",
        product_name: item.product_name || "",
        option_value: item.option_value || "",
        quantity: item.quantity || "",
        unit_price: item.unit_price || "",
        item_currency: item.item_currency || order.currency || "CNY",
        line_note: item.line_note || "",
      }));
    }
    const res = await fetch(apiUrl(`/api/fnos/orders/${order.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const next = await res.json();
    setSaving(false);
    if (res.ok && next.ok) {
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache("/api/fnos/products");
      invalidateApiCache("/api/fnos/products/search");
      invalidateApiCache("/api/fnos/form-data");
      invalidateApiCache("/api/fnos/dashboard");
      invalidateApiCache("/api/fnos/calendar-production-memos");
      window.dispatchEvent(new Event("fnos-calendar-refresh"));
      onSaved(next);
    }
  }

  async function deleteOrder() {
    if (!confirm("이 발주를 삭제할까요?")) return;
    try {
      const res = await fetch(apiUrl(`/api/fnos/orders/${order.id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("삭제에 실패했습니다.");
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache("/api/fnos/products");
      invalidateApiCache("/api/fnos/products/search");
      invalidateApiCache("/api/fnos/form-data");
      invalidateApiCache("/api/fnos/dashboard");
      invalidateApiCache("/api/fnos/calendar-production-memos");
      window.dispatchEvent(new Event("fnos-calendar-refresh"));
      onSaved(null);
    } catch {
      alert("삭제 요청이 서버에 닿지 않았습니다. 수입관리 서버를 확인해주세요.");
    }
  }

  return (
    <div className="grid gap-5 border-b border-slate-200 bg-white p-5 xl:grid-cols-[1fr_320px]">
      <div className="grid gap-5">
        <div className="flex items-center justify-between gap-3">
          <div><b>{order.order_date || order.paid_date || "-"}</b> <StatusPill status={order.status} /></div>
          <div className="flex gap-2">
            <Link className="inline-flex h-9 items-center rounded-md border border-blue-300 px-3 text-sm font-black text-blue-600" href={importHref(`/orders/${order.id}/edit`)}>수정</Link>
            <Link className="inline-flex h-9 items-center rounded-md border border-slate-400 px-3 text-sm font-black text-slate-600" href={importHref(`/orders/new?copy=${order.id}`)}>주문서 복사</Link>
            <button type="button" onClick={deleteOrder} className="inline-flex h-9 items-center rounded-md border border-rose-300 px-3 text-sm font-black text-rose-600">삭제</button>
            <button type="button" onClick={saveQuick} disabled={saving} className="inline-flex h-9 items-center rounded-md bg-orange-500 px-4 text-sm font-black text-white disabled:opacity-50">{saving ? "저장 중..." : "저장"}</button>
          </div>
        </div>
        <section className="grid gap-3">
          <div className="flex items-end justify-between border-b border-slate-200 pb-2">
            <h3 className="text-base font-black">진행 상태</h3>
            <p className="text-xs font-bold text-slate-500">동그라미를 클릭하면 날짜를 입력할 수 있습니다.</p>
          </div>
          <StageProgressLane paymentMethod={order.payment_method} values={stageValues} onChange={(name, value) => setStageValues((prev) => ({ ...prev, [name]: value }))} />
        </section>
        <section className="grid gap-3">
          <h3 className="border-b border-slate-200 pb-2 text-base font-black">물류·통관 비용 (원)</h3>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-4">
              {(["shipping_cost", "customs_duty", "vat", "customs_fee", "inspection_fee", "domestic_shipping_cost", "other_cost"] as const).map((key) => (
                <Field key={key} label={{ shipping_cost: "배대지 배송비", customs_duty: "관세", vat: "부가세", customs_fee: "통관수수료", inspection_fee: "식검비", domestic_shipping_cost: "국내배송비", other_cost: "기타비용" }[key]}>
                  <input className="field-input text-right" type="number" value={costs[key]} onChange={(e) => setCosts((prev) => ({ ...prev, [key]: e.target.value }))} />
                </Field>
              ))}
            </div>
            <Field label="메모"><textarea className="field-input min-h-[84px]" value={costs.note} onChange={(e) => setCosts((prev) => ({ ...prev, note: e.target.value }))} /></Field>
          </div>
        </section>
      </div>
      <aside className="grid h-fit gap-3">
        <section className="rounded-md border border-orange-100 bg-orange-50 p-4">
          <p className="text-sm font-bold text-slate-500">총 비용</p>
          <p className="mt-2 text-2xl font-black">{krw(panelTotalWon)}</p>
          <div className="mt-4 grid gap-2 text-sm">
            <p className="flex justify-between"><span>제품합계(선택통화)</span><b>{nativeTotals}</b></p>
            <p className="flex justify-between"><span>중국내 부대비용</span><b>{nativeAmountText(chinaExtraNative, chinaExtraCurrency)} / {krw(chinaExtraWon)}</b></p>
            <p className="flex justify-between border-t border-orange-100 pt-2"><span>실제 결제금액</span><b>{krw(supplierPaymentWon)}</b></p>
            <p className="flex justify-between"><span>한국 부대비용</span><b>{krw(koreaExtraWon)}</b></p>
            {materialOnlyCost.cardUnitCost != null && <p className="flex justify-between"><span>예상원가</span><b>{krw(materialOnlyCost.cardUnitCost)}</b></p>}
            <p className="text-xs text-slate-500">총 {Number(detail.total_qty || 0).toLocaleString("ko-KR")}개 기준</p>
            {rateNote && <p className="text-xs text-slate-500">{rateNote}</p>}
          </div>
        </section>
        <section className="rounded-md border border-slate-200 bg-white p-3">
          <h3 className="mb-3 text-sm font-black">제작·실결제</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="제작기간">
              <div className="grid grid-cols-[1fr_30px]">
                <input className="field-input rounded-r-none px-3 py-2 text-right" type="number" min="0" step="1" value={productionDays} onChange={(e) => setProductionDays(e.target.value)} placeholder="7" />
                <span className="bg-slate-50 px-2 py-2 text-center text-sm font-bold">일</span>
              </div>
            </Field>
            <Field label="통화">
              <select className="field-input" value={actualCurrency} onChange={(e) => setActualCurrency(e.target.value as ActualPaymentCurrency)}>
                <option>KRW</option>
                <option>USD</option>
                <option>CNY</option>
              </select>
            </Field>
            {isTT ? (
              <>
                <Field label="1차 결제"><input className="field-input text-right" type="number" min="0" step="0.01" value={actualPayment1} onChange={(e) => setActualPayment1(e.target.value)} /></Field>
                <Field label="2차 결제"><input className="field-input text-right" type="number" min="0" step="0.01" value={actualPayment2} onChange={(e) => setActualPayment2(e.target.value)} /></Field>
                <div className="col-span-2 rounded-md bg-slate-50 px-3 py-2">
                  <p className="text-xs font-black text-slate-500">최종 결제</p>
                  <p className="mt-1 text-right text-sm font-black">{actualPaymentValue.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} {actualCurrency}</p>
                </div>
              </>
            ) : (
              <div className="col-span-2">
                <Field label="실 결제금액"><input className="field-input text-right" type="number" min="0" step="0.01" value={actualPayment} onChange={(e) => setActualPayment(e.target.value)} placeholder="비우면 제품 라인 기준" /></Field>
              </div>
            )}
          </div>
        </section>
      </aside>
      <div className="xl:col-span-2">
        <CostMarginGrid orderId={order.id} grid={detail.cost_grid} materialOnlyRows={materialOnlyCost.gridRows} />
      </div>
    </div>
  );
}

function CostMarginGrid({ orderId, grid, materialOnlyRows = [] }: { orderId: number; grid?: CostGrid; materialOnlyRows?: CostGridRow[] }) {
  const rows = materialOnlyRows.length ? materialOnlyRows : (grid?.rows || []);
  const isMaterialOnlyGrid = materialOnlyRows.length > 0;
  const [prices, setPrices] = useState<Record<number, { coupang: string; naverFree: string; naverCod: string }>>(() => {
    const next: Record<number, { coupang: string; naverFree: string; naverCod: string }> = {};
    rows.forEach((row) => {
      if (!row.order_item_id) return;
      next[row.order_item_id] = {
        coupang: row.coupang_free_price ? String(row.coupang_free_price) : "",
        naverFree: row.naver_free_price ? String(row.naver_free_price) : "",
        naverCod: row.naver_cod_price ? String(row.naver_cod_price) : "",
      };
    });
    return next;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next: Record<number, { coupang: string; naverFree: string; naverCod: string }> = {};
    rows.forEach((row) => {
      if (!row.order_item_id) return;
      next[row.order_item_id] = {
        coupang: row.coupang_free_price ? String(row.coupang_free_price) : "",
        naverFree: row.naver_free_price ? String(row.naver_free_price) : "",
        naverCod: row.naver_cod_price ? String(row.naver_cod_price) : "",
      };
    });
    setPrices(next);
  }, [orderId, rows.map((row) => `${row.order_item_id}:${row.coupang_free_price}:${row.naver_free_price}:${row.naver_cod_price}`).join("|")]);

  function calc(priceText: string, unitCost: number, feeRate: number, sellerShippingFee: number) {
    const price = Number(priceText || 0);
    if (!price) return { amount: null, pct: null };
    const settlement = price * (1 - feeRate);
    const amount = settlement - sellerShippingFee - unitCost;
    const marginBase = settlement - sellerShippingFee;
    return { amount, pct: marginBase > 0 ? (amount / marginBase) * 100 : null };
  }

  function formatMargin(value: { amount: number | null; pct: number | null }) {
    if (value.amount === null) return "-";
    return `${krw(value.amount)} ｜ ${fmtPct(value.pct)}`;
  }

  async function save() {
    setSaving(true);
    await fetch(apiUrl(`/api/fnos/orders/${orderId}/margin`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        items: rows.map((row) => ({
          order_item_id: row.order_item_id,
          coupang_free_price: prices[Number(row.order_item_id)]?.coupang || null,
          naver_free_price: prices[Number(row.order_item_id)]?.naverFree || null,
          naver_cod_price: prices[Number(row.order_item_id)]?.naverCod || null,
        })),
      }),
    });
    invalidateApiCache(`/api/fnos/orders/${orderId}`);
    invalidateApiCache("/api/fnos/orders");
    setSaving(false);
  }

  function update(rowId: number | undefined, key: "coupang" | "naverFree" | "naverCod", value: string) {
    if (!rowId) return;
    setPrices((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || { coupang: "", naverFree: "", naverCod: "" }), [key]: value },
    }));
  }

  const headers = ["옵션명", "수량", "상품단가", "원가배분%", "부대비용/개", "부자재", "예상원가", "쿠팡(무료)", "쿠팡MG", "네이버(무료)", "네이버MG", "네이버(착불)", "네이버MG"];
  const widths = ["9%", "5%", "8%", "6%", "8%", "7%", "8%", "8%", "8%", "8%", "8%", "8%", "9%"];

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
        <h3 className="font-black">옵션별 원가/마진표</h3>
        {!isMaterialOnlyGrid && <button type="button" onClick={save} disabled={saving} className="h-9 rounded-md border border-blue-500 px-4 text-sm font-black text-blue-600 disabled:opacity-50">{saving ? "저장 중..." : "마진 저장"}</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] table-fixed text-xs">
          <colgroup>
            {widths.map((width, index) => <col key={`${width}-${index}`} style={{ width }} />)}
          </colgroup>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {headers.map((head) => (
                <th key={head} className="truncate border-b border-r border-slate-200 px-1.5 py-2 text-center font-black last:border-r-0" title={head}>{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowId = Number(row.order_item_id || 0);
              const price = prices[rowId] || { coupang: "", naverFree: "", naverCod: "" };
              const unitCost = Number(row.estimated_unit_cost || 0);
              const cp = calc(price.coupang, unitCost, 0.12, 3000);
              const nf = calc(price.naverFree, unitCost, 0.06, 3000);
              const nc = calc(price.naverCod, unitCost, 0.06, 0);
              if (row.material_only || String(row.item_type || "").toUpperCase() === "MATERIAL") {
                return (
                  <tr key={row.order_item_id || `${row.option_name}-${row.product_name}`} className="odd:bg-white even:bg-slate-50/50">
                    <td className="max-w-0 truncate border-r border-slate-200 px-1.5 py-2 font-bold" title={String(row.option_name || row.product_name || "-")}>{row.option_name || row.product_name || "-"}</td>
                    <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right">{Number(row.quantity || 0).toLocaleString("ko-KR")}</td>
                    <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right text-slate-300">-</td>
                    <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right text-slate-300">-</td>
                    <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right text-slate-300">-</td>
                    <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right text-slate-300">-</td>
                    <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right font-black text-orange-600">{krw(row.estimated_unit_cost || 0)}</td>
                    <td colSpan={6} className="truncate px-1.5 py-2 text-center font-bold text-slate-400">부자재 전용 원가 참고</td>
                  </tr>
                );
              }
              const unitExtraCost = Math.max(0, Number(row.unit_china_extra_cost || 0) + Number(row.unit_extra_cost || 0));
              return (
                <tr key={row.order_item_id || `${row.option_name}-${row.product_name}`} className="odd:bg-white even:bg-slate-50/50">
                  <td className="max-w-0 truncate border-r border-slate-200 px-1.5 py-2 font-bold" title={String(row.option_name || row.product_name || "-")}>{row.option_name || row.product_name || "-"}</td>
                  <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right">{Number(row.quantity || 0).toLocaleString("ko-KR")}</td>
                  <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right">{Number(row.unit_price || 0).toLocaleString("ko-KR")} {row.item_currency}</td>
                  <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right">{fmtPct(Number(row.cost_ratio || 0) * 100)}</td>
                  <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right">{krw(unitExtraCost)}</td>
                  <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right">{krw(row.material_unit_cost || 0)}</td>
                  <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right font-black text-orange-600">{krw(row.estimated_unit_cost || 0)}</td>
                  <td className="border-r border-slate-200 px-1 py-1"><input className="h-7 w-full rounded border border-slate-200 px-1.5 text-right text-xs outline-orange-400" type="number" value={price.coupang} onChange={(e) => update(row.order_item_id, "coupang", e.target.value)} /></td>
                  <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right" title={formatMargin(cp)}>{formatMargin(cp)}</td>
                  <td className="border-r border-slate-200 px-1 py-1"><input className="h-7 w-full rounded border border-slate-200 px-1.5 text-right text-xs outline-orange-400" type="number" value={price.naverFree} onChange={(e) => update(row.order_item_id, "naverFree", e.target.value)} /></td>
                  <td className="truncate border-r border-slate-200 px-1.5 py-2 text-right" title={formatMargin(nf)}>{formatMargin(nf)}</td>
                  <td className="border-r border-slate-200 px-1 py-1"><input className="h-7 w-full rounded border border-slate-200 px-1.5 text-right text-xs outline-orange-400" type="number" value={price.naverCod} onChange={(e) => update(row.order_item_id, "naverCod", e.target.value)} /></td>
                  <td className="truncate px-1.5 py-2 text-right" title={formatMargin(nc)}>{formatMargin(nc)}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={13} className="px-3 py-8 text-center font-bold text-slate-500">상품 속성의 제품 라인이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MarginCalculator({ orderId, unitCost, margin }: { orderId: number; unitCost: number; margin?: ImportOrderDetail["margin"] }) {
  const [coupang, setCoupang] = useState(margin?.coupang_price ? String(margin.coupang_price) : "");
  const [naver, setNaver] = useState(margin?.naver_price ? String(margin.naver_price) : "");
  const [naverFree, setNaverFree] = useState(margin?.naver_free_shipping !== 0);
  const [saving, setSaving] = useState(false);

  function calc(priceText: string, feeRate: number, sellerShippingFee: number) {
    const price = Number(priceText || 0);
    if (!price) return { amount: "-", pct: "-" };
    const settlement = price * (1 - feeRate);
    const mg = settlement - sellerShippingFee - unitCost;
    return { amount: krw(mg), pct: settlement > 0 ? `${((mg / settlement) * 100).toFixed(1)}%` : "-" };
  }

  async function save() {
    setSaving(true);
    await fetch(apiUrl(`/api/fnos/orders/${orderId}/margin`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        coupang_price: coupang ? Number(coupang) : null,
        naver_price: naver ? Number(naver) : null,
        naver_free_shipping: naverFree,
      }),
    });
    invalidateApiCache(`/api/fnos/orders/${orderId}`);
    invalidateApiCache("/api/fnos/orders");
    setSaving(false);
  }

  const coupangResult = calc(coupang, 0.12, 3000);
  const naverResult = calc(naver, 0.06, naverFree ? 3000 : 0);

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <h3 className="font-black">마진 계산기</h3>
      <p className="mt-2 text-xs text-slate-500">개당 원가: <b>{krw(unitCost)}</b></p>
      <div className="mt-3 grid gap-3 text-sm">
        <div>
          <label className="font-black">쿠팡 (무료배송)</label>
          <div className="mt-1 grid grid-cols-[56px_1fr_34px] overflow-hidden rounded-md border border-slate-200">
            <span className="bg-slate-50 px-2 py-2">판매가</span>
            <input className="px-2 outline-none" type="number" value={coupang} onChange={(e) => setCoupang(e.target.value)} placeholder="입력..." />
            <span className="bg-slate-50 px-2 py-2">원</span>
          </div>
          <p className="mt-1 flex justify-between"><span>MG금액:</span><b>{coupangResult.amount}</b></p>
          <p className="flex justify-between"><span>MG%:</span><b>{coupangResult.pct}</b></p>
        </div>
        <div>
          <div className="flex items-center gap-3">
            <label className="font-black">네이버</label>
            <label className="text-xs"><input type="radio" checked={naverFree} onChange={() => setNaverFree(true)} /> 무료배송</label>
            <label className="text-xs"><input type="radio" checked={!naverFree} onChange={() => setNaverFree(false)} /> 착불</label>
          </div>
          <div className="mt-1 grid grid-cols-[56px_1fr_34px] overflow-hidden rounded-md border border-slate-200">
            <span className="bg-slate-50 px-2 py-2">판매가</span>
            <input className="px-2 outline-none" type="number" value={naver} onChange={(e) => setNaver(e.target.value)} placeholder="입력..." />
            <span className="bg-slate-50 px-2 py-2">원</span>
          </div>
          <p className="mt-1 flex justify-between"><span>MG금액:</span><b>{naverResult.amount}</b></p>
          <p className="flex justify-between"><span>MG%:</span><b>{naverResult.pct}</b></p>
        </div>
        <button type="button" onClick={save} disabled={saving} className="h-9 rounded-md border border-blue-500 text-sm font-black text-blue-600 disabled:opacity-50">{saving ? "저장 중..." : "마진 저장"}</button>
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyNativeOrders() {
  const [orders, setOrders] = useState<ImportOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const cachedOrders = readImportCache<{ orders?: ImportOrder[] }>("/api/fnos/orders");
    if (cachedOrders?.orders?.length) {
      setOrders(cachedOrders.orders);
      setLoading(false);
    }
    cachedJson<{ orders?: ImportOrder[] }>("/api/fnos/orders", 30_000)
      .then((data) => {
        if (alive) setOrders(data.orders || []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Panel
      title="발주"
      subtitle="FN OS 안으로 흡수한 수입관리 발주 목록"
      action={<Link className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" href={importHref("/orders/new")}>+ 새 발주</Link>}
    >
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : (
        <div className="grid gap-2">
          {orders.map((order) => (
            <Link key={order.id} href={importHref(`/orders/${order.id}`)} className="grid grid-cols-[56px_1.2fr_1fr_100px_130px_90px] items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm hover:border-orange-200">
              {order.repr_image ? <img src={assetUrl(order.repr_image)} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="h-12 w-12 rounded-md bg-slate-100" />}
              <div>
                <div className="font-black">{order.repr_product || `${order.line_count || 0}개 라인`}</div>
                <div className="text-xs text-slate-500">{order.order_code || order.order_date || "-"}</div>
              </div>
              <div className="font-bold text-slate-600">{order.factory_name || "-"}</div>
              <div className="text-right">{Math.round(order.total_qty || 0).toLocaleString("ko-KR")}</div>
              <div className="text-right font-black">{krw(order.total_won)}</div>
              <StatusPill status={order.status} />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function NativeProducts() {
  useF2Navigate(true, importHref("/products/new"));
  const [products, setProducts] = useState<ImportProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"products" | "materials">("products");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    const cachedProducts = readImportCache<{ products?: ImportProduct[] }>("/api/fnos/products");
    if (cachedProducts?.products?.length) {
      setProducts(cachedProducts.products);
      setLoading(false);
    }
    cachedJson<{ products?: ImportProduct[] }>("/api/fnos/products", 60_000)
      .then((data) => {
        if (!alive) return;
        const nextProducts = data.products || [];
        setProducts(nextProducts);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const visibleProducts = products
    .filter((product) => {
      const keyword = query.trim().toLowerCase();
      if (!keyword) return tab === "materials" ? isMaterial(product) : !isMaterial(product);
      return [product.name, product.factory_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko-KR", { numeric: true, sensitivity: "base" }));

  return (
    <div className="space-y-3">
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : (
        <>
        <div className="mb-4 grid gap-3">
          <div className="grid gap-2 md:grid-cols-[120px_1fr]">
            <Link className="inline-flex h-10 items-center justify-center rounded-lg bg-[#ff6a00] px-4 text-sm font-semibold text-white transition hover:bg-[#ea580c]" href={importHref("/products/new")}>F2 새 제품</Link>
            <input className="field-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제품명 or 거래처명" />
          </div>
          <div className="flex items-center gap-3 text-sm font-black">
            <button type="button" onClick={() => setTab("products")} className={!query.trim() && tab === "products" ? "text-orange-600" : "text-slate-500"}>상품</button>
            <span className="text-slate-300">|</span>
            <button type="button" onClick={() => setTab("materials")} className={!query.trim() && tab === "materials" ? "text-orange-600" : "text-slate-500"}>부자재</button>
            {query.trim() && <span className="text-xs text-slate-500">검색 중에는 상품/부자재 전체에서 찾습니다.</span>}
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {visibleProducts.map((product) => (
            <Link key={product.id} href={importHref(`/products/${product.id}/edit`)} className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 transition hover:border-orange-200 hover:bg-orange-50/60">
              <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-100">
                {product.image_path && <img src={assetUrl(product.image_path)} alt={product.name} className="h-full w-full object-cover" />}
              </div>
              <div className="mt-3 font-black">{product.name}</div>
              <div className="mt-1 text-xs text-slate-500">{product.factory_name || "-"}</div>
              {isMaterial(product) ? (
                <div className="mt-2 grid gap-1 text-sm">
                  <p className="font-black text-orange-600">재고 {Number(product.material_stock || 0).toLocaleString("ko-KR")}개</p>
                  <p className="text-xs font-bold text-slate-500">원가 {krw(product.material_unit_cost || product.material_display_cost || product.material_cost || 0)}</p>
                </div>
              ) : (
                <div className="mt-2 grid gap-1 text-sm">
                  <p className="font-black text-orange-600">{product.std_price ? `${product.std_price.toLocaleString("ko-KR")} ${product.currency || ""}` : "-"}</p>
                  {product.materials?.length ? <p className="text-xs font-bold text-slate-500">부자재: {materialSummary(product.materials)}</p> : null}
                </div>
              )}
            </Link>
          ))}
        </div>
        </>
      )}
    </div>
  );
}

function useImportFormData() {
  const [data, setData] = useState<ImportFormData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    cachedJson<ImportFormData>("/api/fnos/form-data", 60_000)
      .then((next) => {
        if (alive) setData({ ...next, factories: sortFactories(next.factories) });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { data, loading };
}

function NativeProductDetail({ id }: { id: number }) {
  const [detail, setDetail] = useState<ImportProductDetail | null>(null);
  const [skuLinks, setSkuLinks] = useState<ImportSkuLink[]>([]);
  const [bomRows, setBomRows] = useState<ImportBomStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    cachedJson<ImportProductDetail>(`/api/fnos/products/${id}`, 60_000)
      .then((next) => {
        if (!alive) return;
        setDetail(next);
        cachedJson<{ links?: ImportSkuLink[]; bom?: ImportBomStatus[] }>(`/api/fnos/import-product-links?import_product_id=${id}`, 60_000)
          .then((linkData) => {
            if (!alive) return;
            setSkuLinks(linkData.links || []);
            setBomRows(linkData.bom || []);
          })
          .catch(() => {
            if (!alive) return;
            setSkuLinks([]);
            setBomRows([]);
          });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const product = detail?.product;
  async function deleteProduct() {
    if (!confirm("이 상품을 삭제할까요?")) return;
    try {
      const res = await fetch(apiUrl(`/api/fnos/products/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("삭제에 실패했습니다.");
      invalidateApiCache("/api/fnos/products");
      invalidateApiCache("/api/fnos/products/search");
      invalidateApiCache("/api/fnos/form-data");
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache("/api/fnos/dashboard");
      window.location.href = importHref("/products");
    } catch {
      alert("삭제 요청이 서버에 닿지 않았습니다. 수입관리 서버를 확인해주세요.");
    }
  }


  return (
    <Panel
      title={product?.name || "제품 상세"}
      subtitle={product ? `${product.factory_name || "-"}` : "수입관리 제품 데이터"}
      action={<div className="flex gap-2">
        <button type="button" className="rounded-md border border-rose-300 px-4 py-2 text-sm font-black text-rose-600" onClick={deleteProduct}>삭제</button>
        <Link className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" href={importHref(`/products/${id}/edit`)}>수정</Link>
      </div>}
    >
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : product ? (
        <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
          <div className="space-y-3">
            <div className="aspect-square overflow-hidden rounded-md bg-slate-100">
              {product.image_path && <img src={assetUrl(product.image_path)} alt={product.name} className="h-full w-full object-cover" />}
            </div>
            {product.product_url && <a className="block rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-orange-600" href={product.product_url} target="_blank">상품 URL 열기</a>}
          </div>
          <div className="grid gap-5">
            <div className="grid gap-3 md:grid-cols-4">
              {isMaterial(product) ? (
                <>
                  <Info label="현재고" value={`${Number(product.material_stock || 0).toLocaleString("ko-KR")}개`} />
                  <Info label="원가" value={krw(product.material_unit_cost || product.material_cost || 0)} />
                </>
              ) : null}
              <Info label="상태" value={product.status || "-"} />
              <Info label="HS 코드" value={product.hs_code || "-"} />
              <Info label="기본 관세율" value={`${product.basic_rate || 0}%`} />
              <Info label="FTA 관세율" value={`${product.fta_rate || 0}%`} />
              <Info label="MOQ" value={product.moq ? String(product.moq) : "-"} />
              <Info label="표준 단가" value={product.std_price ? `${product.std_price.toLocaleString("ko-KR")} ${product.currency || ""}` : "-"} />
              <Info label="옵션" value={product.options || "-"} wide />
              <Info label="메모" value={product.note || "-"} wide />
            </div>
            <section className="rounded-md border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h3 className="font-black">옵션/연동 SKU</h3>
                  <p className="mt-1 text-xs font-bold text-slate-500">연동 SKU {skuLinks.length.toLocaleString("ko-KR")}개</p>
                </div>
                <Link className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-black text-orange-600" href={importHref(`/products/${id}/edit`)}>SKU 추가</Link>
              </div>
              <div className="overflow-x-auto p-4">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="py-2 text-left">수입 옵션</th>
                      <th className="py-2 text-left">SKU</th>
                      <th className="py-2 text-left">품목명</th>
                      <th className="py-2 text-left">옵션</th>
                      <th className="py-2 text-right">현재재고</th>
                      <th className="py-2 text-right">가용재고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuLinks.map((link) => {
                      const fnProduct = link.product;
                      return (
                        <tr key={link.product_id} className="border-b border-slate-100">
                          <td className="py-2 font-bold text-orange-700">{linkOptionName(link) || "기본"}</td>
                          <td className="py-2 font-black">{fnProductSku(fnProduct)}</td>
                          <td className="py-2">{fnProductName(fnProduct)}</td>
                          <td className="py-2">{fnProductOption(fnProduct)}</td>
                          <td className="py-2 text-right">{Number(fnProduct?.current_stock || 0).toLocaleString("ko-KR")}</td>
                          <td className="py-2 text-right">{Number(fnProduct?.available_stock || 0).toLocaleString("ko-KR")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!skuLinks.length && <p className="rounded-md bg-slate-50 px-3 py-4 text-sm font-bold text-slate-400">연동된 SKU가 없습니다.</p>}
              </div>
            </section>
            <section className="rounded-md border border-slate-200">
              <h3 className="border-b border-slate-200 px-4 py-3 font-black">BOM 현황</h3>
              <div className="grid gap-2 p-4">
                {bomRows.map((row) => (
                  <div key={row.product_id} className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm md:grid-cols-[1.3fr_120px_1.6fr_150px_90px]">
                    <b>{row.product_name || row.sku || "-"}</b>
                    <span className={row.has_bom ? "font-bold text-emerald-600" : "font-bold text-slate-500"}>{row.has_bom ? "BOM 등록 완료" : "BOM 미등록"}</span>
                    <span className="text-slate-600">{(row.components || []).map((item) => fnProductName(item.component) || item.component_sku).filter(Boolean).join(" / ") || "-"}</span>
                    <span className={row.shortage ? "font-bold text-rose-600" : "font-bold text-emerald-600"}>{row.has_bom ? (row.shortage ? "부자재 부족" : "부자재 재고 정상") : "-"}</span>
                    <StatusPill status={row.status || "-"} />
                  </div>
                ))}
                {!bomRows.length && <p className="text-sm text-slate-500">연동 SKU가 있으면 BOM 현황이 표시됩니다.</p>}
              </div>
            </section>
            <section className="rounded-md border border-slate-200">
              <h3 className="border-b border-slate-200 px-4 py-3 font-black">발주 이력</h3>
              <div className="grid gap-2 p-4">
                {(detail.history || []).map((item) => (
                  <Link key={item.id} href={importHref(`/orders/${item.id}`)} className="grid grid-cols-[1fr_1fr_100px_120px_90px] rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-bold">{item.order_code || item.order_date || "-"}</span>
                    <span>{item.factory || "-"}</span>
                    <span className="text-right">{item.quantity || 0}</span>
                    <span className="text-right">{item.unit_price ? `${item.unit_price.toLocaleString("ko-KR")} ${item.item_currency || ""}` : "-"}</span>
                    <StatusPill status={item.status} />
                  </Link>
                ))}
                {!detail.history?.length && <p className="text-sm text-slate-500">아직 발주 이력이 없습니다.</p>}
              </div>
            </section>
          </div>
        </div>
      ) : <p className="text-sm text-rose-600">제품을 찾을 수 없습니다.</p>}
    </Panel>
  );
}

function GptMiniProductBox() {
  const [productName, setProductName] = useState("");
  const [result, setResult] = useState("제품명을 입력하고 HS/관세 물어보기를 눌러주세요.");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = localStorage.getItem("fn-os-gptmini-last-result");
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved) as { productName?: string; answer?: string };
        if (parsed.productName) setProductName(parsed.productName);
        if (parsed.answer) setResult(parsed.answer);
      } catch {
        localStorage.removeItem("fn-os-gptmini-last-result");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function ask() {
    const name = productName.trim();
    if (!name) return;
    setLoading(true);
    setResult("GPTmini 조회 중...");
    try {
      const res = await fetch(apiUrl("/api/gptmini/hs"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_name: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "GPTmini 호출 실패");
      localStorage.setItem(
        "fn-os-gptmini-last-result",
        JSON.stringify({ productName: name, answer: data.answer, ts: Date.now() })
      );
      setResult(data.answer);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "수입관리 서버 연결을 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-black">GPTmini (HS코드&amp;관세율)</h3>
      <input
        value={productName}
        onChange={(event) => setProductName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void ask();
        }}
        className="mt-3 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-orange-500"
        placeholder="제품명 입력"
      />
      <button
        type="button"
        disabled={loading}
        onClick={ask}
        className="mt-2 w-full rounded-md bg-orange-500 px-3 py-2 text-sm font-black text-white disabled:opacity-60"
      >
        {loading ? "조회 중..." : "HS/관세 물어보기"}
      </button>
      <div className="mt-2 min-h-24 whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
        {result}
      </div>
    </section>
  );
}

function FnProductPickerModal({
  open,
  selected,
  optionName = "",
  importProductName = "",
  onClose,
  onApply,
}: {
  open: boolean;
  selected: ImportSkuLink[];
  optionName?: string;
  importProductName?: string;
  onClose: () => void;
  onApply: (links: ImportSkuLink[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<FnProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<ImportSkuLink[]>(selected);
  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    setDraft(selected);
    setQuery([importProductName, optionName].filter(Boolean).join(" "));
  }, [open, selected, importProductName, optionName]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    cachedJson<{ products?: FnProduct[] }>(`/api/fnos/products/search?${params.toString()}`, 60_000)
      .then((data) => {
        if (alive) setProducts(data.products || []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, query]);

  if (!open) return null;

  const selectedIds = new Set(draft.map((item) => item.product_id));
  function toggle(product: FnProduct) {
    setDraft((prev) => {
      if (prev.some((item) => item.product_id === product.id)) {
        window.alert("이미 연동된 상품이 있습니다.");
        return prev;
      }
      return [...prev, {
        product_id: product.id,
        sku: fnProductSku(product),
        option_name: optionName,
        group_label: optionName,
        import_option_key: optionName,
        import_option_name: optionName,
        match_group_label: optionName,
        variant_label: fnProductOption(product) !== "-" ? fnProductOption(product) : fnProductName(product),
        sort_order: prev.length,
        default_ratio: 1,
        default_qty: 0,
        is_primary: prev.length === 0,
        product,
      }];
    });
  }

  return (
    <SelectionModal
      title="FN 상품에서 찾기"
      onClose={onClose}
      size="full"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-sm font-semibold text-gray-500">선택 {draft.length.toLocaleString("ko-KR")}개</span>
          <div className="flex gap-2">
            <ActionButton type="button" variant="secondary" onClick={onClose}>취소</ActionButton>
            <ActionButton type="button" onClick={() => onApply(draft)}>반영</ActionButton>
          </div>
        </div>
      }
    >
        <div className="grid gap-3">
          {optionName && <p className="rounded-md bg-orange-50 px-3 py-2 text-sm font-black text-orange-700">연동 옵션: {optionName}</p>}
          <input className={modalInputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="품목코드 / 품목명 / 옵션 검색" autoFocus />
          <div className="max-h-[58vh] overflow-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[940px] text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="py-2 text-left">이미지</th>
                  <th className="py-2 text-left">SKU</th>
                  <th className="py-2 text-left">품목명</th>
                  <th className="py-2 text-left">옵션</th>
                  <th className="py-2 text-right">현재재고</th>
                  <th className="py-2 text-right">가용재고</th>
                  <th className="py-2 text-right">표준단가</th>
                  <th className="py-2 text-center">선택</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const checked = selectedIds.has(product.id);
                  return (
                    <tr key={product.id} className="border-b border-gray-100 hover:bg-orange-50/40">
                      <td className="py-2">
                        <div className="h-11 w-11 overflow-hidden rounded-md bg-slate-100">
                          {product.image_url && <img src={product.image_url} alt="" className="h-full w-full object-cover" />}
                        </div>
                      </td>
                      <td className="py-2 font-black">{fnProductSku(product)}</td>
                      <td className="py-2">{fnProductName(product)}</td>
                      <td className="py-2">{fnProductOption(product)}</td>
                      <td className="py-2 text-right">{Number(product.current_stock || 0).toLocaleString("ko-KR")}</td>
                      <td className="py-2 text-right">{Number(product.available_stock || 0).toLocaleString("ko-KR")}</td>
                      <td className="py-2 text-right">{krw(fnProductPrice(product))}</td>
                      <td className="py-2 text-center">
                        <button type="button" className={`h-8 rounded-lg px-3 text-xs font-black transition ${checked ? "border border-orange-300 bg-orange-50 text-orange-700" : "bg-[#ff6a00] text-white hover:bg-[#ea580c]"}`} onClick={() => toggle(product)}>
                          {checked ? "선택됨" : "추가"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!products.length && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-sm font-bold text-slate-400">{loading ? "검색 중..." : "검색 결과가 없습니다."}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
    </SelectionModal>
  );
}

function NativeProductForm({ id }: { id?: number }) {
  const { data, loading } = useImportFormData();
  const [product, setProduct] = useState<ImportProduct | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [pastedImageDataUrl, setPastedImageDataUrl] = useState("");
  const [imageHint, setImageHint] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [itemType, setItemType] = useState<"PRODUCT" | "MATERIAL">("PRODUCT");
  const [linkedMaterials, setLinkedMaterials] = useState<ProductMaterialLink[]>([]);
  const [linkedProducts, setLinkedProducts] = useState<MaterialProductLink[]>([]);
  const [productLinkOpen, setProductLinkOpen] = useState(false);
  const [productLinkQuery, setProductLinkQuery] = useState("");
  const [fnProductPickerOpen, setFnProductPickerOpen] = useState(false);
  const [fnProductPickerOption, setFnProductPickerOption] = useState("");
  const [fnSkuLinks, setFnSkuLinks] = useState<ImportSkuLink[]>([]);

  useEscapeToClose(productLinkOpen, () => setProductLinkOpen(false));
  useEscapeToClose(fnProductPickerOpen, () => setFnProductPickerOpen(false));

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function normalizeImageFile(nextFile: File, force = false) {
    if (nextFile.type === "image/gif") return nextFile;
    const maxBytes = 420 * 1024;
    const maxSide = 720;
    if (!force && nextFile.size <= maxBytes) return nextFile;
    const sourceUrl = URL.createObjectURL(nextFile);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = sourceUrl;
      });
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.68));
      if (!blob) return nextFile;
      if (!force && blob.size >= nextFile.size && blob.size <= maxBytes) return nextFile;
      return new File([blob], nextFile.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  async function imageFileToDataUrl(nextFile: File) {
    const preparedFile = await normalizeImageFile(nextFile, true);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(preparedFile);
    });
  }

  async function prepareImageChange(nextFile?: File, forceCompress = false) {
    if (!nextFile) {
      setFile(null);
      setPastedImageDataUrl("");
      setImageHint("");
      setPreviewUrl("");
      return;
    }
    setImageHint("이미지 처리 중...");
    const dataUrl = await imageFileToDataUrl(nextFile);
    setFile(null);
    setPastedImageDataUrl(dataUrl);
    setImageHint("선택한 이미지가 저장됩니다.");
    setPreviewUrl(dataUrl);
  }

  function handleImageChange(nextFile?: File) {
    void prepareImageChange(nextFile);
  }

  function handleImagePaste(event: ClipboardEvent<HTMLDivElement>) {
    const items = Array.from(event.clipboardData.items || []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const pastedFile = imageItem.getAsFile();
      if (pastedFile) {
        const ext = pastedFile.type.split("/")[1] || "png";
        setImageHint("붙여넣은 이미지 처리 중...");
        void imageFileToDataUrl(new File([pastedFile], `pasted-product-image.${ext}`, { type: pastedFile.type })).then((dataUrl) => {
          setFile(null);
          setPastedImageDataUrl(dataUrl);
          setPreviewUrl(dataUrl);
          setImageHint("붙여넣은 이미지가 저장됩니다.");
        }).catch(() => setImageHint("이미지를 처리하지 못했습니다. 파일로 저장해 주세요."));
        setImageHint("붙여넣은 이미지가 저장됩니다.");
        event.preventDefault();
      }
      return;
    }
  }

  function toggleMaterial(material: ImportProduct) {
    setLinkedMaterials((prev) => {
      if (prev.some((item) => item.material_id === material.id)) {
        return prev.filter((item) => item.material_id !== material.id);
      }
      return [...prev, { material_id: material.id, material_name: material.name, quantity_per_unit: 1, material_stock: material.material_stock || 0, material_cost: material.material_unit_cost || material.material_display_cost || material.material_cost || 0 }];
    });
  }

  function setMaterialQty(materialId: number, value: string) {
    setLinkedMaterials((prev) => prev.map((item) => item.material_id === materialId ? { ...item, quantity_per_unit: Number(value || 0) || 1 } : item));
  }

  function toggleLinkedProduct(productItem: ImportProduct) {
    setLinkedProducts((prev) => {
      if (prev.some((item) => item.product_id === productItem.id)) {
        return prev.filter((item) => item.product_id !== productItem.id);
      }
      return [...prev, { product_id: productItem.id, product_name: productItem.name, quantity_per_unit: 1, qty_per_product: 1 }];
    });
  }

  function setLinkedProductQty(productId: number, value: string) {
    setLinkedProducts((prev) => prev.map((item) => item.product_id === productId ? { ...item, quantity_per_unit: Number(value || 0) || 1, qty_per_product: Number(value || 0) || 1 } : item));
  }

  useEffect(() => {
    if (!id) return;
    let alive = true;
    cachedJson<ImportProductDetail>(`/api/fnos/products/${id}`, 60_000)
      .then((next) => {
        if (alive) {
          setProduct(next.product || null);
          setProductUrl(next.product?.product_url || "");
          setOptionsText(next.product?.options || "");
          setPastedImageDataUrl(/^data:image\//i.test(next.product?.image_path || "") ? (next.product?.image_path || "") : "");
          setItemType(isMaterial(next.product) ? "MATERIAL" : "PRODUCT");
          setLinkedMaterials(next.product?.materials || next.materials || []);
          setLinkedProducts(next.product?.linked_products || []);
        }
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (id) return;
    const raw = localStorage.getItem("fnos-import-product-prefill");
    if (!raw) return;
    localStorage.removeItem("fnos-import-product-prefill");
    try {
      const parsed = JSON.parse(raw) as { product?: FnProduct };
      const fnProduct = parsed.product;
      if (!fnProduct?.id) return;
      setFnSkuLinks([{
        product_id: fnProduct.id,
        sku: fnProductSku(fnProduct),
        default_ratio: 1,
        default_qty: 0,
        is_primary: true,
        product: fnProduct,
      }]);
      if (fnProduct.image_url) setPreviewUrl(fnProduct.image_url);
      window.setTimeout(() => {
        const nameInput = document.querySelector<HTMLInputElement>('input[name="name"]');
        const optionInput = document.querySelector<HTMLInputElement>('input[name="options"]');
        const priceInput = document.querySelector<HTMLInputElement>('input[name="std_price"]');
        const currencySelect = document.querySelector<HTMLSelectElement>('select[name="currency"]');
        if (nameInput && !nameInput.value) nameInput.value = fnProduct.product_name || "";
        if (optionInput && !optionInput.value) optionInput.value = fnProduct.option_name || "";
        if (!optionsText && fnProduct.option_name) setOptionsText(fnProduct.option_name || "");
        if (priceInput && !priceInput.value && fnProductPrice(fnProduct)) priceInput.value = String(fnProductPrice(fnProduct));
        if (currencySelect && fnProduct.currency) currencySelect.value = fnProduct.currency;
      }, 0);
    } catch {
      localStorage.removeItem("fnos-import-product-prefill");
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    cachedJson<{ links?: ImportSkuLink[] }>(`/api/fnos/import-product-links?import_product_id=${id}`, 60_000)
      .then((data) => {
        if (alive) setFnSkuLinks(data.links || []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(e.currentTarget);
    if (pastedImageDataUrl) {
      form.delete("image");
      form.set("image_url", pastedImageDataUrl);
    } else if (file) {
      form.set("image", file);
    }
    form.set("item_type", itemType);
    form.set("materials", JSON.stringify(itemType === "PRODUCT" ? linkedMaterials : []));
    form.set("linked_products", JSON.stringify(itemType === "MATERIAL" ? linkedProducts : []));
    try {
      const res = await fetch(apiUrl(id ? `/api/fnos/products/${id}` : "/api/fnos/products"), {
        method: id ? "PUT" : "POST",
        body: form,
        credentials: "include",
      });
      const contentType = res.headers.get("content-type") || "";
      const json = contentType.includes("application/json") ? await res.json() : null;
      if (!json) {
        throw new Error(res.status === 413 ? "이미지 용량이 너무 큽니다. 더 작은 이미지로 저장해 주세요." : `서버가 JSON이 아닌 응답을 반환했습니다. (${res.status})`);
      }
      if (!res.ok || !json.ok) throw new Error(json.error || "제품 저장에 실패했습니다.");
      if (fnSkuLinks.length || id) {
        const savedProductId = id || json.product?.id;
        await fetch("/api/fnos/import-product-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ import_product_id: savedProductId, links: fnSkuLinks }),
        });
        invalidateClientCache("/api/fnos/import-product-links");
        invalidateApiCache(`/api/fnos/import-product-links?import_product_id=${savedProductId}`);
        invalidateApiCache(`/api/fnos/products/${savedProductId}`);
      }
      invalidateApiCache("/api/fnos/products");
      invalidateApiCache("/api/fnos/products/search");
      invalidateApiCache("/api/fnos/form-data");
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache("/api/fnos/dashboard");
      window.location.href = importHref("/products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "제품 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct() {
    if (!id || !confirm("이 제품을 삭제할까요?")) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(apiUrl(`/api/fnos/products/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      const contentType = res.headers.get("content-type") || "";
      const json = contentType.includes("application/json") ? await res.json() : null;
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "제품 삭제에 실패했습니다.");
      }
      invalidateApiCache("/api/fnos/products");
      invalidateApiCache("/api/fnos/products/search");
      invalidateApiCache("/api/fnos/form-data");
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache("/api/fnos/dashboard");
      window.location.href = importHref("/products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "제품 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  const importOptions = importOptionList(optionsText);
  const linkGroups = importOptions.length ? importOptions : [""];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{id ? "제품 수정" : "새 제품 등록"}</h2>
          <p className="mt-1 text-sm text-gray-500">FN OS 화면에서 입력하고 수입관리 원장에 저장합니다.</p>
        </div>
      </div>
      {loading || detailLoading ? <p className="text-sm text-slate-500">폼 데이터를 불러오는 중...</p> : (
        <>
        <form key={product?.id || "new"} onSubmit={submit} onKeyDown={preventEnterSubmit} className="grid items-start gap-5 xl:grid-cols-[220px_1fr]">
          <div className="space-y-3" onPaste={handleImagePaste}>
            <div>
              <p className="text-sm font-black">제품 사진</p>
              <div
                className="mt-2 h-[200px] w-[200px] overflow-hidden rounded-md border border-slate-200 bg-slate-100 outline-orange-500 focus:outline focus:outline-2"
                tabIndex={0}
                title="이미지를 복사한 뒤 Ctrl+V로 붙여넣을 수 있습니다."
              >
                {(previewUrl || product?.image_path) && (
                  <img
                    src={previewUrl || assetUrl(product?.image_path)}
                    alt="제품 이미지 미리보기"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <input
                id="product-image-file"
                className="sr-only"
                type="file"
                name="image"
                accept="image/*"
                onChange={(e) => handleImageChange(e.target.files?.[0])}
              />
              <label
                htmlFor="product-image-file"
                className="mt-2 flex h-10 w-[200px] cursor-pointer items-center justify-center rounded-md border border-orange-200 bg-orange-50 px-4 text-sm font-black text-orange-700 hover:bg-orange-100"
              >
                이미지 선택
              </label>
            </div>
            <p className="text-xs font-bold text-slate-500">JPG/PNG/WebP, 최대 32MB</p>
            {imageHint && <p className="text-xs font-bold text-orange-600">{imageHint}</p>}
            {itemType === "MATERIAL" ? (
              <div className="grid gap-2">
                <button
                  type="button"
                  className="flex h-10 w-[200px] items-center justify-center rounded-md border border-orange-200 bg-orange-50 px-4 text-sm font-black text-orange-700 hover:bg-orange-100"
                  onClick={() => setProductLinkOpen(true)}
                >
                  상품 연결
                </button>
              </div>
            ) : <GptMiniProductBox />}
          </div>

          <div className="grid gap-3">
            <div className="grid items-start gap-3 md:grid-cols-3">
              <Field label="등록 구분">
                <select className="field-input" name="item_type" value={itemType} onChange={(event) => setItemType(event.target.value as "PRODUCT" | "MATERIAL")}>
                  <option value="PRODUCT">상품</option>
                  <option value="MATERIAL">부자재</option>
                </select>
              </Field>
              {itemType === "PRODUCT" ? (
                <Field label="FN OS SKU">
                  <button
                    type="button"
                    className="h-[38px] w-full rounded-md border border-orange-200 bg-orange-50 px-3 text-sm font-black text-orange-700 hover:bg-orange-100"
                    onClick={() => setFnProductPickerOpen(true)}
                  >
                    FN상품에서 찾기
                  </button>
                </Field>
              ) : null}
              {itemType === "MATERIAL" ? (
                <>
                  <Field label="초기재고"><input className="field-input" type="number" step="1" name="material_initial_qty" defaultValue={product?.material_initial_qty ?? 0} /></Field>
                </>
              ) : null}
            </div>
            <div className="grid items-start gap-3 md:grid-cols-[2fr_.7fr_.8fr_.7fr]">
              <Field label={itemType === "MATERIAL" ? "부자재명 *" : "제품명 *"}><input className="field-input" name="name" required defaultValue={product?.name || ""} /></Field>
              <Field label="MOQ"><input className="field-input" type="number" name="moq" defaultValue={product?.moq || ""} /></Field>
              <Field label="표준 단가"><input className="field-input" type="number" step="0.001" name="std_price" defaultValue={product?.std_price || ""} /></Field>
              <Field label="통화">
                <select className="field-input" name="currency" defaultValue={product?.currency || "CNY"}>
                  {["CNY", "USD", "JPY", "KRW", "EUR"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
            </div>
            {itemType === "MATERIAL" ? (
              <div className="grid items-start gap-3 md:grid-cols-[2fr_1fr]">
                <Field label="옵션"><input className="field-input" name="options" placeholder="쉼표로 구분" value={optionsText} onChange={(event) => setOptionsText(event.target.value)} /></Field>
                <Field label="원가 설정(원)"><input className="field-input" type="number" min="0" step="1" name="material_unit_cost" defaultValue={product?.material_unit_cost ?? product?.material_cost ?? 0} /></Field>
              </div>
            ) : (
              <div className="grid items-start gap-3 md:grid-cols-[2fr_1fr_.7fr]">
                <Field label="옵션"><input className="field-input" name="options" placeholder="예: 0.5M, 1.0M, 1.5M / 또는: S, M, L" value={optionsText} onChange={(event) => setOptionsText(event.target.value)} /></Field>
                <Field label="주공장">
                  <select className="field-input" name="factory_id" defaultValue={product?.factory_id || ""}>
                    <option value="">선택 안함</option>
                    {data?.factories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label="상태">
                  <select className="field-input" name="status" defaultValue={product?.status || "현역"}>
                    {["현역", "보류", "종료"].map((item) => <option key={item}>{item}</option>)}
                  </select>
                </Field>
              </div>
            )}
            {itemType === "MATERIAL" && (
              <div className="grid items-start gap-3 md:grid-cols-1">
                <Field label="배송주소"><input className="field-input" name="shipping_address" defaultValue={product?.shipping_address || ""} /></Field>
              </div>
            )}
            <div className={`grid items-start gap-3 ${itemType === "MATERIAL" ? "md:grid-cols-1" : "md:grid-cols-[2fr_.8fr_.8fr_.8fr]"}`}>
              <Field label="상품 URL">
                <div className="flex gap-2">
                  <input
                    className="field-input"
                    name="product_url"
                    placeholder="https://..."
                    value={productUrl}
                    onChange={(event) => setProductUrl(event.target.value)}
                  />
                  <a
                    className={`inline-flex h-[38px] shrink-0 items-center rounded-md border px-3 text-sm font-black ${productUrl ? "border-orange-200 bg-orange-50 text-orange-700" : "pointer-events-none border-slate-200 bg-slate-100 text-slate-400"}`}
                    href={productUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    바로가기
                  </a>
                </div>
              </Field>
              {itemType !== "MATERIAL" && (
                <>
                  <Field label="HS 코드"><input className="field-input" name="hs_code" placeholder="0000.00.0000" defaultValue={product?.hs_code || ""} /></Field>
                  <Field label="기본 관세율 (%)"><input className="field-input" type="number" step="0.1" name="basic_rate" defaultValue={product?.basic_rate || 0} /></Field>
                  <Field label="FTA 관세율 (%)"><input className="field-input" type="number" step="0.1" name="fta_rate" defaultValue={product?.fta_rate || 0} /></Field>
                </>
              )}
            </div>
            <Field label="메모"><textarea className="field-input" name="note" defaultValue={product?.note || ""} /></Field>
            {itemType === "PRODUCT" && (
              <section className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-black">옵션별 FN 품목 연동</h3>
                  <span className="text-xs font-bold text-slate-500">{fnSkuLinks.length.toLocaleString("ko-KR")}개 연결</span>
                </div>
                <div className="grid gap-3">
                  {linkGroups.map((optionName) => {
                    const groupLinks = optionName ? fnSkuLinks.filter((link) => sameImportOption(link, optionName)) : fnSkuLinks.filter((link) => !linkOptionName(link));
                    return (
                      <section key={optionName || "__default"} className="rounded-lg border border-orange-100 bg-orange-50/30 px-3 py-2">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-black">{optionName || "기본 옵션"}</p>
                            <p className="text-xs font-bold text-slate-500">연동 품목 {groupLinks.length.toLocaleString("ko-KR")}개</p>
                          </div>
                          <button
                            type="button"
                            className="h-8 rounded-md border border-orange-200 bg-white px-3 text-xs font-black text-orange-700"
                            onClick={() => {
                              setFnProductPickerOption(optionName);
                              setFnProductPickerOpen(true);
                            }}
                          >
                            FN 품목 연결
                          </button>
                        </div>
                        <div className="grid gap-2">
                          {groupLinks.map((link) => {
                            const fnProduct = link.product;
                            const variant = linkVariantLabel(link);
                            return (
                              <div key={`${optionName}:${link.product_id}`} className="grid items-center gap-2 border-b border-slate-100 py-2 text-sm last:border-b-0 md:grid-cols-[1.4fr_110px_1fr_88px]">
                                <div className="min-w-0">
                                  <p className="truncate font-black">{fnProductName(fnProduct)}</p>
                                  <p className="truncate text-xs font-bold text-slate-500">{fnProductSku(fnProduct)}</p>
                                </div>
                                <span className="truncate text-xs font-black text-slate-500">{variant || fnProductOption(fnProduct)}</span>
                                <span className="truncate text-xs font-bold text-slate-400">수량은 입고 반영 시 입력</span>
                                <button type="button" className="h-8 rounded-md border border-rose-200 text-xs font-black text-rose-600" onClick={() => setFnSkuLinks((prev) => prev.filter((item) => !(item.product_id === link.product_id && linkOptionName(item) === linkOptionName(link))))}>연결 해제</button>
                              </div>
                            );
                          })}
                          {!groupLinks.length && <p className="py-3 text-sm font-bold text-slate-400">이 옵션에 연결된 FN 품목이 없습니다.</p>}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </section>
            )}
            {itemType === "PRODUCT" && (
              <section className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-black">부자재 연동</h3>
                  <span className="text-xs font-bold text-slate-500">상품 1개당 사용 수량</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {(data?.materials || []).filter((material) => material.id !== id).map((material) => {
                    const checked = linkedMaterials.some((item) => item.material_id === material.id);
                    const linked = linkedMaterials.find((item) => item.material_id === material.id);
                    return (
                      <label key={material.id} className={`grid grid-cols-[20px_1fr_86px] items-center gap-2 border-b py-2 text-sm last:border-b-0 ${checked ? "border-orange-200" : "border-slate-100"}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMaterial(material)} />
                        <span>
                          <b>{material.name}</b>
                          <span className="ml-2 text-xs font-bold text-slate-500">재고 {Number(material.material_stock || 0).toLocaleString("ko-KR")}</span>
                        </span>
                        <input className="field-input h-8 text-right" type="number" min="0" step="0.01" disabled={!checked} value={linked?.quantity_per_unit || 1} onChange={(event) => setMaterialQty(material.id, event.target.value)} />
                      </label>
                    );
                  })}
                  {!data?.materials?.length && <p className="text-sm font-bold text-slate-500">등록된 부자재가 없습니다.</p>}
                </div>
              </section>
            )}
            {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{error}</p>}
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
              <div>
                {id && (
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-md border border-rose-300 px-4 text-sm font-black text-rose-600 disabled:opacity-50"
                    disabled={deleting || saving}
                    onClick={deleteProduct}
                  >
                    {deleting ? "삭제 중..." : "삭제"}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-bold" href={importHref("/products")}>취소</Link>
                <button className="inline-flex h-10 items-center justify-center rounded-md bg-orange-500 px-5 text-sm font-black text-white disabled:opacity-50" disabled={saving || deleting}>{saving ? "저장 중..." : "저장"}</button>
              </div>
            </div>
          </div>
        </form>
        {productLinkOpen && (
          <SelectionModal
            title="상품 선택"
            onClose={() => setProductLinkOpen(false)}
            size="xl"
            footer={<ActionButton type="button" onClick={() => setProductLinkOpen(false)}>완료</ActionButton>}
          >
              <div className="grid gap-3">
                <input className={modalInputClass} value={productLinkQuery} onChange={(event) => setProductLinkQuery(event.target.value)} placeholder="제품명 검색" />
                <div className="max-h-[58vh] overflow-auto rounded-xl border border-gray-200">
                  {(data?.products || [])
                    .filter((item) => !isMaterial(item) && item.id !== id)
                    .filter((item) => !productLinkQuery.trim() || item.name.toLowerCase().includes(productLinkQuery.trim().toLowerCase()))
                    .map((item) => {
                      const checked = linkedProducts.some((link) => link.product_id === item.id);
                      const linked = linkedProducts.find((link) => link.product_id === item.id);
                      return (
                        <div key={item.id} className="grid grid-cols-[72px_1fr_120px_96px] items-center gap-3 border-b border-gray-100 p-3 last:border-b-0 hover:bg-orange-50/40">
                          <div className="h-14 w-14 overflow-hidden rounded-md bg-slate-100">
                            {item.image_path && <img src={assetUrl(item.image_path)} alt={item.name} className="h-full w-full object-cover" />}
                          </div>
                          <div>
                            <p className="font-black">{item.name}</p>
                            <p className="text-xs font-bold text-slate-500">{item.factory_name || "-"}</p>
                          </div>
                          <input className={`${modalInputClass} h-9 text-right`} type="number" min="0" step="0.01" disabled={!checked} value={linked?.qty_per_product || linked?.quantity_per_unit || 1} onChange={(event) => setLinkedProductQty(item.id, event.target.value)} />
                          <button type="button" className={`h-9 rounded-lg px-4 text-sm font-black transition ${checked ? "border border-orange-300 bg-orange-50 text-orange-700" : "bg-[#ff6a00] text-white hover:bg-[#ea580c]"}`} onClick={() => toggleLinkedProduct(item)}>
                            {checked ? "선택됨" : "추가"}
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
          </SelectionModal>
        )}
        <FnProductPickerModal
          open={fnProductPickerOpen}
          selected={fnProductPickerOption ? fnSkuLinks.filter((link) => sameImportOption(link, fnProductPickerOption)) : fnSkuLinks.filter((link) => !linkOptionName(link))}
          optionName={fnProductPickerOption}
          importProductName={product?.name || ""}
          onClose={() => setFnProductPickerOpen(false)}
          onApply={(links) => {
            const primaryExists = links.some((link) => link.is_primary);
            const normalizedLinks = links.map((link, index) => ({
              ...link,
              option_name: fnProductPickerOption,
              group_label: fnProductPickerOption,
              import_option_key: fnProductPickerOption,
              import_option_name: fnProductPickerOption,
              match_group_label: fnProductPickerOption,
              sort_order: index,
              is_primary: primaryExists ? Boolean(link.is_primary) : index === 0,
            }));
            setFnSkuLinks((prev) => [
              ...prev.filter((link) => fnProductPickerOption ? !sameImportOption(link, fnProductPickerOption) : Boolean(linkOptionName(link))),
              ...normalizedLinks,
            ]);
            const primary = links.find((link) => link.is_primary) || links[0];
            if (primary?.product) {
              if (!product && primary.product.product_name) {
                const nameInput = document.querySelector<HTMLInputElement>('input[name="name"]');
                if (nameInput && !nameInput.value) nameInput.value = primary.product.product_name || "";
              }
              if (primary.product.image_url && !previewUrl && !pastedImageDataUrl) setPreviewUrl(primary.product.image_url);
            }
            setFnProductPickerOpen(false);
            setFnProductPickerOption("");
          }}
        />
        </>
      )}
    </div>
  );
}

function ImportReceiptModal({ detail, onClose }: { detail: ImportOrderDetail; onClose: () => void }) {
  const order = detail.order;
  const [linksByImportProduct, setLinksByImportProduct] = useState<Record<number, ImportSkuLink[]>>({});
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEscapeToClose(true, onClose);

  function linksForOrderItem(item: ImportOrderItem) {
    const importProductId = Number(item.product_id || 0);
    const links = linksByImportProduct[importProductId] || [];
    const optionValue = String(item.option_value || "").trim();
    const optionLinks = optionValue ? links.filter((link) => sameImportOption(link, optionValue)) : [];
    return optionLinks.length ? optionLinks : links.filter((link) => !linkOptionName(link));
  }

  function allocationKey(item: ImportOrderItem, link: ImportSkuLink) {
    return `${item.id || item.option_value || item.product_id}:${link.product_id}`;
  }

  const unitCostByOrderItem = useMemo(() => {
    const map = new Map<number, number>();
    (detail.cost_grid?.rows || []).forEach((row) => {
      const key = Number(row.order_item_id || 0);
      const cost = Number(row.estimated_unit_cost || 0);
      if (key && cost > 0) map.set(key, cost);
    });
    return map;
  }, [detail.cost_grid]);

  function receiptUnitCost(item: ImportOrderItem) {
    return unitCostByOrderItem.get(Number(item.id || 0)) || Number(item.unit_price || 0);
  }

  useEffect(() => {
    let alive = true;
    const productIds = Array.from(new Set((detail.items || []).map((item) => Number(item.product_id || 0)).filter(Boolean)));
    Promise.all(productIds.map((productId) => (
      cachedJson<{ links?: ImportSkuLink[] }>(`/api/fnos/import-product-links?import_product_id=${productId}`, 60_000)
        .then((data) => [productId, data.links || []] as const)
        .catch(() => [productId, []] as const)
    ))).then((entries) => {
      if (!alive) return;
      const nextLinks = Object.fromEntries(entries) as Record<number, ImportSkuLink[]>;
      setLinksByImportProduct(nextLinks);
      const nextAllocations: Record<string, number> = {};
      (detail.items || []).forEach((item) => {
        const importProductId = Number(item.product_id || 0);
        const links = (() => {
          const allLinks = nextLinks[importProductId] || [];
          const optionValue = String(item.option_value || "").trim();
          const optionLinks = optionValue ? allLinks.filter((link) => sameImportOption(link, optionValue)) : [];
          return optionLinks.length ? optionLinks : allLinks.filter((link) => !linkOptionName(link));
        })();
        const qty = Number(item.quantity || 0);
        const defaultQtyTotal = links.reduce((sum: number, link: ImportSkuLink) => sum + Number(link.default_qty || 0), 0);
        const ratioTotal = links.reduce((sum: number, link: ImportSkuLink) => sum + Number(link.default_ratio || 1), 0) || links.length || 1;
        links.forEach((link) => {
          nextAllocations[allocationKey(item, link)] = defaultQtyTotal > 0
            ? Math.round((qty * Number(link.default_qty || 0) / defaultQtyTotal) * 100) / 100
            : Math.round((qty * Number(link.default_ratio || 1) / ratioTotal) * 100) / 100;
        });
      });
      setAllocations(nextAllocations);
    });
    return () => {
      alive = false;
    };
  }, [detail.items]);

  function equalAllocate(item: ImportOrderItem, qty: number) {
    const links = linksForOrderItem(item);
    if (!links.length) return;
    const perQty = Math.round((qty / links.length) * 100) / 100;
    setAllocations((prev) => ({
      ...prev,
      ...Object.fromEntries(links.map((link) => [allocationKey(item, link), perQty])),
    }));
  }

  function ratioAllocate(item: ImportOrderItem, qty: number) {
    const links = linksForOrderItem(item);
    const total = links.reduce((sum: number, link: ImportSkuLink) => sum + Number(link.default_ratio || 1), 0) || 1;
    setAllocations((prev) => ({
      ...prev,
      ...Object.fromEntries(links.map((link) => [allocationKey(item, link), Math.round((qty * Number(link.default_ratio || 1) / total) * 100) / 100])),
    }));
  }

  async function saveReceipt() {
    setSaving(true);
    setMessage("");
    const rows = (detail.items || []).flatMap((item) => {
      const importProductId = Number(item.product_id || 0);
      return linksForOrderItem(item).map((link) => ({
        import_order_id: order.id,
        import_order_item_id: item.id,
        import_product_id: importProductId,
        import_option_key: item.option_value || "",
        import_option_name: item.option_value || "",
        product_id: link.product_id,
        sku: link.sku || link.product?.sku,
        allocated_qty: allocations[allocationKey(item, link)] || 0,
        unit_cost: receiptUnitCost(item),
      }));
    }).filter((row) => row.allocated_qty > 0);
    try {
      const res = await fetch("/api/fnos/import-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          purchase_date: order.fn_arrived || formatDateKey(new Date()),
          supplier_name: order.factory_name || "",
          source_ref_id: order.id,
          memo: `${order.repr_product || order.order_code || "수입관리"} / ${order.order_code || order.id} / ${order.shipping_method || ""} / ${order.note || ""}`,
          allocations: rows,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || "구매/입고 생성 실패");
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache(`/api/fnos/orders/${order.id}`);
      invalidateApiCache("/api/fnos/products");
      invalidateApiCache("/api/fnos/products/search");
      invalidateApiCache("/api/fnos/import-receipts");
      setMessage(`구매/입고 ${data.count || rows.length}건을 생성했습니다.`);
      window.setTimeout(onClose, 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "구매/입고 생성 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SelectionModal
      title="SKU별 수량 배분"
      description={`purchase_date = ${order.fn_arrived || "FN입고일 없음"}`}
      onClose={onClose}
      size="full"
      footer={
        <>
          <ActionButton type="button" variant="secondary" onClick={onClose}>나중에</ActionButton>
          <ActionButton type="button" disabled={saving} onClick={saveReceipt}>{saving ? "생성 중..." : "구매/입고 생성"}</ActionButton>
        </>
      }
    >
        <div className="grid max-h-[70vh] gap-4 overflow-auto">
          {(detail.items || []).map((item) => {
            const importProductId = Number(item.product_id || 0);
            const links = linksForOrderItem(item);
            const qty = Number(item.quantity || 0);
            const allocatedTotal = links.reduce((sum: number, link: ImportSkuLink) => sum + Number(allocations[allocationKey(item, link)] || 0), 0);
            return (
              <section key={item.id || importProductId} className="rounded-xl border border-gray-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
                  <div>
                    <b>{item.product_name || "-"}</b>
                    {item.option_value && <span className="ml-2 rounded bg-white px-2 py-1 text-xs font-black text-slate-500">{item.option_value}</span>}
                    <span className="ml-3 text-sm font-bold text-slate-500">수입 수량 {qty.toLocaleString("ko-KR")} / 배분 {allocatedTotal.toLocaleString("ko-KR")}</span>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={() => equalAllocate(item, qty)}>동일 수량</ActionButton>
                    <ActionButton type="button" variant="secondary" className="h-8 border-orange-200 bg-orange-50 px-3 text-xs text-orange-700 hover:bg-orange-100" onClick={() => ratioAllocate(item, qty)}>기본 비율</ActionButton>
                  </div>
                </div>
                <div className="grid gap-2 p-3">
                  {links.map((link) => {
                    const key = allocationKey(item, link);
                    const fnProduct = link.product;
                    return (
                      <div key={link.product_id} className="grid items-center gap-2 rounded-lg bg-white p-2 text-sm md:grid-cols-[44px_1fr_100px_120px_120px]">
                        <div className="h-10 w-10 overflow-hidden rounded-md bg-slate-100">{fnProduct?.image_url && <img src={fnProduct.image_url} alt="" className="h-full w-full object-cover" />}</div>
                        <div>
                          <p className="font-black">{fnProductName(fnProduct)}</p>
                          <p className="text-xs font-bold text-slate-500">{fnProductSku(fnProduct)} · 재고 {Number(fnProduct?.available_stock || 0).toLocaleString("ko-KR")}</p>
                        </div>
                        <span className="text-right text-xs font-bold text-slate-500">비율 {Number(link.default_ratio || 1)}</span>
                        <input className={`${modalInputClass} h-9 text-right`} type="number" min="0" step="0.01" value={allocations[key] || 0} onChange={(event) => setAllocations((prev) => ({ ...prev, [key]: Number(event.target.value || 0) }))} />
                        <span className="text-right font-black">{krw(receiptUnitCost(item))}</span>
                      </div>
                    );
                  })}
                  {!links.length && <p className="rounded-md bg-amber-50 px-3 py-3 text-sm font-bold text-amber-700">이 수입관리 제품에 연결된 FN OS SKU가 없습니다. 먼저 제품 상세에서 SKU를 연결해 주세요.</p>}
                </div>
              </section>
            );
          })}
          {message && <p className="rounded-md bg-orange-50 px-3 py-3 text-sm font-black text-orange-600">{message}</p>}
        </div>
    </SelectionModal>
  );
}

function NativeOrderDetail({ id }: { id: number }) {
  const [detail, setDetail] = useState<ImportOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    cachedJson<ImportOrderDetail>(`/api/fnos/orders/${id}`, 30_000)
      .then((next) => {
        if (alive) setDetail(next);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const key = `fnos-open-import-receipt-${id}`;
    if (localStorage.getItem(key) === "1") {
      localStorage.removeItem(key);
      setReceiptOpen(true);
    }
  }, [id]);

  const order = detail?.order;
  async function deleteOrder() {
    if (!confirm("이 발주를 삭제할까요?")) return;
    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/fnos/orders/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("삭제에 실패했습니다.");
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache("/api/fnos/dashboard");
      invalidateApiCache("/api/fnos/calendar-production-memos");
      window.dispatchEvent(new Event("fnos-calendar-refresh"));
      window.location.href = importHref("/orders");
    } catch {
      alert("삭제 요청이 서버에 닿지 않았습니다. 수입관리 서버를 확인해주세요.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Panel
      title={order?.order_code || "발주 상세"}
      subtitle={order ? `${order.factory_name || "-"} · ${order.status || "-"}` : "수입관리 발주 데이터"}
      action={
        order ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => setFolderOpen(true)} className="rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-black text-orange-600">
              📁 발주 폴더{Number(order.attachment_count || 0) > 0 ? ` ${order.attachment_count}` : ""}
            </button>
            <Link className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" href={importHref(`/orders/${id}/edit`)}>수정</Link>
          </div>
        ) : null
      }
    >
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : order ? (
        <div className="grid gap-5">
          <div className="flex justify-end">
            <div className="flex gap-2">
              {order.fn_arrived && (
                <button type="button" className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700" onClick={() => setReceiptOpen(true)}>구매/입고 생성</button>
              )}
              <button type="button" className="rounded-md border border-rose-300 px-4 py-2 text-sm font-black text-rose-600 disabled:opacity-50" onClick={deleteOrder} disabled={deleting}>삭제</button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Info label="발주일" value={order.order_date || "-"} />
            <Info label="결제일" value={order.paid_date || "-"} />
            <Info label="플랫폼" value={order.platform || "-"} />
            <Info label="배송방식" value={order.shipping_method || "-"} />
            <Info label="통화/환율" value={`${order.currency || "-"} / ${order.fx_rate || "-"}`} />
            <Info label="총수량" value={String(detail.total_qty || 0)} />
            <Info label="총금액" value={krw(detail.total_won)} />
            <Info label="메모" value={order.note || "-"} wide />
          </div>
          <section className="rounded-md border border-slate-200">
            <h3 className="border-b border-slate-200 px-4 py-3 font-black">제품 라인</h3>
            <div className="grid gap-2 p-4">
              {(detail.items || []).map((item, index) => (
                <div key={item.id || index} className="grid grid-cols-[48px_1fr_120px_90px_120px_1fr] items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
                  {item.image_path ? <img src={assetUrl(item.image_path)} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="h-12 w-12 rounded-md bg-slate-200" />}
                  <strong>{item.product_name || "-"}</strong>
                  <span>{item.option_value || "-"}</span>
                  <span className="text-right">{item.quantity || 0}</span>
                  <span className="text-right">{item.unit_price ? `${Number(item.unit_price).toLocaleString("ko-KR")} ${item.item_currency || ""}` : "-"}</span>
                  <span className="text-slate-500">{item.line_note || ""}</span>
                </div>
              ))}
            </div>
          </section>
          {folderOpen && (
            <OrderAttachmentModal
              order={order}
              onClose={() => setFolderOpen(false)}
              onChanged={(count) => setDetail((prev) => prev ? { ...prev, order: { ...prev.order, attachment_count: count } } : prev)}
            />
          )}
          {receiptOpen && detail && <ImportReceiptModal detail={detail} onClose={() => setReceiptOpen(false)} />}
        </div>
      ) : <p className="text-sm text-rose-600">발주를 찾을 수 없습니다.</p>}
    </Panel>
  );
}

function NativeOrderForm({ id, copyId }: { id?: number; copyId?: number }) {
  const { data, loading } = useImportFormData();
  const [order, setOrder] = useState<ImportOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(id || copyId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogOptions, setCatalogOptions] = useState<Record<number, string>>({});
  const [paymentMethod, setPaymentMethod] = useState("플랫폼 카드결제");
  const [productionDays, setProductionDays] = useState("");
  const [actualCurrency, setActualCurrency] = useState<ActualPaymentCurrency>("KRW");
  const [actualPayment, setActualPayment] = useState("");
  const [actualPayment1, setActualPayment1] = useState("");
  const [actualPayment2, setActualPayment2] = useState("");
  const [chinaCosts, setChinaCosts] = useState({
    shipping: "",
    fee: "",
    other: "",
    otherNote: "",
    currency: "CNY",
  });
  const [stageValues, setStageValues] = useState<StageValues>(stageValuesFromOrder(null));
  const [lines, setLines] = useState<OrderLine[]>([
    { product_id: "", product_name: "", option_value: "", quantity: "1", unit_price: "", item_currency: "CNY", line_note: "" },
  ]);
  const [orderLineLinks, setOrderLineLinks] = useState<Record<string, ImportSkuLink[]>>({});
  const [expandedSkuLines, setExpandedSkuLines] = useState<Record<number, boolean>>({});

  useEscapeToClose(catalogOpen, () => setCatalogOpen(false));

  useEffect(() => {
    const sourceId = id || copyId;
    if (!sourceId) return;
    let alive = true;
    const isCopy = !id && Boolean(copyId);
    cachedJson<ImportOrderDetail>(`/api/fnos/orders/${sourceId}`, 30_000)
      .then((next: ImportOrderDetail) => {
        if (!alive) return;
        const sourceOrder = next.order || null;
        const formOrder = sourceOrder && isCopy ? {
          ...sourceOrder,
          id: 0,
          order_code: "",
          parent_order_id: undefined,
          order_date: "",
          first_payment_date: "",
          paid_date: "",
          factory_ship_date: "",
          badaeji_arrived: "",
          customs_cleared: "",
          fn_arrived: "",
          production_due_date: null,
          production_memo: null,
          status: "",
        } as ImportOrder : sourceOrder;
        setOrder(formOrder);
        setPaymentMethod(formOrder?.payment_method || "플랫폼 카드결제");
        setProductionDays(formOrder?.production_days != null ? String(formOrder.production_days) : "");
        setActualCurrency(actualPaymentCurrency(formOrder));
        setActualPayment(actualPaymentSingle(formOrder));
        setActualPayment1(actualPaymentFirst(formOrder));
        setActualPayment2(actualPaymentSecond(formOrder));
        setChinaCosts({
          shipping: formOrder?.china_domestic_shipping != null ? String(formOrder.china_domestic_shipping) : "",
          fee: formOrder?.china_fee != null ? String(formOrder.china_fee) : "",
          other: formOrder?.china_other_cost != null ? String(formOrder.china_other_cost) : "",
          otherNote: formOrder?.china_other_note || "",
          currency: formOrder?.china_cost_currency || formOrder?.currency || "CNY",
        });
        setStageValues(stageValuesFromOrder(formOrder));
        setLines((next.items || []).map((item) => ({
          product_id: item.product_id ? String(item.product_id) : "",
          product_name: item.product_name || "",
          option_value: item.option_value || "",
          quantity: item.quantity ? String(item.quantity) : "1",
          unit_price: item.unit_price ? String(item.unit_price) : "",
          item_currency: item.item_currency || "CNY",
          line_note: item.line_note || "",
          image_path: item.image_path || "",
          item_type: item.item_type || "",
          materials: item.materials || [],
        })));
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, copyId]);

  useEffect(() => {
    let alive = true;
    const productIds = Array.from(new Set(lines.map((line) => String(line.product_id || "")).filter(Boolean)));
    Promise.all(productIds.map((productId) => (
      cachedJson<{ links?: ImportSkuLink[] }>(`/api/fnos/import-product-links?import_product_id=${productId}`, 60_000)
        .then((json) => [productId, json.links || []] as const)
        .catch(() => [productId, []] as const)
    ))).then((entries) => {
      if (alive) setOrderLineLinks(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [lines.map((line) => line.product_id).join("|")]);

  const blankLine: OrderLine = { product_id: "", product_name: "", option_value: "", quantity: "1", unit_price: "", item_currency: "CNY", line_note: "" };

  const catalogProducts = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    const products = query
      ? (data?.products || []).filter((product) => (
        [product.name, String(product.id), product.factory_name, product.options]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      ))
      : (data?.products || []);
    return [...products].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko-KR", { numeric: true, sensitivity: "base" }));
  }, [catalogQuery, data?.products]);

  const orderNativeTotals = lines.reduce<Record<string, number>>((totals, line) => {
    const currency = line.item_currency || "CNY";
    totals[currency] = (totals[currency] || 0) + (Number(line.quantity || 0) * Number(line.unit_price || 0));
    return totals;
  }, {});
  const chinaCostAmount = Number(chinaCosts.shipping || 0) + Number(chinaCosts.fee || 0) + Number(chinaCosts.other || 0);
  if (chinaCostAmount) {
    const currency = chinaCosts.currency || "CNY";
    orderNativeTotals[currency] = (orderNativeTotals[currency] || 0) + chinaCostAmount;
  }
  const fxRate = order?.fx_rate || data?.rates?.CNY || 195;
  const isTT = isTTPayment(paymentMethod);
  const actualPaymentValue = isTT ? Number(actualPayment1 || 0) + Number(actualPayment2 || 0) : Number(actualPayment || 0);
  const actualPaymentKrw = actualPaymentWon(actualPaymentValue, actualCurrency, data?.rates);
  const orderLineWon = lines.reduce((sum, line) => {
    return sum + (Number(line.quantity || 0) * Number(line.unit_price || 0) * Number(data?.rates?.[line.item_currency || "CNY"] || 0));
  }, 0) + (chinaCostAmount * Number(data?.rates?.[chinaCosts.currency || "CNY"] || 0));
  const orderTotalWon = Math.round(actualPaymentKrw > 0 ? actualPaymentKrw : orderLineWon);
  const formRateNote = rateNoteText(data?.rates, Object.keys(orderNativeTotals));
  const orderSummaryParts = [
    nativeTotalText(orderNativeTotals, "CNY"),
    ...(actualPaymentValue > 0 ? [actualCurrency === "KRW" ? krw(actualPaymentValue) : `${actualPaymentValue.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${actualCurrency}`] : []),
  ];
  const visibleStageValues = paymentMethod === "T/T송금" || paymentMethod === "TT송금" ? stageValues : { ...stageValues, first_payment_date: "" };

  function optionsFor(product?: ImportProduct) {
    return (product?.options || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function updateLine(index: number, patch: Partial<OrderLine>) {
    setLines((prev) => prev.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  function addProduct(product: ImportProduct) {
    const selectedOption = catalogOptions[product.id] || optionsFor(product)[0] || "";
    const productIsMaterial = isMaterial(product);
    const nextLine: OrderLine = {
      product_id: String(product.id),
      product_name: product.name || "",
      option_value: selectedOption,
      quantity: "1",
      unit_price: product.std_price ? String(product.std_price) : "",
      item_currency: product.currency || "CNY",
      line_note: productIsMaterial ? "재고이동: " : "",
      image_path: product.image_path || "",
      item_type: product.item_type || "",
      materials: product.materials || [],
    };
    setLines((prev) => {
      const emptyIndex = prev.findIndex((line) => !line.product_name && !line.product_id);
      if (emptyIndex === -1) return [...prev, nextLine];
      return prev.map((line, index) => index === emptyIndex ? nextLine : line);
    });
  }

  function addEmptyLine() {
    setLines((prev) => [...prev, { ...blankLine }]);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const paymentPayload = isTT
      ? {
        actual_payment_currency: actualCurrency,
        actual_payment_1: actualPayment1,
        actual_payment_2: actualPayment2,
        actual_payment_total: actualPaymentValue || "",
        actual_payment_total_krw: actualPaymentKrw || "",
        actual_payment_usd: actualCurrency === "USD" ? actualPaymentValue || "" : "",
        actual_payment_usd_1: actualCurrency === "USD" ? actualPayment1 : "",
        actual_payment_usd_2: actualCurrency === "USD" ? actualPayment2 : "",
      }
      : {
        actual_payment_currency: actualCurrency,
        actual_payment_1: "",
        actual_payment_2: "",
        actual_payment_total: actualPayment || "",
        actual_payment_total_krw: actualPaymentKrw || "",
        actual_payment_usd: actualCurrency === "USD" ? actualPayment : "",
        actual_payment_usd_1: "",
        actual_payment_usd_2: "",
      };
    try {
      const res = await fetch(apiUrl(id ? `/api/fnos/orders/${id}?minimal=1` : "/api/fnos/orders?minimal=1"), {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...payload,
          production_days: productionDays,
          china_domestic_shipping: chinaCosts.shipping,
          china_fee: chinaCosts.fee,
          china_other_cost: chinaCosts.other,
          china_other_note: chinaCosts.otherNote,
          china_cost_currency: chinaCosts.currency,
          ...paymentPayload,
          items: lines.filter(savableOrderLine),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "발주 저장에 실패했습니다.");
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache("/api/fnos/dashboard");
      invalidateApiCache("/api/fnos/calendar-production-memos");
      const savedId = id || json.order?.id;
      if (!order?.fn_arrived && visibleStageValues.fn_arrived && savedId) {
        const createNow = window.confirm("입고일이 저장되었습니다.\n이 발주건을 FN OS 구매/입고로 반영하시겠습니까?");
        if (createNow) {
          localStorage.setItem(`fnos-open-import-receipt-${savedId}`, "1");
          window.location.href = importHref(`/orders/${savedId}`);
          return;
        }
      }
      window.location.href = importHref("/orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "발주 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrder() {
    if (!id || !confirm("이 발주를 삭제할까요?")) return;
    try {
      const res = await fetch(apiUrl(`/api/fnos/orders/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("삭제에 실패했습니다.");
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache("/api/fnos/dashboard");
      invalidateApiCache("/api/fnos/calendar-production-memos");
      window.dispatchEvent(new Event("fnos-calendar-refresh"));
      window.location.href = importHref("/orders");
    } catch {
      alert("삭제 요청이 서버에 닿지 않았습니다. 수입관리 서버를 확인해주세요.");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const stageFields = paymentMethod === "T/T송금"
    ? [
      { label: "주문", name: "order_date", value: order?.order_date },
      { label: "1차결제", name: "first_payment_date", value: order?.first_payment_date },
      { label: "2차결제", name: "paid_date", value: order?.paid_date },
      { label: "공장출고", name: "factory_ship_date", value: order?.factory_ship_date },
      { label: "배대지도착", name: "badaeji_arrived", value: order?.badaeji_arrived },
      { label: "통관완료", name: "customs_cleared", value: order?.customs_cleared },
      { label: "FN입고", name: "fn_arrived", value: order?.fn_arrived },
    ]
    : [
      { label: "주문", name: "order_date", value: order?.order_date },
      { label: "결제완료", name: "paid_date", value: order?.paid_date },
      { label: "공장출고", name: "factory_ship_date", value: order?.factory_ship_date },
      { label: "배대지도착", name: "badaeji_arrived", value: order?.badaeji_arrived },
      { label: "통관완료", name: "customs_cleared", value: order?.customs_cleared },
      { label: "FN입고", name: "fn_arrived", value: order?.fn_arrived },
    ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{id ? "발주서 수정" : "새 발주서 작성"}</h2>
          <p className="mt-1 text-sm text-gray-500">발주 정보와 제품 라인을 입력합니다.</p>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{order?.order_code || "PO-NEW"}</span>
      </div>
      {loading || detailLoading ? <p className="text-sm text-slate-500">데이터를 불러오는 중...</p> : (
        <form key={order?.id || "new"} onSubmit={submit} onKeyDown={preventEnterSubmit} className="grid gap-5">
          <input type="hidden" name="platform" value={order?.platform || "FN_OS"} />
          <input type="hidden" name="currency" value={order?.currency || "CNY"} />
          <input type="hidden" name="fx_rate" value={String(fxRate)} />
          {Object.entries(visibleStageValues).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}

          <section className="grid gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="border-b border-slate-200 pb-2 text-base font-black">기본 정보</h3>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="발주처(공장)">
                <select className="field-input" name="factory_id" defaultValue={order?.factory_id || ""}>
                  <option value="">선택...</option>
                  {data?.factories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="결제방법">
                <select className="field-input" name="payment_method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                  {["플랫폼 카드결제", "T/T송금", "기타"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="운송방식">
                <select className="field-input" name="shipping_method" defaultValue={order?.shipping_method || "LCL"}>
                  {["LCL", "항공", "해운", "택배", "기타"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="예상 제작기간">
                <div className="grid grid-cols-[1fr_38px]">
                  <input className="field-input rounded-r-none px-3 py-2 text-right" type="number" min="0" step="1" value={productionDays} onChange={(event) => setProductionDays(event.target.value)} placeholder="7" />
                  <span className="bg-slate-50 px-2 py-2 text-center text-sm font-bold">일</span>
                </div>
              </Field>
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-end justify-between border-b border-slate-200 pb-2">
              <h3 className="text-base font-black">진행 상태</h3>
              <p className="text-xs font-bold text-slate-500">날짜는 필요한 단계만 입력하면 됩니다.</p>
            </div>
            <StageProgressLane paymentMethod={paymentMethod} values={visibleStageValues} onChange={(name, value) => setStageValues((prev) => ({ ...prev, [name]: value }))} />
          </section>

          <section className="grid gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="text-base font-black">제품 라인</h3>
              <div className="flex gap-2">
                <button type="button" className="inline-flex h-9 items-center rounded-lg bg-[#ff6a00] px-3 text-sm font-black text-white shadow-sm hover:bg-[#ea580c]" onClick={() => setCatalogOpen(true)}>카탈로그에서 추가</button>
                <button type="button" className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50" onClick={addEmptyLine}>직접 입력</button>
              </div>
            </div>
            <div className="hidden grid-cols-[76px_1.6fr_1fr_80px_160px_120px_1fr_40px] gap-3 border-b border-slate-200 px-2 py-2 text-sm font-black text-slate-600 xl:grid">
              <span>사진</span><span>제품</span><span>옵션</span><span>수량</span><span>단가 / 통화</span><span>소계</span><span>비고</span><span />
            </div>
            <div className="grid gap-2">
              {lines.map((line, index) => {
                const subtotal = Number(line.quantity || 0) * Number(line.unit_price || 0);
                const linkedSkus = (() => {
                  const links = orderLineLinks[String(line.product_id || "")] || [];
                  const optionLinks = line.option_value ? links.filter((link) => sameImportOption(link, line.option_value)) : [];
                  return optionLinks.length ? optionLinks : links.filter((link) => !linkOptionName(link));
                })();
                return (
                  <div key={index} className="grid items-start gap-3 border-b border-slate-200 py-3 xl:grid-cols-[76px_1.6fr_1fr_80px_160px_120px_1fr_40px]">
                    <div className="h-16 w-16 overflow-hidden rounded-md bg-slate-100">
                      {line.image_path ? <img src={assetUrl(line.image_path)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">사진</div>}
                    </div>
                    <input className="field-input" value={line.product_name} onChange={(e) => updateLine(index, { product_name: e.target.value, product_id: "" })} placeholder="제품명" />
                    <input className="field-input" value={line.option_value} onChange={(e) => updateLine(index, { option_value: e.target.value })} placeholder="옵션" />
                    <input className="field-input text-right" type="number" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} placeholder="수량" />
                    <div className="grid grid-cols-[1fr_76px] gap-2">
                      <input className="field-input text-right" type="number" step="0.01" value={line.unit_price} onChange={(e) => updateLine(index, { unit_price: e.target.value })} placeholder="단가" />
                      <select className="field-input" value={line.item_currency} onChange={(e) => updateLine(index, { item_currency: e.target.value })}>
                        {["CNY", "USD", "JPY", "KRW", "EUR"].map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="flex h-[38px] items-center justify-end text-sm font-black">{subtotal.toLocaleString("ko-KR")} {line.item_currency}</div>
                    {String(line.item_type || "").toUpperCase() === "MATERIAL" ? (
                      <p className="text-xs font-bold text-emerald-600 xl:col-span-5 xl:col-start-2 xl:row-start-2">부자재 입고 재고에 반영</p>
                    ) : line.materials?.length ? (
                      <p className={`text-xs font-bold xl:col-span-5 xl:col-start-2 xl:row-start-2 ${hasMaterialShortage(line.materials, line.quantity) ? "text-rose-600" : "text-slate-500"}`}>부자재: {materialNeedSummary(line.materials, line.quantity)}</p>
                    ) : null}
                    {linkedSkus.length > 0 && (
                      <div className="grid gap-1 text-xs font-bold xl:col-span-5 xl:col-start-2 xl:row-start-3">
                        <button
                          type="button"
                          className="w-fit rounded-md border border-orange-100 bg-orange-50 px-2 py-1 text-left font-black text-orange-700"
                          onClick={() => setExpandedSkuLines((prev) => ({ ...prev, [index]: !prev[index] }))}
                        >
                          {linkedSkus.length.toLocaleString("ko-KR")}개 품목 연동
                        </button>
                        {expandedSkuLines[index] && (
                          <div className="flex flex-wrap gap-1">
                            {linkedSkus.map((link) => (
                              <span key={`${linkOptionName(link)}:${link.product_id}`} className="rounded-md border border-orange-100 bg-orange-50 px-2 py-1 text-orange-700">
                                {linkVariantLabel(link) || fnProductSku(link.product)}{link.default_qty ? ` ${Number(link.default_qty).toLocaleString("ko-KR")}개` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <input className="field-input xl:col-start-7 xl:row-start-1" value={line.line_note} onChange={(e) => updateLine(index, { line_note: e.target.value })} placeholder={String(line.item_type || "").toUpperCase() === "MATERIAL" ? "재고이동: 수량입력" : "비고"} />
                    <button type="button" className="h-[38px] rounded-md border border-rose-200 text-rose-600 disabled:opacity-40 xl:col-start-8 xl:row-start-1" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>×</button>
                  </div>
                );
              })}
            </div>
            <div className="grid items-end gap-4 border-t border-slate-200 pt-4 md:grid-cols-[minmax(0,660px)_1fr]">
              <div className={`grid gap-3 rounded-lg border border-orange-100 bg-orange-50/30 p-3 ${isTT ? "md:grid-cols-[1fr_1fr_1fr_1.55fr]" : "md:grid-cols-2"}`}>
                {isTT ? (
                  <>
                    <Field label="실결제 통화">
                      <select className="field-input" value={actualCurrency} onChange={(event) => setActualCurrency(event.target.value as ActualPaymentCurrency)}>
                        <option>KRW</option>
                        <option>USD</option>
                        <option>CNY</option>
                      </select>
                    </Field>
                    <Field label={`1차 결제(${actualCurrency})`}><input className="field-input text-right" type="number" min="0" step="0.01" value={actualPayment1} onChange={(event) => setActualPayment1(event.target.value)} /></Field>
                    <Field label={`2차 결제(${actualCurrency})`}><input className="field-input text-right" type="number" min="0" step="0.01" value={actualPayment2} onChange={(event) => setActualPayment2(event.target.value)} /></Field>
                    <Field label={`최종 실 결제금액(${actualCurrency})`}><p className="whitespace-nowrap px-1 py-2 text-right text-sm font-black">{actualPaymentValue.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} {actualCurrency}</p></Field>
                  </>
                ) : (
                  <>
                    <Field label="실결제 통화">
                      <select className="field-input" value={actualCurrency} onChange={(event) => setActualCurrency(event.target.value as ActualPaymentCurrency)}>
                        <option>KRW</option>
                        <option>USD</option>
                        <option>CNY</option>
                      </select>
                    </Field>
                    <Field label={`실 결제금액(${actualCurrency})`}><input className="field-input text-right" type="number" min="0" step="0.01" value={actualPayment} onChange={(event) => setActualPayment(event.target.value)} placeholder="비우면 제품 라인 기준" /></Field>
                  </>
                )}
              </div>
              <div className="grid gap-1 text-right text-sm">
                <p className="font-black">
                  주문 합계: <span className="text-lg text-orange-600">{orderSummaryParts.join(" / ")}</span>
                </p>
                <p className="font-black">원화 주문 합계: <span className="text-lg text-orange-600">₩{orderTotalWon.toLocaleString("ko-KR")}</span></p>
                <p className="text-xs text-slate-500">환율 참고: {formRateNote}</p>
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 md:grid-cols-[1fr_1fr_1fr_1.2fr_110px]">
              <Field label="중국내 배송비"><input className="field-input text-right" type="number" name="china_domestic_shipping" value={chinaCosts.shipping} onChange={(event) => setChinaCosts((prev) => ({ ...prev, shipping: event.target.value }))} /></Field>
              <Field label="수수료"><input className="field-input text-right" type="number" name="china_fee" value={chinaCosts.fee} onChange={(event) => setChinaCosts((prev) => ({ ...prev, fee: event.target.value }))} /></Field>
              <Field label="중국내 기타금액"><input className="field-input text-right" type="number" name="china_other_cost" value={chinaCosts.other} onChange={(event) => setChinaCosts((prev) => ({ ...prev, other: event.target.value }))} /></Field>
              <Field label="기타 적요"><input className="field-input" name="china_other_note" value={chinaCosts.otherNote} onChange={(event) => setChinaCosts((prev) => ({ ...prev, otherNote: event.target.value }))} placeholder="인쇄비, 할인 등" /></Field>
              <Field label="통화">
                <select className="field-input" name="china_cost_currency" value={chinaCosts.currency} onChange={(event) => setChinaCosts((prev) => ({ ...prev, currency: event.target.value }))}>
                  {["CNY", "USD", "JPY", "KRW", "EUR"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="border-b border-slate-200 pb-2 text-base font-black">물류·통관 비용 (원)</h3>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="배대지 배송비"><input className="field-input text-right" type="number" name="shipping_cost" defaultValue={order?.shipping_cost || 0} /></Field>
              <Field label="관세"><input className="field-input text-right" type="number" name="customs_duty" defaultValue={order?.customs_duty || 0} /></Field>
              <Field label="부가세"><input className="field-input text-right" type="number" name="vat" defaultValue={order?.vat || 0} /></Field>
              <Field label="통관수수료"><input className="field-input text-right" type="number" name="customs_fee" defaultValue={order?.customs_fee || 0} /></Field>
              <Field label="식검비"><input className="field-input text-right" type="number" name="inspection_fee" defaultValue={order?.inspection_fee || 0} /></Field>
              <Field label="국내배송비"><input className="field-input text-right" type="number" name="domestic_shipping_cost" defaultValue={order?.domestic_shipping_cost || 0} /></Field>
              <Field label="기타비용"><input className="field-input text-right" type="number" name="other_cost" defaultValue={order?.other_cost || 0} /></Field>
            </div>
          </section>

          <Field label="메모"><textarea className="field-input" name="note" defaultValue={order?.note || ""} /></Field>
          {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-bold" href={importHref("/orders")}>취소</Link>
            {id && <button type="button" className="inline-flex h-10 items-center justify-center rounded-md border border-rose-300 px-4 text-sm font-black text-rose-600" onClick={deleteOrder}>삭제</button>}
            <button className="inline-flex h-10 items-center justify-center rounded-md bg-orange-500 px-5 text-sm font-black text-white disabled:opacity-50" disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
          </div>

          {catalogOpen && (
            <SelectionModal title="제품 선택" onClose={() => setCatalogOpen(false)} className="p-6">
              <div className="grid gap-3">
                <input className={modalInputClass} value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="제품명 검색" />
                <div className="grid max-h-[58vh] overflow-auto rounded-xl border border-gray-200">
                  {catalogProducts.map((product) => {
                    const options = optionsFor(product);
                    return (
                      <div key={product.id} className="grid min-h-[84px] items-center gap-3 border-b border-gray-100 px-3 py-3 last:border-b-0 hover:bg-orange-50/40 md:grid-cols-[68px_1fr_180px_90px]">
                        <div className="h-14 w-14 overflow-hidden rounded-lg bg-gray-100">
                          {product.image_path ? <img src={assetUrl(product.image_path)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-gray-400">사진</div>}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-gray-900">{product.name}</p>
                          <p className="mt-1 truncate text-xs font-medium text-gray-500">{product.factory_name || "-"} · {product.std_price ? `${product.std_price.toLocaleString("ko-KR")} ${product.currency || "CNY"}` : "단가 없음"}</p>
                        </div>
                        {options.length ? (
                          <select className={modalSelectClass} value={catalogOptions[product.id] || options[0]} onChange={(event) => setCatalogOptions((prev) => ({ ...prev, [product.id]: event.target.value }))}>
                            {options.map((option) => <option key={option}>{option}</option>)}
                          </select>
                        ) : <span className="text-sm font-semibold text-gray-500">옵션 없음</span>}
                        <ActionButton type="button" onClick={() => addProduct(product)}>추가</ActionButton>
                      </div>
                    );
                  })}
                  {!catalogProducts.length && <p className="bg-gray-50 p-5 text-center text-sm font-semibold text-gray-500">등록된 제품이 없습니다.</p>}
                </div>
              </div>
            </SelectionModal>
          )}
        </form>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyNativeOrderForm({ id }: { id?: number }) {
  const { data, loading } = useImportFormData();
  const [order, setOrder] = useState<ImportOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([
    { product_id: "", product_name: "", option_value: "", quantity: "1", unit_price: "", item_currency: "CNY", line_note: "" },
  ]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    cachedJson<ImportOrderDetail>(`/api/fnos/orders/${id}`, 30_000)
      .then((next: ImportOrderDetail) => {
        if (!alive) return;
        setOrder(next.order || null);
        setLines((next.items || []).map((item) => ({
          product_id: item.product_id ? String(item.product_id) : "",
          product_name: item.product_name || "",
          option_value: item.option_value || "",
          quantity: item.quantity ? String(item.quantity) : "",
          unit_price: item.unit_price ? String(item.unit_price) : "",
          item_currency: item.item_currency || "CNY",
          line_note: item.line_note || "",
        })));
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  function updateLine(index: number, patch: Partial<OrderLine>) {
    setLines((prev) => prev.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  function pickProduct(index: number, productId: string) {
    const product = data?.products.find((item) => String(item.id) === productId);
    updateLine(index, {
      product_id: productId,
      product_name: product?.name || "",
      option_value: product?.options?.split(",")[0]?.trim() || "",
      unit_price: product?.std_price ? String(product.std_price) : "",
      item_currency: product?.currency || "CNY",
      line_note: product && isMaterial(product) ? "재고이동: " : "",
      image_path: product?.image_path || "",
      item_type: product?.item_type || "",
      materials: product?.materials || [],
    });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const res = await fetch(apiUrl(id ? `/api/fnos/orders/${id}` : "/api/fnos/orders"), {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...payload, items: lines.filter(savableOrderLine) }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "발주 저장에 실패했습니다.");
      window.location.href = importHref(id ? `/orders/${id}` : "/orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "발주 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={id ? "발주 수정" : "새 발주 등록"} subtitle="발주 기본정보와 제품 라인을 FN OS에서 바로 저장합니다.">
      {loading || detailLoading ? <p className="text-sm text-slate-500">폼 데이터를 불러오는 중...</p> : (
        <form key={order?.id || "new"} onSubmit={submit} onKeyDown={preventEnterSubmit} className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="주공장">
              <select className="field-input" name="factory_id" defaultValue={order?.factory_id || ""}>
                <option value="">선택 안함</option>
                {data?.factories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="플랫폼"><input className="field-input" name="platform" placeholder="1688 / 알리바바" defaultValue={order?.platform || ""} /></Field>
            <Field label="통화">
              <select className="field-input" name="currency" defaultValue={order?.currency || "CNY"}>
                {["CNY", "USD", "JPY", "KRW", "EUR"].map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="환율"><input className="field-input" type="number" step="0.01" name="fx_rate" defaultValue={order?.fx_rate || data?.rates.CNY || 195} /></Field>
            <Field label="발주일"><input className="field-input" type="date" name="order_date" defaultValue={order?.order_date || ""} /></Field>
            <Field label="결제일"><input className="field-input" type="date" name="paid_date" defaultValue={order?.paid_date || ""} /></Field>
            <Field label="결제수단"><input className="field-input" name="payment_method" defaultValue={order?.payment_method || ""} /></Field>
            <Field label="배송방식"><input className="field-input" name="shipping_method" placeholder="LCL / 항공 / 택배" defaultValue={order?.shipping_method || ""} /></Field>
          </div>

          <section className="rounded-md border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="font-black">제품 라인</h3>
              <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold" onClick={() => setLines((prev) => [...prev, { product_id: "", product_name: "", option_value: "", quantity: "1", unit_price: "", item_currency: "CNY", line_note: "" }])}>+ 라인 추가</button>
            </div>
            <div className="grid gap-3 p-4">
              {lines.map((line, index) => (
                <div key={index} className="grid gap-3 rounded-md bg-slate-50 p-3 xl:grid-cols-[1fr_1fr_100px_130px_110px_1fr_40px]">
                  <select className="field-input" value={line.product_id} onChange={(e) => pickProduct(index, e.target.value)}>
                    <option value="">카탈로그 선택</option>
                    {data?.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <input className="field-input" value={line.product_name} onChange={(e) => updateLine(index, { product_name: e.target.value })} placeholder="제품명" />
                  <input className="field-input" value={line.option_value} onChange={(e) => updateLine(index, { option_value: e.target.value })} placeholder="옵션" />
                  <input className="field-input" type="number" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} placeholder="수량" />
                  <input className="field-input" type="number" step="0.01" value={line.unit_price} onChange={(e) => updateLine(index, { unit_price: e.target.value })} placeholder="단가" />
                  <input className="field-input" value={line.line_note} onChange={(e) => updateLine(index, { line_note: e.target.value })} placeholder="비고" />
                  <button type="button" className="rounded-md border border-rose-200 text-rose-600 disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>×</button>
                </div>
              ))}
            </div>
          </section>

          <Field label="메모"><textarea className="field-input min-h-24" name="note" defaultValue={order?.note || ""} /></Field>
          {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold" href={importHref("/orders")}>취소</Link>
            <button className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white disabled:opacity-50" disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm font-black text-slate-700">
      <span className="leading-5">{label}</span>
      {children}
    </div>
  );
}

function Info({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-md bg-slate-50 px-3 py-3 ${wide ? "md:col-span-2" : ""}`}>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm font-black text-slate-900">{value}</p>
    </div>
  );
}

function NativeSettings() {
  const [data, setData] = useState<{ rates: Record<string, number>; factories: ImportFactory[] } | null>(null);
  const [ratesDraft, setRatesDraft] = useState<Record<string, string>>({ CNY: "", USD: "", JPY: "", EUR: "" });
  const [saving, setSaving] = useState(false);
  const [factoryFormOpen, setFactoryFormOpen] = useState(false);
  const [factoryDraft, setFactoryDraft] = useState({ name: "", country: "중국", platform: "1688", contact: "", note: "" });

  async function loadSettings() {
    const next = await cachedJson<{ rates?: Record<string, number>; factories?: ImportFactory[] }>("/api/fnos/settings", 0);
    const rates = next.rates || {};
    setData({ rates, factories: sortFactories(next.factories || []) });
    setRatesDraft({
      CNY: rates.CNY ? String(rates.CNY) : "",
      USD: rates.USD ? String(rates.USD) : "",
      JPY: rates.JPY ? String(rates.JPY) : "",
      EUR: rates.EUR ? String(rates.EUR) : "",
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSettings();
  }, []);

  async function saveRates(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    await fetch(apiUrl("/api/fnos/settings/rates"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(ratesDraft),
    });
    invalidateApiCache("/api/fnos/settings");
    invalidateApiCache("/api/fnos/form-data");
    await loadSettings();
    setSaving(false);
  }

  async function addFactory() {
    if (!factoryDraft.name.trim()) return;
    setSaving(true);
    await fetch(apiUrl("/api/fnos/factories"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...factoryDraft, note_lines: factoryDraft.note.split(/\r?\n/) }),
    });
    invalidateApiCache("/api/fnos/settings");
    invalidateApiCache("/api/fnos/form-data");
    setFactoryDraft({ name: "", country: "중국", platform: "1688", contact: "", note: "" });
    setFactoryFormOpen(false);
    await loadSettings();
    setSaving(false);
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[360px_1fr]">
      <Panel title="환율" subtitle="KRW 기준 기본 환율" className="h-fit self-start">
        <form onSubmit={saveRates} onKeyDown={preventEnterSubmit} className="grid gap-3 sm:grid-cols-2">
          {(["CNY", "USD", "JPY", "EUR"] as const).map((currency) => (
            <Field key={currency} label={`${currency} → KRW`}>
              <input
                className="field-input text-right"
                type="number"
                step="0.0001"
                name={currency}
                value={ratesDraft[currency] || ""}
                onChange={(event) => setRatesDraft((prev) => ({ ...prev, [currency]: event.target.value }))}
              />
            </Field>
          ))}
          <div className="sm:col-span-2 flex justify-end">
            <button className="inline-flex h-10 items-center rounded-md bg-orange-500 px-5 text-sm font-black text-white disabled:opacity-50" disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
          </div>
        </form>
      </Panel>

      <Panel title="공급사/공장" subtitle={`${data?.factories?.length || 0}개`}>
        <div className="grid gap-4">
          {!factoryFormOpen && (
            <div className="flex justify-end">
              <button type="button" className="inline-flex h-10 items-center rounded-md bg-orange-500 px-5 text-sm font-black text-white" onClick={() => setFactoryFormOpen(true)}>공급사 추가</button>
            </div>
          )}
          <section className={`rounded-md border border-slate-200 p-4 ${factoryFormOpen ? "" : "hidden"}`}>
            <h3 className="mb-3 text-base font-black">새 공급사 추가</h3>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="공급사명 *"><input className="field-input" value={factoryDraft.name} onChange={(e) => setFactoryDraft((prev) => ({ ...prev, name: e.target.value }))} /></Field>
              <Field label="국가"><input className="field-input" value={factoryDraft.country} onChange={(e) => setFactoryDraft((prev) => ({ ...prev, country: e.target.value }))} /></Field>
              <Field label="플랫폼"><input className="field-input" value={factoryDraft.platform} onChange={(e) => setFactoryDraft((prev) => ({ ...prev, platform: e.target.value }))} /></Field>
              <Field label="담당자"><input className="field-input" value={factoryDraft.contact} onChange={(e) => setFactoryDraft((prev) => ({ ...prev, contact: e.target.value }))} /></Field>
              <div className="md:col-span-4">
                <p className="mb-1.5 text-sm font-black text-slate-700">메모</p>
                <textarea className="field-input" value={factoryDraft.note} onChange={(e) => setFactoryDraft((prev) => ({ ...prev, note: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) e.currentTarget.rows += 1; }} />
              </div>
              <div className="md:col-span-4 flex justify-end"><button type="button" className="inline-flex h-10 items-center rounded-md bg-orange-500 px-5 text-sm font-black text-white" onClick={addFactory} disabled={saving}>공급사 추가</button></div>
            </div>
          </section>
          <div className="grid gap-2">
            {(data?.factories || []).map((factory) => <FactorySettingsCard key={factory.id} factory={factory} onSaved={loadSettings} />)}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function FactorySettingsCard({ factory, onSaved }: { factory: ImportFactory; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ ...factory, note: factory.note || "" });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(apiUrl(`/api/fnos/factories/${factory.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...draft, note_lines: draft.note.split(/\r?\n/) }),
    });
    invalidateApiCache("/api/fnos/settings");
    invalidateApiCache("/api/fnos/form-data");
    await onSaved();
    setSaving(false);
  }

  async function deleteFactory() {
    if (!confirm("이 공급사를 삭제할까요?")) return;
    setSaving(true);
    await fetch(apiUrl(`/api/fnos/factories/${factory.id}`), {
      method: "DELETE",
      credentials: "include",
    });
    invalidateApiCache("/api/fnos/settings");
    invalidateApiCache("/api/fnos/form-data");
    await onSaved();
    setSaving(false);
  }

  return (
    <div className="rounded-md border border-slate-200">
      <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setOpen((prev) => !prev)}>
        <span><b>{factory.name}</b><small className="ml-2 text-slate-500">{factory.platform || "-"} · 제품 {factory.product_count || 0}개 · 발주 {factory.order_count || 0}건</small></span>
        <span className="text-slate-500">{open ? "접기" : "수정"}</span>
      </button>
      {open && (
        <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-4">
          <Field label="공급사명"><input className="field-input" value={draft.name || ""} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} /></Field>
          <Field label="국가"><input className="field-input" value={draft.country || ""} onChange={(e) => setDraft((prev) => ({ ...prev, country: e.target.value }))} /></Field>
          <Field label="플랫폼"><input className="field-input" value={draft.platform || ""} onChange={(e) => setDraft((prev) => ({ ...prev, platform: e.target.value }))} /></Field>
          <Field label="담당자"><input className="field-input" value={draft.contact || ""} onChange={(e) => setDraft((prev) => ({ ...prev, contact: e.target.value }))} /></Field>
          <div className="md:col-span-4"><p className="mb-1.5 text-sm font-black text-slate-700">메모</p><textarea className="field-input" value={draft.note || ""} onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))} /></div>
          <div className="md:col-span-4 flex justify-end gap-2">
            <button type="button" className="inline-flex h-10 items-center rounded-md border border-rose-300 px-5 text-sm font-black text-rose-600" disabled={saving} onClick={deleteFactory}>삭제</button>
            <button type="button" className="inline-flex h-10 items-center rounded-md bg-orange-500 px-5 text-sm font-black text-white" disabled={saving} onClick={save}>{saving ? "저장 중..." : "저장"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyNativeSettings() {
  const [data, setData] = useState<{ rates: Record<string, number>; factories: ImportFactory[] } | null>(null);

  useEffect(() => {
    let alive = true;
    cachedJson<{ rates: Record<string, number>; factories: ImportFactory[] }>("/api/fnos/settings", 60_000)
      .then((next) => {
        if (alive) setData(next);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <Panel title="환율" subtitle="수입관리 설정값">
        <div className="grid gap-2">
          {Object.entries(data?.rates || {}).map(([currency, rate]) => (
            <div key={currency} className="flex justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
              <strong>{currency}</strong>
              <span>{rate.toLocaleString("ko-KR")}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="공급사/공장" subtitle={`${data?.factories?.length || 0}개`}>
        <div className="grid gap-2">
          {(data?.factories || []).map((factory) => (
            <div key={factory.id} className="rounded-md border border-slate-200 p-3">
              <div className="font-black">{factory.name}</div>
              <div className="mt-1 text-xs text-slate-500">{factory.country || "-"} · 제품 {factory.product_count || 0} · 발주 {factory.order_count || 0}</div>
              {factory.note && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{factory.note}</p>}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`p-5 ${className}`}>
      <SectionHeader title={title} description={subtitle} actions={action} />
      {children}
    </Card>
  );
}

function StatusPill({ status }: { status?: string }) {
  const label = status || "-";
  const tone = (() => {
    if (["주문", "1차결제", "2차결제", "결제완료", "위험", "FAIL"].includes(label)) return "danger";
    if (["공장출고", "배대지도착", "대기", "보류"].includes(label)) return "warning";
    if (["통관완료", "FN입고", "입고완료", "정상", "SAVED"].includes(label)) return "success";
    if (label === "SET" || label === "RG") return "orange";
    return "muted";
  })();
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

type SalesSheetName = "송장출력용" | "FN송장입력" | "FN판매입력";

const salesSheetHeaders: Record<SalesSheetName, string[]> = {
  송장출력용: ["쇼핑몰코드", "송장번호", "수취인", "수취인연락처1", "수취인연락처2", "우편번호", "주소", "주문옵션", "수량", "배송요청사항", "정산예정금액"],
  FN송장입력: ["쇼핑몰코드", "주문번호", "묶음주문번호", "배송방법코드", "송장번호"],
  "FN판매입력": ["일자", "순번", "거래처코드", "거래처명", "담당자", "출하창고", "거래유형", "통화", "환율", "품목코드", "품목명", "규격", "수량", "단가(vat포함)", "외화금액", "공급가액", "적요", "생산전표생성", "결과"],
};

const salesInitialRows: Record<SalesSheetName, string[][]> = {
  송장출력용: [],
  FN송장입력: [],
  "FN판매입력": [],
};

function makeSheetRows(sheet: SalesSheetName, minRows = 18) {
  const headers = salesSheetHeaders[sheet];
  const rows = [...salesInitialRows[sheet]];
  while (rows.length < minRows) rows.push(headers.map(() => ""));
  return rows;
}

function padSalesRows(sheet: SalesSheetName, rows: string[][], minRows = 18) {
  const headers = salesSheetHeaders[sheet];
  const next = rows.map((row) => headers.map((_, index) => row[index] || ""));
  while (next.length < minRows) next.push(headers.map(() => ""));
  return next;
}

function hasSalesRows(rows: string[][]) {
  return rows.some((row) => row.some((cell) => String(cell || "").trim()));
}

function classifyOrderUploadFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (/esk\d*m/i.test(fileName) || fileName.toLowerCase().includes("legacy-order")) return "레거시 주문수집";
  if (fileName.includes("배송목록") || fileName.includes("현대이지웰") || fileName.includes("이지웰")) return "현대 이지웰";
  if (fileName.includes("주문배송 내역") || fileName.includes("오늘의집") || fileName.includes("오늘의 집")) return "오늘의 집";
  if (fileName.includes("주문배송관리-상품준비중") || fileName.includes("토스")) return "토스";
  return "";
}

function salesUploadFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function classifyInvoiceUploadFileName(fileName: string) {
  if (fileName.includes("파일접수 상세내역") || fileName.toLowerCase().includes("fn0310")) return "송장파일";
  return "";
}

function salesUploadBadge(fileName: string, kind: "orders" | "invoices") {
  const orderType = kind === "orders" ? classifyOrderUploadFileName(fileName) : "";
  const invoiceType = kind === "invoices" ? classifyInvoiceUploadFileName(fileName) || "송장파일" : "";
  const type = orderType || invoiceType;
  if (type === "레거시 주문수집") return { mark: "E", label: "레거시", className: "border-blue-200 bg-blue-50 text-blue-700" };
  if (type === "오늘의 집") return { mark: "O", label: "오늘의 집", className: "border-violet-200 bg-violet-50 text-violet-700" };
  if (type === "현대 이지웰") return { mark: "Z", label: "이지웰", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (type === "토스") return { mark: "T", label: "토스", className: "border-sky-200 bg-sky-50 text-sky-700" };
  if (type === "송장파일") return { mark: "CJ", label: "송장", className: "border-indigo-200 bg-indigo-50 text-indigo-700" };
  return { mark: "?", label: "미확인", className: "border-slate-200 bg-white text-slate-600" };
}

type SalesSortToken = { raw: string; rank: number; numberValue: number | null };

function salesSortTokenize(value: string): SalesSortToken[] {
  const cleaned = String(value || "")
    .replace(/\[[^\]]+\]/g, "")
    .trim()
    .toLowerCase();
  const matches = cleaned.match(/[A-Za-z]+|\d+(?:\.\d+)?|[\uAC00-\uD7A3]+|[^A-Za-z0-9\uAC00-\uD7A3]+/g) || [];
  return matches
    .map((raw) => {
      const numberValue = /^\d/.test(raw) ? Number(raw) : null;
      const rank = numberValue !== null && Number.isFinite(numberValue)
        ? 0
        : /^[A-Za-z]+$/.test(raw)
          ? 1
          : /^[\uAC00-\uD7A3]+$/.test(raw)
            ? 2
            : 3;
      return { raw, rank, numberValue };
    })
    .filter((token) => token.raw.trim() || token.rank !== 3);
}

function compareMixedKoreanText(a: string, b: string) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftTokens = salesSortTokenize(left);
  const rightTokens = salesSortTokenize(right);
  const length = Math.max(leftTokens.length, rightTokens.length);

  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (!leftToken) return -1;
    if (!rightToken) return 1;

    if (leftToken.rank !== rightToken.rank) return leftToken.rank - rightToken.rank;

    if (leftToken.numberValue !== null && rightToken.numberValue !== null) {
      const diff = leftToken.numberValue - rightToken.numberValue;
      if (diff !== 0) return diff;
      continue;
    }

    const locale = leftToken.rank === 0 ? "en" : "ko";
    const diff = leftToken.raw.localeCompare(rightToken.raw, locale, { numeric: true, sensitivity: "base" });
    if (diff !== 0) return diff;
  }

  return left.localeCompare(right, "ko", { numeric: true, sensitivity: "base" });
}

function sortShippingRowsByOption(rows: string[][]) {
  const optionIndex = salesSheetHeaders.송장출력용.indexOf("주문옵션");
  return [...rows].sort((a, b) => compareMixedKoreanText(String(a[optionIndex] || ""), String(b[optionIndex] || "")));
}

function salesCellText(value: unknown) {
  return String(value || "").trim();
}

function rowHasValue(row: string[]) {
  return row.some((cell) => salesCellText(cell));
}

function salesRowObject(sheet: SalesSheetName, row: string[]) {
  return Object.fromEntries(salesSheetHeaders[sheet].map((header, index) => [header, salesCellText(row[index])]));
}

function salesMoneyValue(value: unknown) {
  const normalized = salesCellText(value).replace(/[^\d.-]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function salesSupplyAmountTotal(rows: string[][]) {
  const supplyIndex = salesSheetHeaders["FN판매입력"].indexOf("공급가액");
  if (supplyIndex < 0) return 0;
  return rows.reduce((sum, row) => sum + salesMoneyValue(row[supplyIndex]), 0);
}

function importResultText(data: Record<string, unknown>, fallback = "") {
  const total = Number(data.total_count || 0);
  const success = Number(data.success_count || 0);
  const fail = Number(data.fail_count || 0);
  const saved = Number(data.db_saved_count || 0);
  const results = Array.isArray(data.results) ? data.results as Array<Record<string, unknown>> : [];
  const reasons = Array.from(
    new Set(
      [
        data.message,
        data.error,
        ...results.map((item) => item.message),
      ]
        .map((value) => salesCellText(value))
        .filter(Boolean),
    ),
  );
  return [
    fallback,
    `DB 저장: ${saved || success || total}건`,
    `성공: ${success}건`,
    `실패: ${fail}건`,
    `이유: ${reasons.join(" / ") || "정상 처리되었습니다."}`,
  ].filter(Boolean).join("\n");
}

type ParsedInvoiceTrackingRow = {
  trackingNo?: string;
  recipient?: string;
  phone?: string;
  address?: string;
  productCode?: string;
  fileName?: string;
  sourceRow?: number;
};

function normalizeInvoiceName(value: unknown) {
  return salesCellText(value).replace(/\s+/g, "");
}

function normalizeInvoicePhone(value: unknown) {
  return salesCellText(value).replace(/[-\s()]/g, "");
}

function normalizeInvoiceAddress(value: unknown) {
  return salesCellText(value).replace(/\s+/g, "");
}

function invoiceMatchKey(name: unknown, phone: unknown, address: unknown) {
  return `${normalizeInvoiceName(name)}|${normalizeInvoicePhone(phone)}|${normalizeInvoiceAddress(address)}`;
}

function invoiceProductCodeKey(value: unknown) {
  return salesCellText(value).toUpperCase().replace(/\s+/g, "");
}

function looksLikeInvoicePhone(value: unknown) {
  return normalizeInvoicePhone(value).length >= 8;
}

function normalizeShippingRowForTracking(row: string[]) {
  const expectedLength = salesSheetHeaders.송장출력용.length;
  const legacyWithoutTracking = rowHasValue(row)
    && row.length <= expectedLength - 1
    && salesCellText(row[1])
    && looksLikeInvoicePhone(row[2])
    && looksLikeInvoicePhone(row[3]);
  if (!legacyWithoutTracking) return [...row];
  return [row[0] || "", "", ...row.slice(1)];
}

const invoiceMallCodeByAlias: Record<string, string> = {
  FN: "00001",
  FF: "00002",
  "11": "00003",
  C: "00004",
  G: "00005",
  A: "00006",
  K: "00007",
  S: "00008",
  L: "00009",
};

function parseShippingCode(value: string) {
  const parts = salesCellText(value).split("-");
  const alias = parts[1] || "";
  const serial = Number((parts[2] || "").replace(/\D/g, ""));
  return {
    alias,
    mallCode: invoiceMallCodeByAlias[alias] || alias,
    serial: Number.isFinite(serial) ? serial : 0,
  };
}

function isInvoiceInputExcludedMall(aliasOrCode: string, productCode?: string) {
  const value = salesCellText(aliasOrCode);
  const product = salesCellText(productCode).toUpperCase();
  if (["L", "S", "O", "T", "Z"].includes(value)) return true;
  if (["00008", "00009"].includes(value)) return true;
  if (/^\d{4}-[LSOTZ]-/i.test(product)) return true;
  return false;
}

function invoiceFailureReport(shippingRows: string[], invoiceRows: string[]) {
  return [
    `송장출력용 매칭 실패 : ${shippingRows.length}건`,
    shippingRows.length ? shippingRows.join(", ") : "-",
    "",
    `FN송장입력 매칭 실패 : ${invoiceRows.length}건`,
    invoiceRows.length ? invoiceRows.join(", ") : "-",
  ].join("\n");
}

function applyInvoiceTrackingToSheets(
  currentSheets: Record<SalesSheetName, string[][]>,
  parsedSheets: Partial<Record<SalesSheetName, string[][]>>,
  invoiceRows: ParsedInvoiceTrackingRow[] = [],
) {
  if (invoiceRows.length) {
    const nextShipping = currentSheets.송장출력용.map((row) => normalizeShippingRowForTracking(row));
    const nextInvoice = currentSheets.FN송장입력.map((row) => [...row]);
    const usedShipping = new Set<number>();
    const failedShippingIndexes = new Set<number>();
    let matchedShipping = 0;
    let matchedInvoice = 0;
    const failedInvoiceIndexes = new Set<number>();
    let alreadyMatchedShipping = 0;
    let alreadyMatchedInvoice = 0;

    const invoiceRowsByMall = new Map<string, number[]>();
    nextInvoice.forEach((row, index) => {
      const mallCode = salesCellText(row[0]);
      if (!mallCode) return;
      const list = invoiceRowsByMall.get(mallCode) || [];
      list.push(index);
      invoiceRowsByMall.set(mallCode, list);
    });

    invoiceRows.forEach((invoiceRow) => {
      const trackingNo = salesCellText(invoiceRow.trackingNo);
      const invoiceKey = invoiceMatchKey(invoiceRow.recipient, invoiceRow.phone, invoiceRow.address);
      const productKey = invoiceProductCodeKey(invoiceRow.productCode);
      const shippingIndexByAddress = nextShipping.findIndex((row, index) => {
        if (usedShipping.has(index) || !rowHasValue(row) || salesCellText(row[1])) return false;
        const name = row[2];
        const phone1 = row[3];
        const phone2 = row[4];
        const address = row[6];
        return invoiceKey === invoiceMatchKey(name, phone1, address) || invoiceKey === invoiceMatchKey(name, phone2, address);
      });
      const shippingIndexByCode = productKey
        ? nextShipping.findIndex((row, index) => (
          !usedShipping.has(index)
          && rowHasValue(row)
          && !salesCellText(row[1])
          && invoiceProductCodeKey(row[0]) === productKey
        ))
        : -1;
      const shippingIndex = shippingIndexByAddress >= 0 ? shippingIndexByAddress : shippingIndexByCode;

      if (shippingIndex < 0) {
        const alreadyIndex = nextShipping.findIndex((row) => {
          if (!rowHasValue(row) || salesCellText(row[1]) !== trackingNo) return false;
          const name = row[2];
          const phone1 = row[3];
          const phone2 = row[4];
          const address = row[6];
          return invoiceKey === invoiceMatchKey(name, phone1, address)
            || invoiceKey === invoiceMatchKey(name, phone2, address)
            || (productKey && invoiceProductCodeKey(row[0]) === productKey);
        });
        if (alreadyIndex >= 0) alreadyMatchedShipping += 1;
        const highlightIndex = productKey
          ? nextShipping.findIndex((row) => rowHasValue(row) && invoiceProductCodeKey(row[0]) === productKey)
          : -1;
        if (highlightIndex >= 0) failedShippingIndexes.add(highlightIndex);
        return;
      }

      usedShipping.add(shippingIndex);
      nextShipping[shippingIndex][1] = trackingNo;
      matchedShipping += 1;

      const { alias, mallCode, serial } = parseShippingCode(nextShipping[shippingIndex][0]);
      const candidateIndexes = invoiceRowsByMall.get(mallCode) || [];
      const invoiceIndex = candidateIndexes[serial - 1] ?? candidateIndexes.find((index) => !salesCellText(nextInvoice[index]?.[4]));
      if (invoiceIndex !== undefined && nextInvoice[invoiceIndex]) {
        if (salesCellText(nextInvoice[invoiceIndex][4]) === trackingNo) {
          alreadyMatchedInvoice += 1;
        } else {
          nextInvoice[invoiceIndex][4] = trackingNo;
          matchedInvoice += 1;
        }
      } else if (!isInvoiceInputExcludedMall(alias || mallCode, invoiceRow.productCode)) {
        const failedInvoiceIndex = candidateIndexes[serial - 1] ?? candidateIndexes[0];
        if (failedInvoiceIndex !== undefined) failedInvoiceIndexes.add(failedInvoiceIndex);
        else failedShippingIndexes.add(shippingIndex);
      }
    });

    const failedShippingIndexesList = [...failedShippingIndexes].filter((index) => index >= 0);
    const failedInvoiceIndexesList = [...failedInvoiceIndexes].filter((index) => index >= 0);
    const failedShipping = failedShippingIndexesList.map((index) => `${index + 1}행`);
    const failedInvoice = failedInvoiceIndexesList.map((index) => `${index + 1}행`);

    const manualRows = nextShipping
      .filter(rowHasValue)
      .filter((row) => ["T", "Z", "O"].includes(String(row[0] || "").split("-")[1] || ""))
      .filter((row) => salesCellText(row[1]))
      .map((row) => `${row[0]} ${row[2]} ${row[1]}`);

    return {
      sheets: {
        ...currentSheets,
        송장출력용: nextShipping,
        FN송장입력: nextInvoice,
      },
      matchedShipping,
      matchedInvoice,
      failedShipping,
      failedInvoice,
      failedShippingIndexes: failedShippingIndexesList,
      failedInvoiceIndexes: failedInvoiceIndexesList,
      alreadyMatchedShipping,
      alreadyMatchedInvoice,
      manualRows,
    };
  }

  const parsedShippingRows = (parsedSheets.송장출력용 || []).filter(rowHasValue);
  const parsedInvoiceRows = (parsedSheets.FN송장입력 || []).filter(rowHasValue);
  const trackingByShippingCode = new Map<string, string>();
  const trackingByOrderNo = new Map<string, string>();
  const trackingByBundleNo = new Map<string, string>();

  parsedShippingRows.forEach((row) => {
    const item = salesRowObject("송장출력용", row);
    if (item.쇼핑몰코드 && item.송장번호) trackingByShippingCode.set(item.쇼핑몰코드, item.송장번호);
  });
  parsedInvoiceRows.forEach((row) => {
    const item = salesRowObject("FN송장입력", row);
    if (item.쇼핑몰코드 && item.송장번호) trackingByShippingCode.set(item.쇼핑몰코드, item.송장번호);
    if (item.주문번호 && item.송장번호) trackingByOrderNo.set(item.주문번호, item.송장번호);
    if (item.묶음주문번호 && item.송장번호) trackingByBundleNo.set(item.묶음주문번호, item.송장번호);
  });

  let matchedShipping = 0;
  let matchedInvoice = 0;
  const nextShipping = currentSheets.송장출력용.map((row) => {
    if (!rowHasValue(row)) return row;
    const item = salesRowObject("송장출력용", row);
    const tracking = trackingByShippingCode.get(item.쇼핑몰코드);
    if (!tracking || item.송장번호 === tracking) return row;
    matchedShipping += 1;
    return row.map((cell, index) => index === 1 ? tracking : cell);
  });

  const nextInvoice = currentSheets.FN송장입력.map((row) => {
    if (!rowHasValue(row)) return row;
    const item = salesRowObject("FN송장입력", row);
    const tracking = trackingByOrderNo.get(item.주문번호)
      || trackingByBundleNo.get(item.묶음주문번호)
      || trackingByShippingCode.get(item.쇼핑몰코드);
    if (!tracking || item.송장번호 === tracking) return row;
    matchedInvoice += 1;
    return row.map((cell, index) => index === 4 ? tracking : cell);
  });

  const manualRows = nextShipping
    .filter(rowHasValue)
    .filter((row) => ["T", "Z", "O"].includes(String(row[0] || "").split("-")[1] || ""))
    .filter((row) => salesCellText(row[1]))
    .map((row) => `${row[0]} ${row[2]} ${row[1]}`);

  return {
    sheets: {
      ...currentSheets,
      송장출력용: nextShipping,
      FN송장입력: nextInvoice,
    },
    matchedShipping,
    matchedInvoice,
    failedShipping: [] as string[],
    failedInvoice: [] as string[],
    failedShippingIndexes: [] as number[],
    failedInvoiceIndexes: [] as number[],
    alreadyMatchedShipping: 0,
    alreadyMatchedInvoice: 0,
    manualRows,
  };
}

type DirectShippingPartner = "JB" | "케이모아";
type FileSystemWritableLike = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};
type FileSystemFileHandleLike = {
  getFile?: () => Promise<File>;
  createWritable: () => Promise<FileSystemWritableLike>;
};
type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandleLike>;
};

type SalesWorkspaceSnapshot = {
  dayKey: string;
  activeSheet: SalesSheetName;
  sheets: Record<SalesSheetName, string[][]>;
  uploadedFileNames: string[];
  pendingOrderFileNames: string[];
  pendingInvoiceFileNames: string[];
  completedSalesTasks: Record<string, boolean>;
  orderFilePassword: string;
  message: string;
  directShippingRows: Record<DirectShippingPartner, string[][]>;
};

const SALES_WORKSPACE_STORAGE_KEY = "fnos.salesInventory.onlineWorkspace.v1";
const SALES_WORKSPACE_DB_NAME = "fnos-sales-inventory-workspace";
const SALES_WORKSPACE_DB_STORE = "files";
const SALES_WORKSPACE_FILE_BUCKETS = ["uploaded", "pendingOrders", "pendingInvoices"] as const;
type SalesWorkspaceFileBucket = typeof SALES_WORKSPACE_FILE_BUCKETS[number];

function salesInitialSheets(): Record<SalesSheetName, string[][]> {
  return {
    송장출력용: makeSheetRows("송장출력용"),
    FN송장입력: makeSheetRows("FN송장입력"),
    "FN판매입력": makeSheetRows("FN판매입력"),
  };
}

function salesWorkspaceDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function openSalesWorkspaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SALES_WORKSPACE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SALES_WORKSPACE_DB_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runSalesWorkspaceStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openSalesWorkspaceDb().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(SALES_WORKSPACE_DB_STORE, mode);
    const store = tx.objectStore(SALES_WORKSPACE_DB_STORE);
    let request: IDBRequest<T> | void;
    tx.oncomplete = () => {
      db.close();
      resolve(request ? request.result : undefined);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    request = action(store);
  }));
}

async function saveSalesWorkspaceFiles(bucket: SalesWorkspaceFileBucket, files: File[]) {
  if (typeof indexedDB === "undefined") return;
  await runSalesWorkspaceStore("readwrite", (store) => {
    files.forEach((file, index) => {
      store.put({
        id: `${bucket}:${index}`,
        bucket,
        index,
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        blob: file,
      });
    });
    for (let index = files.length; index < 80; index += 1) store.delete(`${bucket}:${index}`);
  });
}

async function loadSalesWorkspaceFiles(bucket: SalesWorkspaceFileBucket) {
  if (typeof indexedDB === "undefined") return [] as File[];
  const records = await runSalesWorkspaceStore<Array<{ name: string; type?: string; lastModified?: number; blob: Blob; index?: number }>>("readonly", (store) => store.getAll());
  return (records || [])
    .filter((record) => String((record as { bucket?: string }).bucket || "") === bucket)
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .map((record) => new File([record.blob], record.name, { type: record.type || record.blob.type, lastModified: record.lastModified || Date.now() }));
}

async function clearSalesWorkspaceFiles() {
  if (typeof indexedDB === "undefined") return;
  await runSalesWorkspaceStore("readwrite", (store) => {
    store.clear();
  });
}

function clearSalesWorkspaceStorage() {
  localStorage.removeItem(SALES_WORKSPACE_STORAGE_KEY);
  void clearSalesWorkspaceFiles().catch(() => undefined);
}

const jbDirectHeaders = salesSheetHeaders.송장출력용.filter((header) => header !== "정산예정금액" && header !== "송장번호");
const kemoreDirectHeaders = ["쇼핑몰코드", "수량", "수취인", "수취인연락처1", "수취인연락처2", "주문옵션", "우편번호", "주소", "배송구분", "배송금액", "선불/착불", "배송요청사항", "발송처", "발송처TEL"];

function mapJbDirectRow(source: string[], sequence: number) {
  const mmdd = todayMmdd();
  return jbDirectHeaders.map((header) => {
    if (header === "쇼핑몰코드") return `${mmdd}-JB-${String(sequence).padStart(3, "0")}`;
    const sourceIndex = salesSheetHeaders.송장출력용.indexOf(header);
    return sourceIndex >= 0 ? source[sourceIndex] || "" : "";
  });
}

function mapKemoreDirectRow(source: string[], sequence: number) {
  const mmdd = todayMmdd();
  const get = (header: string) => {
    const sourceIndex = salesSheetHeaders.송장출력용.indexOf(header);
    return sourceIndex >= 0 ? source[sourceIndex] || "" : "";
  };
  return [
    `${mmdd}-에프엔-${String(sequence).padStart(3, "0")}`,
    get("수량"),
    get("수취인"),
    get("수취인연락처1"),
    get("수취인연락처2"),
    get("주문옵션"),
    get("우편번호"),
    get("주소"),
    "1",
    "1",
    "1",
    get("배송요청사항"),
    "에프엔",
    "031-767-5454",
  ];
}

function downloadTextFile(fileName: string, text: string, mime = "application/vnd.ms-excel;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function toSettlementExportValue(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.replace(/[₩원,\s]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : value;
}

function exportSheetRowsWithHeaders(name: SalesSheetName, rows: string[][]) {
  let headers = [...salesSheetHeaders[name]];
  let exportRows: Array<Array<string | number>> = rows.map((row) => headers.map((_, index) => row[index] || ""));
  if (name === "송장출력용") {
    const trackingIndex = headers.indexOf("송장번호");
    const hasTracking = trackingIndex >= 0 && exportRows.some((row) => salesCellText(row[trackingIndex]));
    if (trackingIndex >= 0 && !hasTracking) {
      headers = headers.filter((_, index) => index !== trackingIndex);
      exportRows = exportRows.map((row) => row.filter((_, index) => index !== trackingIndex));
    }
    const settlementIndex = headers.indexOf("정산예정금액");
    if (settlementIndex >= 0) {
      exportRows = exportRows.map((row) => row.map((cell, index) => index === settlementIndex ? toSettlementExportValue(String(cell || "")) : cell));
    }
  }
  return { headers, rows: exportRows };
}

function setWorksheetFontSize(xlsx: XlsxModule, worksheet: WorkSheet, size = 11) {
  const range = worksheet["!ref"] ? xlsx.utils.decode_range(worksheet["!ref"]) : null;
  if (!range) return;
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = xlsx.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[address] as (CellObject & { s?: { font?: { name?: string; sz?: number } } }) | undefined;
      if (!cell) continue;
      cell.s = { ...(cell.s || {}), font: { ...(cell.s?.font || {}), name: "맑은 고딕", sz: size } };
    }
  }
}

function salesExportColumnWidths(headers: string[], rows: Array<Array<string | number>>) {
  return headers.map((header, index) => {
    if (index !== 0 && header !== "주문옵션") return { wch: 8 };
    const maxLength = Math.max(
      String(header || "").length,
      ...rows.map((row) => String(row[index] || "").length),
    );
    return { wch: Math.min(Math.max(maxLength + 2, 8), 80) };
  });
}

async function downloadXlsxFile(fileName: string, sheets: Partial<Record<SalesSheetName, string[][]>>) {
  const xlsx = await loadXlsxModule();
  const workbook = xlsx.utils.book_new();
  (Object.keys(sheets) as SalesSheetName[]).forEach((name) => {
    const rows = sheets[name] || [];
    const { headers, rows: exportRows } = exportSheetRowsWithHeaders(name, rows);
    const worksheet = xlsx.utils.aoa_to_sheet([headers, ...exportRows]);
    if (name === "송장출력용") {
      const settlementIndex = headers.indexOf("정산예정금액");
      if (settlementIndex >= 0) {
        for (let rowIndex = 1; rowIndex <= exportRows.length; rowIndex += 1) {
          const address = xlsx.utils.encode_cell({ r: rowIndex, c: settlementIndex });
          if (worksheet[address]?.t === "n") worksheet[address].z = "#,##0";
        }
      }
    }
    setWorksheetFontSize(xlsx, worksheet, 11);
    worksheet["!cols"] = salesExportColumnWidths(headers, exportRows);
    xlsx.utils.book_append_sheet(workbook, worksheet, name);
  });
  const output = xlsx.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function tableXlsxBlob(xlsx: XlsxModule, sheetName: string, headers: string[], rows: string[][]) {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([headers, ...rows]);
  setWorksheetFontSize(xlsx, worksheet, 11);
  worksheet["!cols"] = headers.map((header, index) => ({
    wch: Math.min(Math.max(header.length + 2, ...rows.map((row) => String(row[index] || "").length + 2)), 60),
  }));
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  const output = xlsx.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
  return new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function downloadTableXlsx(fileName: string, sheetName: string, headers: string[], rows: string[][]) {
  const xlsx = await loadXlsxModule();
  downloadBlob(fileName, tableXlsxBlob(xlsx, sheetName, headers, rows));
}

function timeLabel() {
  const nowDate = new Date();
  const mm = String(nowDate.getMonth() + 1).padStart(2, "0");
  const dd = String(nowDate.getDate()).padStart(2, "0");
  return `${mm}${dd}_발주건출력_${nowDate.getHours() < 12 ? "오전" : "오후"}`;
}

function integratedOrderFileName() {
  const nowDate = new Date();
  const mm = String(nowDate.getMonth() + 1).padStart(2, "0");
  const dd = String(nowDate.getDate()).padStart(2, "0");
  return `${mm}${dd}_FNOS통합발주`;
}

function todayMmdd() {
  const nowDate = new Date();
  const mm = String(nowDate.getMonth() + 1).padStart(2, "0");
  const dd = String(nowDate.getDate()).padStart(2, "0");
  return `${mm}${dd}`;
}

function fnParcelSheetName(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

type SalesGridCell = { row: number; col: number };
type SalesGridRange = { startRow: number; endRow: number; startCol: number; endCol: number };
type SalesGridSelection = { sheet: SalesSheetName; range: SalesGridRange; rowIndexes?: number[] };
type SalesGridSort = { col: number; dir: "asc" | "desc" } | null;
type FnOsProductSearchItem = { code?: string; name?: string; size?: string; inPrice?: string; outPrice?: string };
type FnOsProductSearchState = {
  open: boolean;
  row: number;
  col: number;
  query: string;
  searchedQuery: string;
  results: FnOsProductSearchItem[];
  selectedIndex: number;
  loading: boolean;
  error: string;
};

function normalizeRange(a: SalesGridCell, b: SalesGridCell): SalesGridRange {
  return {
    startRow: Math.min(a.row, b.row),
    endRow: Math.max(a.row, b.row),
    startCol: Math.min(a.col, b.col),
    endCol: Math.max(a.col, b.col),
  };
}

function measureSalesColumn(sheet: SalesSheetName, header: string, rows: string[][], colIndex: number) {
  if (sheet === "송장출력용" && header !== "주문옵션") return 95;
  const longest = [header, ...rows.map((row) => row[colIndex] || "")].reduce((max, value) => Math.max(max, String(value).length), 0);
  return Math.min(Math.max(90, longest * 9 + 28), sheet === "송장출력용" ? 520 : 360);
}

function compareSalesCellValue(a: string, b: string) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  const leftNumber = Number(left.replace(/,/g, ""));
  const rightNumber = Number(right.replace(/,/g, ""));
  if (left && right && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return compareMixedKoreanText(left, right);
}

function SalesExcelGrid({
  sheet,
  rows,
  onChange,
  onSelectionChange,
  resetKey = 0,
  highlightedRows = [],
}: {
  sheet: SalesSheetName;
  rows: string[][];
  onChange: (rows: string[][]) => void;
  onSelectionChange?: (sheet: SalesSheetName, range: SalesGridRange, rowIndexes?: number[]) => void;
  resetKey?: number;
  highlightedRows?: number[];
}) {
  const headers = salesSheetHeaders[sheet];
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<SalesGridCell>({ row: 0, col: 0 });
  const [range, setRange] = useState<SalesGridRange>({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 });
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [editing, setEditing] = useState<SalesGridCell | null>(null);
  const [colWidths, setColWidths] = useState<number[]>(() => headers.map((header, index) => measureSalesColumn(sheet, header, rows, index)));
  const [rowHeights, setRowHeights] = useState<number[]>(() => rows.map(() => 30));
  const [resize, setResize] = useState<null | { type: "col" | "row"; index: number; start: number; initial: number }>(null);
  const [sortState, setSortState] = useState<SalesGridSort>(null);
  const highlightedRowSet = useMemo(() => new Set(highlightedRows), [highlightedRows]);
  const isSortableSheet = Boolean(salesSheetHeaders[sheet]);
  const productCodeCol = headers.indexOf("품목코드");
  const [productSearch, setProductSearch] = useState<FnOsProductSearchState>({
    open: false,
    row: 0,
    col: productCodeCol,
    query: "",
    searchedQuery: "",
    results: [],
    selectedIndex: 0,
    loading: false,
    error: "",
  });

  useEffect(() => {
    setAnchor({ row: 0, col: 0 });
    setRange({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 });
    setSelectedRows([]);
    setEditing(null);
    setSortState(null);
    setProductSearch((prev) => ({ ...prev, open: false, row: 0, col: productCodeCol, query: "", searchedQuery: "", results: [], selectedIndex: 0, loading: false, error: "" }));
    setColWidths(headers.map((header, index) => measureSalesColumn(sheet, header, rows, index)));
    setRowHeights(rows.map(() => 30));
  }, [sheet, resetKey]);

  useEffect(() => {
    setRowHeights((prev) => rows.map((_, index) => prev[index] || 30));
  }, [rows.length]);

  useEffect(() => {
    onSelectionChange?.(sheet, range, selectedRows);
  }, [sheet, range, selectedRows, onSelectionChange]);

  useEffect(() => {
    if (!resize) return;
    const activeResize = resize;
    function onMove(event: globalThis.MouseEvent) {
      const delta = (activeResize.type === "col" ? event.clientX : event.clientY) - activeResize.start;
      if (activeResize.type === "col") {
        setColWidths((prev) => prev.map((width, index) => index === activeResize.index ? Math.max(54, activeResize.initial + delta) : width));
      } else {
        setRowHeights((prev) => prev.map((height, index) => index === activeResize.index ? Math.max(22, activeResize.initial + delta) : height));
      }
    }
    function onUp() {
      setResize(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resize]);

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    onChange(rows.map((row, r) => r === rowIndex ? row.map((cell, c) => c === colIndex ? value : cell) : row));
  }
  async function searchFnOsProducts(query: string) {
    const keyword = query.trim();
    if (!keyword) {
      setProductSearch((prev) => ({ ...prev, results: [], selectedIndex: 0, error: "검색어를 입력해주세요." }));
      return;
    }
    setProductSearch((prev) => ({ ...prev, query: keyword, loading: true, error: "" }));
    try {
      const res = await fetch("/api/fnos/quick-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: keyword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setProductSearch((prev) => ({ ...prev, loading: false, searchedQuery: keyword, results: [], selectedIndex: 0, error: data.error || "품목검색 실패" }));
        window.alert(FNOS_DB_ERROR_MESSAGE);
        return;
      }
      const results = Array.isArray(data.products) ? data.products : data.product ? [data.product] : [];
      setProductSearch((prev) => ({ ...prev, loading: false, searchedQuery: keyword, results, selectedIndex: 0, error: results.length ? "" : "검색 결과가 없습니다." }));
    } catch (error) {
      setProductSearch((prev) => ({ ...prev, loading: false, searchedQuery: keyword, results: [], selectedIndex: 0, error: error instanceof Error ? error.message : "품목검색 실패" }));
      window.alert(FNOS_DB_ERROR_MESSAGE);
    }
  }
  function openProductSearch(rowIndex: number, colIndex: number, query: string) {
    setProductSearch({
      open: true,
      row: rowIndex,
      col: colIndex,
      query,
      searchedQuery: "",
      results: [],
      selectedIndex: 0,
      loading: false,
      error: "",
    });
    void searchFnOsProducts(query);
  }
  function selectProductSearchItem(item: FnOsProductSearchItem) {
    if (!item.code) return;
    updateCell(productSearch.row, productSearch.col, item.code);
    setProductSearch((prev) => ({ ...prev, open: false }));
    setEditing(null);
    setAnchor({ row: productSearch.row, col: productSearch.col });
    setRange({ startRow: productSearch.row, endRow: productSearch.row, startCol: productSearch.col, endCol: productSearch.col });
    window.setTimeout(() => gridRef.current?.focus(), 0);
  }
  useEscapeToClose(productSearch.open, () => setProductSearch((prev) => ({ ...prev, open: false })));
  function addRow() {
    onChange([...rows, headers.map(() => "")]);
  }
  function sortByColumn(colIndex: number) {
    const dir: "asc" | "desc" = sortState?.col === colIndex && sortState.dir === "asc" ? "desc" : "asc";
    const filledRows = rows.filter((row) => row.some((cell) => String(cell || "").trim()));
    const emptyRows = rows.filter((row) => !row.some((cell) => String(cell || "").trim()));
    const sortedRows = [...filledRows].sort((a, b) => {
      const result = compareSalesCellValue(a[colIndex] || "", b[colIndex] || "");
      return dir === "asc" ? result : -result;
    });
    onChange([...sortedRows, ...emptyRows]);
    setSortState({ col: colIndex, dir });
    setAnchor({ row: 0, col: colIndex });
    setRange({ startRow: 0, endRow: Math.max(0, sortedRows.length - 1), startCol: colIndex, endCol: colIndex });
    setEditing(null);
    gridRef.current?.focus();
  }
  function selectCell(row: number, col: number, extend = false) {
    const next = { row, col };
    const base = extend ? anchor : next;
    if (!extend) setAnchor(next);
    setSelectedRows([]);
    setRange(normalizeRange(base, next));
    setEditing(null);
    gridRef.current?.focus();
  }
  function toggleRow(row: number) {
    setSelectedRows((prev) => {
      const next = prev.includes(row) ? prev.filter((value) => value !== row) : [...prev, row].sort((a, b) => a - b);
      if (next.length) {
        setRange({ startRow: row, endRow: row, startCol: 0, endCol: headers.length - 1 });
        setAnchor({ row, col: 0 });
      }
      return next;
    });
    setEditing(null);
    gridRef.current?.focus();
  }
  function isSelected(row: number, col: number) {
    return selectedRows.includes(row) || (row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol);
  }
  function copyRange(event: ClipboardEvent<HTMLDivElement>) {
    const text = selectedRows.length
      ? selectedRows.map((rowIndex) => rows[rowIndex]?.join("\t") || "").join("\n")
      : rows
        .slice(range.startRow, range.endRow + 1)
        .map((row) => row.slice(range.startCol, range.endCol + 1).join("\t"))
        .join("\n");
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  }
  function pasteRange(event: ClipboardEvent<HTMLDivElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    const pasted = text.replace(/\r/g, "").split("\n").filter((line, index, arr) => line !== "" || index < arr.length - 1).map((line) => line.split("\t"));
    if (!pasted.length) return;
    const next = rows.map((row) => [...row]);
    const neededRows = range.startRow + pasted.length;
    while (next.length < neededRows) next.push(headers.map(() => ""));
    pasted.forEach((line, rowOffset) => {
      line.forEach((value, colOffset) => {
        const rowIndex = range.startRow + rowOffset;
        const colIndex = range.startCol + colOffset;
        if (colIndex < headers.length) next[rowIndex][colIndex] = value;
      });
    });
    onChange(next);
    setRange(normalizeRange(
      { row: range.startRow, col: range.startCol },
      { row: range.startRow + pasted.length - 1, col: Math.min(headers.length - 1, range.startCol + pasted[0].length - 1) },
    ));
    event.preventDefault();
  }
  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (editing) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      const next = rows.map((row, rowIndex) => row.map((cell, colIndex) => isSelected(rowIndex, colIndex) ? "" : cell));
      onChange(next);
      event.preventDefault();
      return;
    }
    const current = { row: range.startRow, col: range.startCol };
    if (event.key === "Enter") {
      setEditing(current);
      event.preventDefault();
      return;
    }
    const move: Record<string, SalesGridCell> = {
      ArrowUp: { row: Math.max(0, current.row - 1), col: current.col },
      ArrowDown: { row: Math.min(rows.length - 1, current.row + 1), col: current.col },
      ArrowLeft: { row: current.row, col: Math.max(0, current.col - 1) },
      ArrowRight: { row: current.row, col: Math.min(headers.length - 1, current.col + 1) },
    };
    if (move[event.key]) {
      selectCell(move[event.key].row, move[event.key].col, event.shiftKey);
      event.preventDefault();
    }
  }
  function startColResize(event: MouseEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    setResize({ type: "col", index, start: event.clientX, initial: colWidths[index] || 90 });
  }
  function startRowResize(event: MouseEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    setResize({ type: "row", index, start: event.clientY, initial: rowHeights[index] || 30 });
  }
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <strong>{sheet}</strong>
        <button type="button" onClick={addRow} className="rounded-md border border-slate-200 px-3 py-1 text-xs font-black text-slate-600">행 추가</button>
      </div>
      <div
        ref={gridRef}
        tabIndex={0}
        onCopy={copyRange}
        onPaste={pasteRange}
        onKeyDown={onGridKeyDown}
        onMouseUp={() => setSelecting(false)}
        className="max-h-[560px] overflow-auto outline-none"
      >
        <table className="table-fixed border-collapse text-xs" style={{ width: 40 + colWidths.reduce((sum, width) => sum + width, 0) }}>
          <colgroup>
            <col style={{ width: 40 }} />
            {headers.map((header, colIndex) => (
              <col key={header} style={{ width: colWidths[colIndex] || 95 }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-100">
            <tr>
              <th className="w-10 border border-slate-200 px-2 py-2 text-slate-400">#</th>
              {headers.map((header, colIndex) => (
                <th
                  key={header}
                  style={{ width: colWidths[colIndex] || 95, maxWidth: colWidths[colIndex] || 95 }}
                  onDoubleClick={() => sortByColumn(colIndex)}
                  title={isSortableSheet ? "더블클릭하면 오름/내림차순 정렬" : undefined}
                  className={`relative border border-slate-200 px-2 py-2 text-left font-black text-slate-600 ${isSortableSheet ? "cursor-pointer select-none hover:bg-orange-50" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate">{header}</span>
                    {isSortableSheet && sortState?.col === colIndex && (
                      <span className="shrink-0 text-[10px] text-orange-600">{sortState.dir === "asc" ? "ASC" : "DESC"}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`${header} 열 너비 조절`}
                    onMouseDown={(event) => startColResize(event, colIndex)}
                    onDoubleClick={(event) => event.stopPropagation()}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-orange-300"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const isHighlightedRow = highlightedRowSet.has(rowIndex);
              return (
              <tr key={rowIndex} style={{ height: rowHeights[rowIndex] || 30 }}>
                <td className={`relative border px-2 py-1 text-center font-bold text-slate-400 ${isHighlightedRow ? "border-yellow-200 bg-yellow-50" : "border-slate-200 bg-slate-50"}`}>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      if (event.ctrlKey || event.metaKey) {
                        toggleRow(rowIndex);
                        return;
                      }
                      setSelectedRows([]);
                      setAnchor({ row: rowIndex, col: 0 });
                      setRange({ startRow: rowIndex, endRow: rowIndex, startCol: 0, endCol: headers.length - 1 });
                      gridRef.current?.focus();
                    }}
                    className="w-full text-center"
                  >
                    {rowIndex + 1}
                  </button>
                  <button
                    type="button"
                    aria-label={`${rowIndex + 1}행 높이 조절`}
                    onMouseDown={(event) => startRowResize(event, rowIndex)}
                    className="absolute bottom-0 left-0 h-1 w-full cursor-row-resize hover:bg-orange-300"
                  />
                </td>
                {headers.map((header, colIndex) => (
                  <td
                    key={`${header}-${colIndex}`}
                    style={{ width: colWidths[colIndex] || 95, maxWidth: colWidths[colIndex] || 95, height: rowHeights[rowIndex] || 30 }}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      if (event.ctrlKey || event.metaKey) {
                        event.preventDefault();
                        toggleRow(rowIndex);
                        setSelecting(false);
                        return;
                      }
                      selectCell(rowIndex, colIndex, event.shiftKey);
                      setSelecting(true);
                    }}
                    onMouseEnter={() => {
                      if (selecting) setRange(normalizeRange(anchor, { row: rowIndex, col: colIndex }));
                    }}
                    onDoubleClick={() => setEditing({ row: rowIndex, col: colIndex })}
                    className={`border p-0 align-middle ${isSelected(rowIndex, colIndex) ? "border-orange-500 bg-orange-50 ring-1 ring-inset ring-orange-400" : isHighlightedRow ? "border-yellow-200 bg-yellow-50" : "border-slate-200 bg-white"}`}
                  >
                    {editing?.row === rowIndex && editing?.col === colIndex ? (
                      <input
                        autoFocus
                        value={row[colIndex] || ""}
                        onChange={(event) => updateCell(rowIndex, colIndex, event.target.value)}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            const value = (event.currentTarget as HTMLInputElement).value.trim();
                            if (sheet === "FN판매입력" && colIndex === productCodeCol && value) {
                              event.preventDefault();
                              openProductSearch(rowIndex, colIndex, value);
                              setEditing(null);
                              return;
                            }
                            setEditing(null);
                          }
                          if (event.key === "Escape") setEditing(null);
                        }}
                        className="h-full w-full bg-white px-2 text-xs outline-orange-400"
                      />
                    ) : (
                      <div className="h-full w-full select-none overflow-hidden whitespace-nowrap px-2 py-1 leading-5">{row[colIndex] || ""}</div>
                    )}
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {productSearch.open && (
        <SelectionModal
          title="품목검색"
          onClose={() => setProductSearch((prev) => ({ ...prev, open: false }))}
          size="lg"
          className="overflow-hidden"
          footer={
            <div className="flex w-full items-center justify-between gap-3 text-xs text-gray-500">
              <span>Enter 선택 · ↑↓ 이동 · Esc 닫기</span>
              <ActionButton type="button" variant="secondary" onClick={() => setProductSearch((prev) => ({ ...prev, open: false }))}>닫기</ActionButton>
            </div>
          }
        >
          <div
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setProductSearch((prev) => ({ ...prev, open: false }));
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setProductSearch((prev) => ({ ...prev, selectedIndex: Math.min(Math.max(0, prev.results.length - 1), prev.selectedIndex + 1) }));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setProductSearch((prev) => ({ ...prev, selectedIndex: Math.max(0, prev.selectedIndex - 1) }));
                return;
              }
              if (event.key === "Enter" && productSearch.results[productSearch.selectedIndex]) {
                event.preventDefault();
                selectProductSearchItem(productSearch.results[productSearch.selectedIndex]);
              }
            }}
          >
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm font-semibold text-gray-800">품목검색</span>
              <input
                autoFocus
                value={productSearch.query}
                onChange={(event) => setProductSearch((prev) => ({ ...prev, query: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (productSearch.results.length && productSearch.query.trim() === productSearch.searchedQuery && productSearch.results[productSearch.selectedIndex]) {
                      selectProductSearchItem(productSearch.results[productSearch.selectedIndex]);
                      return;
                    }
                    void searchFnOsProducts(productSearch.query);
                  }
                }}
                className={modalInputClass}
                placeholder="품목명 또는 품목코드"
              />
              <ActionButton
                type="button"
                onClick={() => void searchFnOsProducts(productSearch.query)}
                disabled={productSearch.loading}
              >
                {productSearch.loading ? "검색중" : "검색"}
              </ActionButton>
            </div>
            <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-gray-200">
              {productSearch.error && <div className="mb-2 rounded bg-rose-50 p-3 text-sm font-black text-rose-600">{productSearch.error}</div>}
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600">
                    <th className="w-14 border-b border-gray-200 px-2 py-2 text-center">선택</th>
                    <th className="w-32 border-b border-gray-200 px-2 py-2">품목코드</th>
                    <th className="border-b border-gray-200 px-2 py-2">품목명[규격]</th>
                    <th className="w-24 border-b border-gray-200 px-2 py-2">입고단가</th>
                    <th className="w-24 border-b border-gray-200 px-2 py-2">출고단가</th>
                  </tr>
                </thead>
                <tbody>
                  {productSearch.results.map((item, index) => (
                    <tr
                      key={`${item.code || "item"}-${index}`}
                      onMouseEnter={() => setProductSearch((prev) => ({ ...prev, selectedIndex: index }))}
                      onDoubleClick={() => selectProductSearchItem(item)}
                      className={`cursor-pointer ${productSearch.selectedIndex === index ? "bg-orange-50" : "bg-white hover:bg-slate-50"}`}
                    >
                      <td className="border border-slate-200 px-2 py-2 text-center">
                        <button type="button" onClick={() => selectProductSearchItem(item)} className="rounded border border-slate-300 px-2 py-1 text-xs font-black text-slate-600">
                          {index + 1}
                        </button>
                      </td>
                      <td className="border border-slate-200 px-2 py-2 font-black text-orange-700">{item.code || "-"}</td>
                      <td className="border border-slate-200 px-2 py-2">{item.name || "-"}{item.size ? ` / ${item.size}` : ""}</td>
                      <td className="border border-slate-200 px-2 py-2 text-right">{item.inPrice || "-"}</td>
                      <td className="border border-slate-200 px-2 py-2 text-right">{item.outPrice || "-"}</td>
                    </tr>
                  ))}
                  {!productSearch.loading && !productSearch.results.length && (
                    <tr>
                      <td colSpan={5} className="border border-slate-200 px-3 py-10 text-center text-sm font-bold text-slate-500">
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </SelectionModal>
      )}
    </div>
  );
}

const FNOS_DB_ERROR_MESSAGE = "FN OS 자체 DB 처리 중 문제가 발생했습니다. Supabase 테이블과 환경변수를 확인해 주세요.";

function SalesRightTools() {
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{
    product?: { code?: string; name?: string; inPrice?: string; outPrice?: string } | null;
    products?: Array<{ code?: string; name?: string; inPrice?: string; outPrice?: string }>;
    inventory?: Array<{ whCode?: string; whName?: string; qty?: string }>;
    error?: string;
  } | null>(null);
  const [registerMode, setRegisterMode] = useState<"product" | "customer">("product");
  const [registerForm, setRegisterForm] = useState({
    prod_cd: "",
    prod_name: "",
    size_des: "",
    in_price: "",
    out_price: "",
    cust_code: "",
    cust_name: "",
    biz_no: "",
    ceo_name: "",
    tel: "",
    remarks: "",
  });
  const [registerMessage, setRegisterMessage] = useState("");
  const [registerLoading, setRegisterLoading] = useState(false);
  const [inputMode, setInputMode] = useState<"sales" | "purchase">("sales");
  const [inputForm, setInputForm] = useState({
    io_date: new Date().toISOString().slice(0, 10).replace(/\D/g, ""),
    cust_code: "",
    wh_cd: "100",
    prod_cd: "",
    qty: "",
    price: "",
    remarks: "",
  });
  const [inputMessage, setInputMessage] = useState("");
  const [inputLoading, setInputLoading] = useState(false);

  function updateRegisterField(key: keyof typeof registerForm, value: string) {
    setRegisterForm((form) => ({ ...form, [key]: value }));
  }

  function updateInputField(key: keyof typeof inputForm, value: string) {
    setInputForm((form) => ({ ...form, [key]: value }));
  }

  async function quickLookup() {
    const query = lookupQuery.trim();
    if (!query) {
      setLookupResult({ error: "상품명을 입력해 주세요." });
      return;
    }
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const res = await fetch("/api/fnos/quick-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        window.alert(FNOS_DB_ERROR_MESSAGE);
        setLookupResult({ error: data.error || "상품 조회 실패" });
        return;
      }
      setLookupResult(data);
    } catch (error) {
      window.alert(FNOS_DB_ERROR_MESSAGE);
      setLookupResult({ error: error instanceof Error ? error.message : "상품 조회 실패" });
    } finally {
      setLookupLoading(false);
    }
  }

  async function submitRegister() {
    setRegisterLoading(true);
    setRegisterMessage("");
    try {
      const res = await fetch("/api/fnos/quick-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: registerMode, form: registerForm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        window.alert(FNOS_DB_ERROR_MESSAGE);
        setRegisterMessage(data.error || "등록 실패");
        return;
      }
      invalidateClientCache("/api/fnos/products/master");
      invalidateClientCache("/api/fnos/products/search");
      invalidateClientCache("/api/fnos/customers");
      invalidateClientCache("/api/dashboard/summary");
      setRegisterMessage(registerMode === "product" ? "제품등록 전송 완료" : "거래처등록 전송 완료");
    } catch (error) {
      window.alert(FNOS_DB_ERROR_MESSAGE);
      setRegisterMessage(error instanceof Error ? error.message : "등록 실패");
    } finally {
      setRegisterLoading(false);
    }
  }

  async function submitInput() {
    setInputLoading(true);
    setInputMessage("");
    try {
      const res = await fetch("/api/fnos/quick-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: inputMode, form: inputForm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        window.alert(FNOS_DB_ERROR_MESSAGE);
        setInputMessage(data.error || "입력 실패");
        return;
      }
      invalidateClientCache("/api/dashboard/summary");
      invalidateClientCache("/api/fnos/products/master");
      invalidateClientCache("/api/fnos/products/search");
      setInputMessage(inputMode === "sales" ? "판매입력 전송 완료" : "구매입력 전송 완료");
    } catch (error) {
      window.alert(FNOS_DB_ERROR_MESSAGE);
      setInputMessage(error instanceof Error ? error.message : "입력 실패");
    } finally {
      setInputLoading(false);
    }
  }

  function lookupAmount(value?: string) {
    const text = String(value || "").trim();
    if (!text) return "-";
    const number = Number(text.replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) && /\d/.test(text) ? number.toLocaleString("ko-KR") : text;
  }

  function copyLookupText(value?: string) {
    const text = String(value || "").trim();
    if (!text) return;
    void navigator.clipboard?.writeText(text);
  }

  return (
    <aside className="hidden w-[320px] shrink-0 border-l border-slate-200 bg-white px-4 py-6 xl:block">
      <ToolSection title="상품 간편조회" defaultOpen showChevron={false}>
        <input
          value={lookupQuery}
          onChange={(event) => setLookupQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void quickLookup();
          }}
          className="mb-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-orange-400"
          placeholder="상품명 조회"
        />
        <button type="button" onClick={quickLookup} disabled={lookupLoading} className="w-full rounded-md bg-slate-950 px-3 py-2 text-sm font-black text-white disabled:opacity-50">
          {lookupLoading ? "조회 중" : "조회"}
        </button>
        {lookupResult?.error && <div className="mt-2 rounded-md bg-rose-50 p-3 text-xs font-black text-rose-600">{lookupResult.error}</div>}
        {lookupResult?.product && (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <button type="button" onClick={() => copyLookupText(lookupResult.product?.name)} className="mb-2 block w-full truncate text-left font-black text-slate-950 underline-offset-2 hover:text-orange-600 hover:underline" title="클릭해서 품목명 복사">
              {lookupResult.product.name || "-"}
            </button>
            <div className="grid grid-cols-[72px_1fr] gap-y-1 text-slate-600">
              <span>품목코드</span><b className="text-slate-950">{lookupResult.product.code || "-"}</b>
              <span>입고단가</span><b className="text-slate-950">{lookupAmount(lookupResult.product.inPrice)}</b>
              <span>출고단가</span><b className="text-slate-950">{lookupAmount(lookupResult.product.outPrice)}</b>
            </div>
          </div>
        )}
        {lookupResult?.products && lookupResult.products.length > 1 && (
          <div className="mt-2 rounded-md border border-slate-200 p-2">
            <div className="mb-1 text-xs font-black text-slate-500">포함 상품 {lookupResult.products.length}건</div>
            <div className="grid gap-1">
              {lookupResult.products.slice(1, 5).map((item, index) => (
                <div key={`${item.code}-${index}-summary`} className="truncate text-xs font-bold text-slate-600">
                  {item.name || "-"} · 입고 {lookupAmount(item.inPrice)} / 출고 {lookupAmount(item.outPrice)}
                </div>
              ))}
              {false && lookupResult?.products?.slice(1, 5).map((item, index) => (
                <div key={`${item.code}-${index}`} className="hidden truncate text-xs font-bold text-slate-600">
                  {item.code || "-"} · {item.name || "-"}
                </div>
              ))}
            </div>
          </div>
        )}
        {lookupResult?.product && (
          <div className="mt-2 rounded-md border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black">창고별 재고현황</div>
            <div className="grid gap-1 p-2">
              {lookupResult.inventory?.length ? lookupResult.inventory.map((item, index) => (
                <div key={`${item.whCode}-${index}`} className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs font-bold">
                  <span className="truncate">{item.whName || item.whCode || "창고"}</span>
                  <span className="text-slate-950">{item.qty || "0"}</span>
                </div>
              )) : <div className="px-2 py-2 text-xs font-bold text-slate-500">창고별 재고가 없습니다.</div>}
            </div>
          </div>
        )}
      </ToolSection>

      <ToolSection title="간편 등록" showChevron={false}>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setRegisterMode("product")} className={`rounded-md border px-2 py-2 text-xs font-black ${registerMode === "product" ? "border-orange-300 bg-orange-50 text-orange-600" : "border-slate-200"}`}>제품등록</button>
          <button type="button" onClick={() => setRegisterMode("customer")} className={`rounded-md border px-2 py-2 text-xs font-black ${registerMode === "customer" ? "border-orange-300 bg-orange-50 text-orange-600" : "border-slate-200"}`}>거래처등록</button>
        </div>
        <div className="mt-2 grid gap-2 rounded-md bg-slate-50 p-3">
          {registerMode === "product" ? (
            <>
              <input value={registerForm.prod_cd} onChange={(event) => updateRegisterField("prod_cd", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="품목코드 *" />
              <input value={registerForm.prod_name} onChange={(event) => updateRegisterField("prod_name", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="품목명 *" />
              <input value={registerForm.size_des} onChange={(event) => updateRegisterField("size_des", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="규격" />
              <div className="grid grid-cols-2 gap-2">
                <input value={registerForm.in_price} onChange={(event) => updateRegisterField("in_price", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="입고단가" />
                <input value={registerForm.out_price} onChange={(event) => updateRegisterField("out_price", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="출고단가" />
              </div>
            </>
          ) : (
            <>
              <input value={registerForm.cust_code} onChange={(event) => updateRegisterField("cust_code", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="거래처코드 *" />
              <input value={registerForm.cust_name} onChange={(event) => updateRegisterField("cust_name", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="거래처명 *" />
              <input value={registerForm.biz_no} onChange={(event) => updateRegisterField("biz_no", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="사업자번호" />
              <div className="grid grid-cols-2 gap-2">
                <input value={registerForm.ceo_name} onChange={(event) => updateRegisterField("ceo_name", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="대표자" />
                <input value={registerForm.tel} onChange={(event) => updateRegisterField("tel", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="연락처" />
              </div>
            </>
          )}
          <input value={registerForm.remarks} onChange={(event) => updateRegisterField("remarks", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="비고" />
          <button type="button" onClick={submitRegister} disabled={registerLoading} className="rounded-md bg-orange-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
            {registerLoading ? "전송 중" : registerMode === "product" ? "제품등록 전송" : "거래처등록 전송"}
          </button>
          {registerMessage && <div className="rounded-md bg-white px-2 py-2 text-xs font-black text-slate-600">{registerMessage}</div>}
        </div>
      </ToolSection>

      <ToolSection title="간편 입력" showChevron={false}>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setInputMode("sales")} className={`rounded-md border px-2 py-2 text-xs font-black ${inputMode === "sales" ? "border-orange-300 bg-orange-50 text-orange-600" : "border-slate-200"}`}>판매입력</button>
          <button type="button" onClick={() => setInputMode("purchase")} className={`rounded-md border px-2 py-2 text-xs font-black ${inputMode === "purchase" ? "border-orange-300 bg-orange-50 text-orange-600" : "border-slate-200"}`}>구매입력</button>
        </div>
        <div className="mt-2 grid gap-2 rounded-md bg-slate-50 p-3">
          <input value={inputForm.io_date} onChange={(event) => updateInputField("io_date", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="일자 YYYYMMDD *" />
          <div className="grid grid-cols-2 gap-2">
            <input value={inputForm.cust_code} onChange={(event) => updateInputField("cust_code", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="거래처코드" />
            <input value={inputForm.wh_cd} onChange={(event) => updateInputField("wh_cd", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="창고코드 *" />
          </div>
          <input value={inputForm.prod_cd} onChange={(event) => updateInputField("prod_cd", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="품목코드 *" />
          <div className="grid grid-cols-2 gap-2">
            <input value={inputForm.qty} onChange={(event) => updateInputField("qty", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="수량 *" />
            <input value={inputForm.price} onChange={(event) => updateInputField("price", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="단가 *" />
          </div>
          <input value={inputForm.remarks} onChange={(event) => updateInputField("remarks", event.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400" placeholder="적요" />
          <button type="button" onClick={submitInput} disabled={inputLoading} className="rounded-md bg-orange-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
            {inputLoading ? "전송 중" : inputMode === "sales" ? "판매입력 전송" : "구매입력 전송"}
          </button>
          {inputMessage && <div className="rounded-md bg-white px-2 py-2 text-xs font-black text-slate-600">{inputMessage}</div>}
        </div>
      </ToolSection>
    </aside>
  );
}

function SalesSyncTools() {
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{
    product?: { code?: string; name?: string; inPrice?: string; outPrice?: string; inventory?: Array<{ whCode?: string; whName?: string; qty?: string; syncedAt?: string }> } | null;
    products?: Array<{ code?: string; name?: string; inPrice?: string; outPrice?: string; inventory?: Array<{ whCode?: string; whName?: string; qty?: string; syncedAt?: string }> }>;
    inventory?: Array<{ whCode?: string; whName?: string; qty?: string; syncedAt?: string }>;
    message?: string;
    error?: string;
  } | null>(null);
  const [expandedLookupCodes, setExpandedLookupCodes] = useState<Record<string, boolean>>({});

  async function quickLookup() {
    const query = lookupQuery.trim();
    if (!query) {
      setLookupResult({ error: "상품명을 입력해 주세요." });
      return;
    }
    setLookupLoading(true);
    setLookupResult(null);
    setExpandedLookupCodes({});
    try {
      const res = await fetch("/api/fnos/quick-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setLookupResult({ error: data.error || "상품 조회 실패" });
        return;
      }
      setLookupResult(data);
    } catch (error) {
      setLookupResult({ error: error instanceof Error ? error.message : "상품 조회 실패" });
    } finally {
      setLookupLoading(false);
    }
  }

  const lookupProducts = lookupResult?.products?.length
    ? lookupResult.products
    : lookupResult?.product
      ? [lookupResult.product]
      : [];

  function lookupAmount(value?: string) {
    const text = String(value || "").trim();
    if (!text) return "-";
    const number = Number(text.replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) && /\d/.test(text) ? number.toLocaleString("ko-KR") : text;
  }

  function copyLookupText(value?: string) {
    const text = String(value || "").trim();
    if (!text) return;
    void navigator.clipboard?.writeText(text);
  }

  return (
    <aside className="hidden w-[320px] shrink-0 border-l border-slate-200 bg-white px-4 py-6 xl:block">
      <ToolSection title="상품 간편조회" defaultOpen showChevron={false}>
        <input
          value={lookupQuery}
          onChange={(event) => setLookupQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void quickLookup();
          }}
          className="mb-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-orange-400"
          placeholder="상품명 조회"
        />
        <button type="button" onClick={quickLookup} disabled={lookupLoading} className="w-full rounded-md bg-slate-950 px-3 py-2 text-sm font-black text-white disabled:opacity-50">
          {lookupLoading ? "조회 중" : "조회"}
        </button>
        {lookupResult?.error && <div className="mt-2 rounded-md bg-rose-50 p-3 text-xs font-black text-rose-600">{lookupResult.error}</div>}
        {lookupResult?.message && !lookupProducts.length && <div className="mt-2 rounded-md bg-amber-50 p-3 text-xs font-black text-amber-700">{lookupResult.message}</div>}
        {lookupProducts.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-md border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-500">
              검색 결과 {lookupProducts.length}건
            </div>
            <div className="divide-y divide-slate-100">
              {lookupProducts.map((item, index) => {
                const itemKey = item.code || item.name || String(index);
                const isOpen = Boolean(expandedLookupCodes[itemKey]);
                return (
                  <div key={`${itemKey}-${index}`} className="bg-white">
                    <button
                      type="button"
                      onClick={() => setExpandedLookupCodes((prev) => ({ ...prev, [itemKey]: !prev[itemKey] }))}
                      className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-xs transition ${isOpen ? "bg-orange-50" : "hover:bg-slate-50"}`}
                    >
                      <span className="min-w-0">
                        <b className="block truncate text-slate-950">{item.name || "-"}</b>
                        <span className="mt-0.5 block truncate font-bold text-slate-500">
                          입고 {lookupAmount(item.inPrice)} / 출고 {lookupAmount(item.outPrice)}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-black text-orange-500">{isOpen ? "−" : "+"}</span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-orange-100 bg-orange-50 px-3 py-2 text-xs text-slate-600">
                        <div className="grid grid-cols-[76px_1fr] gap-y-1">
                          <span>품목명</span>
                          <button type="button" onClick={() => copyLookupText(item.name)} className="min-w-0 truncate text-left font-black text-slate-950 underline-offset-2 hover:text-orange-600 hover:underline" title="클릭해서 품목명 복사">
                            {item.name || "-"}
                          </button>
                          <span>품목코드</span><b className="text-slate-950">{item.code || "-"}</b>
                          <span>입고단가</span><b className="text-slate-950">{lookupAmount(item.inPrice)}</b>
                          <span>출고단가</span><b className="text-slate-950">{lookupAmount(item.outPrice)}</b>
                        </div>
                        <div className="mt-2 rounded-md border border-orange-100 bg-white">
                          <div className="border-b border-orange-100 px-2 py-1 font-black text-slate-500">창고별 현재고</div>
                          <div className="grid gap-1 p-2">
                            {item.inventory?.length ? item.inventory.map((stock, stockIndex) => (
                              <div key={`${item.code}-${stock.whCode || stock.whName}-${stockIndex}`} className="flex items-center justify-between gap-2">
                                <span className="truncate">{stock.whName || stock.whCode || "창고"}</span>
                                <b className="text-slate-950">{stock.qty || "0"}</b>
                              </div>
                            )) : <span className="text-slate-400">창고별 재고 없음</span>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ToolSection>

    </aside>
  );
}

function SalesInventoryWorkspace({ section }: { section: string }) {
  const [summary, setSummary] = useState<SalesInventorySummary | null>(null);
  const [message, setMessage] = useState("");
  const [showJsonTool, setShowJsonTool] = useState(false);
  const [historyMode, setHistoryMode] = useState<"sales" | "purchases">("sales");
  const [entryModalMode, setEntryModalMode] = useState<"sales" | "purchases" | null>(null);
  const [entryDraft, setEntryDraft] = useState<Record<string, string>>({});
  const [entryRows, setEntryRows] = useState<Array<Record<string, string>>>([]);
  const [editingEntryIndex, setEditingEntryIndex] = useState<number | null>(null);
  const [activeSheet, setActiveSheet] = useState<SalesSheetName>("송장출력용");
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [completedSalesTasks, setCompletedSalesTasks] = useState<Record<string, boolean>>({});
  const [pendingOrderFiles, setPendingOrderFiles] = useState<File[]>([]);
  const [pendingInvoiceFiles, setPendingInvoiceFiles] = useState<File[]>([]);
  const [orderFilePassword, setOrderFilePassword] = useState("");
  const [selectedSalesRange, setSelectedSalesRange] = useState<SalesGridSelection | null>(null);
  const [salesGridResetKey, setSalesGridResetKey] = useState(0);
  const [directShippingRows, setDirectShippingRows] = useState<Record<DirectShippingPartner, string[][]>>({ JB: [], 케이모아: [] });
  const directShippingFileHandles = useRef<Partial<Record<DirectShippingPartner, FileSystemFileHandleLike>>>({});
  const [directPartnerPickerOpen, setDirectPartnerPickerOpen] = useState(false);
  const [invoiceMemoText, setInvoiceMemoText] = useState("");
  const [salesSheetHighlightedRows, setSalesSheetHighlightedRows] = useState<Partial<Record<SalesSheetName, number[]>>>({});
  const [workspaceRestored, setWorkspaceRestored] = useState(false);

  useEscapeToClose(directPartnerPickerOpen, () => setDirectPartnerPickerOpen(false));
  useEscapeToClose(Boolean(invoiceMemoText), () => setInvoiceMemoText(""));
  useEscapeToClose(Boolean(entryModalMode), () => setEntryModalMode(null));

  const [sheets, setSheets] = useState<Record<SalesSheetName, string[][]>>(salesInitialSheets);
  const salesSupplyTotal = salesSupplyAmountTotal(sheets["FN판매입력"]);
  const [jsonText, setJsonText] = useState(`[
  {
    "일자": "20260520",
    "순번": "1",
    "거래처코드": "",
    "거래처명": "",
    "출하창고": "100",
    "품목코드": "",
    "품목명": "",
    "수량": 1,
    "단가(vat포함)": 1000,
    "적요": ""
  }
]`);

  function invalidateSalesInventoryCaches() {
    invalidateClientCache("/api/dashboard/summary");
    invalidateClientCache("/api/fnos/products/master");
    invalidateClientCache("/api/fnos/products/search");
    invalidateClientCache("/api/fnos/products");
    invalidateClientCache("/api/fnos/orders");
  }

  function loadSummary(force = false) {
    if (!force) {
      const cached = readCachedJson<DashboardSummary>("/api/dashboard/summary", { storageTtl: 60_000 });
      if (cached) setSummary(cached);
    }
    cachedClientJson<DashboardSummary>("/api/dashboard/summary", { ttl: 45_000, storageTtl: 60_000, force })
      .then((summaryData) => {
        setSummary(summaryData);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "요약 조회 실패";
        setSummary({ ok: false, error: message });
      });
  }

  useEffect(() => {
    loadSummary();
  }, []);

  const isOnlineSection = section === "online";
  const isHistorySection = section === "history";
  const isInventorySection = section === "inventory";
  const isMasterSection = section === "master";
  const sectionTitle = isOnlineSection ? "온라인 발주" : isHistorySection ? "판매/구매" : isInventorySection ? "재고현황" : "기초관리";
  const sectionDescription = isOnlineSection
    ? "주문수집부터 송장/출고까지 한 화면에서 처리합니다."
    : isHistorySection
      ? "판매내역, 구매내역, 기간별 현황을 FN OS DB 기준으로 관리합니다."
      : isInventorySection
        ? "현재고와 수동 재고 조정을 확인합니다."
        : "거래처, 품목, 창고, 쇼핑몰, 근태 기준정보를 관리합니다.";

  function makeEntryDraft(mode: "sales" | "purchases", sequence = entryRows.length + 1) {
    const date = new Date().toISOString().slice(0, 10);
    return {
      io_date: date,
      upload_ser_no: String(sequence),
      cust_name: "",
      wh_cd: "100",
      prod_cd: "",
      prod_name: "",
      qty: "1",
      price: "0",
      supply_amt: "0",
      remarks: mode === "sales" ? "웹 판매입력" : "웹 구매입력",
    };
  }

  function openEntryModal(mode: "sales" | "purchases") {
    setEntryModalMode(mode);
    setEntryRows([]);
    setEditingEntryIndex(null);
    setEntryDraft(makeEntryDraft(mode, 1));
  }

  function updateEntryDraft(key: string, value: string) {
    setEntryDraft((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "qty" || key === "price") {
        const qty = Number(String(key === "qty" ? value : next.qty).replace(/[^\d.-]/g, ""));
        const price = Number(String(key === "price" ? value : next.price).replace(/[^\d.-]/g, ""));
        if (Number.isFinite(qty) && Number.isFinite(price)) next.supply_amt = String(qty * price);
      }
      return next;
    });
  }

  function addOrUpdateEntryRow() {
    if (!entryModalMode) return;
    const qty = Number(String(entryDraft.qty || 0).replace(/[^\d.-]/g, ""));
    if (!String(entryDraft.prod_cd || entryDraft.prod_name || "").trim()) {
      setMessage("품목코드 또는 품목명을 입력해 주세요.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setMessage("수량은 1 이상으로 입력해 주세요.");
      return;
    }
    const row = {
      ...entryDraft,
      sale_date: entryModalMode === "sales" ? entryDraft.io_date : "",
      purchase_date: entryModalMode === "purchases" ? entryDraft.io_date : "",
    };
    if (editingEntryIndex === null) {
      setEntryRows((prev) => [...prev, row]);
      setEntryDraft(makeEntryDraft(entryModalMode, entryRows.length + 2));
    } else {
      setEntryRows((prev) => prev.map((item, index) => (index === editingEntryIndex ? row : item)));
      setEditingEntryIndex(null);
      setEntryDraft(makeEntryDraft(entryModalMode, entryRows.length + 1));
    }
    setMessage("");
  }

  function editEntryRow(index: number) {
    setEditingEntryIndex(index);
    setEntryDraft(entryRows[index] || {});
  }

  function deleteEntryRow(index: number) {
    setEntryRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
    if (editingEntryIndex === index) {
      setEditingEntryIndex(null);
      if (entryModalMode) setEntryDraft(makeEntryDraft(entryModalMode, Math.max(1, entryRows.length)));
    }
  }

  async function saveEntryRows() {
    if (!entryModalMode) return;
    const rows = entryRows.length ? entryRows : [entryDraft];
    if (!rows.some((row) => String(row.prod_cd || row.prod_name || "").trim())) {
      setMessage("저장할 판매/구매 입력 행이 없습니다.");
      return;
    }
    const endpoint = entryModalMode === "sales" ? "/api/sales/import" : "/api/purchases/import";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ rows, source_file_name: entryModalMode === "sales" ? "FN_OS_SALES_ENTRY" : "FN_OS_PURCHASE_ENTRY" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setMessage(data.error || "저장에 실패했습니다.");
      return;
    }
    setMessage(`${entryModalMode === "sales" ? "판매" : "구매"} 입력 저장 완료: ${data.total_count || data.success_count || rows.length}건`);
    setEntryModalMode(null);
    setEntryRows([]);
    setEditingEntryIndex(null);
    invalidateSalesInventoryCaches();
    loadSummary(true);
  }

  useEffect(() => {
    if (!isHistorySection) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "F2") return;
      event.preventDefault();
      openEntryModal(historyMode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isHistorySection, historyMode]);

  useEffect(() => {
    let cancelled = false;
    async function restoreWorkspace() {
      try {
        const raw = localStorage.getItem(SALES_WORKSPACE_STORAGE_KEY);
        if (!raw) return;
        const snapshot = JSON.parse(raw) as Partial<SalesWorkspaceSnapshot>;
        if (snapshot.dayKey !== salesWorkspaceDayKey()) {
          clearSalesWorkspaceStorage();
          return;
        }
        if (snapshot.activeSheet && salesSheetHeaders[snapshot.activeSheet]) setActiveSheet(snapshot.activeSheet);
        if (snapshot.sheets) {
          setSheets({
            송장출력용: padSalesRows("송장출력용", snapshot.sheets.송장출력용 || []),
            FN송장입력: padSalesRows("FN송장입력", snapshot.sheets.FN송장입력 || []),
            "FN판매입력": padSalesRows("FN판매입력", snapshot.sheets["FN판매입력"] || []),
          });
        }
        setCompletedSalesTasks(snapshot.completedSalesTasks || {});
        setOrderFilePassword(snapshot.orderFilePassword || "");
        setMessage(snapshot.message || "");
        setDirectShippingRows(snapshot.directShippingRows || { JB: [], 케이모아: [] });
        const [storedUploaded, storedOrders, storedInvoices] = await Promise.all([
          loadSalesWorkspaceFiles("uploaded"),
          loadSalesWorkspaceFiles("pendingOrders"),
          loadSalesWorkspaceFiles("pendingInvoices"),
        ]);
        if (cancelled) return;
        setUploadedFiles(storedUploaded);
        setPendingOrderFiles(storedOrders);
        setPendingInvoiceFiles(storedInvoices);
        setSalesGridResetKey((value) => value + 1);
      } catch {
        clearSalesWorkspaceStorage();
      } finally {
        if (!cancelled) setWorkspaceRestored(true);
      }
    }
    void restoreWorkspace();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceRestored) return undefined;
    const timer = window.setTimeout(() => {
      try {
        const snapshot: SalesWorkspaceSnapshot = {
          dayKey: salesWorkspaceDayKey(),
          activeSheet,
          sheets,
          uploadedFileNames: uploadedFiles.map((file) => file.name),
          pendingOrderFileNames: pendingOrderFiles.map((file) => file.name),
          pendingInvoiceFileNames: pendingInvoiceFiles.map((file) => file.name),
          completedSalesTasks,
          orderFilePassword,
          message,
          directShippingRows,
        };
        localStorage.setItem(SALES_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // 작업실 저장 공간이 부족하면 화면 작업은 그대로 유지하고, 다음 초기화 때 정리한다.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [workspaceRestored, activeSheet, sheets, uploadedFiles, pendingOrderFiles, pendingInvoiceFiles, completedSalesTasks, orderFilePassword, message, directShippingRows]);

  useEffect(() => {
    if (!workspaceRestored) return;
    void Promise.all([
      saveSalesWorkspaceFiles("uploaded", uploadedFiles),
      saveSalesWorkspaceFiles("pendingOrders", pendingOrderFiles),
      saveSalesWorkspaceFiles("pendingInvoices", pendingInvoiceFiles),
    ]).catch(() => undefined);
  }, [workspaceRestored, uploadedFiles, pendingOrderFiles, pendingInvoiceFiles]);

  async function postRows(kind: "sales" | "purchases") {
    setMessage("");
    let rows: unknown;
    try {
      rows = JSON.parse(jsonText);
    } catch {
      setMessage("JSON 형식이 올바르지 않습니다. VBA에서는 rows 배열로 보내면 됩니다.");
      return;
    }
    const endpoint = kind === "sales" ? "/api/sales/import" : "/api/purchases/import";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ rows, source_file_name: "FN_OS_WEB" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setMessage(data.error || "저장 실패");
      return;
    }
    setMessage(`FN OS 저장 완료: ${data.total_count || 0}건`);
    invalidateSalesInventoryCaches();
    loadSummary(true);
  }

  async function sync(target: "products" | "inventory") {
    setMessage("");
    const res = await fetch(`/api/fnos/${target}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setMessage(data.error || "동기화 실패");
      return;
    }
    setMessage(`${target === "products" ? "품목" : "재고"} 동기화 완료: ${data.count || 0}건`);
    invalidateSalesInventoryCaches();
    loadSummary(true);
  }

  function pickOrderFiles(files: FileList | File[] | null, kind: "orders" | "invoices" = "orders") {
    const incoming = Array.from(files || []);
    const existingNames = new Set(uploadedFiles.map((file) => file.name));
    const duplicatedNames = incoming.filter((file) => existingNames.has(file.name)).map((file) => file.name);
    const next = incoming.filter((file) => !existingNames.has(file.name));
    if (duplicatedNames.length) {
      setMessage(`이미 업로드된 파일은 제외했습니다: ${duplicatedNames.join(", ")}`);
    }
    if (!next.length) return;
    if (kind === "orders") {
      for (const file of next) {
        if (!classifyOrderUploadFileName(file.name)) {
          const ok = window.confirm(`${file.name} - 이 파일은 확인되지 않는 사이트의 정보입니다. 그래도 발주파일로 추가할까요?`);
          if (!ok) return;
        }
      }
    }
    if (kind === "orders" && (hasSalesRows(sheets.송장출력용) || hasSalesRows(sheets.FN송장입력) || hasSalesRows(sheets["FN판매입력"]))) {
      const ok = window.confirm("현재 작업 중인 시트 값이 있습니다. 새 파일을 실행하면 해당 시트 값이 덮어써질 수 있습니다. 파일을 대기 목록에 추가할까요?");
      if (!ok) return;
    }
    setUploadedFiles((prev) => [...prev, ...next]);
    if (kind === "orders") {
      setPendingOrderFiles((prev) => [...prev, ...next]);
    } else {
      setPendingInvoiceFiles((prev) => [...prev, ...next]);
    }
    setCompletedSalesTasks((prev) => ({
      ...prev,
      orderFlow: kind === "orders" ? false : prev.orderFlow,
      invoiceFlow: kind === "invoices" ? false : prev.invoiceFlow,
      invoiceMatched: kind === "invoices" ? false : prev.invoiceMatched,
    }));
    setMessage(kind === "orders"
      ? `발주파일 ${next.length}개를 대기 목록에 올렸습니다. F1 버튼을 누르면 시트가 채워집니다.`
      : `송장파일 ${next.length}개를 업로드했습니다. F5 송장번호 매칭을 누르면 기존 시트에 반영됩니다.`);
  }

  function removeUploadedSalesFile(target: File) {
    const key = salesUploadFileKey(target);
    const keep = (file: File) => salesUploadFileKey(file) !== key;
    setUploadedFiles((prev) => prev.filter(keep));
    setPendingOrderFiles((prev) => prev.filter(keep));
    setPendingInvoiceFiles((prev) => prev.filter(keep));
    setMessage(`${target.name} 업로드를 취소했습니다.`);
  }

  async function parseWaitingFiles(kind: "orders" | "invoices", passwordOverride = orderFilePassword) {
    const waitingFiles = kind === "orders" ? pendingOrderFiles : pendingInvoiceFiles;
    if (!waitingFiles.length) {
      window.alert(kind === "orders" ? "먼저 발주파일을 업로드해 주세요." : "먼저 송장파일을 업로드해 주세요.");
      return;
    }
    setSalesSheetHighlightedRows({});
    setMessage(`${waitingFiles.length}개 파일을 읽는 중입니다...`);
    const formData = new FormData();
    formData.append("kind", kind);
    if (passwordOverride) formData.append("order_file_password", passwordOverride);
    waitingFiles.forEach((file) => formData.append("files", file));
    const res = await fetch("/api/sales/order-files/parse", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const errorMessage = data.error || "";
      if (kind === "orders" && /ORDER_FILE_PASSWORD|password|protected|encrypted|암호/i.test(errorMessage)) {
        const password = window.prompt("암호화된 엑셀입니다. 엑셀 비밀번호를 입력해 주세요.");
        if (password) {
          setOrderFilePassword(password);
          await parseWaitingFiles(kind, password);
          return;
        }
      }
      setMessage(data.error || "엑셀 파일을 읽지 못했습니다.");
      return;
    }
    const parsedSheets = data.sheets as Partial<Record<SalesSheetName, string[][]>>;
    setSheets((prev) => {
      const nextSheets = { ...prev };
      (Object.keys(salesSheetHeaders) as SalesSheetName[]).forEach((sheet) => {
        const rows = sheet === "송장출력용"
          ? sortShippingRowsByOption(parsedSheets?.[sheet] || [])
          : parsedSheets?.[sheet] || [];
        if (rows.length) nextSheets[sheet] = padSalesRows(sheet, rows);
      });
      return nextSheets;
    });
    setSalesGridResetKey((value) => value + 1);
    const count = (Object.values(parsedSheets || {}) as string[][][]).reduce((sum, rows) => sum + rows.length, 0);
    setCompletedSalesTasks((prev) => ({ ...prev, orderFlow: kind === "orders" ? true : prev.orderFlow, invoiceFlow: kind === "invoices" ? true : prev.invoiceFlow }));
    setMessage(`${kind === "orders" ? "발주" : "송장"}파일 ${waitingFiles.length}개를 읽어서 ${count}개 행을 시트에 반영했습니다.`);
    if (kind === "orders") window.alert("작업 완료됨!");
  }

  function runOrderMacroFlow() {
    if (completedSalesTasks.orderFlow) {
      const ok = window.confirm("이미 발주파일 작업을 실행한 것으로 보입니다. 중복 작업일 수 있는데 계속할까요?");
      if (!ok) {
        setMessage("발주파일 작업 실행을 취소했습니다.");
        return;
      }
    }
    void parseWaitingFiles("orders");
  }

  function exportAllSheets() {
    const hasAnyRows = (Object.keys(salesSheetHeaders) as SalesSheetName[]).some((sheet) => hasSalesRows(sheets[sheet]));
    if (!hasAnyRows) {
      window.alert("내보낼 시트 값이 없습니다. 파일을 업로드하거나 값을 입력한 뒤 다시 시도해 주세요.");
      return;
    }
    if (completedSalesTasks.exportAll) {
      const ok = window.confirm("전체 엑셀을 이미 내보낸 것으로 보입니다. 다른 이름으로 다시 다운로드될 수 있습니다. 계속할까요?");
      if (!ok) return;
    }
    void downloadXlsxFile(`${integratedOrderFileName()}.xlsx`, sheets);
    setCompletedSalesTasks((prev) => ({ ...prev, exportAll: true }));
    setMessage("현재 화면의 전체 시트를 Excel 파일로 내보냈습니다.");
  }

  function exportShippingSheet() {
    if (!hasSalesRows(sheets.송장출력용)) {
      window.alert("송장출력용 시트가 비어 있습니다. 파일을 업로드하거나 값을 입력한 뒤 내보내 주세요.");
      return;
    }
    if (completedSalesTasks.exportShipping) {
      const ok = window.confirm("송장출력용을 이미 내보낸 것으로 보입니다. 다른 이름으로 다시 다운로드될 수 있습니다. 계속할까요?");
      if (!ok) return;
    }
    void downloadXlsxFile(`${timeLabel()}_송장출력용.xlsx`, { 송장출력용: sheets.송장출력용 });
    setCompletedSalesTasks((prev) => ({ ...prev, exportShipping: true }));
    setMessage("송장출력용 시트를 내보냈습니다. 브라우저 다운로드 폴더에서 확인해 주세요.");
  }

  function selectedShippingRows() {
    if (selectedSalesRange?.sheet !== "송장출력용") return [];
    if (selectedSalesRange.rowIndexes?.length) {
      return selectedSalesRange.rowIndexes
        .map((rowIndex) => sheets.송장출력용[rowIndex])
        .filter((row): row is string[] => Boolean(row && row.some(Boolean)));
    }
    return sheets.송장출력용.slice(selectedSalesRange.range.startRow, selectedSalesRange.range.endRow + 1).filter((row) => row.some(Boolean));
  }

  function openDirectPartnerPicker() {
    if (!hasSalesRows(sheets.송장출력용)) {
      window.alert("직송파일을 만들 송장출력용 데이터가 없습니다.");
      return;
    }
    const selectedRows = selectedShippingRows();
    if (!selectedRows.length) {
      window.alert("직송파일로 만들 송장출력용 행을 먼저 선택해 주세요. 예: 2행과 5행을 드래그 또는 Shift 선택");
      return;
    }
    setDirectPartnerPickerOpen(true);
  }

  async function readDirectShippingRowsFromHandle(handle: FileSystemFileHandleLike, headers: string[]) {
    if (!handle.getFile) return [];
    try {
      const file = await handle.getFile();
      if (!file.size) return [];
      const data = await file.arrayBuffer();
      const xlsx = await loadXlsxModule();
      const workbook = xlsx.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) return [];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = xlsx.utils.sheet_to_json<string[]>(worksheet, { header: 1, blankrows: false, defval: "" });
      if (!rawRows.length) return [];
      const [firstRow, ...bodyRows] = rawRows.map((row) => headers.map((_, index) => String(row[index] ?? "")));
      const hasHeader = headers.every((header, index) => String(firstRow[index] || "").trim() === header);
      return (hasHeader ? bodyRows : [firstRow, ...bodyRows]).filter((row) => row.some(Boolean));
    } catch {
      return [];
    }
  }

  function directShippingCode(partner: DirectShippingPartner, sequence: number) {
    return partner === "JB" ? `${todayMmdd()}-JB-${String(sequence).padStart(3, "0")}` : `${todayMmdd()}-에프엔-${String(sequence).padStart(3, "0")}`;
  }

  function mergeDirectShippingRows(partner: DirectShippingPartner, existingRows: string[][], nextRows: string[][]) {
    const seen = new Set(existingRows.map((row) => row.slice(1).join("\t")));
    const merged = [...existingRows];
    for (const row of nextRows) {
      const key = row.slice(1).join("\t");
      if (seen.has(key)) continue;
      seen.add(key);
      const nextRow = [...row];
      nextRow[0] = directShippingCode(partner, merged.length + 1);
      merged.push(nextRow);
    }
    return merged;
  }

  async function saveDirectShippingWorkbook(partner: DirectShippingPartner, headers: string[], rows: string[][]) {
    const fileName = `${todayMmdd()}_${partner}직송.xlsx`;
    await downloadTableXlsx(fileName, `${partner}직송`, headers, rows);
    return rows;
  }

  async function makeDirectShippingFile(partner: DirectShippingPartner) {
    const selectedRows = selectedShippingRows();
    if (!selectedRows.length) {
      window.alert("직송파일로 만들 송장출력용 행을 먼저 선택해 주세요.");
      setDirectPartnerPickerOpen(false);
      return;
    }

    const headers = partner === "JB" ? jbDirectHeaders : kemoreDirectHeaders;
    const mapper = partner === "JB" ? mapJbDirectRow : mapKemoreDirectRow;
    const previousRows = directShippingRows[partner] || [];
    const appendRows: string[][] = [];

    for (const sourceRow of selectedRows) {
      const preview = mapper(sourceRow, previousRows.length + appendRows.length + 1);
      const isDuplicate = previousRows.some((row) => row.slice(1).join("\t") === preview.slice(1).join("\t"))
        || appendRows.some((row) => row.slice(1).join("\t") === preview.slice(1).join("\t"));
      if (!isDuplicate) appendRows.push(preview);
    }

    if (!appendRows.length) {
      window.alert("이미 입력된 값과 일치합니다.");
      setDirectPartnerPickerOpen(false);
      return;
    }

    const nextRows = [...previousRows, ...appendRows];
    let savedRows = nextRows;
    try {
      savedRows = await saveDirectShippingWorkbook(partner, headers, nextRows);
    } catch {
      setDirectPartnerPickerOpen(false);
      setMessage("직송파일 저장을 취소했습니다.");
      return;
    }
    setDirectShippingRows((prev) => ({ ...prev, [partner]: savedRows }));
    setCompletedSalesTasks((prev) => ({ ...prev, directShipping: true }));
    setMessage(`${partner} 직송파일에 ${appendRows.length}개 행을 추가했습니다. 총 ${savedRows.length}개 행입니다.`);
    setDirectPartnerPickerOpen(false);
  }

  async function sendSalesInput() {
    const rows = sheets["FN판매입력"]
      .filter(rowHasValue)
      .map((row) => salesRowObject("FN판매입력", row));
    if (!rows.length) {
      window.alert("전송할 판매입력 행이 없습니다.");
      return;
    }
    if (completedSalesTasks.salesSent) {
      const ok = window.confirm("판매입력을 이미 전송한 것으로 보입니다. 중복 전송 위험이 있습니다. 계속할까요?");
      if (!ok) return;
    } else {
      const ok = window.confirm(`${rows.length}건을 FN OS 판매 DB에 저장합니다. 계속할까요?`);
      if (!ok) return;
    }
    setMessage("FN OS 판매 DB에 저장하는 중입니다...");
    try {
      const res = await fetch("/api/sales/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows, source_file_name: "FN_OS_ONLINE_ORDER" }),
      });
      const data = await res.json().catch(() => ({}));
      const popup = importResultText(data, "FN OS 판매입력 결과");
      window.alert(popup);
      if (!res.ok || data.ok === false) {
        setMessage(data.error || data.message || "판매입력 전송 실패");
      } else {
        setCompletedSalesTasks((prev) => ({ ...prev, salesSent: true }));
        setMessage(`판매입력 처리 완료: 성공 ${data.success_count || 0}건 / 실패 ${data.fail_count || 0}건`);
      }
      invalidateSalesInventoryCaches();
      loadSummary(true);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "알 수 없는 오류";
      window.alert(`FN OS 판매입력 결과\nDB 저장: 0건\n성공: 0건\n실패: ${rows.length}건\n이유: ${reason}`);
      setMessage(`판매입력 전송 실패: ${reason}`);
    }
  }

  async function matchInvoiceNumbers() {
    setSalesSheetHighlightedRows({});
    if (!pendingInvoiceFiles.length) {
      window.alert("먼저 송장파일을 업로드해 주세요.");
      return;
    }
    if (!hasSalesRows(sheets.송장출력용)) {
      window.alert("송장번호 매칭을 실행할 송장출력용 데이터가 없습니다.");
      return;
    }
    if (completedSalesTasks.invoiceMatched) {
      const ok = window.confirm("송장매칭이 이미 되었습니다. 다시 매칭하시겠어요?");
      if (!ok) return;
    }

    setMessage(`${pendingInvoiceFiles.length}개 송장파일을 읽어서 기존 시트에 매칭하는 중입니다...`);
    const formData = new FormData();
    formData.append("kind", "invoices");
    if (orderFilePassword) formData.append("order_file_password", orderFilePassword);
    pendingInvoiceFiles.forEach((file) => formData.append("files", file));
    const res = await fetch("/api/sales/order-files/parse", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setMessage(data.error || "송장파일을 읽지 못했습니다.");
      return;
    }
    const parsedSheets = data.sheets as Partial<Record<SalesSheetName, string[][]>>;
    const invoiceRows = (data.invoiceRows || []) as ParsedInvoiceTrackingRow[];
    const result = applyInvoiceTrackingToSheets(sheets, parsedSheets, invoiceRows);

    if (!result.matchedShipping && !result.matchedInvoice) {
      const already = Number(result.alreadyMatchedShipping || 0) + Number(result.alreadyMatchedInvoice || 0);
      if (already > 0) {
        const ok = window.confirm("송장매칭이 이미 되었습니다. 다시 매칭하시겠어요?");
        if (!ok) return;
      }
      if (result.failedShipping.length || result.failedInvoice.length) {
        const failureMessage = invoiceFailureReport(result.failedShipping, result.failedInvoice);
        setSalesSheetHighlightedRows({
          송장출력용: result.failedShippingIndexes,
          FN송장입력: result.failedInvoiceIndexes,
        });
        window.alert(failureMessage);
        setMessage(failureMessage);
        return;
      }
      setMessage("송장번호 매칭 결과가 없습니다. 수취인/연락처/주소를 확인해 주세요.");
      return;
    }

    setSheets(result.sheets);
    setSalesGridResetKey((value) => value + 1);
    if (!result.failedShipping.length && !result.failedInvoice.length) {
      setPendingInvoiceFiles([]);
      setCompletedSalesTasks((prev) => ({ ...prev, invoiceFlow: true, invoiceMatched: true }));
    } else {
      setCompletedSalesTasks((prev) => ({ ...prev, invoiceFlow: true, invoiceMatched: false }));
    }
    const manualRows = result.manualRows;
    const failureMessage = (result.failedShipping.length || result.failedInvoice.length)
      ? invoiceFailureReport(result.failedShipping, result.failedInvoice)
      : "";
    setSalesSheetHighlightedRows({
      송장출력용: result.failedShippingIndexes,
      FN송장입력: result.failedInvoiceIndexes,
    });
    window.alert(failureMessage || "송장매칭 성공");
    if (manualRows.length) {
      const memo = [`<${new Date().getMonth() + 1}월${new Date().getDate()}일 직접 송장 입력>`, "", ...manualRows].join("\n");
      setInvoiceMemoText(memo);
      setMessage(`송장번호 매칭 완료: 송장출력용 ${result.matchedShipping}건, FN송장입력 ${result.matchedInvoice}건 반영. 직접 입력 대상 메모장을 화면에 표시했습니다.${failureMessage ? `\n${failureMessage}` : ""}`);
    } else {
      setInvoiceMemoText("");
      setMessage(`송장번호 매칭 완료: 송장출력용 ${result.matchedShipping}건, FN송장입력 ${result.matchedInvoice}건 반영. 직접 입력 대상은 없습니다.${failureMessage ? `\n${failureMessage}` : ""}`);
    }
  }

  async function applyFnParcelSheet() {
    const shippingRows = sheets.송장출력용.filter((row) => row.some((cell) => String(cell || "").trim()));
    if (!shippingRows.length) {
      window.alert("FN_택배시트에 반영할 송장출력용 데이터가 없습니다.");
      return;
    }
    const targetSheet = fnParcelSheetName();
    const ok = window.confirm(`FN_택배시트의 '${targetSheet}' 시트 가장 아래 빈 행부터 ${shippingRows.length}개 행을 구글시트에 반영합니다. 계속할까요?`);
    if (!ok) return;
    try {
      const rows = shippingRows.map((row) => salesSheetHeaders.송장출력용.map((_, index) => row[index] || ""));
      const res = await fetch("/api/google/fn-parcel-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sheetName: targetSheet, rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        window.alert(data.error || "FN_택배시트 반영에 실패했습니다.");
        setMessage(data.error || "FN_택배시트 반영 실패");
        return;
      }
      setCompletedSalesTasks((prev) => ({ ...prev, fnParcelApplied: true }));
      const reflectedCount = Number(data.count || 0);
      const duplicateCount = Number(data.duplicateCount || 0);
      const resultMessage = reflectedCount === 0 && duplicateCount > 0
        ? "새로운 행이 없습니다. 모든 행이 이미 구글시트에 있습니다."
        : duplicateCount > 0
          ? `새로운 ${reflectedCount}개의 행만 반영되었습니다.`
          : `FN_택배시트 '${data.sheetName || targetSheet}'에 ${reflectedCount || shippingRows.length}개 행을 반영했습니다.`;
      window.alert(resultMessage);
      setMessage(resultMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FN_택배시트 반영 실패";
      window.alert(message);
      setMessage(message);
    }
  }

  function resetSalesWorkspace() {
    const hasAnyRows = (Object.keys(salesSheetHeaders) as SalesSheetName[]).some((sheet) => hasSalesRows(sheets[sheet]));
    if (hasAnyRows || uploadedFiles.length) {
      const ok = window.confirm("이번 작업의 업로드 파일과 시트 값을 모두 초기화할까요?");
      if (!ok) return;
    }
    setUploadedFiles([]);
    setPendingOrderFiles([]);
    setPendingInvoiceFiles([]);
    setOrderFilePassword("");
    setSelectedSalesRange(null);
    setCompletedSalesTasks({});
    setInvoiceMemoText("");
    setSalesSheetHighlightedRows({});
    setDirectShippingRows({ JB: [], 케이모아: [] });
    directShippingFileHandles.current = {};
    setActiveSheet("송장출력용");
    setSheets(salesInitialSheets());
    clearSalesWorkspaceStorage();
    setSalesGridResetKey((value) => value + 1);
    setMessage("이번 작업을 초기화했습니다.");
  }

  useEffect(() => {
    if (section !== "online") return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!/^F[1-6]$/.test(event.key)) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (directPartnerPickerOpen || invoiceMemoText) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "F1") runOrderMacroFlow();
      if (event.key === "F2") exportShippingSheet();
      if (event.key === "F3") openDirectPartnerPicker();
      if (event.key === "F4") void sendSalesInput();
      if (event.key === "F5") matchInvoiceNumbers();
      if (event.key === "F6") void applyFnParcelSheet();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  return (
    <div className="space-y-4">
      <PageHeader title={sectionTitle} description={sectionDescription} />
      {isOnlineSection && (
        <Panel
          title="온라인 발주"
          subtitle="기존 발주통합매크로 흐름을 FN OS 화면에서 실행합니다. 업로드 파일은 작업 대기 상태로 보관하고, 결과 시트는 아래 그리드에서 편집합니다."
          action={
            <div className="flex gap-2">
              <button type="button" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-black text-slate-700" onClick={resetSalesWorkspace}>초기화</button>
              <button type="button" className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" onClick={exportAllSheets}>전체 엑셀 내보내기</button>
            </div>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2">
            <button type="button" className="rounded-md bg-slate-950 px-3 py-2 text-sm font-black text-white" onClick={runOrderMacroFlow}>F1. 발주 작업 실행</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-black text-slate-700" onClick={exportShippingSheet}>F2. 송장출력용 엑셀</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-black text-slate-700" onClick={openDirectPartnerPicker}>F3. 직송파일 생성</button>
            <button type="button" className="rounded-md border border-blue-300 px-3 py-2 text-sm font-black text-blue-600" onClick={sendSalesInput}>F4. FN 판매입력 저장</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-black text-slate-700" onClick={matchInvoiceNumbers}>F5. 송장번호 매칭</button>
            <button type="button" className="rounded-md border border-emerald-300 px-3 py-2 text-sm font-black text-emerald-700" onClick={() => void applyFnParcelSheet()}>F6. FN_택배시트 반영</button>
          </div>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void pickOrderFiles(event.dataTransfer.files, "orders");
            }}
            className={`mb-4 rounded-md border p-4 ${dragging ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-slate-50"}`}
          >
            <div className="grid gap-3 lg:grid-cols-[180px_180px_1fr]">
              <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-orange-200 bg-white px-4 text-sm font-black text-orange-600 hover:bg-orange-50">
                발주파일 업로드
                <input type="file" multiple accept=".xlsx,.xls,.xlsm,.csv" className="hidden" onChange={(event) => { void pickOrderFiles(event.target.files, "orders"); event.target.value = ""; }} />
              </label>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-blue-200 bg-white px-4 text-sm font-black text-blue-600 hover:bg-blue-50">
                송장파일 업로드
                <input type="file" multiple accept=".xlsx,.xls,.xlsm,.csv" className="hidden" onChange={(event) => { void pickOrderFiles(event.target.files, "invoices"); event.target.value = ""; }} />
              </label>
              <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-500">
                파일을 여러 개 끌어다 놓을 수 있습니다. 드래그앤드랍은 발주파일만 가능
              </div>
            </div>
            {uploadedFiles.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {uploadedFiles.map((file) => {
                  const key = salesUploadFileKey(file);
                  const kind = pendingInvoiceFiles.some((invoiceFile) => salesUploadFileKey(invoiceFile) === key) ? "invoices" : "orders";
                  const badge = salesUploadBadge(file.name, kind);
                  return (
                    <span
                      key={key}
                      title={`${badge.label} · ${file.name}`}
                      className={`inline-flex h-8 w-[200px] items-center gap-2 rounded-md border px-2 text-xs font-black ${badge.className}`}
                    >
                      <span className="flex h-5 min-w-5 items-center justify-center rounded bg-white/80 px-1 text-[10px] font-black">{badge.mark}</span>
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <button
                        type="button"
                        aria-label={`${file.name} 업로드 취소`}
                        onClick={() => removeUploadedSalesFile(file)}
                        className="shrink-0 rounded px-1 text-xs font-black opacity-70 hover:bg-white hover:opacity-100"
                      >
                        X
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {(pendingOrderFiles.length > 0 || pendingInvoiceFiles.length > 0) && (
              <p className="mt-2 text-xs font-bold text-slate-500">
                대기 중: 발주파일 {pendingOrderFiles.length}개 / 송장파일 {pendingInvoiceFiles.length}개
              </p>
            )}
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {(Object.keys(salesSheetHeaders) as SalesSheetName[]).map((sheet) => (
              <button
                key={sheet}
                type="button"
                onClick={() => setActiveSheet(sheet)}
                className={`rounded-md px-3 py-2 text-sm font-black ${activeSheet === sheet ? "bg-orange-500 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
              >
                {sheet}
              </button>
            ))}
            {activeSheet === "FN판매입력" && (
              <span className="inline-flex items-center rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-black text-orange-700">
                판매입력 총 금액 : {Math.round(salesSupplyTotal).toLocaleString("ko-KR")}원
              </span>
            )}
          </div>
          <SalesExcelGrid
            sheet={activeSheet}
            rows={sheets[activeSheet]}
            onChange={(rows) => setSheets((prev) => ({ ...prev, [activeSheet]: rows }))}
            onSelectionChange={(sheet, range, rowIndexes) => setSelectedSalesRange({ sheet, range, rowIndexes })}
            resetKey={salesGridResetKey}
            highlightedRows={salesSheetHighlightedRows[activeSheet] || []}
          />
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs font-bold text-amber-700">
            참고: 직송파일은 기본 다운로드 위치에 바로 생성됩니다. 같은 거래처로 다시 생성하면 현재 작업에 누적된 행까지 포함해 다시 내려받습니다.
          </p>
          {message && <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">{message}</div>}
          {directPartnerPickerOpen && (
            <SelectionModal
              title="거래처"
              description="직송파일 양식을 선택해 주세요."
              onClose={() => setDirectPartnerPickerOpen(false)}
              size="sm"
            >
              <div
              onKeyDown={(event) => {
                if (event.key === "1") {
                  event.preventDefault();
                  void makeDirectShippingFile("JB");
                }
                if (event.key === "2") {
                  event.preventDefault();
                  void makeDirectShippingFile("케이모아");
                }
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <button type="button" autoFocus onClick={() => void makeDirectShippingFile("JB")} className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-5 text-lg font-black text-orange-600 hover:bg-orange-100">1. JB</button>
                <button type="button" onClick={() => void makeDirectShippingFile("케이모아")} className="rounded-xl border border-gray-200 bg-white px-4 py-5 text-lg font-black text-gray-700 hover:bg-gray-50">2. 케이모아</button>
              </div>
              </div>
            </SelectionModal>
          )}
          {invoiceMemoText && (
            <FormModal
              title="직접 송장 입력 메모장"
              onClose={() => setInvoiceMemoText("")}
              size="xl"
              footer={<ActionButton type="button" onClick={() => setInvoiceMemoText("")}>확인</ActionButton>}
            >
                <textarea
                  className={`${modalTextareaClass} h-80 resize-none font-mono`}
                  value={invoiceMemoText}
                  onChange={(event) => setInvoiceMemoText(event.target.value)}
                  autoFocus
                />
            </FormModal>
          )}
        </Panel>
      )}

      {isHistorySection && (
        <Panel
          title="판매/구매"
          subtitle={historyMode === "sales" ? "최근 입력한 판매내역을 기본으로 보여줍니다." : "최근 입력한 구매내역을 기본으로 보여줍니다."}
          action={
            <button
              type="button"
              onClick={() => openEntryModal(historyMode)}
              className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white hover:bg-orange-600"
            >
              {historyMode === "sales" ? "F2 판매입력" : "F2 구매입력"}
            </button>
          }
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
              {[
                ["sales", "판매"],
                ["purchases", "구매"],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setHistoryMode(mode as "sales" | "purchases")}
                  className={`rounded px-5 py-2 text-sm font-black transition ${historyMode === mode ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-xs font-black text-slate-500">단축키 F2</div>
          </div>
          <div className="mb-3 grid gap-2 md:grid-cols-4">
            <input className="field-input rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder={historyMode === "sales" ? "품목명 / 거래처명 검색" : "품목명 / 공급처명 검색"} />
            <input className="field-input rounded-md border border-slate-200 px-3 py-2 text-sm" type="date" />
            <input className="field-input rounded-md border border-slate-200 px-3 py-2 text-sm" type="date" />
            <select className="field-input rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option>전체 상태</option>
              <option>SAVED</option>
              <option>FAIL</option>
            </select>
          </div>
          {historyMode === "sales" && <SalesSummaryGroups summary={summary} />}
          <SalesInventoryTable rows={historyMode === "sales" ? summary?.recent_sales || [] : summary?.recent_purchases || []} />
        </Panel>
      )}

      {isInventorySection && (
        <Panel
          title="재고현황"
          subtitle="FN OS 재고 DB를 판매 DB와 결합해 품절 위험을 계산합니다."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-2 text-left">품목코드</th>
                  <th className="py-2 text-left">품목명</th>
                  <th className="py-2 text-left">창고</th>
                  <th className="py-2 text-right">현재재고</th>
                  <th className="py-2 text-right">예상 소진일</th>
                  <th className="py-2 text-center">위험도</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.inventory || []).slice(0, 20).map((row, index) => {
                  const qty = Number(row.bal_qty || 0);
                  return (
                    <tr key={`${row.prod_cd || index}-${index}`} className="border-b border-slate-100">
                      <td className="py-2 font-bold">{String(row.prod_cd || "-")}</td>
                      <td className="py-2">{String(row.prod_name || "-")}</td>
                      <td className="py-2">{String(row.wh_name || row.wh_cd || "-")}</td>
                      <td className="py-2 text-right font-black">{qty.toLocaleString("ko-KR")}</td>
                      <td className="py-2 text-right">{qty > 0 ? "판매 DB 연결 후 계산" : "즉시 확인"}</td>
                      <td className="py-2 text-center"><StatusPill status={qty <= 5 ? "위험" : "정상"} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {message && <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">{message}</div>}
        </Panel>
      )}

      {isOnlineSection && (
        <Panel title="주문확인" subtitle="수집된 주문을 출고 가능 상태로 정리합니다. 미매칭, 재고부족, 중복, 보류/제외 상태를 확인하는 작업대입니다.">
          <div className="mb-3 grid gap-2 md:grid-cols-5">
            <select className="field-input rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option>전체 주문상태</option>
              <option>collected</option>
              <option>confirmed</option>
              <option>hold</option>
              <option>excluded</option>
              <option>ready_to_ship</option>
            </select>
            <button type="button" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-700">미매칭 상품</button>
            <button type="button" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-black text-rose-700">재고부족</button>
            <button type="button" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-600">중복 확인</button>
            <button type="button" className="rounded-md bg-orange-500 px-3 py-2 text-sm font-black text-white">확정 저장</button>
          </div>
          <OrderCheckTable orders={summary?.recent_orders || []} items={summary?.recent_order_items || []} />
        </Panel>
      )}

      {isHistorySection && (
        <Panel title="기간별 판매/구매 현황" subtitle="FN OS DB 기준 거래처별, 품목별, 기간별 금액을 집계합니다.">
          <div className="grid gap-4 lg:grid-cols-2">
            <SummaryGroupCard title="거래처별 판매" rows={summary?.sales_by_customer || []} />
            <SummaryGroupCard title="품목별 판매" rows={summary?.sales_by_product || []} />
            <SummaryGroupCard title="거래처별 구매" rows={summary?.purchases_by_customer || []} />
            <SummaryGroupCard title="품목별 구매" rows={summary?.purchases_by_product || []} />
          </div>
        </Panel>
      )}

      {isInventorySection && (
        <Panel title="재고수정" subtitle="수동 조정은 inventory_movements에 adjustment_plus / adjustment_minus로 기록하고 현재고를 갱신하는 구조입니다.">
          <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-500">
                  <tr><th className="py-2 text-left">일시</th><th className="py-2 text-left">유형</th><th className="py-2 text-left">SKU</th><th className="py-2 text-right">수량</th><th className="py-2 text-left">메모</th></tr>
                </thead>
                <tbody>
                  {(summary?.recent_inventory_movements || []).map((row, index) => (
                    <tr key={String(row.id || index)} className="border-b border-slate-100">
                      <td className="py-2 font-bold">{String(row.movement_date || row.created_at || "-").slice(0, 16)}</td>
                      <td className="py-2"><StatusPill status={String(row.movement_type || "-")} /></td>
                      <td className="py-2">{String(row.sku || "-")}</td>
                      <td className="py-2 text-right font-black">{Number(row.qty || 0).toLocaleString("ko-KR")}</td>
                      <td className="py-2">{String(row.memo || "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-black">조정 입력 예정 필드</h3>
              <p className="mt-2 text-sm font-bold text-slate-600">품목/SKU, 창고, 증가/감소, 수량, 사유, 조정자를 입력받아 다음 단계에서 저장 API를 연결합니다.</p>
            </div>
          </div>
        </Panel>
      )}

      {isMasterSection && (
        <MasterManagementPanel
          summary={summary}
          message={message}
          setMessage={setMessage}
          sync={sync}
          loadSummary={loadSummary}
        />
      )}

      {isOnlineSection && (
        <Panel title="송장/출고" subtitle="송장출력용, FN송장입력 시트 구조를 웹 DB로 옮기는 영역입니다.">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-black">송장출력용</h3>
              <p className="mt-2 text-sm text-slate-600">쇼핑몰코드, 수취인, 연락처, 우편번호, 주소, 주문옵션, 수량, 배송요청사항, 정산예정금액을 저장할 예정입니다.</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-black">FN송장입력</h3>
              <p className="mt-2 text-sm text-slate-600">주문번호, 묶음주문번호, 배송방법코드, 송장번호 매칭 및 입력 상태를 관리합니다.</p>
            </div>
          </div>
        </Panel>
      )}

      {entryModalMode && (
        <SalesPurchaseEntryModal
          mode={entryModalMode}
          draft={entryDraft}
          rows={entryRows}
          editingIndex={editingEntryIndex}
          onClose={() => setEntryModalMode(null)}
          onDraftChange={updateEntryDraft}
          onAddOrUpdate={addOrUpdateEntryRow}
          onEdit={editEntryRow}
          onDelete={deleteEntryRow}
          onNew={() => setEntryDraft(makeEntryDraft(entryModalMode, entryRows.length + 1))}
          onSave={() => void saveEntryRows()}
        />
      )}
    </div>
  );
}

function OrderCheckTable({ orders, items }: { orders: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> }) {
  const itemCountByOrder = new Map<string, number>();
  items.forEach((item) => {
    const key = String(item.order_id || "");
    if (!key) return;
    itemCountByOrder.set(key, (itemCountByOrder.get(key) || 0) + 1);
  });
  if (!orders.length) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-sm font-bold text-slate-500">아직 수집된 주문이 없습니다.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-500">
          <tr><th className="py-2 text-left">수집일</th><th className="py-2 text-left">쇼핑몰</th><th className="py-2 text-left">주문번호</th><th className="py-2 text-left">수취인</th><th className="py-2 text-left">주소</th><th className="py-2 text-right">품목</th><th className="py-2 text-center">상태</th></tr>
        </thead>
        <tbody>
          {orders.map((row, index) => (
            <tr key={String(row.id || index)} className="border-b border-slate-100">
              <td className="py-2 font-bold">{String(row.collected_at || row.created_at || "-").slice(0, 16)}</td>
              <td className="py-2">{String(row.channel_name || "-")}</td>
              <td className="py-2 font-bold">{String(row.order_no || "-")}</td>
              <td className="py-2">{String(row.receiver_name || "-")}</td>
              <td className="max-w-[360px] truncate py-2">{String(row.address || "-")}</td>
              <td className="py-2 text-right">{(itemCountByOrder.get(String(row.id || "")) || 0).toLocaleString("ko-KR")}</td>
              <td className="py-2 text-center"><StatusPill status={String(row.order_status || "collected")} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SalesPurchaseEntryModal({
  mode,
  draft,
  rows,
  editingIndex,
  onClose,
  onDraftChange,
  onAddOrUpdate,
  onEdit,
  onDelete,
  onNew,
  onSave,
}: {
  mode: "sales" | "purchases";
  draft: Record<string, string>;
  rows: Array<Record<string, string>>;
  editingIndex: number | null;
  onClose: () => void;
  onDraftChange: (key: string, value: string) => void;
  onAddOrUpdate: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onNew: () => void;
  onSave: () => void;
}) {
  const partnerLabel = mode === "sales" ? "거래처" : "공급처";
  useEscapeToClose(true, onClose);
  return (
    <FormModal
      title={mode === "sales" ? "판매입력" : "구매입력"}
      description="행 추가 후 수정/삭제하고 저장하면 FN OS DB에 반영됩니다."
      onClose={onClose}
      size="full"
      footer={
        <>
          <ActionButton type="button" variant="secondary" onClick={onClose}>닫기</ActionButton>
          <ActionButton type="button" variant="secondary" onClick={onNew}>새 입력</ActionButton>
          <ActionButton type="button" onClick={onSave}>저장</ActionButton>
        </>
      }
    >
      <div className="space-y-4">

        <div className="grid gap-4 md:grid-cols-4">
          <FormField label="일자"><input className={modalInputClass} type="date" value={draft.io_date || ""} onChange={(event) => onDraftChange("io_date", event.target.value)} /></FormField>
          <FormField label={partnerLabel}><input className={modalInputClass} value={draft.cust_name || ""} onChange={(event) => onDraftChange("cust_name", event.target.value)} /></FormField>
          <FormField label="창고"><input className={modalInputClass} value={draft.wh_cd || ""} onChange={(event) => onDraftChange("wh_cd", event.target.value)} /></FormField>
          <FormField label="순번"><input className={modalInputClass} value={draft.upload_ser_no || ""} onChange={(event) => onDraftChange("upload_ser_no", event.target.value)} /></FormField>
          <FormField label="품목코드"><input className={modalInputClass} value={draft.prod_cd || ""} onChange={(event) => onDraftChange("prod_cd", event.target.value)} /></FormField>
          <FormField label="품목명"><input className={modalInputClass} value={draft.prod_name || ""} onChange={(event) => onDraftChange("prod_name", event.target.value)} /></FormField>
          <FormField label="수량"><input className={modalInputClass} type="number" value={draft.qty || ""} onChange={(event) => onDraftChange("qty", event.target.value)} /></FormField>
          <FormField label="단가"><input className={modalInputClass} type="number" value={draft.price || ""} onChange={(event) => onDraftChange("price", event.target.value)} /></FormField>
          <FormField label="공급가액"><input className={modalInputClass} type="number" value={draft.supply_amt || ""} onChange={(event) => onDraftChange("supply_amt", event.target.value)} /></FormField>
          <FormField label="메모" className="md:col-span-3"><input className={modalInputClass} value={draft.remarks || ""} onChange={(event) => onDraftChange("remarks", event.target.value)} /></FormField>
        </div>

        <div className="flex flex-wrap justify-start gap-2">
          <ActionButton type="button" variant="secondary" onClick={onAddOrUpdate}>
            {editingIndex === null ? "행 추가" : "수정 반영"}
          </ActionButton>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500">
              <tr><th className="px-3 py-2 text-left">일자</th><th className="px-3 py-2 text-left">{partnerLabel}</th><th className="px-3 py-2 text-left">품목</th><th className="px-3 py-2 text-right">수량</th><th className="px-3 py-2 text-right">공급가액</th><th className="px-3 py-2 text-center">관리</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.upload_ser_no}-${index}`} className="border-t border-gray-100 hover:bg-orange-50/40">
                  <td className="px-3 py-2 font-bold">{row.io_date || "-"}</td>
                  <td className="px-3 py-2">{row.cust_name || "-"}</td>
                  <td className="px-3 py-2 font-bold">{row.prod_name || row.prod_cd || "-"}</td>
                  <td className="px-3 py-2 text-right">{Number(row.qty || 0).toLocaleString("ko-KR")}</td>
                  <td className="px-3 py-2 text-right font-black">{krw(Number(row.supply_amt || 0))}</td>
                  <td className="px-3 py-2 text-center">
                    <ActionButton type="button" variant="secondary" className="mr-2 h-8 px-3 text-xs" onClick={() => onEdit(index)}>수정</ActionButton>
                    <ActionButton type="button" variant="secondary" className="h-8 border-rose-200 px-3 text-xs text-rose-600 hover:bg-rose-50" onClick={() => onDelete(index)}>삭제</ActionButton>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm font-bold text-slate-400">추가된 행이 없으면 현재 입력값 1건을 바로 저장합니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </FormModal>
  );
}

function SummaryGroupCard({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.amount || 0)));
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-black">{title}</h3>
      <div className="mt-3 space-y-3">
        {rows.slice(0, 10).map((row, index) => {
          const amount = Number(row.amount || 0);
          return (
            <div key={`${title}-${String(row.label || index)}`}>
              <div className="mb-1 flex justify-between gap-3 text-xs">
                <span className="truncate font-bold text-slate-700">{String(row.label || "-")}</span>
                <span className="font-black">{krw(amount)}</span>
              </div>
              <div className="h-2 rounded bg-white"><div className="h-2 rounded bg-orange-500" style={{ width: `${Math.max(4, (amount / max) * 100)}%` }} /></div>
            </div>
          );
        })}
        {!rows.length && <p className="rounded bg-white px-2 py-6 text-center text-xs font-bold text-slate-400">데이터 없음</p>}
      </div>
    </section>
  );
}

function ChannelTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-sm font-bold text-slate-500">기본 채널을 생성하면 쇼핑몰 목록이 표시됩니다.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-500">
          <tr><th className="py-2 text-left">쇼핑몰코드</th><th className="py-2 text-left">쇼핑몰명</th><th className="py-2 text-left">ID</th><th className="py-2 text-left">거래처명</th><th className="py-2 text-center">수집처</th><th className="py-2 text-center">API</th><th className="py-2 text-center">상태</th><th className="py-2 text-left">마지막 수집</th></tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id || row.channel_code || index)} className="border-b border-slate-100">
              <td className="py-2 font-black">{String(row.channel_code || "-")}</td>
              <td className="py-2">{String(row.channel_name || "-")}</td>
              <td className="py-2">{String(row.seller_id || "-")}</td>
              <td className="py-2">{String(row.customer_name || "-")}</td>
              <td className="py-2 text-center"><StatusPill status={String(row.channel_type || "excel")} /></td>
              <td className="py-2 text-center">{row.api_enabled ? "Y" : "N"}</td>
              <td className="py-2 text-center"><StatusPill status={String(row.api_status || (row.is_active === false ? "미사용" : "사용"))} /></td>
              <td className="py-2">{String(row.last_synced_at || "-").slice(0, 16)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type MasterTabKey = "customers" | "products" | "warehouses" | "channels" | "attendance";

const masterTabs: Array<{ key: MasterTabKey; label: string; title: string; uploadEndpoint?: string; templateHeaders: string[]; sampleRow: string[] }> = [
  {
    key: "customers",
    label: "거래처 관리",
    title: "거래처",
    uploadEndpoint: "/api/fnos/customers/upload",
    templateHeaders: ["거래처코드", "거래처명", "거래처구분", "사업자번호", "담당자", "전화", "결제조건", "사용구분", "메모"],
    sampleRow: ["CUST001", "샘플거래처", "쇼핑몰/공급처", "000-00-00000", "담당자", "010-0000-0000", "월말결제", "사용", ""],
  },
  {
    key: "products",
    label: "품목관리",
    title: "품목",
    templateHeaders: ["품목코드", "품목명", "속성", "입고가", "출고가", "창고코드", "재고등록(수정)", "BOM구성품코드", "BOM수량"],
    sampleRow: ["SET001", "[SET]세트상품명", "SET", "7000", "10000", "100", "0", "FL0001", "2"],
  },
  {
    key: "warehouses",
    label: "창고관리",
    title: "창고",
    uploadEndpoint: "/api/fnos/warehouses/upload",
    templateHeaders: ["창고코드", "창고명", "창고구분", "재고상태", "사용구분", "메모"],
    sampleRow: ["WH001", "본사창고", "RG", "정상", "사용", ""],
  },
  {
    key: "channels",
    label: "쇼핑몰관리",
    title: "쇼핑몰",
    templateHeaders: ["쇼핑몰코드", "쇼핑몰명", "ID", "거래처명", "수집처구분", "사용구분", "진행상태", "판매자사이트 URL", "API 연동 여부"],
    sampleRow: ["NAVER", "네이버 스마트스토어", "seller-id", "네이버", "api", "사용", "planned", "https://sell.smartstore.naver.com/", "Y"],
  },
  {
    key: "attendance",
    label: "근태관리",
    title: "근태",
    templateHeaders: ["직원코드", "직원명", "근무일", "출근시간", "퇴근시간", "근태구분", "휴게시간", "메모"],
    sampleRow: ["EMP001", "홍길동", "2026-05-27", "09:00", "18:00", "정상", "1", ""],
  },
];

function masterTemplate(tab: MasterTabKey) {
  return masterTabs.find((item) => item.key === tab) || masterTabs[0];
}

async function readXlsxObjects(file: File) {
  const buffer = await file.arrayBuffer();
  const xlsx = await loadXlsxModule();
  const workbook = xlsx.read(buffer, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: false });
}

function MasterManagementPanel({
  summary,
  message,
  setMessage,
  sync,
  loadSummary,
}: {
  summary: SalesInventorySummary | null;
  message: string;
  setMessage: (value: string) => void;
  sync: (target: "products" | "inventory") => void;
  loadSummary: () => void;
}) {
  const [activeMasterTab, setActiveMasterTab] = useState<MasterTabKey>("customers");
  const activeConfig = masterTemplate(activeMasterTab);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white p-2">
        <div className="flex min-w-max gap-1">
          {masterTabs.filter((tab) => tab.key !== "channels").map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveMasterTab(tab.key)}
              className={`h-10 rounded-md px-4 text-sm font-black ${
                activeMasterTab === tab.key ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeMasterTab !== "products" && activeMasterTab !== "customers" && activeMasterTab !== "warehouses" && (
        <MasterEntryPanel
          config={activeConfig}
          setMessage={setMessage}
          loadSummary={loadSummary}
        />
      )}

      {activeMasterTab === "customers" && (
        <CustomerManagementPanel message={message} setMessage={setMessage} />
      )}

      {activeMasterTab === "products" && (
        <ProductManagementPanel message={message} setMessage={setMessage} />
      )}

      {activeMasterTab === "warehouses" && <WarehouseManagementPanel message={message} setMessage={setMessage} />}

      {activeMasterTab === "channels" && (
        <Panel
          title="쇼핑몰 목록"
          subtitle="주문수집 대상 쇼핑몰과 API/엑셀 수집 방식을 관리합니다."
          action={<button type="button" className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" onClick={async () => {
            const res = await fetch("/api/fnos/sales-channels", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ seed: true }) });
            const data = await res.json().catch(() => ({}));
            setMessage(data.ok ? `기본 채널 ${data.count || 0}개를 저장했습니다.` : data.error || "채널 저장 실패");
            loadSummary();
          }}>기본 채널 생성</button>}
        >
          <ChannelTable rows={summary?.sales_channels || []} />
          {message && <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">{message}</div>}
        </Panel>
      )}

      {activeMasterTab === "attendance" && (
        <Panel title="근태 목록" subtitle="근태는 직원별 일자, 출근/퇴근, 근태구분 기준으로 관리합니다.">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-sm font-bold text-slate-500">근태 저장 테이블은 다음 단계에서 DB 스키마와 저장 API를 연결합니다.</div>
          {message && <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">{message}</div>}
        </Panel>
      )}
    </div>
  );
}

function CustomerManagementPanel({ setMessage }: { message: string; setMessage: (value: string) => void }) {
  const [customers, setCustomers] = useState<FnCustomer[]>([]);
  const [query, setQuery] = useState("");
  const [relationFilter, setRelationFilter] = useState<CustomerRelationFilter>("general");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [channelDraft, setChannelDraft] = useState<SalesChannelDraft>(blankSalesChannelDraft());
  const [channelCredentials, setChannelCredentials] = useState(blankSalesChannelCredentials());
  const [credentialMeta, setCredentialMeta] = useState<Record<string, SalesChannelCredentialMeta>>({});
  const [credentialsRevealed, setCredentialsRevealed] = useState(false);
  const [channelLoading, setChannelLoading] = useState(false);
  const [customerMessage, setCustomerMessage] = useState("");
  const [selectedCustomerKeys, setSelectedCustomerKeys] = useState<string[]>([]);
  const [customerSelecting, setCustomerSelecting] = useState(false);
  const [customerBulkOpen, setCustomerBulkOpen] = useState(false);
  const [customerBulkField, setCustomerBulkField] = useState<CustomerBulkField>("customer_type");
  const [customerBulkValue, setCustomerBulkValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const customerSelectModeRef = useRef<"select" | "deselect">("select");
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const customerKeys = customers.map((customer) => customer.id || customer.customer_code || customer.cust_code || "").filter(Boolean);
  const selectedCustomers = customers.filter((customer) => selectedCustomerKeys.includes(customer.id || customer.customer_code || customer.cust_code || ""));
  const allCustomersSelected = Boolean(customerKeys.length) && customerKeys.every((key) => selectedCustomerKeys.includes(key));

  function blankCustomerDraft() {
    return { id: "", customer_code: "", customer_name: "", customer_type: "general", business_no: "", contact_name: "", phone: "", payment_terms: "", memo: "" };
  }

  async function loadCustomers(nextPage = page, nextQuery = query, nextRelation = relationFilter) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(pageSize) });
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      if (nextRelation !== "all") params.set("relation", nextRelation);
      const endpoint = `/api/fnos/customers?${params.toString()}`;
      const cached = readCachedJson<{ customers?: FnCustomer[]; total?: number; ok?: boolean; error?: string }>(endpoint, { storageTtl: 5 * 60_000 });
      if (cached) {
        setCustomers(cached.customers || []);
        setTotal(Number(cached.total || 0));
        setLoading(false);
      }
      const data = await cachedClientJson<{ customers?: FnCustomer[]; total?: number; ok?: boolean; error?: string }>(endpoint, { ttl: 5 * 60_000, storageTtl: 10 * 60_000 });
      if (data.ok === false) {
        setCustomerMessage(data.error || "거래처 조회 실패");
        return;
      }
      setCustomers(data.customers || []);
      setTotal(Number(data.total || 0));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCustomers(page, query, relationFilter), 0);
    return () => window.clearTimeout(timer);
  }, [page, query, relationFilter]);

  useEffect(() => {
    setSelectedCustomerKeys([]);
  }, [page, query, relationFilter]);

  useEffect(() => {
    function stopSelecting() {
      setCustomerSelecting(false);
    }
    window.addEventListener("mouseup", stopSelecting);
    return () => window.removeEventListener("mouseup", stopSelecting);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "F2") return;
      event.preventDefault();
      openNewCustomer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function openNewCustomer() {
    const nextDraft = blankCustomerDraft();
    setDraft(nextDraft);
    setChannelDraft(blankSalesChannelDraft(nextDraft));
    setChannelCredentials(blankSalesChannelCredentials());
    setCredentialMeta({});
    setCredentialsRevealed(false);
    setModalOpen(true);
  }

  function openCustomer(customer: FnCustomer) {
    const nextDraft = {
      id: customer.id || "",
      customer_code: customer.customer_code || customer.cust_code || "",
      customer_name: customer.customer_name || customer.cust_name || "",
      customer_type: normalizeCustomerAttribute(customer.customer_type || customer.customer_type_label),
      business_no: formatBusinessNoInput(customer.business_no || ""),
      contact_name: customer.contact_name || "",
      phone: customer.phone || "",
      payment_terms: customer.payment_terms || "",
      memo: customer.memo || "",
    };
    setDraft(nextDraft);
    setChannelDraft(blankSalesChannelDraft(nextDraft));
    setChannelCredentials(blankSalesChannelCredentials());
    setCredentialMeta({});
    setCredentialsRevealed(false);
    setModalOpen(true);
    if (normalizeCustomerAttribute(nextDraft.customer_type) === "shopping") void loadCustomerChannel(nextDraft);
  }

  function updateDraft(key: string, value: string) {
    setDraft((prev) => {
      if (key === "customer_type") return { ...prev, customer_type: normalizeCustomerAttribute(value) };
      if (key === "business_no") return { ...prev, business_no: formatBusinessNoInput(value) };
      if (key === "customer_code") {
        const previousCodeBusinessNo = formatBusinessNoInput(prev.customer_code || "");
        const shouldSyncBusinessNo = Boolean(prev.business_no && prev.business_no === previousCodeBusinessNo);
        setChannelDraft((channel) => ({
          ...channel,
          channel_code: channel.id ? channel.channel_code : value.trim().toUpperCase(),
        }));
        return {
          ...prev,
          customer_code: value,
          business_no: shouldSyncBusinessNo ? formatBusinessNoInput(value) : prev.business_no,
        };
      }
      if (key === "customer_name") {
        setChannelDraft((channel) => ({
          ...channel,
          channel_name: channel.id ? channel.channel_name : value,
        }));
      }
      return { ...prev, [key]: value };
    });
  }

  function updateChannelDraft(key: string, value: string) {
    setChannelDraft((prev) => ({ ...prev, [key]: key === "channel_code" ? value.trim().toUpperCase() : value }));
  }

  function updateChannelCredential(key: string, value: string) {
    setChannelCredentials((prev) => ({ ...prev, [key]: value }));
  }

  function customerRowKey(customer: FnCustomer) {
    return customer.id || customer.customer_code || customer.cust_code || "";
  }

  function setCustomerSelected(key: string, selected: boolean) {
    if (!key) return;
    setSelectedCustomerKeys((prev) => selected ? Array.from(new Set([...prev, key])) : prev.filter((item) => item !== key));
  }

  function toggleCustomerSelected(key: string) {
    if (!key) return;
    setSelectedCustomerKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  }

  async function loadCustomerChannel(customer: Record<string, string>) {
    setChannelLoading(true);
    setCredentialsRevealed(false);
    try {
      const data = await cachedClientJson<{ channels?: SalesChannelRow[]; ok?: boolean; error?: string }>("/api/fnos/sales-channels", { ttl: 5 * 60_000, storageTtl: 10 * 60_000 });
      if (data.ok === false) {
        setCustomerMessage(data.error || "쇼핑몰 채널 조회 실패");
        return;
      }
      const channels = (data.channels || []) as SalesChannelRow[];
      const channel = channels.find((item) => (
        (customer.id && String(item.customer_id || "") === customer.id) ||
        (customer.customer_code && String(item.customer_code || "").trim() === customer.customer_code) ||
        (customer.customer_name && String(item.customer_name || "").trim() === customer.customer_name)
      ));
      setChannelDraft(normalizeSalesChannelDraft(channel, customer));
      const meta = Object.fromEntries((channel?.credentials || []).map((item) => [item.key, item]));
      setCredentialMeta(meta);
      setChannelCredentials(blankSalesChannelCredentials());
    } finally {
      setChannelLoading(false);
    }
  }

  async function revealChannelCredentials() {
    if (credentialsRevealed) {
      setCredentialsRevealed(false);
      setChannelCredentials(blankSalesChannelCredentials());
      return;
    }
    const channelId = String(channelDraft.id || "").trim();
    if (!channelId) {
      setCustomerMessage("먼저 쇼핑몰 채널을 저장한 뒤 secret 값을 볼 수 있습니다.");
      return;
    }
    setChannelLoading(true);
    try {
      const res = await fetch(`/api/fnos/sales-channel-credentials?channel_id=${encodeURIComponent(channelId)}&reveal=true`, { cache: "no-store", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setCustomerMessage(data.error || "쇼핑몰 credential 조회 실패");
        return;
      }
      const next = blankSalesChannelCredentials();
      const nextMeta: Record<string, SalesChannelCredentialMeta> = {};
      (data.credentials || []).forEach((item: SalesChannelCredentialMeta & { value?: string }) => {
        if (salesChannelCredentialKeys.includes(item.key as (typeof salesChannelCredentialKeys)[number])) {
          next[item.key as (typeof salesChannelCredentialKeys)[number]] = String(item.value || "");
          nextMeta[item.key] = item;
        }
      });
      setCredentialMeta((prev) => ({ ...prev, ...nextMeta }));
      setChannelCredentials(next);
      setCredentialsRevealed(true);
    } finally {
      setChannelLoading(false);
    }
  }

  async function saveCustomerDraft() {
    const code = String(draft.customer_code || "").trim();
    const name = String(draft.customer_name || "").trim();
    if (!code || !name) {
      setCustomerMessage("거래처코드와 거래처명은 필수입니다.");
      return;
    }
    const res = await fetch("/api/fnos/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ customer: draft }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setCustomerMessage(data.error || "거래처 저장 실패");
      return;
    }
    invalidateClientCache("/api/fnos/customers");
    const savedCustomer = data.customer || {};
    if (normalizeCustomerAttribute(draft.customer_type) === "shopping") {
      const channelPayload = {
        ...channelDraft,
        channel_code: (channelDraft.channel_code || code).trim().toUpperCase(),
        channel_name: (channelDraft.channel_name || name).trim(),
        customer_id: savedCustomer.id || draft.id || null,
        customer_code: code,
        customer_name: name,
        api_enabled: channelDraft.api_enabled === "true",
      };
      const channelRes = await fetch("/api/fnos/sales-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(channelPayload),
      });
      const channelData = await channelRes.json().catch(() => ({}));
      if (!channelRes.ok || channelData.ok === false) {
        setCustomerMessage(channelData.error || "쇼핑몰 채널 저장 실패");
        return;
      }
      invalidateClientCache("/api/fnos/sales-channels");
      const savedChannel = (channelData.channels || [])[0] as SalesChannelRow | undefined;
      const channelId = String(savedChannel?.id || channelDraft.id || "");
      const credentialPayload = Object.fromEntries(
        salesChannelCredentialKeys
          .map((key) => [key, String(channelCredentials[key] || "").trim()] as const)
          .filter(([, value]) => value !== "")
      );
      if (channelId && Object.keys(credentialPayload).length) {
        const credentialRes = await fetch("/api/fnos/sales-channel-credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ channel_id: channelId, credentials: credentialPayload }),
        });
        const credentialData = await credentialRes.json().catch(() => ({}));
        if (!credentialRes.ok || credentialData.ok === false) {
          setCustomerMessage(credentialData.error || "쇼핑몰 credential 저장 실패");
          return;
        }
        invalidateClientCache("/api/fnos/sales-channel-credentials");
      }
    }
    setCustomerMessage(`거래처 저장 완료: ${code}`);
    setMessage("");
    setModalOpen(false);
    await loadCustomers(page, query, relationFilter);
  }

  async function deleteCustomerDraft() {
    const id = String(draft.id || "").trim();
    const code = String(draft.customer_code || "").trim();
    if (!id && !code) return;
    if (!window.confirm("이 거래처를 삭제할까요?")) return;
    const res = await fetch("/api/fnos/customers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id, customer_code: code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setCustomerMessage(data.error || "거래처 삭제 실패");
      return;
    }
    invalidateClientCache("/api/fnos/customers");
    invalidateClientCache("/api/fnos/sales-channels");
    setCustomerMessage(`거래처 삭제 완료: ${code}`);
    setModalOpen(false);
    await loadCustomers(page, query, relationFilter);
  }

  async function saveCustomerBulkEdit() {
    if (!selectedCustomers.length) {
      setCustomerMessage("수정할 거래처를 먼저 선택해 주세요.");
      return;
    }
    const value = customerBulkField === "business_no" ? formatBusinessNoInput(customerBulkValue) : customerBulkValue;
    let saved = 0;
    for (const customer of selectedCustomers) {
      const payload = {
        id: customer.id,
        customer_code: customer.customer_code || customer.cust_code || "",
        customer_name: customer.customer_name || customer.cust_name || "",
        customer_type: normalizeCustomerAttribute(customer.customer_type || customer.customer_type_label),
        business_no: customer.business_no || "",
        contact_name: customer.contact_name || "",
        phone: customer.phone || "",
        payment_terms: customer.payment_terms || "",
        memo: customer.memo || "",
        [customerBulkField]: customerBulkField === "customer_type" ? normalizeCustomerAttribute(value) : value,
      };
      const res = await fetch("/api/fnos/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ customer: payload }),
      });
      if (res.ok) saved += 1;
    }
    setCustomerMessage(`선택수정 완료: ${saved.toLocaleString("ko-KR")}건`);
    setCustomerBulkOpen(false);
    setCustomerBulkValue("");
    setSelectedCustomerKeys([]);
    invalidateClientCache("/api/fnos/customers");
    await loadCustomers(page, query, relationFilter);
  }

  function downloadCustomerTemplate() {
    void downloadTableXlsx(
      "FN_OS_거래처_엑셀폼.xlsx",
      "거래처",
      ["속성", "거래처코드", "거래처명", "사업자번호", "담당자", "전화번호", "주소/Email/기타메모"],
      [["일반", "CUST001", "샘플거래처", "1111111111", "담당자", "010-0000-0000", "주소: 서울 / Email: sample@fnos.local"]],
    );
  }

  async function uploadCustomers(file: File) {
    const rows = await readXlsxObjects(file);
    const allData = await cachedClientJson<{ customers?: FnCustomer[] }>("/api/fnos/customers?page=1&pageSize=5000", { ttl: 60_000, storageTtl: 5 * 60_000 });
    const existing = new Map<string, FnCustomer>((allData.customers || []).map((customer: FnCustomer) => [String(customer.customer_code || customer.cust_code || ""), customer]));
    const normalized = rows
      .map((row) => ({
        customer_type: normalizeCustomerAttribute(row["속성"] || row["거래처속성"] || row["거래처구분"] || row["구분"]),
        customer_code: String(row["거래처코드"] || row["거래처 코드"] || row["코드"] || row["customer_code"] || "").trim(),
        customer_name: String(row["거래처명"] || row["거래처명칭"] || row["상호"] || row["customer_name"] || "").trim(),
        business_no: formatBusinessNoInput(String(row["사업자번호"] || row["사업자등록번호"] || "").trim()),
        contact_name: String(row["담당자"] || row["연락담당자"] || "").trim(),
        phone: String(row["전화번호"] || row["전화"] || row["연락처"] || row["휴대폰"] || "").trim(),
        memo: String(row["주소/Email/기타메모"] || row["거래처정보"] || row["기타메모"] || row["메모"] || row["비고"] || "").trim(),
      }))
      .filter((row) => row.customer_code && row.customer_name);
    const exactMatches = normalized.filter((row) => {
      const found = existing.get(row.customer_code);
      return found && String(found.customer_name || found.cust_name || "").trim() === row.customer_name;
    });
    const overwrite = exactMatches.length
      ? window.confirm(`${exactMatches.length}개 거래처의 거래처코드와 거래처명이 일치합니다. 현재 엑셀 데이터로 덮어쓰기 하시겠습니까?\n\n확인: 덮어쓰기\n취소: 기존 항목 스킵`)
      : false;
    let saved = 0;
    let skipped = 0;
    for (const row of normalized) {
      const found = existing.get(row.customer_code);
      if (found && !overwrite) {
        skipped += 1;
        continue;
      }
      if (found && String(found.customer_name || found.cust_name || "").trim() !== row.customer_name) {
        skipped += 1;
        continue;
      }
      const res = await fetch("/api/fnos/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ customer: { ...row, id: found?.id } }),
      });
      if (res.ok) saved += 1;
    }
    setCustomerMessage(`거래처 엑셀등록 완료: 저장 ${saved.toLocaleString("ko-KR")}건 / 스킵 ${skipped.toLocaleString("ko-KR")}건`);
    invalidateClientCache("/api/fnos/customers");
    await loadCustomers(1, query, relationFilter);
    setPage(1);
  }

  async function downloadCustomers() {
    const params = new URLSearchParams({ page: "1", pageSize: "5000" });
    if (query.trim()) params.set("q", query.trim());
    if (relationFilter !== "all") params.set("relation", relationFilter);
    const data = await cachedClientJson<{ customers?: FnCustomer[]; ok?: boolean; error?: string }>(`/api/fnos/customers?${params.toString()}`, { ttl: 60_000, storageTtl: 5 * 60_000 }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "거래처 다운로드 실패", customers: [] }));
    if (data.ok === false) {
      setCustomerMessage(data.error || "거래처 다운로드 실패");
      return;
    }
    const rows = ((data.customers || []) as FnCustomer[]).map((customer) => [
      customer.customer_code || customer.cust_code || "",
      customer.customer_name || customer.cust_name || "",
      customerAttributeLabel(customer.customer_type || customer.customer_type_label),
      customer.business_no || "",
      customer.contact_name || "",
      customer.phone || "",
      customer.memo || "",
    ]);
    void downloadTableXlsx(`FN_OS_거래처_${rows.length}건_${todayMmdd()}.xlsx`, "거래처", ["거래처코드", "거래처명", "속성", "사업자번호", "담당자", "전화번호", "주소/Email/기타메모"], rows);
  }

  const pageNumbers = Array.from({ length: Math.min(6, pageCount) }, (_, index) => {
    const start = Math.min(Math.max(1, page - 2), Math.max(1, pageCount - 5));
    return start + index;
  }).filter((value) => value <= pageCount);

  return (
    <div className="space-y-4">
      <Panel
        title="거래처 관리"
        subtitle={
          <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-500">
            {[
              { key: "general" as CustomerRelationFilter, label: "일반" },
              { key: "shopping" as CustomerRelationFilter, label: "쇼핑몰" },
              { key: "all" as CustomerRelationFilter, label: "전체거래처" },
            ].map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => {
                  setRelationFilter(filter.key);
                  setPage(1);
                }}
                className={`font-black underline-offset-4 hover:underline ${relationFilter === filter.key ? "text-orange-600 underline" : "text-slate-500"}`}
              >
                {filter.label}
              </button>
            ))}
            <span className="ml-2 rounded-lg bg-slate-100 px-3 py-1 font-black text-slate-900">거래처수 {total.toLocaleString("ko-KR")}개</span>
          </div>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <ActionButton type="button" onClick={openNewCustomer}>F2 새 거래처</ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>엑셀등록</ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => void downloadCustomers()}>거래처정보 다운로드</ActionButton>
            <ActionButton
              type="button"
              variant="ghost"
              onClick={downloadCustomerTemplate}
              className="h-10 w-10 border-0 bg-transparent p-0 text-emerald-600 shadow-none hover:bg-orange-50"
              aria-label="엑셀폼 다운로드"
              title="엑셀폼 다운로드"
            >
              <ExcelFormIcon />
            </ActionButton>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadCustomers(file);
              event.target.value = "";
            }} />
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton type="button" variant="secondary" onClick={() => setCustomerBulkOpen(true)}>수정</ActionButton>
            <span className="text-xs font-bold text-slate-500">선택 {selectedCustomerKeys.length.toLocaleString("ko-KR")}개</span>
          </div>
          <input
            className="field-input w-full max-w-sm rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={query}
            onChange={(event) => {
              setPage(1);
              setQuery(event.target.value);
            }}
            placeholder="거래처명 / 코드 검색"
          />
        </div>
        <div className="fn-table-shell overflow-x-auto [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
          <table className="w-full min-w-[980px] table-fixed text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500">
              <tr>
                <th className="w-16 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={allCustomersSelected}
                    onChange={(event) => setSelectedCustomerKeys(event.target.checked ? customerKeys : [])}
                    aria-label="거래처 전체선택"
                  />
                </th>
                <th className="w-36 py-2 pl-3 text-left">거래처코드</th>
                <th className="w-48 py-2 text-left">거래처명</th>
                <th className="w-24 py-2 text-left">속성</th>
                <th className="w-36 py-2 text-left">사업자번호</th>
                <th className="w-28 py-2 text-left">담당자</th>
                <th className="w-36 py-2 text-left">전화번호</th>
                <th className="w-40 py-2 text-left">메모</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer, index) => {
                const key = customerRowKey(customer);
                const selected = selectedCustomerKeys.includes(key);
                return (
                <tr key={customer.id || customer.customer_code} onClick={() => openCustomer(customer)} className={`cursor-pointer border-b border-gray-100 ${selected ? "bg-sky-50" : "hover:bg-orange-50/60"}`}>
                  <td className="py-2 text-center" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        const mode = selected ? "deselect" : "select";
                        customerSelectModeRef.current = mode;
                        setCustomerSelecting(true);
                        setCustomerSelected(key, mode === "select");
                      }}
                      onMouseEnter={() => {
                        if (customerSelecting) setCustomerSelected(key, customerSelectModeRef.current === "select");
                      }}
                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs font-black ${selected ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-400"}`}
                    >
                      {index + 1}
                    </button>
                  </td>
                  <td className="truncate py-2 pl-3 font-black">{customer.customer_code || customer.cust_code || "-"}</td>
                  <td className="truncate py-2 font-bold">{customer.customer_name || customer.cust_name || "-"}</td>
                  <td className="truncate py-2 text-slate-500">{customerAttributeLabel(customer.customer_type || customer.customer_type_label)}</td>
                  <td className="truncate py-2 text-slate-500">{customer.business_no || "-"}</td>
                  <td className="truncate py-2 text-slate-500">{customer.contact_name || "-"}</td>
                  <td className="truncate py-2 text-slate-500">{customer.phone || "-"}</td>
                  <td className="truncate py-2 text-slate-500" title={customer.memo || ""}>{customer.memo ? `${customer.memo.slice(0, 10)}${customer.memo.length > 10 ? "..." : ""}` : "-"}</td>
                </tr>
              );})}
            </tbody>
          </table>
          {!customers.length && <EmptyState title={loading ? "불러오는 중..." : "거래처가 없습니다."} />}
        </div>
        <div className="mt-4 flex items-center justify-center gap-1">
          {pageNumbers.map((number) => (
            <button key={number} type="button" onClick={() => setPage(number)} className={`h-7 min-w-7 rounded px-2 text-xs font-black ${page === number ? "bg-slate-950 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{number}</button>
          ))}
        </div>
        {customerMessage && <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">{customerMessage}</div>}
      </Panel>
      {customerBulkOpen && (
        <FormModal
          title="거래처 선택수정"
          description={`선택 ${selectedCustomers.length.toLocaleString("ko-KR")}개 거래처에 같은 값을 적용합니다.`}
          onClose={() => setCustomerBulkOpen(false)}
          size="xl"
          footer={
            <>
              <ActionButton type="button" variant="secondary" onClick={() => setCustomerBulkOpen(false)}>닫기</ActionButton>
              <ActionButton type="button" onClick={() => void saveCustomerBulkEdit()}>저장</ActionButton>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <select className={modalSelectClass} value={customerBulkField} onChange={(event) => setCustomerBulkField(event.target.value as CustomerBulkField)}>
                <option value="customer_type">속성</option>
                <option value="business_no">사업자번호</option>
                <option value="contact_name">담당자</option>
                <option value="phone">전화번호</option>
                <option value="memo">메모</option>
              </select>
              {customerBulkField === "customer_type" ? (
                <select className={modalSelectClass} value={customerBulkValue || "general"} onChange={(event) => setCustomerBulkValue(event.target.value)}>
                  <option value="general">일반</option>
                  <option value="shopping">쇼핑몰</option>
                </select>
              ) : (
                <input className={modalInputClass} value={customerBulkValue} onChange={(event) => setCustomerBulkValue(event.target.value)} placeholder="선택한 거래처에 적용할 값" />
              )}
            </div>
            <div className="max-h-[52vh] overflow-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[620px] text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr><th className="w-12 px-2 py-2 text-center">#</th><th className="px-2 py-2 text-left">거래처코드</th><th className="px-2 py-2 text-left">거래처명</th><th className="px-2 py-2 text-left">현재값</th></tr>
                </thead>
                <tbody>
                  {selectedCustomers.map((customer, index) => (
                    <tr key={customerRowKey(customer)} className="border-t border-gray-100">
                      <td className="px-2 py-2 text-center"><span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-blue-600 px-1 font-black text-white">{index + 1}</span></td>
                      <td className="px-2 py-2 font-black">{customer.customer_code || customer.cust_code || "-"}</td>
                      <td className="px-2 py-2 font-bold">{customer.customer_name || customer.cust_name || "-"}</td>
                      <td className="px-2 py-2 text-slate-600">{String(customerBulkField === "customer_type" ? customerAttributeLabel(customer.customer_type || customer.customer_type_label) : customer[customerBulkField as keyof FnCustomer] || "-")}</td>
                    </tr>
                  ))}
                  {!selectedCustomers.length && <tr><td colSpan={4} className="px-3 py-8 text-center font-bold text-slate-400">선택된 거래처가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </FormModal>
      )}
      {modalOpen && (
        <CustomerEditModal
          draft={draft}
          channelDraft={channelDraft}
          channelCredentials={channelCredentials}
          credentialMeta={credentialMeta}
          credentialsRevealed={credentialsRevealed}
          channelLoading={channelLoading}
          onClose={() => setModalOpen(false)}
          onChange={updateDraft}
          onChannelChange={updateChannelDraft}
          onCredentialChange={updateChannelCredential}
          onRevealCredentials={() => void revealChannelCredentials()}
          onSave={() => void saveCustomerDraft()}
          onDelete={() => void deleteCustomerDraft()}
        />
      )}
    </div>
  );
}

function ProductManagementPanel({ setMessage }: { message: string; setMessage: (value: string) => void }) {
  const [products, setProducts] = useState<FnProduct[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [query, setQuery] = useState("");
  const [searchByCode, setSearchByCode] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [productMessage, setProductMessage] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [bomRows, setBomRows] = useState<ProductBomRow[]>([]);
  const [importLinks, setImportLinks] = useState<ProductImportLinkRow[]>([]);
  const [relationFilter, setRelationFilter] = useState<ProductRelationFilter>("plain");
  const [selectedProductKeys, setSelectedProductKeys] = useState<string[]>([]);
  const [productSelecting, setProductSelecting] = useState(false);
  const [productBulkOpen, setProductBulkOpen] = useState(false);
  const [productBulkField, setProductBulkField] = useState<ProductBulkField>("cost_price");
  const [productBulkValue, setProductBulkValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const productSelectModeRef = useRef<"select" | "deselect">("select");
  const usableWarehouses = warehouses.filter(isUsableWarehouse).sort(sortWarehousesByCode);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const productKeys = products.map((product) => product.id || product.product_code || product.sku || "").filter(Boolean);
  const selectedProducts = products.filter((product) => selectedProductKeys.includes(product.id || product.product_code || product.sku || ""));
  const allProductsSelected = Boolean(productKeys.length) && productKeys.every((key) => selectedProductKeys.includes(key));

  function blankDraft() {
    return {
      id: "",
      product_code: "",
      product_name: "",
      product_attribute: "plain",
      product_kind: "plain",
      cost_price: "",
      standard_price: "",
      ...Object.fromEntries(usableWarehouses.map((warehouse) => [`stock_${warehouse.warehouse_code}`, ""])),
    };
  }

  async function loadProducts(nextPage = page, nextQuery = query, nextFilter = relationFilter, nextSearchByCode = searchByCode) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(pageSize), relation: nextFilter });
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      if (nextSearchByCode) params.set("searchField", "code");
      const endpoint = `/api/fnos/products/master?${params.toString()}`;
      const cached = readCachedJson<{ products?: FnProduct[]; warehouses?: WarehouseOption[]; total?: number; ok?: boolean; error?: string }>(endpoint, { storageTtl: 10 * 60_000 });
      if (cached) {
        setProducts(cached.products || []);
        setWarehouses(cached.warehouses || []);
        setTotal(Number(cached.total || 0));
        setLoading(false);
      }
      const data = await cachedClientJson<{ products?: FnProduct[]; warehouses?: WarehouseOption[]; total?: number; ok?: boolean; error?: string }>(endpoint, { ttl: 5 * 60_000, storageTtl: 10 * 60_000 });
      if (data.ok === false) {
        setProductMessage(data.error || "품목 조회 실패");
        return;
      }
      setProducts(data.products || []);
      setWarehouses(data.warehouses || []);
      setTotal(Number(data.total || 0));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProducts(page, query, relationFilter, searchByCode);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [page, query, relationFilter, searchByCode]);

  useEffect(() => {
    setSelectedProductKeys([]);
  }, [page, query, relationFilter, searchByCode]);

  useEffect(() => {
    function stopSelecting() {
      setProductSelecting(false);
    }
    window.addEventListener("mouseup", stopSelecting);
    return () => window.removeEventListener("mouseup", stopSelecting);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "F2") return;
      event.preventDefault();
      openNewProduct();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [warehouses]);

  function openNewProduct() {
    setDraft(blankDraft());
    setBomRows([]);
    setImportLinks([]);
    setModalOpen(true);
  }

  function openProduct(product: FnProduct) {
    const stockValues = Object.fromEntries(usableWarehouses.map((warehouse) => {
      const stock = (product.inventory || []).find((item) => item.warehouse_code === warehouse.warehouse_code);
      return [`stock_${warehouse.warehouse_code}`, stock?.qty != null ? String(stock.qty) : ""];
    }));
    setDraft({
      id: product.id || "",
      product_code: product.product_code || product.sku || "",
      product_name: product.product_name || "",
      product_attribute: productAttributeOf(product),
      product_kind: productAttributeOf(product),
      cost_price: product.cost_price != null ? String(product.cost_price) : "",
      standard_price: product.standard_price != null ? String(product.standard_price) : "",
      ...stockValues,
    });
    setBomRows(product.bom || []);
    setImportLinks(product.import_links || []);
    setModalOpen(true);
  }

  function updateDraft(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function productRowKey(product: FnProduct) {
    return product.id || product.product_code || product.sku || "";
  }

  function productChannelStock(product: FnProduct, target: "fn" | "coupang" | "naver") {
    return (product.inventory || []).reduce((sum, stock) => {
      const code = String(stock.warehouse_code || "").trim();
      const name = String(stock.warehouse_name || "").trim().toLowerCase();
      const isMatch =
        target === "fn"
          ? code === "100" || name.includes("에프엔") || name.includes("본사") || name === "fn"
          : target === "coupang"
            ? code === "101" || name.includes("쿠팡") || name.includes("로켓")
            : code === "102" || name.includes("네이버") || name.includes("n배송");
      return isMatch ? sum + Number(stock.qty || 0) : sum;
    }, 0);
  }

  function productChannelStockText(product: FnProduct) {
    return (["fn", "coupang", "naver"] as const)
      .map((target) => productChannelStock(product, target).toLocaleString("ko-KR"))
      .join(" ｜ ");
  }

  function setProductSelected(key: string, selected: boolean) {
    if (!key) return;
    setSelectedProductKeys((prev) => selected ? Array.from(new Set([...prev, key])) : prev.filter((item) => item !== key));
  }

  function toggleProductSelected(key: string) {
    if (!key) return;
    setSelectedProductKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  }

  async function saveProductDraft() {
    const productCode = String(draft.product_code || "").trim();
    const rawProductName = String(draft.product_name || "").trim();
    const productAttribute = normalizeProductAttribute(draft.product_attribute ?? draft.product_kind);
    const productName = productNameWithAttribute(rawProductName, productAttribute);
    if (!productCode || !rawProductName) {
      setProductMessage("품목코드와 품목명은 필수입니다.");
      return;
    }
    const inventory = usableWarehouses
      .map((warehouse) => ({
        warehouse_id: warehouse.id,
        warehouse_code: warehouse.warehouse_code,
        qty: draft[`stock_${warehouse.warehouse_code}`],
      }))
      .filter((item) => String(item.qty ?? "").trim() !== "");
    const res = await fetch("/api/fnos/products/master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        product: {
          id: draft.id,
          product_code: productCode,
          product_name: productName,
          product_attribute: productAttribute,
          product_kind: productAttribute,
          cost_price: draft.cost_price,
          standard_price: draft.standard_price,
        },
        inventory,
        bom: bomRows,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setProductMessage(data.error || "품목 저장 실패");
      return;
    }
    setProductMessage(`품목 저장 완료: ${productCode}`);
    setMessage("");
    setModalOpen(false);
    invalidateClientCache("/api/fnos/products/master");
    await loadProducts(page, query);
  }

  async function deleteProductDraft() {
    const productId = String(draft.id || "").trim();
    const productCode = String(draft.product_code || "").trim();
    if (!productId && !productCode) return;
    if (!window.confirm("이 품목을 삭제할까요?")) return;
    const res = await fetch("/api/fnos/products/master", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: productId, product_code: productCode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setProductMessage(data.error || "품목 삭제 실패");
      return;
    }
    setProductMessage(`품목 삭제 완료: ${productCode}`);
    setModalOpen(false);
    invalidateClientCache("/api/fnos/products/master");
    await loadProducts(page, query, relationFilter, searchByCode);
  }

  async function saveProductBulkEdit() {
    if (!selectedProducts.length) {
      setProductMessage("수정할 품목을 먼저 선택해 주세요.");
      return;
    }
    let saved = 0;
    for (const product of selectedProducts) {
      const productAttribute = productBulkField === "product_attribute" ? normalizeProductAttribute(productBulkValue) : productAttributeOf(product);
      const productName = productNameWithAttribute(String(product.product_name || ""), productAttribute);
      const res = await fetch("/api/fnos/products/master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          product: {
            id: product.id,
            product_code: product.product_code || product.sku || "",
            product_name: productName,
            product_attribute: productAttribute,
            product_kind: productAttribute,
            cost_price: productBulkField === "cost_price" ? productBulkValue : product.cost_price,
            standard_price: productBulkField === "standard_price" ? productBulkValue : product.standard_price,
          },
        }),
      });
      if (res.ok) saved += 1;
    }
    setProductMessage(`선택수정 완료: ${saved.toLocaleString("ko-KR")}건`);
    setProductBulkOpen(false);
    setProductBulkValue("");
    setSelectedProductKeys([]);
    invalidateClientCache("/api/fnos/products/master");
    invalidateClientCache("/api/fnos/products/search");
    await loadProducts(page, query, relationFilter, searchByCode);
  }

  function downloadProductTemplate() {
    void downloadTableXlsx(
      "FN_OS_품목_엑셀폼.xlsx",
      "품목",
      ["품목코드", "품목명", "속성", "입고가", "출고가", "창고코드", "재고등록(수정)", "BOM구성품코드", "BOM수량"],
      [["SET001", "[SET]세트상품명", "SET", "1200", "5900", warehouses[0]?.warehouse_code || "100", "0", "FL0001", "2"]],
    );
  }

  async function downloadVisibleProducts() {
    const filterLabel = relationFilters.find((filter) => filter.key === relationFilter)?.label || "품목";
    const params = new URLSearchParams({ page: "1", pageSize: "5000", relation: relationFilter });
    if (query.trim()) params.set("q", query.trim());
    if (searchByCode) params.set("searchField", "code");
    const data = await cachedClientJson<{ products?: FnProduct[]; ok?: boolean; error?: string }>(`/api/fnos/products/master?${params.toString()}`, { ttl: 60_000, storageTtl: 5 * 60_000 }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "상품정보 다운로드 대상 조회 실패", products: [] }));
    if (data.ok === false) {
      setProductMessage(data.error || "상품정보 다운로드 대상 조회 실패");
      return;
    }
    const exportProducts = (data.products || []) as FnProduct[];
    const rows = exportProducts.map((product) => [
      product.product_code || product.sku || "",
      product.product_name || "",
      product.product_attribute_label || productAttributeLabel(productAttributeOf(product)),
      String(product.cost_price ?? ""),
      String(product.standard_price ?? ""),
      String(product.current_stock ?? 0),
      (product.inventory || []).map((stock) => `${stock.warehouse_name || stock.warehouse_code}:${Number(stock.qty || 0).toLocaleString("ko-KR")}`).join(" / "),
      (product.bom || []).map((item) => `${item.component_product_code || item.component_sku}:${item.qty_per_unit}`).join(" / "),
      (product.import_links || []).map((item) => `${item.import_product_name || item.import_product_id}${item.import_option_name ? `/${item.import_option_name}` : ""}`).join(" / "),
    ]);
    void downloadTableXlsx(
      `FN_OS_품목_${filterLabel}_${exportProducts.length}건_${todayMmdd()}.xlsx`,
      "품목정보",
      ["품목코드", "품목명", "속성", "입고가", "출고가", "현재고", "창고별재고", "BOM구성", "수입연동"],
      rows,
    );
  }

  async function uploadProducts(file: File) {
    const rows = await readXlsxObjects(file);
    const allData = await cachedClientJson<{ products?: FnProduct[] }>("/api/fnos/products/master?page=1&pageSize=5000", { ttl: 60_000, storageTtl: 5 * 60_000 });
    const existing = new Map<string, FnProduct>((allData.products || []).map((product: FnProduct) => [String(product.product_code || product.sku || ""), product]));
    const normalized = rows
      .map((row) => {
        const rawProductName = String(row["품목명"] || row["상품명"] || "").trim();
        const rawAttribute = String(row["속성"] || row["품목속성"] || "").toUpperCase();
        const productAttribute = rawAttribute ? normalizeProductAttribute(rawAttribute, "plain") : "plain";
        return {
          product_code: String(row["품목코드"] || row["SKU"] || row["sku"] || "").trim(),
          product_name: productNameWithAttribute(rawProductName, productAttribute),
          product_attribute: productAttribute,
          cost_price: String(row["입고가"] || row["매입가"] || "").trim(),
          standard_price: String(row["출고가"] || row["판매가"] || "").trim(),
          warehouse_code: String(row["창고코드"] || warehouses[0]?.warehouse_code || "100").trim(),
          qty: String(row["재고등록(수정)"] || row["재고"] || "").trim(),
          bom_component_code: String(row["BOM구성품코드"] || row["BOM연동품목코드"] || row["BOM품목코드"] || row["bom_component_code"] || "").trim(),
          bom_qty: String(row["BOM수량"] || row["BOM연동수량"] || row["bom_qty"] || "").trim(),
        };
      })
      .filter((row) => row.product_code && row.product_name);
    const grouped = Array.from(normalized.reduce((map, row) => {
      const current = map.get(row.product_code) || { ...row, bom: [] as Array<{ component_code: string; qty: string }> };
      if (row.bom_component_code) current.bom.push({ component_code: row.bom_component_code, qty: row.bom_qty || "1" });
      map.set(row.product_code, current);
      return map;
    }, new Map<string, typeof normalized[number] & { bom: Array<{ component_code: string; qty: string }> }>()).values());
    const exactMatches = grouped.filter((row) => {
      const found = existing.get(row.product_code);
      return found && String(found.product_name || "").trim() === row.product_name;
    });
    const overwrite = exactMatches.length
      ? window.confirm(`${exactMatches.length}개 품목의 품목코드와 품목명이 일치합니다. 현재 엑셀 데이터로 덮어쓰기 하시겠습니까?\n\n확인: 덮어쓰기\n취소: 기존 항목 스킵`)
      : false;
    let saved = 0;
    let skipped = 0;
    const processedRows: typeof grouped = [];
    for (const row of grouped) {
      const found = existing.get(row.product_code);
      if (found && !overwrite) {
        skipped += 1;
        continue;
      }
      if (found && String(found.product_name || "").trim() !== row.product_name) {
        skipped += 1;
        continue;
      }
      const res = await fetch("/api/fnos/products/master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          product: {
            id: found?.id,
            product_code: row.product_code,
            product_name: row.product_name,
            product_attribute: row.product_attribute,
            product_kind: row.product_attribute,
            cost_price: row.cost_price,
            standard_price: row.standard_price,
          },
          inventory: row.qty === "" ? [] : [{ warehouse_code: row.warehouse_code, qty: row.qty }],
        }),
      });
      if (res.ok) {
        saved += 1;
        processedRows.push(row);
      }
    }
    invalidateClientCache("/api/fnos/products/master");
    const refreshedData = await cachedClientJson<{ products?: FnProduct[] }>("/api/fnos/products/master?page=1&pageSize=5000", { ttl: 0, storageTtl: 0, force: true });
    const productsByCode = new Map<string, FnProduct>((refreshedData.products || []).map((product: FnProduct) => [String(product.product_code || product.sku || ""), product]));
    for (const row of processedRows.filter((item) => item.bom.length > 0)) {
      const parent = productsByCode.get(row.product_code);
      if (!parent) continue;
      const bom = row.bom
        .map((item) => {
          const component = productsByCode.get(item.component_code);
          return component ? {
            component_product_id: component.id,
            component_sku: component.product_code || component.sku,
            component_product_code: component.product_code || component.sku,
            component_product_name: component.product_name,
            qty_per_unit: Number(String(item.qty || "1").replace(/[^\d.-]/g, "")) || 1,
          } : null;
        })
        .filter(Boolean);
      if (!bom.length) continue;
      await fetch("/api/fnos/products/master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          product: {
            id: parent.id,
            product_code: row.product_code,
            product_name: row.product_name,
            product_attribute: row.product_attribute,
            product_kind: row.product_attribute,
            cost_price: row.cost_price,
            standard_price: row.standard_price,
          },
          inventory: [],
          bom,
        }),
      });
    }
    setProductMessage(`엑셀 등록 완료: 저장 ${saved}건 / 스킵 ${skipped}건`);
    setMessage("");
    invalidateClientCache("/api/fnos/products/master");
    await loadProducts(1, query);
    setPage(1);
  }

  const pageNumbers = Array.from({ length: Math.min(6, pageCount) }, (_, index) => {
    const start = Math.min(Math.max(1, page - 2), Math.max(1, pageCount - 5));
    return start + index;
  }).filter((value) => value <= pageCount);
  const relationFilters: Array<{ key: ProductRelationFilter; label: string }> = [
    { key: "plain", label: "일반" },
    { key: "set", label: "SET" },
    { key: "rg", label: "RG" },
    { key: "import", label: "수입연동" },
    { key: "all", label: "전체품목" },
  ];

  return (
    <div className="space-y-4">
      <Panel
        title="품목관리"
        subtitle={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {relationFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => {
                  setRelationFilter(filter.key);
                  setPage(1);
                }}
                className={`font-black underline-offset-4 hover:underline ${
                  relationFilter === filter.key ? "text-orange-600 underline" : "text-slate-500"
                }`}
              >
                {filter.label}
              </button>
            ))}
            <span className="ml-2 rounded-lg bg-slate-100 px-3 py-1 font-black text-slate-900">상품수 {total.toLocaleString("ko-KR")}개</span>
          </div>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <ActionButton type="button" onClick={openNewProduct}>F2 새 품목</ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>엑셀등록</ActionButton>
            <ActionButton type="button" variant="secondary" onClick={downloadVisibleProducts}>상품정보 다운로드</ActionButton>
            <ActionButton
              type="button"
              variant="ghost"
              onClick={downloadProductTemplate}
              className="h-10 w-10 border-0 bg-transparent p-0 text-emerald-600 shadow-none hover:bg-orange-50"
              aria-label="엑셀폼 다운로드"
              title="엑셀폼 다운로드"
            >
              <ExcelFormIcon />
            </ActionButton>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadProducts(file);
              event.target.value = "";
            }} />
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton type="button" variant="secondary" onClick={() => setProductBulkOpen(true)}>수정</ActionButton>
            <span className="text-xs font-bold text-slate-500">선택 {selectedProductKeys.length.toLocaleString("ko-KR")}개</span>
          </div>
          <input
            className="field-input w-full max-w-sm rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={query}
            onChange={(event) => {
              setPage(1);
              setSearchByCode(false);
              setQuery(event.target.value);
            }}
            placeholder="품목명 검색"
          />
        </div>
        <div className="fn-table-shell overflow-x-auto [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
          <table className="w-full min-w-[1040px] table-fixed text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500">
              <tr>
                <th className="w-16 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={allProductsSelected}
                    onChange={(event) => setSelectedProductKeys(event.target.checked ? productKeys : [])}
                    aria-label="품목 전체선택"
                  />
                </th>
                <th className="w-36 py-2 pl-3 text-left">품목코드</th>
                <th className="w-80 py-2 text-left">품목명</th>
                <th className="w-28 py-2 text-right">입고가</th>
                <th className="w-28 py-2 text-right">출고가</th>
                <th className="w-44 py-2 text-center">재고 현황(FN ｜ C ｜ N)</th>
                <th className="w-36 py-2 text-left">BOM / 수입연동</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, index) => {
                const key = productRowKey(product);
                const selected = selectedProductKeys.includes(key);
                return (
                <tr key={product.id || product.product_code} onClick={() => openProduct(product)} className={`cursor-pointer border-b border-gray-100 ${selected ? "bg-sky-50" : "hover:bg-orange-50/60"}`}>
                  <td className="py-2 text-center" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        const mode = selected ? "deselect" : "select";
                        productSelectModeRef.current = mode;
                        setProductSelecting(true);
                        setProductSelected(key, mode === "select");
                      }}
                      onMouseEnter={() => {
                        if (productSelecting) setProductSelected(key, productSelectModeRef.current === "select");
                      }}
                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs font-black ${selected ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-400"}`}
                    >
                      {index + 1}
                    </button>
                  </td>
                  <td className="truncate py-2 pl-3 font-black">{product.product_code || product.sku || "-"}</td>
                  <td className="truncate py-2 font-bold" title={product.product_name || ""}>{product.product_name || "-"}</td>
                  <td className="py-2 text-right">{krw(Number(product.cost_price || 0))}</td>
                  <td className="py-2 text-right">{krw(Number(product.standard_price || 0))}</td>
                  <td className="py-2 text-center font-black text-slate-900">{productChannelStockText(product)}</td>
                  <td className="py-2 text-xs font-black">
                    <StatusBadge tone={(product.bom || []).length ? "success" : "muted"} className="mr-2">BOM {(product.bom || []).length}</StatusBadge>
                    <StatusBadge tone={(product.import_links || []).length ? "orange" : "muted"}>수입 {(product.import_links || []).length}</StatusBadge>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
          {!products.length && <EmptyState title={loading ? "불러오는 중..." : "품목이 없습니다."} />}
        </div>
        <div className="mt-4 flex items-center justify-center gap-1">
          {pageNumbers.map((number) => (
            <button
              key={number}
              type="button"
              onClick={() => setPage(number)}
              className={`h-7 min-w-7 rounded px-2 text-xs font-black ${page === number ? "bg-slate-950 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}
            >
              {number}
            </button>
          ))}
        </div>
        {productMessage && <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">{productMessage}</div>}
      </Panel>

      {productBulkOpen && (
        <FormModal
          title="품목 선택수정"
          description={`선택 ${selectedProducts.length.toLocaleString("ko-KR")}개 품목에 같은 값을 적용합니다.`}
          onClose={() => setProductBulkOpen(false)}
          size="xl"
          footer={
            <>
              <ActionButton type="button" variant="secondary" onClick={() => setProductBulkOpen(false)}>닫기</ActionButton>
              <ActionButton type="button" onClick={() => void saveProductBulkEdit()}>저장</ActionButton>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <select className={modalSelectClass} value={productBulkField} onChange={(event) => setProductBulkField(event.target.value as ProductBulkField)}>
                <option value="product_attribute">속성</option>
                <option value="cost_price">입고단가</option>
                <option value="standard_price">출고단가</option>
              </select>
              {productBulkField === "product_attribute" ? (
                <select className={modalSelectClass} value={productBulkValue || "plain"} onChange={(event) => setProductBulkValue(event.target.value)}>
                  <option value="plain">일반</option>
                  <option value="set">SET</option>
                  <option value="rg">RG</option>
                </select>
              ) : (
                <input className={modalInputClass} type="number" value={productBulkValue} onChange={(event) => setProductBulkValue(event.target.value)} placeholder="선택한 품목에 적용할 값" />
              )}
            </div>
            <div className="max-h-[52vh] overflow-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[680px] text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr><th className="w-12 px-2 py-2 text-center">#</th><th className="px-2 py-2 text-left">품목코드</th><th className="px-2 py-2 text-left">품목명</th><th className="px-2 py-2 text-right">현재값</th></tr>
                </thead>
                <tbody>
                  {selectedProducts.map((product, index) => (
                    <tr key={productRowKey(product)} className="border-t border-gray-100">
                      <td className="px-2 py-2 text-center"><span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-blue-600 px-1 font-black text-white">{index + 1}</span></td>
                      <td className="px-2 py-2 font-black">{product.product_code || product.sku || "-"}</td>
                      <td className="px-2 py-2 font-bold">{product.product_name || "-"}</td>
                      <td className="px-2 py-2 text-right text-slate-600">
                        {productBulkField === "product_attribute"
                          ? productAttributeLabel(productAttributeOf(product))
                          : krw(Number(productBulkField === "cost_price" ? product.cost_price || 0 : product.standard_price || 0))}
                      </td>
                    </tr>
                  ))}
                  {!selectedProducts.length && <tr><td colSpan={4} className="px-3 py-8 text-center font-bold text-slate-400">선택된 품목이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </FormModal>
      )}

      {modalOpen && (
        <ProductEditModal
          draft={draft}
          warehouses={usableWarehouses}
          bomRows={bomRows}
          importLinks={importLinks}
          onClose={() => setModalOpen(false)}
          onChange={updateDraft}
          onBomRowsChange={setBomRows}
          onSave={() => void saveProductDraft()}
          onDelete={() => void deleteProductDraft()}
        />
      )}
    </div>
  );
}

function WarehouseManagementPanel({ message, setMessage }: { message: string; setMessage: (value: string) => void }) {
  const [warehouses, setWarehouses] = useState<FnWarehouse[]>([]);
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [selectedWarehouseKeys, setSelectedWarehouseKeys] = useState<string[]>([]);
  const [warehouseSelecting, setWarehouseSelecting] = useState(false);
  const [warehouseBulkOpen, setWarehouseBulkOpen] = useState(false);
  const [warehouseBulkField, setWarehouseBulkField] = useState<WarehouseBulkField>("warehouse_type");
  const [warehouseBulkValue, setWarehouseBulkValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const warehouseSelectModeRef = useRef<"select" | "deselect">("select");
  const warehouseKeys = warehouses.map((warehouse) => warehouseRowKey(warehouse)).filter(Boolean);
  const selectedWarehouses = warehouses.filter((warehouse) => selectedWarehouseKeys.includes(warehouseRowKey(warehouse)));
  const allWarehousesSelected = Boolean(warehouseKeys.length) && warehouseKeys.every((key) => selectedWarehouseKeys.includes(key));

  function blankWarehouseDraft() {
    return {
      id: "",
      warehouse_type: "general",
      warehouse_code: "",
      warehouse_name: "",
      warehouse_address: "",
      warehouse_phone: "",
      manager_name: "",
      manager_phone: "",
      manager_memo: "",
      memo: "",
    };
  }

  function parseWarehouseMemo(memo?: string) {
    const next = blankWarehouseDraft();
    String(memo || "").split(/\r?\n/).forEach((line) => {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim();
      const value = rest.join(":").trim();
      if (!key || !value) return;
      if (key === "창고 주소") next.warehouse_address = value;
      else if (key === "창고 연락처") next.warehouse_phone = value;
      else if (key === "담당자 이름") next.manager_name = value;
      else if (key === "담당자 연락처") next.manager_phone = value;
      else if (key === "담당자 메모") next.manager_memo = value;
    });
    const plainMemo = String(memo || "")
      .split(/\r?\n/)
      .filter((line) => !/^(창고 주소|창고 연락처|담당자 이름|담당자 연락처|담당자 메모)\s*:/.test(line.trim()))
      .join("\n")
      .trim();
    next.memo = plainMemo;
    return next;
  }

  function composeWarehouseMemo(source: Record<string, string>) {
    return [
      source.memo,
      source.warehouse_address ? `창고 주소: ${source.warehouse_address}` : "",
      source.warehouse_phone ? `창고 연락처: ${source.warehouse_phone}` : "",
      source.manager_name ? `담당자 이름: ${source.manager_name}` : "",
      source.manager_phone ? `담당자 연락처: ${source.manager_phone}` : "",
      source.manager_memo ? `담당자 메모: ${source.manager_memo}` : "",
    ].filter(Boolean).join("\n");
  }

  async function loadWarehouses(nextQuery = query) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "5000" });
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      const endpoint = `/api/fnos/warehouses?${params.toString()}`;
      const cached = readCachedJson<{ warehouses?: FnWarehouse[]; total?: number; ok?: boolean; error?: string }>(endpoint, { storageTtl: 10 * 60_000 });
      if (cached) {
        setWarehouses(cached.warehouses || []);
        setTotal(Number(cached.total || 0));
        setLoading(false);
      }
      const data = await cachedClientJson<{ warehouses?: FnWarehouse[]; total?: number; ok?: boolean; error?: string }>(endpoint, { ttl: 5 * 60_000, storageTtl: 10 * 60_000 });
      if (data.ok === false) {
        setMessage(data.error || "창고 조회 실패");
        return;
      }
      setWarehouses(data.warehouses || []);
      setTotal(Number(data.total || 0));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWarehouses(query), 0);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setSelectedWarehouseKeys([]);
  }, [query]);

  useEffect(() => {
    function stopSelecting() {
      setWarehouseSelecting(false);
    }
    window.addEventListener("mouseup", stopSelecting);
    return () => window.removeEventListener("mouseup", stopSelecting);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "F2") return;
      event.preventDefault();
      openNewWarehouse();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function openNewWarehouse() {
    setDraft(blankWarehouseDraft());
    setModalOpen(true);
  }

  function openWarehouse(warehouse: FnWarehouse) {
    const memoDraft = parseWarehouseMemo(warehouse.memo);
    setDraft({
      ...memoDraft,
      id: warehouse.id || "",
      warehouse_type: warehouse.warehouse_type || "general",
      warehouse_code: warehouse.warehouse_code || "",
      warehouse_name: warehouse.warehouse_name || "",
    });
    setModalOpen(true);
  }

  function updateDraft(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function warehouseRowKey(warehouse: FnWarehouse) {
    return warehouse.id || warehouse.warehouse_code || "";
  }

  function setWarehouseSelected(key: string, selected: boolean) {
    if (!key) return;
    setSelectedWarehouseKeys((prev) => selected ? Array.from(new Set([...prev, key])) : prev.filter((item) => item !== key));
  }

  async function saveWarehouseDraft() {
    const warehouseType = draft.warehouse_type || "general";
    const warehouseCode = String(draft.warehouse_code || "").trim();
    const warehouseName = String(draft.warehouse_name || "").trim();
    if (!warehouseType || !warehouseCode || !warehouseName) {
      setMessage("속성, 창고코드, 창고명은 필수입니다.");
      return;
    }
    const res = await fetch("/api/fnos/warehouses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        warehouse: {
          id: draft.id,
          warehouse_type: warehouseType,
          warehouse_code: warehouseCode,
          warehouse_name: warehouseName,
          memo: composeWarehouseMemo(draft),
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setMessage(data.error || "창고 저장 실패");
      return;
    }
    invalidateClientCache("/api/fnos/warehouses");
    invalidateClientCache("/api/fnos/products/master");
    setMessage(`창고 저장 완료: ${warehouseCode}`);
    setModalOpen(false);
    await loadWarehouses(query);
  }

  async function deleteWarehouseDraft() {
    if (!draft.id && !draft.warehouse_code) return;
    if (!window.confirm("이 창고를 삭제하시겠습니까?")) return;
    const res = await fetch("/api/fnos/warehouses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: draft.id, warehouse_code: draft.warehouse_code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setMessage(data.error || "창고 삭제 실패");
      return;
    }
    invalidateClientCache("/api/fnos/warehouses");
    invalidateClientCache("/api/fnos/products/master");
    setMessage(`창고 삭제 완료: ${draft.warehouse_code}`);
    setModalOpen(false);
    await loadWarehouses(query);
  }

  async function saveWarehouseBulkEdit() {
    if (!selectedWarehouses.length) {
      setMessage("수정할 창고를 먼저 선택해 주세요.");
      return;
    }
    let saved = 0;
    for (const warehouse of selectedWarehouses) {
      const memoDraft = parseWarehouseMemo(warehouse.memo);
      const nextDraft = {
        ...memoDraft,
        id: warehouse.id || "",
        warehouse_type: warehouse.warehouse_type || "general",
        warehouse_code: warehouse.warehouse_code || "",
        warehouse_name: warehouse.warehouse_name || "",
        [warehouseBulkField]: warehouseBulkField === "warehouse_type" ? normalizeWarehouseAttribute(warehouseBulkValue) : warehouseBulkValue,
      };
      const res = await fetch("/api/fnos/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          warehouse: {
            id: nextDraft.id,
            warehouse_type: nextDraft.warehouse_type,
            warehouse_code: nextDraft.warehouse_code,
            warehouse_name: nextDraft.warehouse_name,
            memo: composeWarehouseMemo(nextDraft),
          },
        }),
      });
      if (res.ok) saved += 1;
    }
    invalidateClientCache("/api/fnos/warehouses");
    invalidateClientCache("/api/fnos/products/master");
    setMessage(`선택수정 완료: ${saved.toLocaleString("ko-KR")}건`);
    setWarehouseBulkOpen(false);
    setWarehouseBulkValue("");
    setSelectedWarehouseKeys([]);
    await loadWarehouses(query);
  }

  function downloadWarehouseTemplate() {
    void downloadTableXlsx(
      "FN_OS_창고_엑셀폼.xlsx",
      "창고",
      ["속성", "창고코드", "창고명", "창고 주소", "창고 연락처", "담당자 이름", "담당자 연락처", "메모"],
      [["일반", "100", "에프엔 본사창고", "서울", "010-0000-0000", "", "", ""]],
    );
  }

  async function uploadWarehouses(file: File) {
    const rows = await readXlsxObjects(file);
    const allData = await cachedClientJson<{ warehouses?: FnWarehouse[] }>("/api/fnos/warehouses?page=1&pageSize=5000", { ttl: 60_000, storageTtl: 5 * 60_000 });
    const existing = new Map<string, FnWarehouse>((allData.warehouses || []).map((warehouse) => [String(warehouse.warehouse_code || ""), warehouse]));
    const normalized = rows
      .map((row) => ({
        warehouse_type: normalizeWarehouseAttribute(row["속성"] || row["창고속성"] || row["구분"] || row["warehouse_type"]),
        warehouse_code: String(row["창고코드"] || row["창고 코드"] || row["코드"] || row["warehouse_code"] || "").trim(),
        warehouse_name: String(row["창고명"] || row["창고명칭"] || row["warehouse_name"] || "").trim(),
        warehouse_address: String(row["창고 주소"] || row["창고주소"] || row["주소"] || "").trim(),
        warehouse_phone: String(row["창고 연락처"] || row["창고연락처"] || row["연락처"] || "").trim(),
        manager_name: String(row["담당자 이름"] || row["담당자이름"] || row["담당자"] || "").trim(),
        manager_phone: String(row["담당자 연락처"] || row["담당자연락처"] || "").trim(),
        memo: String(row["메모"] || row["비고"] || row["적요"] || "").trim(),
      }))
      .filter((row) => row.warehouse_code && row.warehouse_name);
    const exactMatches = normalized.filter((row) => {
      const found = existing.get(row.warehouse_code);
      return found && String(found.warehouse_name || "").trim() === row.warehouse_name;
    });
    const overwrite = exactMatches.length
      ? window.confirm(`${exactMatches.length}개 창고의 창고코드와 창고명이 일치합니다. 현재 엑셀 데이터로 덮어쓰기 하시겠습니까?\n\n확인: 덮어쓰기\n취소: 기존 항목 스킵`)
      : false;
    let saved = 0;
    let skipped = 0;
    for (const row of normalized) {
      const found = existing.get(row.warehouse_code);
      if (found && !overwrite) {
        skipped += 1;
        continue;
      }
      if (found && String(found.warehouse_name || "").trim() !== row.warehouse_name) {
        skipped += 1;
        continue;
      }
      const res = await fetch("/api/fnos/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          warehouse: {
            id: found?.id,
            warehouse_type: row.warehouse_type,
            warehouse_code: row.warehouse_code,
            warehouse_name: row.warehouse_name,
            memo: composeWarehouseMemo(row),
          },
        }),
      });
      if (res.ok) saved += 1;
    }
    invalidateClientCache("/api/fnos/warehouses");
    invalidateClientCache("/api/fnos/products/master");
    setMessage(`창고 엑셀등록 완료: 저장 ${saved.toLocaleString("ko-KR")}건 / 스킵 ${skipped.toLocaleString("ko-KR")}건`);
    await loadWarehouses(query);
  }

  async function downloadWarehouses() {
    const params = new URLSearchParams({ page: "1", pageSize: "5000" });
    if (query.trim()) params.set("q", query.trim());
    const data = await cachedClientJson<{ warehouses?: FnWarehouse[]; ok?: boolean; error?: string }>(`/api/fnos/warehouses?${params.toString()}`, { ttl: 60_000, storageTtl: 5 * 60_000 }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "창고정보 다운로드 실패", warehouses: [] }));
    if (data.ok === false) {
      setMessage(data.error || "창고정보 다운로드 실패");
      return;
    }
    const rows = (data.warehouses || []).map((warehouse) => [
      warehouse.warehouse_code || "",
      warehouse.warehouse_name || "",
      warehouse.warehouse_type_label || (warehouse.warehouse_type === "fulfillment" ? "풀필먼트" : "일반"),
      String(Number(warehouse.stock_product_count || 0)),
      warehouse.memo || "",
    ]);
    void downloadTableXlsx(`FN_OS_창고_${rows.length}건_${todayMmdd()}.xlsx`, "창고", ["창고코드", "창고명", "속성", "보유품목", "메모"], rows);
  }

  return (
    <div className="space-y-4">
      <Panel
        title="창고관리"
        subtitle={
          <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-500">
            <button type="button" className="font-black text-orange-600 underline underline-offset-4">전체창고</button>
            <span className="ml-2 rounded-lg bg-slate-100 px-3 py-1 font-black text-slate-900">창고수 {total.toLocaleString("ko-KR")}개</span>
          </div>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <ActionButton type="button" onClick={openNewWarehouse}>F2 새 창고</ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>엑셀등록</ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => void downloadWarehouses()}>창고정보 다운로드</ActionButton>
            <button type="button" onClick={downloadWarehouseTemplate} className="inline-flex h-10 w-10 items-center justify-center rounded-md border-0 bg-transparent p-0 text-emerald-600 hover:bg-orange-50" aria-label="엑셀폼 다운로드" title="엑셀폼 다운로드">
              <ExcelFormIcon />
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadWarehouses(file);
              event.target.value = "";
            }} />
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton type="button" variant="secondary" onClick={() => setWarehouseBulkOpen(true)}>수정</ActionButton>
            <span className="text-xs font-bold text-slate-500">선택 {selectedWarehouseKeys.length.toLocaleString("ko-KR")}개</span>
          </div>
          <input className="field-input w-full max-w-sm rounded-md border border-slate-200 px-3 py-2 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="창고명 / 코드 검색" />
        </div>
        <div className="fn-table-shell overflow-x-auto [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
          <table className="w-full min-w-[980px] table-fixed text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500">
              <tr>
                <th className="w-20 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={allWarehousesSelected}
                    onChange={(event) => setSelectedWarehouseKeys(event.target.checked ? warehouseKeys : [])}
                    aria-label="창고 전체선택"
                  />
                </th>
                <th className="w-36 py-2 pl-4 text-left">창고 코드</th>
                <th className="w-56 py-2 text-left">창고명</th>
                <th className="w-28 py-2 text-left">창고 속성</th>
                <th className="w-28 py-2 text-right">보유 품목</th>
                <th className="w-56 py-2 text-left">메모</th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((warehouse, index) => {
                const key = warehouseRowKey(warehouse);
                const selected = selectedWarehouseKeys.includes(key);
                return (
                  <tr key={warehouse.id || warehouse.warehouse_code} onClick={() => openWarehouse(warehouse)} className={`cursor-pointer border-b border-gray-100 ${selected ? "bg-sky-50" : "hover:bg-orange-50/60"}`}>
                    <td className="py-2 text-center" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          const mode = selected ? "deselect" : "select";
                          warehouseSelectModeRef.current = mode;
                          setWarehouseSelecting(true);
                          setWarehouseSelected(key, mode === "select");
                        }}
                        onMouseEnter={() => {
                          if (warehouseSelecting) setWarehouseSelected(key, warehouseSelectModeRef.current === "select");
                        }}
                        className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs font-black ${selected ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-400"}`}
                      >
                        {index + 1}
                      </button>
                    </td>
                    <td className="truncate py-2 pl-4 font-black">{warehouse.warehouse_code || "-"}</td>
                    <td className="truncate py-2 font-bold" title={warehouse.warehouse_name || ""}>{warehouse.warehouse_name || "-"}</td>
                    <td className="truncate py-2 text-slate-500">{warehouse.warehouse_type_label || warehouseAttributeLabel(warehouse.warehouse_type)}</td>
                    <td className="py-2 text-right font-black">{Number(warehouse.stock_product_count || 0).toLocaleString("ko-KR")}</td>
                    <td className="truncate py-2 text-slate-500" title={warehouse.memo || ""}>{warehouse.memo ? `${warehouse.memo.slice(0, 10)}${warehouse.memo.length > 10 ? "..." : ""}` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!warehouses.length && <EmptyState title={loading ? "불러오는 중..." : "창고가 없습니다."} />}
        </div>
        {message && <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">{message}</div>}
      </Panel>

      {warehouseBulkOpen && (
        <FormModal
          title="창고 선택수정"
          description={`선택 ${selectedWarehouses.length.toLocaleString("ko-KR")}개 창고에 같은 값을 적용합니다.`}
          onClose={() => setWarehouseBulkOpen(false)}
          size="xl"
          footer={
            <>
              <ActionButton type="button" variant="secondary" onClick={() => setWarehouseBulkOpen(false)}>닫기</ActionButton>
              <ActionButton type="button" onClick={() => void saveWarehouseBulkEdit()}>저장</ActionButton>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <select className={modalSelectClass} value={warehouseBulkField} onChange={(event) => setWarehouseBulkField(event.target.value as WarehouseBulkField)}>
                <option value="warehouse_type">창고 속성</option>
                <option value="warehouse_address">창고 주소</option>
                <option value="warehouse_phone">창고 연락처</option>
                <option value="manager_name">담당자 이름</option>
                <option value="manager_phone">담당자 연락처</option>
                <option value="manager_memo">담당자 메모</option>
                <option value="memo">메모</option>
              </select>
              {warehouseBulkField === "warehouse_type" ? (
                <select className={modalSelectClass} value={warehouseBulkValue || "general"} onChange={(event) => setWarehouseBulkValue(event.target.value)}>
                  <option value="general">일반</option>
                  <option value="fulfillment">풀필먼트</option>
                </select>
              ) : (
                <input className={modalInputClass} value={warehouseBulkValue} onChange={(event) => setWarehouseBulkValue(event.target.value)} placeholder="선택한 창고에 적용할 값" />
              )}
            </div>
            <div className="max-h-[52vh] overflow-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[620px] text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr><th className="w-12 px-2 py-2 text-center">#</th><th className="px-2 py-2 text-left">창고코드</th><th className="px-2 py-2 text-left">창고명</th><th className="px-2 py-2 text-left">현재값</th></tr>
                </thead>
                <tbody>
                  {selectedWarehouses.map((warehouse, index) => {
                    const memoDraft = parseWarehouseMemo(warehouse.memo);
                    const currentValue = warehouseBulkField === "warehouse_type"
                      ? warehouse.warehouse_type_label || warehouseAttributeLabel(warehouse.warehouse_type)
                      : memoDraft[warehouseBulkField] || "-";
                    return (
                      <tr key={warehouseRowKey(warehouse)} className="border-t border-gray-100">
                        <td className="px-2 py-2 text-center"><span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-blue-600 px-1 font-black text-white">{index + 1}</span></td>
                        <td className="px-2 py-2 font-black">{warehouse.warehouse_code || "-"}</td>
                        <td className="px-2 py-2 font-bold">{warehouse.warehouse_name || "-"}</td>
                        <td className="px-2 py-2 text-slate-600">{currentValue}</td>
                      </tr>
                    );
                  })}
                  {!selectedWarehouses.length && <tr><td colSpan={4} className="px-3 py-8 text-center font-bold text-slate-400">선택된 창고가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </FormModal>
      )}

      {modalOpen && (
        <FormModal
          title={draft.id ? "창고 수정" : "새 창고"}
          description="속성, 창고코드, 창고명은 필수입니다."
          onClose={() => setModalOpen(false)}
          size="xl"
          footer={
            <>
              {draft.id && <ActionButton type="button" variant="secondary" className="mr-auto border-rose-200 text-rose-600 hover:bg-rose-50" onClick={() => void deleteWarehouseDraft()}>삭제</ActionButton>}
              <ActionButton type="button" variant="secondary" onClick={() => setModalOpen(false)}>닫기</ActionButton>
              <ActionButton type="button" onClick={() => void saveWarehouseDraft()}>저장</ActionButton>
            </>
          }
        >
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {[
                ["general", "일반"],
                ["fulfillment", "풀필먼트"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateDraft("warehouse_type", value)}
                  className={`h-10 rounded-md px-4 text-sm font-black ${draft.warehouse_type === value ? "bg-orange-500 text-white" : "border border-gray-200 bg-white text-slate-600 hover:bg-orange-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="창고코드"><input className={modalInputClass} value={draft.warehouse_code || ""} onChange={(event) => updateDraft("warehouse_code", event.target.value)} placeholder="100" /></FormField>
              <FormField label="창고명"><input className={modalInputClass} value={draft.warehouse_name || ""} onChange={(event) => updateDraft("warehouse_name", event.target.value)} placeholder="에프엔 본사창고" /></FormField>
              <FormField label="창고 주소"><input className={modalInputClass} value={draft.warehouse_address || ""} onChange={(event) => updateDraft("warehouse_address", event.target.value)} placeholder="창고 주소" /></FormField>
              <FormField label="창고 연락처"><input className={modalInputClass} value={draft.warehouse_phone || ""} onChange={(event) => updateDraft("warehouse_phone", event.target.value)} placeholder="010-0000-0000" /></FormField>
              <FormField label="메모" className="md:col-span-2"><textarea className={modalTextareaClass} value={draft.memo || ""} onChange={(event) => updateDraft("memo", event.target.value)} placeholder="창고 관련 메모" /></FormField>
            </div>
            {draft.warehouse_type === "fulfillment" && (
              <div className="grid gap-4 border-t border-gray-200 pt-4 md:grid-cols-2">
                <div className="md:col-span-2 text-sm font-black text-slate-900">담당자 정보</div>
                <FormField label="담당자 이름"><input className={modalInputClass} value={draft.manager_name || ""} onChange={(event) => updateDraft("manager_name", event.target.value)} placeholder="담당자 이름" /></FormField>
                <FormField label="담당자 연락처"><input className={modalInputClass} value={draft.manager_phone || ""} onChange={(event) => updateDraft("manager_phone", event.target.value)} placeholder="담당자 연락처" /></FormField>
                <FormField label="메모" className="md:col-span-2"><textarea className={modalTextareaClass} value={draft.manager_memo || ""} onChange={(event) => updateDraft("manager_memo", event.target.value)} placeholder="풀필먼트 담당자 관련 메모" /></FormField>
              </div>
            )}
          </div>
        </FormModal>
      )}
    </div>
  );
}

function CustomerEditModal({
  draft,
  channelDraft,
  channelCredentials,
  credentialMeta,
  credentialsRevealed,
  channelLoading,
  onClose,
  onChange,
  onChannelChange,
  onCredentialChange,
  onRevealCredentials,
  onSave,
  onDelete,
}: {
  draft: Record<string, string>;
  channelDraft: SalesChannelDraft;
  channelCredentials: Record<(typeof salesChannelCredentialKeys)[number], string>;
  credentialMeta: Record<string, SalesChannelCredentialMeta>;
  credentialsRevealed: boolean;
  channelLoading: boolean;
  onClose: () => void;
  onChange: (key: string, value: string) => void;
  onChannelChange: (key: string, value: string) => void;
  onCredentialChange: (key: string, value: string) => void;
  onRevealCredentials: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  useEscapeToClose(true, onClose);
  const customerType = normalizeCustomerAttribute(draft.customer_type);
  const businessSameAsCode = Boolean(draft.customer_code && draft.business_no && draft.business_no === formatBusinessNoInput(draft.customer_code));

  function changeBusinessSameAsCode(checked: boolean) {
    onChange("business_no", checked ? draft.customer_code || "" : "");
  }

  return (
    <FormModal
      title={draft.id ? "거래처 수정" : "새 거래처 등록"}
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex w-full justify-between gap-2">
          <div>{draft.id && <ActionButton type="button" variant="danger" onClick={onDelete}>삭제</ActionButton>}</div>
          <div className="flex gap-2">
            <ActionButton type="button" variant="secondary" onClick={onClose}>닫기</ActionButton>
            <ActionButton type="button" onClick={onSave}>저장</ActionButton>
          </div>
        </div>
      }
    >
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-[13px] font-semibold text-gray-700">속성 선택 <span className="text-[#ff6a00]">*</span></div>
            <div className="flex gap-2">
              {[
                { key: "general" as CustomerAttribute, label: "일반" },
                { key: "shopping" as CustomerAttribute, label: "쇼핑몰" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onChange("customer_type", item.key)}
                  className={`h-10 rounded-lg border px-4 text-sm font-semibold ${customerType === item.key ? "border-orange-200 bg-orange-50 text-orange-700" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="거래처코드" required><input className={modalInputClass} value={draft.customer_code || ""} onChange={(event) => onChange("customer_code", event.target.value)} /></FormField>
            <FormField label="거래처명" required><input className={modalInputClass} value={draft.customer_name || ""} onChange={(event) => onChange("customer_name", event.target.value)} /></FormField>
            <FormField label="사업자번호" className="md:col-span-2">
              <input className={modalInputClass} value={draft.business_no || ""} onChange={(event) => onChange("business_no", event.target.value)} placeholder="111-11-11111" />
              <span className="mt-2 flex items-center gap-2 text-[11px] font-bold text-slate-500">
                <input type="checkbox" checked={businessSameAsCode} onChange={(event) => changeBusinessSameAsCode(event.target.checked)} />
                거래처코드와 동일
              </span>
            </FormField>
            <FormField label="담당자"><input className={modalInputClass} value={draft.contact_name || ""} onChange={(event) => onChange("contact_name", event.target.value)} placeholder="담당자명" /></FormField>
            <FormField label="전화번호"><input className={modalInputClass} value={draft.phone || ""} onChange={(event) => onChange("phone", event.target.value)} placeholder="010-0000-0000" /></FormField>
            <FormField label="거래처정보 · 기타 메모" className="md:col-span-2"><textarea className={modalTextareaClass} value={draft.memo || ""} onChange={(event) => onChange("memo", event.target.value)} placeholder={"담당자/전화번호/주소/Email 등 정보기재\n예) 담당자: 홍길동 / 주소: 서울... / Email: fn@example.com"} /></FormField>
          </div>
          {customerType === "shopping" && (
            <div className="rounded-xl border border-orange-100 bg-orange-50/40 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-orange-700">쇼핑몰 API 정보</div>
                  <p className="mt-1 text-xs font-medium text-orange-700">주문수집에서 사용할 쇼핑몰 채널과 credential을 연결합니다.</p>
                </div>
                <ActionButton type="button" variant="secondary" className="h-8 border-orange-200 px-3 text-xs text-orange-700 hover:bg-orange-50" onClick={onRevealCredentials} disabled={channelLoading}>
                  {credentialsRevealed ? "가리기" : "보기"}
                </ActionButton>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="channel_code"><input className={modalInputClass} value={channelDraft.channel_code || ""} onChange={(event) => onChannelChange("channel_code", event.target.value)} placeholder="NAVER" /></FormField>
                <FormField label="channel_name"><input className={modalInputClass} value={channelDraft.channel_name || ""} onChange={(event) => onChannelChange("channel_name", event.target.value)} placeholder="네이버 스마트스토어" /></FormField>
                <FormField label="seller_id"><input className={modalInputClass} value={channelDraft.seller_id || ""} onChange={(event) => onChannelChange("seller_id", event.target.value)} /></FormField>
                <FormField label="seller_site_url"><input className={modalInputClass} value={channelDraft.seller_site_url || ""} onChange={(event) => onChannelChange("seller_site_url", event.target.value)} placeholder="https://..." /></FormField>
                <FormField label="api_enabled">
                  <select className={modalSelectClass} value={channelDraft.api_enabled || "false"} onChange={(event) => onChannelChange("api_enabled", event.target.value)}>
                    <option value="false">N</option>
                    <option value="true">Y</option>
                  </select>
                </FormField>
                <FormField label="api_status">
                  <select className={modalSelectClass} value={channelDraft.api_status || "manual"} onChange={(event) => onChannelChange("api_status", event.target.value)}>
                    <option value="manual">manual</option>
                    <option value="planned">planned</option>
                    <option value="ready">ready</option>
                    <option value="connected">connected</option>
                    <option value="error">error</option>
                  </select>
                </FormField>
                {salesChannelCredentialKeys.map((key) => {
                  const meta = credentialMeta[key];
                  const placeholder = meta?.has_value ? meta.hint || "****" : "";
                  return (
                    <FormField key={key} label={salesChannelCredentialLabels[key]}>
                      <input
                        className={modalInputClass}
                        type={credentialsRevealed ? "text" : "password"}
                        value={channelCredentials[key] || ""}
                        onChange={(event) => onCredentialChange(key, event.target.value)}
                        placeholder={placeholder}
                      />
                    </FormField>
                  );
                })}
              </div>
              <p className="mt-3 text-xs font-medium leading-relaxed text-orange-700">
                저장된 secret은 평문으로 기본 표시하지 않습니다. 값이 있는 항목은 hint만 보이고, 새 값을 입력한 항목만 저장 시 갱신됩니다.
              </p>
            </div>
          )}
        </div>
    </FormModal>
  );
}

function ProductEditModal({
  draft,
  warehouses,
  bomRows,
  importLinks,
  onClose,
  onChange,
  onBomRowsChange,
  onSave,
  onDelete,
}: {
  draft: Record<string, string>;
  warehouses: WarehouseOption[];
  bomRows: ProductBomRow[];
  importLinks: ProductImportLinkRow[];
  onClose: () => void;
  onChange: (key: string, value: string) => void;
  onBomRowsChange: (rows: ProductBomRow[]) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [componentQuery, setComponentQuery] = useState("");
  const [componentCandidates, setComponentCandidates] = useState<FnProduct[]>([]);
  const [bomOpen, setBomOpen] = useState(false);
  const productAttribute = normalizeProductAttribute(draft.product_attribute || draft.product_kind);
  const showBomPanel = productAttribute === "set" || bomRows.length > 0 || bomOpen;
  useEscapeToClose(true, onClose);

  useEffect(() => {
    const keyword = componentQuery.trim() || (productAttribute === "set" ? relatedProductSearchQuery(draft.product_name) : "");
    if (!keyword) {
      setComponentCandidates([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ q: keyword, page: "1", pageSize: "20", excludeBom: "true" });
      const data = await cachedClientJson<{ products?: FnProduct[] }>(`/api/fnos/products/master?${params.toString()}`, { ttl: 5 * 60_000, storageTtl: 10 * 60_000 }).catch(() => ({ products: [] }));
      if (alive) {
        setComponentCandidates((data.products || []).filter((product: FnProduct) => (
          product.id !== draft.id && !bomRows.some((row) => row.component_product_id === product.id)
        )));
      }
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [componentQuery, draft.id, draft.product_name, productAttribute, bomRows]);

  function addBomComponent(product: FnProduct) {
    if (!product.id) return;
    if (product.id === draft.id) return;
    if (bomRows.some((row) => row.component_product_id === product.id)) return;
    onBomRowsChange([
      ...bomRows,
      {
        component_product_id: product.id,
        component_sku: product.product_code || product.sku,
        component_product_code: product.product_code || product.sku,
        component_product_name: product.product_name,
        qty_per_unit: 1,
      },
    ]);
    setComponentQuery("");
    setComponentCandidates([]);
  }

  function updateBomQty(index: number, value: string) {
    onBomRowsChange(bomRows.map((row, rowIndex) => rowIndex === index ? { ...row, qty_per_unit: Number(value) || 0 } : row));
  }

  function removeBomComponent(index: number) {
    onBomRowsChange(bomRows.filter((_, rowIndex) => rowIndex !== index));
  }

  function selectProductAttribute(attribute: ProductAttribute) {
    onChange("product_attribute", attribute);
    onChange("product_kind", attribute);
    onChange("product_name", productNameWithAttribute(draft.product_name || "", attribute));
    if (attribute === "set") setBomOpen(true);
  }

  return (
    <FormModal
      title={draft.id ? "품목 수정" : "새 품목 등록"}
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex w-full justify-between gap-2">
          <div>{draft.id && <ActionButton type="button" variant="danger" onClick={onDelete}>삭제</ActionButton>}</div>
          <div className="flex gap-2">
            <ActionButton type="button" variant="secondary" onClick={onClose}>닫기</ActionButton>
            <ActionButton type="button" onClick={onSave}>저장</ActionButton>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["plain", "set", "rg"] as ProductAttribute[]).map((attribute) => {
              const selected = normalizeProductAttribute(draft.product_attribute || draft.product_kind) === attribute;
              return (
                <button
                  key={attribute}
                  type="button"
                  onClick={() => selectProductAttribute(attribute)}
                  className={`rounded-md border px-4 py-2 text-sm font-black ${
                    selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-orange-600"
                  }`}
                >
                  {productAttributeLabel(attribute)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="품목코드" required><input className={modalInputClass} value={draft.product_code || ""} onChange={(event) => onChange("product_code", event.target.value)} /></FormField>
          <FormField label="품목명" required><input className={modalInputClass} value={draft.product_name || ""} onChange={(event) => onChange("product_name", event.target.value)} /></FormField>
          <FormField label="입고가"><input className={modalInputClass} type="number" value={draft.cost_price || ""} onChange={(event) => onChange("cost_price", event.target.value)} /></FormField>
          <FormField label="출고가"><input className={modalInputClass} type="number" value={draft.standard_price || ""} onChange={(event) => onChange("standard_price", event.target.value)} /></FormField>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="mb-3 text-sm font-semibold text-gray-900">재고등록(수정)</div>
          <div className="grid gap-2 md:grid-cols-2">
            {warehouses.map((warehouse) => (
              <label key={warehouse.id || warehouse.warehouse_code} className="text-xs font-black text-slate-500">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{warehouse.warehouse_code} - {warehouse.warehouse_name}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">현재 {Number(draft[`stock_${warehouse.warehouse_code}`] || 0).toLocaleString("ko-KR")}</span>
                </span>
                <input
                  className={modalInputClass}
                  type="number"
                  value={draft[`stock_${warehouse.warehouse_code}`] || ""}
                  placeholder="수정 수량"
                  onChange={(event) => onChange(`stock_${warehouse.warehouse_code}`, event.target.value)}
                />
              </label>
            ))}
            {!warehouses.length && <div className="rounded-md bg-slate-50 p-4 text-sm font-bold text-slate-400">등록된 창고가 없습니다. 먼저 창고관리에서 창고를 등록해 주세요.</div>}
          </div>
        </div>
        {!showBomPanel && (
          <div className="rounded-xl border border-dashed border-gray-200 p-4">
            <ActionButton type="button" variant="secondary" onClick={() => setBomOpen(true)}>BOM 설정</ActionButton>
          </div>
        )}
        {showBomPanel && <div className="rounded-xl border border-gray-200 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">BOM 관리</div>
              <p className="mt-1 text-xs font-medium text-gray-500">세트 판매품이면 실제 차감될 구성 품목과 수량을 지정합니다.</p>
            </div>
            <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">{bomRows.length}개 구성</span>
          </div>
          <input
            className={`${modalInputClass} mb-2`}
            value={componentQuery}
            onChange={(event) => setComponentQuery(event.target.value)}
            placeholder="구성품 품목코드 / 품목명 검색"
          />
          {!!componentCandidates.length && (
            <div className="mb-3 max-h-36 overflow-auto rounded-xl border border-gray-200">
              {componentCandidates.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addBomComponent(product)}
                  className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-orange-50"
                >
                  <span className="font-black">{product.product_code || product.sku}</span>
                  <span className="flex-1 truncate font-bold text-slate-600">{product.product_name}</span>
                  <span className="text-xs font-black text-orange-600">선택</span>
                </button>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {bomRows.map((row, index) => (
              <div key={`${row.component_product_id}-${index}`} className="grid items-center gap-2 rounded-lg bg-gray-50 p-2 md:grid-cols-[120px_1fr_90px_64px]">
                <div className="text-sm font-black">{row.component_product_code || row.component_sku}</div>
                <div className="truncate text-sm font-bold text-slate-600">{row.component_product_name || "-"}</div>
                <input className={`${modalInputClass} h-8 text-right`} type="number" min="0" step="1" value={row.qty_per_unit || ""} onChange={(event) => updateBomQty(index, event.target.value)} />
                <ActionButton type="button" variant="secondary" className="h-8 border-rose-200 px-2 text-xs text-rose-600 hover:bg-rose-50" onClick={() => removeBomComponent(index)}>삭제</ActionButton>
              </div>
            ))}
            {!bomRows.length && <div className="rounded-md bg-slate-50 p-4 text-sm font-bold text-slate-400">BOM 구성품이 없습니다.</div>}
          </div>
        </div>}
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900">수입관리 연동</div>
            <ActionButton type="button" variant="secondary" className="h-8 border-orange-200 px-3 text-xs text-orange-700 hover:bg-orange-50" onClick={() => goToInternal(importHref("/products"))}>수입관리에서 수정</ActionButton>
          </div>
          <div className="space-y-2">
            {importLinks.map((link, index) => (
              <div key={`${link.import_product_id}-${index}`} className="rounded-md bg-orange-50 px-3 py-2 text-sm font-bold text-orange-800">
                {link.import_product_name || `수입상품 ${link.import_product_id || ""}`}
                {link.import_option_name ? ` / ${link.import_option_name}` : ""}
              </div>
            ))}
            {!importLinks.length && <div className="rounded-md bg-slate-50 p-4 text-sm font-bold text-slate-400">연동된 수입관리 상품이 없습니다.</div>}
          </div>
        </div>
      </div>
    </FormModal>
  );
}

function MasterEntryPanel({ config, setMessage, loadSummary }: { config: (typeof masterTabs)[number]; setMessage: (value: string) => void; loadSummary: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);

  function invalidateMasterEntryCaches() {
    if (config.key === "customers") {
      invalidateClientCache("/api/fnos/customers");
      invalidateClientCache("/api/fnos/sales-channels");
    }
    if (config.key === "products") {
      invalidateClientCache("/api/fnos/products/master");
      invalidateClientCache("/api/fnos/products/search");
      invalidateClientCache("/api/fnos/products");
    }
    if (config.key === "warehouses") {
      invalidateClientCache("/api/fnos/products/master");
    }
    if (config.key === "channels") {
      invalidateClientCache("/api/fnos/sales-channels");
    }
    invalidateClientCache("/api/dashboard/summary");
  }

  useEffect(() => {
    setDraft(Object.fromEntries(config.templateHeaders.slice(0, 6).map((header) => [header, ""])));
  }, [config.key]);

  function updateField(header: string, value: string) {
    setDraft((prev) => ({ ...prev, [header]: value }));
  }

  function downloadTemplate() {
    void downloadTableXlsx(`FN_OS_${config.title}_업로드_서식.xlsx`, `${config.title}업로드`, config.templateHeaders, [config.sampleRow]);
  }

  async function saveRows(rows: Record<string, unknown>[]) {
    if (config.key === "products") {
      let success = 0;
      for (const row of rows) {
        const res = await fetch("/api/fnos/quick-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            mode: "product",
            form: {
              prod_cd: row["품목코드"],
              product_code: row["품목코드"],
              prod_name: row["품목명"],
              product_name: row["품목명"],
              size_des: row["옵션"],
              out_price: row["표준단가"],
              in_price: row["매입단가"],
            },
          }),
        });
        if (res.ok) success += 1;
      }
      setMessage(`품목 ${success}건을 저장했습니다.`);
      invalidateMasterEntryCaches();
      return;
    }

    if (config.key === "channels") {
      const res = await fetch("/api/fnos/sales-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows }),
      });
      const data = await res.json().catch(() => ({}));
      setMessage(res.ok && data.ok !== false ? `쇼핑몰 ${data.count || rows.length}건을 저장했습니다.` : data.error || "쇼핑몰 저장 실패");
      invalidateMasterEntryCaches();
      loadSummary();
      return;
    }

    if (config.key === "warehouses") {
      let success = 0;
      for (const row of rows) {
        const res = await fetch("/api/fnos/quick-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            mode: "warehouse",
            form: {
              wh_cd: row["창고코드"],
              warehouse_code: row["창고코드"],
              wh_name: row["창고명"],
              warehouse_name: row["창고명"],
              warehouse_type: row["창고구분"],
              memo: row["메모"],
            },
          }),
        });
        if (res.ok) success += 1;
      }
      setMessage(`창고 ${success}건을 저장했습니다.`);
      invalidateMasterEntryCaches();
      return;
    }

    if (config.key === "attendance") {
      const saved = JSON.parse(localStorage.getItem("fnos-attendance-draft-rows") || "[]") as Record<string, unknown>[];
      localStorage.setItem("fnos-attendance-draft-rows", JSON.stringify([...saved, ...rows]));
      setMessage(`근태 ${rows.length}건을 임시 저장했습니다. DB 저장은 근태 테이블 생성 후 연결합니다.`);
      return;
    }
  }

  async function uploadExcel(file: File) {
    setUploading(true);
    try {
      if (config.uploadEndpoint) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(config.uploadEndpoint, { method: "POST", credentials: "include", body: form });
        const data = await res.json().catch(() => ({}));
        setMessage(res.ok && data.ok !== false ? `${config.title} ${data.count || 0}건을 업로드했습니다.` : data.error || `${config.title} 업로드 실패`);
        if (res.ok && data.ok !== false) invalidateMasterEntryCaches();
        return;
      }
      const rows = await readXlsxObjects(file);
      await saveRows(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${config.title} 업로드 실패`);
    } finally {
      setUploading(false);
    }
  }

  async function saveDraft() {
    const row = { ...draft };
    if (config.key === "customers") {
      const res = await fetch("/api/fnos/quick-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "customer",
          form: {
            cust_code: row["거래처코드"],
            cust_name: row["거래처명"],
            business_no: row["사업자번호"],
            contact_name: row["담당자"],
            phone: row["전화"],
            memo: row["메모"],
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      setMessage(res.ok && data.ok !== false ? "거래처를 저장했습니다." : data.error || "거래처 저장 실패");
      if (res.ok && data.ok !== false) invalidateMasterEntryCaches();
      return;
    }
    await saveRows([row]);
  }

  return (
    <Panel
      title={`${config.title} 입력`}
      subtitle="개별 입력 또는 엑셀 업로드로 기초 데이터를 관리합니다."
      action={
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadTemplate} className="inline-flex h-10 w-10 items-center justify-center rounded-md border-0 bg-transparent p-0 text-emerald-600 hover:bg-orange-50" aria-label="엑셀폼 다운로드" title="엑셀폼 다운로드"><ExcelFormIcon /></button>
          <label className="inline-flex h-10 cursor-pointer items-center rounded-md border border-orange-200 bg-orange-50 px-4 text-sm font-black text-orange-600">
            {uploading ? "업로드 중" : "엑셀 업로드"}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadExcel(file);
              event.target.value = "";
            }} />
          </label>
        </div>
      }
    >
      <div className="grid gap-2 md:grid-cols-3">
        {config.templateHeaders.slice(0, 6).map((header) => (
          <input
            key={`${config.key}-${header}`}
            className="field-input rounded-md border border-slate-200 px-3 py-2 text-sm"
            placeholder={header}
            value={draft[header] || ""}
            onChange={(event) => updateField(header, event.target.value)}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={() => void saveDraft()} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-black text-white">개별 입력 저장</button>
      </div>
    </Panel>
  );
}

function SalesInventoryTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-sm font-bold text-slate-500">아직 저장된 내역이 없습니다.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-500">
          <tr>
            <th className="py-2 text-left">일자</th>
            <th className="py-2 text-left">거래처</th>
            <th className="py-2 text-left">품목코드</th>
            <th className="py-2 text-left">품목명</th>
            <th className="py-2 text-right">수량</th>
            <th className="py-2 text-right">단가</th>
            <th className="py-2 text-right">공급가액</th>
            <th className="py-2 text-center">상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id || index)} className="border-b border-slate-100">
              <td className="py-2 font-bold">{String(row.io_date || "-")}</td>
              <td className="py-2">{String(row.cust_name || row.cust_code || "-")}</td>
              <td className="py-2">{String(row.prod_cd || "-")}</td>
              <td className="py-2 font-bold">{String(row.prod_name || "-")}</td>
              <td className="py-2 text-right">{Number(row.qty || 0).toLocaleString("ko-KR")}</td>
              <td className="py-2 text-right">{Number(row.price || 0).toLocaleString("ko-KR")}</td>
              <td className="py-2 text-right font-black">{krw(Number(row.supply_amt || 0))}</td>
              <td className="py-2 text-center"><StatusPill status={String(row.sync_status || "SAVED")} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SalesProductMasterPanel({ message, setMessage, sync }: { message: string; setMessage: (value: string) => void; sync: (target: "products" | "inventory") => void }) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<FnProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    cachedClientJson<{ products?: FnProduct[] }>(`/api/fnos/products/search?${params.toString()}`, { ttl: 5 * 60_000, storageTtl: 10 * 60_000 })
      .then((data) => {
        if (alive) setProducts(data.products || []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [query]);

  async function linkProduct(product: FnProduct) {
    const createNew = window.confirm("새 수입관리 대표상품을 생성할까요?\n취소를 누르면 기존 수입관리 제품 ID에 연결합니다.");
    if (createNew) {
      localStorage.setItem("fnos-import-product-prefill", JSON.stringify({ product }));
      goToInternal(importHref("/products/new"));
      return;
    }
    const importProductId = window.prompt("연결할 기존 수입관리 제품 ID를 입력해 주세요.");
    if (!importProductId) return;
    const res = await fetch("/api/fnos/import-product-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        import_product_id: importProductId,
        links: [{ product_id: product.id, sku: fnProductSku(product), default_ratio: 1, is_primary: true }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok && data.ok !== false ? "수입관리 대표상품에 SKU를 연결했습니다." : data.error || "연결 실패");
  }

  return (
    <Panel
      title="품목관리"
      subtitle="FN OS 품목 마스터를 관리하고 수입관리 대표상품과 연결합니다."
      action={<button type="button" className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" onClick={() => sync("products")}>품목 동기화</button>}
    >
      <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
        <input className="field-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SKU / 품목명 / 옵션 검색" />
        <Link className="inline-flex h-[38px] items-center justify-center rounded-md border border-orange-200 bg-orange-50 px-4 text-sm font-black text-orange-600" href={importHref("/products/new")}>새 수입관리 상품</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-slate-200 text-xs text-slate-500">
            <tr>
              <th className="py-2 text-left">SKU</th>
              <th className="py-2 text-left">품목명</th>
              <th className="py-2 text-left">옵션</th>
              <th className="py-2 text-right">현재재고</th>
              <th className="py-2 text-right">가용재고</th>
              <th className="py-2 text-right">표준단가</th>
              <th className="py-2 text-center">수입관리</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-slate-100">
                <td className="py-2 font-black">{fnProductSku(product)}</td>
                <td className="py-2">{fnProductName(product)}</td>
                <td className="py-2">{fnProductOption(product)}</td>
                <td className="py-2 text-right">{Number(product.current_stock || 0).toLocaleString("ko-KR")}</td>
                <td className="py-2 text-right">{Number(product.available_stock || 0).toLocaleString("ko-KR")}</td>
                <td className="py-2 text-right">{krw(fnProductPrice(product))}</td>
                <td className="py-2 text-center"><button type="button" className="h-8 rounded-md border border-orange-200 px-3 text-xs font-black text-orange-600" onClick={() => void linkProduct(product)}>수입관리와 연동</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!products.length && <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-400">{loading ? "불러오는 중..." : "품목이 없습니다."}</p>}
      </div>
      {message && <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">{message}</div>}
    </Panel>
  );
}

function SalesSummaryGroups({ summary }: { summary: SalesInventorySummary | null }) {
  const groups = [
    { title: "날짜별 매출", rows: summary?.sales_by_date || [] },
    { title: "거래처별 매출", rows: summary?.sales_by_customer || [] },
    { title: "품목별 매출", rows: summary?.sales_by_product || [] },
  ];
  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-3">
      {groups.map((group) => (
        <div key={group.title} className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-black">{group.title}</h3>
          <div className="mt-2 space-y-2">
            {group.rows.slice(0, 5).map((row, index) => (
              <div key={`${group.title}-${String(row.label || index)}`} className="grid grid-cols-[1fr_auto] gap-2 rounded bg-white px-2 py-2 text-xs">
                <span className="truncate font-bold text-slate-700">{String(row.label || "-")}</span>
                <span className="font-black">{krw(Number(row.amount || 0))}</span>
                <span className="text-slate-500">{Number(row.count || 0).toLocaleString("ko-KR")}건</span>
                <span className="text-right text-slate-500">{Number(row.qty || 0).toLocaleString("ko-KR")}개</span>
              </div>
            ))}
            {!group.rows.length && <p className="rounded bg-white px-2 py-3 text-xs font-bold text-slate-400">데이터 없음</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Dashboard() {
  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {kpis.map((item) => (
          <article key={item.label} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">{item.label}</p>
            <p className="mt-3 text-2xl font-black">{item.value}</p>
            <p className={`mt-2 text-sm font-bold ${item.tone}`}>{item.note}</p>
          </article>
        ))}
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">수입제품 현황</h2>
            <p className="mt-1 text-sm text-slate-500">수입관리 데이터를 FN OS 네이티브 화면으로 표시합니다.</p>
          </div>
          <div className="flex gap-2">
            <Link className="inline-flex h-9 items-center rounded-md bg-orange-500 px-3 text-sm font-black text-white" href={importHref("/orders/new")}>+ 새 발주</Link>
            <Link className="inline-flex h-9 items-center rounded-md border border-orange-200 bg-orange-50 px-3 text-sm font-black text-orange-600" href={importHref("/products/new")}>+ 새 상품</Link>
          </div>
        </div>
        <NativeImportDashboard compact />
      </section>
    </div>
  );
}

type AdsMetricRow = Record<string, unknown>;
type AdSourceKey = "meta-gfa" | "naver-shopping" | "naver-adboost" | "naver-gfa" | "coupang";
type UploadedAdFile = {
  id: string;
  sourceKey: AdSourceKey;
  file: File;
};

type AdUploadResultRow = {
  channel?: string;
  success_count?: number;
  fail_count?: number;
  replaced_count?: number;
  replaced_dates?: string[];
  message?: string;
};

type AdUploadReport = {
  message?: string;
  parsed_count?: number;
  success_count?: number;
  fail_count?: number;
  replaced_count?: number;
  results?: AdUploadResultRow[];
};

type AdsSummary = {
  ok?: boolean;
  error?: string;
  total?: AdsMetricRow;
  batches?: AdsMetricRow[];
  daily?: AdsMetricRow[];
  channels?: AdsMetricRow[];
  products?: AdsMetricRow[];
  campaigns?: AdsMetricRow[];
  unmapped?: AdsMetricRow[];
  advice?: Array<{ title?: string; message?: string; tone?: string }>;
};

type AdsSummaryRange = { from: string; to: string };

const ADS_SUMMARY_CACHE_TTL = 5 * 60_000;
const ADS_SUMMARY_STORAGE_TTL = 10 * 60_000;

function adsSummaryUrl(range: AdsSummaryRange) {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  return `/api/fnos/ads/summary?${params.toString()}`;
}

function cachedAdsSummary(range: AdsSummaryRange) {
  return cachedClientJson<AdsSummary>(adsSummaryUrl(range), {
    ttl: ADS_SUMMARY_CACHE_TTL,
    storageTtl: ADS_SUMMARY_STORAGE_TTL,
  });
}

const adSources: Array<{ key: AdSourceKey; label: string; shortLabel: string; hint: string }> = [
  { key: "meta-gfa", label: "메타GFA", shortLabel: "META", hint: "광고 세트/소재 단위 리포트" },
  { key: "naver-shopping", label: "네이버쇼핑검색", shortLabel: "NS", hint: "쇼핑검색 캠페인 리포트" },
  { key: "naver-adboost", label: "네이버AdV", shortLabel: "ADV", hint: "캠페인 단위 리포트" },
  { key: "naver-gfa", label: "네이버GFA", shortLabel: "GFA", hint: "광고그룹 단위 리포트" },
  { key: "coupang", label: "쿠팡", shortLabel: "CP", hint: "pa_total_campaign 리포트" },
];

const adSourceOrder: AdSourceKey[] = ["meta-gfa", "naver-shopping", "naver-adboost", "naver-gfa", "coupang"];

const adSourceLabels = Object.fromEntries(adSources.map((source) => [source.key, source.label])) as Record<AdSourceKey, string>;

function adUploadFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function uploadedAdFileKey(item: UploadedAdFile) {
  return `${item.sourceKey}:${adUploadFileKey(item.file)}`;
}

function adFileSizeLabel(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.max(1, Math.round(size / 1024)).toLocaleString("ko-KR")}KB`;
  return `${size.toLocaleString("ko-KR")}B`;
}

function adUploadResultLabel(result: AdUploadReport | null) {
  if (!result) return "";
  const success = adNumber(result.success_count).toLocaleString("ko-KR");
  const fail = adNumber(result.fail_count).toLocaleString("ko-KR");
  const replaced = adNumber(result.replaced_count).toLocaleString("ko-KR");
  const parsed = adNumber(result.parsed_count).toLocaleString("ko-KR");
  return `읽음 ${parsed} / 저장 ${success} / 제외 ${fail}${adNumber(result.replaced_count) ? ` / 대체 ${replaced}` : ""}`;
}

function inferAdSourceKey(fileName: string): AdSourceKey {
  const name = fileName.toLowerCase();
  if (name.includes("광고그룹")) return "naver-gfa";
  if (name.includes("쇼핑검색")) return "naver-shopping";
  if (name.includes("pa_total_campaign") || name.includes("coupang") || name.includes("쿠팡")) return "coupang";
  if (name.includes("광고-세트") || name.includes("광고 세트") || name.includes("meta") || name.includes("facebook") || name.includes("instagram") || name.includes("메타")) return "meta-gfa";
  if (name.includes("캠페인_") || name.startsWith("캠페인") || name.includes("adboost") || name.includes("advoost") || name.includes("애드부스트")) return "naver-adboost";
  if (name.includes("shopping")) return "naver-shopping";
  if (name.includes("gfa") || name.includes("성과형")) return "naver-gfa";
  if (name.includes("캠페인")) return "naver-adboost";
  if (name.includes("naver") || name.includes("검색") || name.includes("네이버")) return "naver-shopping";
  return "naver-shopping";
}

function adSourceForFile(file: File, index: number, total: number, forcedSource?: AdSourceKey) {
  if (forcedSource) return forcedSource;
  const inferred = inferAdSourceKey(file.name);
  if (inferred) return inferred;
  if (total >= adSourceOrder.length && index < adSourceOrder.length) return adSourceOrder[index];
  return "naver-shopping";
}

function adNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function adPercent(value: unknown) {
  return `${adNumber(value).toFixed(1)}%`;
}

function adPercent2(value: unknown) {
  return `${adNumber(value).toFixed(2)}%`;
}

function adDateInput(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function adUploadDateLabel(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
  return [
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-") + ` ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

type AdRangePreset = "yesterday" | "7d" | "14d" | "30d";

function adRangeForPreset(preset: AdRangePreset) {
  const today = new Date();
  const end = new Date(today);
  end.setDate(today.getDate() - 1);
  const start = new Date(end);
  const days = preset === "yesterday" ? 1 : preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
  start.setDate(end.getDate() - days + 1);
  return { from: adDateInput(start), to: adDateInput(end) };
}

function adPresetForRange(from: string, to: string): AdRangePreset | "custom" {
  for (const preset of ["yesterday", "7d", "14d", "30d"] as const) {
    const range = adRangeForPreset(preset);
    if (range.from === from && range.to === to) return preset;
  }
  return "custom";
}

function adRangeDays(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(1, diff || 1);
}

function shiftAdDateRange(from: string, to: string, direction: -1 | 1) {
  const days = adRangeDays(from, to);
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  start.setDate(start.getDate() + direction * days);
  end.setDate(end.getDate() + direction * days);
  return { from: adDateInput(start), to: adDateInput(end) };
}

function AdsMetricCard({ label, value, note, tone = "orange" }: { label: string; value: string; note?: string; tone?: "orange" | "slate" | "rose" }) {
  const nextTone = tone === "rose" ? "danger" : tone === "orange" ? "orange" : "default";
  return <KpiCard label={label} value={value} note={note} tone={nextTone} className="h-full min-h-[88px]" />;
}

function AdsChannelStatus({ rows, selectedChannels }: { rows: AdsMetricRow[]; selectedChannels: string[] }) {
  const selected = new Set(selectedChannels);
  const orderedRows = adReportChannelOrder
    .filter((channel) => selected.has(channel))
    .map((channel) => {
      const row = rows.find((item) => String(item.channel || "") === channel) || { channel };
      return {
        channel,
        label: adReportChannelNames[channel] || channel,
        cost: adNumber(row.cost),
        roas: adNumber(row.roas),
      };
    });
  const maxRoas = Math.max(...orderedRows.map((row) => row.roas), 1);
  const barOpacityByRank = ["1", "0.78", "0.62", "0.46", "0.3"];
  const barOpacityByChannel = new Map(
    [...orderedRows]
      .sort((a, b) => b.roas - a.roas)
      .map((row, index) => [row.channel, barOpacityByRank[index] || "0.3"]),
  );
  return (
    <Card className="p-4">
      <SectionHeader title="채널별 현황" className="mb-3" />
      <div className="mt-3 space-y-2.5">
        {orderedRows.map((row, index) => (
          <div key={`ad-channel-status-${row.channel}`} className="space-y-1.5">
            <div className="grid grid-cols-[minmax(82px,1fr)_auto_auto] items-center gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 font-black text-slate-700">
                <AdChannelLogo channel={row.channel} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 font-black text-[#ff6a00]">{adPercent(row.roas)}</span>
              <span className="shrink-0 font-black text-gray-950">{krw(row.cost)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-[#ff6a00]" style={{ width: `${Math.min(100, (row.roas / maxRoas) * 100)}%`, opacity: barOpacityByChannel.get(row.channel) || "0.3" }} />
            </div>
          </div>
        ))}
        {!orderedRows.length && <EmptyState title="데이터 없음" className="min-h-28" />}
              </div>
    </Card>
  );
}

function adDailyRowsForRange(rows: AdsMetricRow[], from: string, to: string) {
  const byDate = new Map(rows.map((row) => [String(row.date || ""), row]));
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const result: AdsMetricRow[] = [];
  const cursor = new Date(start);
  while (!Number.isNaN(cursor.getTime()) && cursor <= end) {
    const date = adDateInput(cursor);
    result.push(byDate.get(date) || { date, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0, roas: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function adMonthInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addAdMonths(date: Date, amount: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function adChartRange(from: string, to: string) {
  const days = adRangeDays(from, to);
  const end = new Date(`${to}T00:00:00`);
  if (days <= 7) {
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return { from: adDateInput(start), to, mode: "day" as const, title: "최근 7일" };
  }
  if (days <= 30) return { from, to, mode: "day" as const, title: `${days}일` };
  const start = new Date(end.getFullYear(), end.getMonth() - 5, 1);
  return { from: adDateInput(start), to, mode: "month" as const, title: "최근 6개월" };
}

function adMonthlyRowsForRange(rows: AdsMetricRow[], from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const monthly = new Map<string, AdsMetricRow>();
  for (let i = 0; i < 6; i += 1) {
    const month = addAdMonths(start, i);
    const key = adMonthInput(month);
    monthly.set(key, { date: key, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0, roas: 0 });
  }
  rows.forEach((row) => {
    const date = new Date(`${String(row.date || "").slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime()) || date < start || date > end) return;
    const key = adMonthInput(date);
    const target = monthly.get(key) || { date: key, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0, roas: 0 };
    target.cost = adNumber(target.cost) + adNumber(row.cost);
    target.conversion_value = adNumber(target.conversion_value) + adNumber(row.conversion_value);
    target.roas = adNumber(target.cost) > 0 ? (adNumber(target.conversion_value) / adNumber(target.cost)) * 100 : 0;
    monthly.set(key, target);
  });
  return Array.from(monthly.values());
}

function AdsLineChart({ rows, from, to }: { rows: AdsMetricRow[]; from: string; to: string }) {
  const [activePointKey, setActivePointKey] = useState<string | null>(null);
  const range = adChartRange(from, to);
  const points = range.mode === "month" ? adMonthlyRowsForRange(rows, range.from, range.to) : adDailyRowsForRange(rows, range.from, range.to);
  const maxCost = Math.max(...points.map((row) => adNumber(row.cost)), 1);
  const maxRoas = Math.max(...points.map((row) => adNumber(row.roas)), 1);
  const chartPoints = points.map((row, index) => {
    const x = points.length <= 1 ? 50 : 8 + (index / (points.length - 1)) * 84;
    const costY = 92 - (adNumber(row.cost) / maxCost) * 72;
    const roasY = 92 - (adNumber(row.roas) / maxRoas) * 72;
    return { row, x, costY, roasY };
  });
  const costPath = chartPoints.map(({ x, costY }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${costY.toFixed(2)}`).join(" ");
  const roasPath = chartPoints.map(({ x, roasY }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${roasY.toFixed(2)}`).join(" ");
  const labelColumns = Math.min(points.length || 1, range.mode === "month" ? 6 : 10);
  const showPointDateLabels = range.mode === "month" || points.length <= 7;
  const axisTicks = [
    { y: 20, cost: maxCost, roas: maxRoas },
    { y: 56, cost: maxCost / 2, roas: maxRoas / 2 },
    { y: 92, cost: 0, roas: 0 },
  ];

  return (
    <Card className="p-5">
      <SectionHeader
        title="일별 광고비 / ROAS"
        className="mb-3"
        actions={(
        <div className="flex shrink-0 gap-2.5 text-xs font-semibold">
          <span className="text-[#ff6a00]">광고비</span>
          <span className="text-emerald-600">ROAS</span>
          <span className="text-slate-400">{range.title}</span>
        </div>
        )}
      />
      <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3">
        {points.length ? (
          <>
            <div className="relative h-44">
              <div className="pointer-events-none absolute inset-0 z-10">
                {axisTicks.map((tick) => (
                  <div key={`ad-axis-${tick.y}`} className="absolute left-0 right-0 flex -translate-y-1/2 items-center justify-between text-[10px] font-black text-slate-400/70" style={{ top: `${tick.y}%` }}>
                    <span className="rounded bg-slate-50/80 px-1 text-[#ff6a00]/70">{krw(tick.cost)}</span>
                    <span className="rounded bg-slate-50/80 px-1 text-emerald-600/70">{adPercent(tick.roas)}</span>
                  </div>
                ))}
              </div>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img" aria-label="광고비와 ROAS 그래프">
                <path d="M 0 92 L 100 92" stroke="#e2e8f0" strokeWidth="0.8" />
                <path d="M 0 56 L 100 56" stroke="#e2e8f0" strokeWidth="0.5" />
                <path d="M 0 20 L 100 20" stroke="#e2e8f0" strokeWidth="0.5" />
                {points.length > 1 && <path d={costPath} fill="none" stroke="#ff6a00" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
                {points.length > 1 && <path d={roasPath} fill="none" stroke="#16a34a" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeDasharray="2 4" strokeLinecap="round" strokeLinejoin="round" />}
              </svg>
              {chartPoints.map(({ row, x, costY, roasY }, index) => {
                const pointKey = `${String(row.date)}-${index}`;
                const tooltipTop = Math.max(8, Math.min(costY, roasY) - 8);
                const tooltipLeft = Math.min(82, Math.max(18, x));
                const isActive = activePointKey === pointKey;
                return (
                <div key={`ad-hover-point-${String(row.date)}-${index}`} className="group">
                  {[
                    { y: costY, xOffset: -0.55, color: "bg-[#ff6a00]" },
                    { y: roasY, xOffset: 0.55, color: "bg-emerald-600" },
                  ].map((point) => (
                    <button
                      key={`${String(row.date)}-${point.color}`}
                      type="button"
                      aria-label={`${String(row.date)} 광고 지표`}
                      onClick={() => setActivePointKey((current) => current === pointKey ? null : pointKey)}
                      className="absolute z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{ left: `${x + point.xOffset}%`, top: `${point.y}%` }}
                    >
                      <span className={`absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${point.color} ring-2 ring-white`} />
                    </button>
                  ))}
                  <div
                    className={`pointer-events-none absolute z-30 w-40 -translate-x-1/2 rounded-md border border-slate-200 bg-white p-3 text-sm font-black text-slate-800 shadow-xl ${isActive ? "block" : "hidden group-hover:block"}`}
                    style={{ left: `${tooltipLeft}%`, top: `${tooltipTop}%` }}
                  >
                    <p className="whitespace-nowrap text-slate-500">{String(row.date)}</p>
                    <p className="mt-2 flex justify-between gap-3 whitespace-nowrap"><span>ROAS</span><span>{adPercent(adNumber(row.roas))}</span></p>
                    <p className="mt-1 flex justify-between gap-3 whitespace-nowrap"><span>사용금액</span><span>{krw(adNumber(row.cost))}</span></p>
                  </div>
                </div>
                );
              })}
            </div>
            {showPointDateLabels && (
              <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${labelColumns}, minmax(0, 1fr))` }}>
                {points.map((row, index) => (
                  <div key={`ad-chart-label-${String(row.date)}-${index}`} className="min-w-0 px-1 py-0.5 text-center text-xs">
                    <p className="truncate font-black text-slate-600">{range.mode === "month" ? String(row.date || "-") : String(row.date || "-").slice(5)}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <EmptyState title="광고 파일을 올리면 그래프가 표시됩니다." className="min-h-40 border-0 bg-gray-50" />
        )}
      </div>
    </Card>
  );
}

function AdsWorkflowSummary() {
  const items = [
    { title: "1. 파일 생성", body: "5개 리포트를 한 번에 업로드" },
    { title: "2. 채널 분류", body: "순서와 파일명으로 자동 반영" },
    { title: "3. 성과 확인", body: "광고비, ROAS, CTR, CVR" },
    { title: "4. 상품 연결", body: "SKU, 매출, 재고, 순이익" },
    { title: "5. 실행 판단", body: "증액, 개선, 중단 추천" },
  ];
  return (
    <section className="grid gap-2 md:grid-cols-5">
      {items.map((item) => (
        <div key={item.title} className="rounded-md border border-slate-200 bg-white px-3 py-3 shadow-sm">
          <p className="text-xs font-black text-orange-600">{item.title}</p>
          <p className="mt-1 text-xs font-bold text-slate-600">{item.body}</p>
        </div>
      ))}
    </section>
  );
}

const adReportChannelOrder = ["메타GFA", "네이버GFA", "네이버쇼핑검색", "네이버Advoost", "쿠팡"];
const adReportChannelNames: Record<string, string> = {
  메타GFA: "메타 GFA",
  네이버GFA: "네이버 GFA",
  네이버쇼핑검색: "네이버 검색",
  네이버Advoost: "네이버 AdV",
  쿠팡: "쿠팡",
};

function AdChannelLogo({ channel }: { channel: string }) {
  if (channel === "total") {
    return <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[9px] font-black text-white">Σ</span>;
  }
  if (channel.includes("메타")) {
    return <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0866ff] text-[9px] font-black text-white">M</span>;
  }
  if (channel.includes("네이버")) {
    return <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-[#03c75a] text-[9px] font-black text-white">N</span>;
  }
  if (channel.includes("쿠팡")) {
    return <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#e52528] text-[9px] font-black text-white">C</span>;
  }
  return <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[9px] font-black text-slate-700">A</span>;
}

function adMetricReportRows(channels: AdsMetricRow[], selectedChannels: string[]) {
  const selected = new Set(selectedChannels);
  const channelRows = adReportChannelOrder
    .filter((channel) => selected.has(channel))
    .map((channel) => {
      const row = channels.find((item) => String(item.channel || "") === channel) || { channel };
      const cost = adNumber(row.cost);
      const purchaseValue = adNumber(row.conversion_value);
      const purchases = adNumber(row.conversions);
      const impressions = adNumber(row.impressions);
      const clicks = adNumber(row.clicks);
      return {
        channel,
        label: adReportChannelNames[channel] || channel,
        cost,
        purchaseValue,
        roas: cost > 0 ? (purchaseValue / cost) * 100 : 0,
        purchases,
        costPerPurchase: purchases > 0 ? cost / purchases : 0,
        impressions,
        clicks,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpm: impressions > 0 ? (cost / impressions) * 1000 : 0,
        cpc: clicks > 0 ? cost / clicks : 0,
        purchaseCvr: clicks > 0 ? (purchases / clicks) * 100 : 0,
      };
    });
  const total = channelRows.reduce((acc, row) => ({
    channel: "total",
    label: "합계 평균",
    cost: acc.cost + row.cost,
    purchaseValue: acc.purchaseValue + row.purchaseValue,
    purchases: acc.purchases + row.purchases,
    impressions: acc.impressions + row.impressions,
    clicks: acc.clicks + row.clicks,
    roas: 0,
    costPerPurchase: 0,
    ctr: 0,
    cpm: 0,
    cpc: 0,
    purchaseCvr: 0,
  }), { channel: "total", label: "합계 평균", cost: 0, purchaseValue: 0, purchases: 0, impressions: 0, clicks: 0, roas: 0, costPerPurchase: 0, ctr: 0, cpm: 0, cpc: 0, purchaseCvr: 0 });
  total.roas = total.cost > 0 ? (total.purchaseValue / total.cost) * 100 : 0;
  total.costPerPurchase = total.purchases > 0 ? total.cost / total.purchases : 0;
  total.ctr = total.impressions > 0 ? (total.clicks / total.impressions) * 100 : 0;
  total.cpm = total.impressions > 0 ? (total.cost / total.impressions) * 1000 : 0;
  total.cpc = total.clicks > 0 ? total.cost / total.clicks : 0;
  total.purchaseCvr = total.clicks > 0 ? (total.purchases / total.clicks) * 100 : 0;
  return [total, ...channelRows];
}

function AdsReportTable({ rows }: { rows: ReturnType<typeof adMetricReportRows> }) {
  const header = [
    ["총비용", true],
    ["전환매출", true],
    ["ROAS", true],
    ["전환\n건수", true],
    ["CVR", true],
    ["CPA", true],
    ["CTR", true],
    ["노출", false],
    ["클릭", false],
    ["CPC", false],
    ["CPM", false],
  ] as const;
  const channelRows = rows.filter((row) => row.channel !== "total");
  const cpaValues = channelRows.filter((row) => row.purchases > 0 && row.costPerPurchase > 0).map((row) => row.costPerPurchase);
  const ctrValues = channelRows.map((row) => row.ctr);
  const purchaseCvrValues = channelRows.map((row) => row.purchaseCvr);
  const minCpa = cpaValues.length ? Math.min(...cpaValues) : null;
  const maxCpa = cpaValues.length ? Math.max(...cpaValues) : null;
  const minCtr = ctrValues.length ? Math.min(...ctrValues) : null;
  const maxCtr = ctrValues.length ? Math.max(...ctrValues) : null;
  const minPurchaseCvr = purchaseCvrValues.length ? Math.min(...purchaseCvrValues) : null;
  const maxPurchaseCvr = purchaseCvrValues.length ? Math.max(...purchaseCvrValues) : null;
  const isSameMetric = (a: number, b: number | null) => b !== null && Math.abs(a - b) < 0.0001;
  const roasCellClass = (roas: number) => {
    if (roas >= 450) return "bg-emerald-50 text-emerald-800";
    if (roas >= 300) return "bg-yellow-100 text-yellow-900";
    return "bg-rose-50 text-rose-700";
  };
  const cpaCellClass = (row: (typeof rows)[number]) => {
    if (row.channel === "total" || !row.purchases || row.costPerPurchase <= 0 || minCpa === maxCpa) return "";
    if (isSameMetric(row.costPerPurchase, minCpa)) return "bg-emerald-50 text-emerald-800";
    if (isSameMetric(row.costPerPurchase, maxCpa)) return "bg-rose-50 text-rose-700";
    return "";
  };
  const highLowCellClass = (value: number, min: number | null, max: number | null, isTotal: boolean) => {
    if (isTotal || min === null || max === null || min === max) return "";
    if (isSameMetric(value, max)) return "bg-emerald-50 text-emerald-800";
    if (isSameMetric(value, min)) return "bg-rose-50 text-rose-700";
    return "";
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 pb-1">
      <table className="w-full min-w-[1080px] table-fixed border-collapse text-center text-[13px] tabular-nums">
        <colgroup>
          <col className="w-[12%]" />
          <col className="w-[9.3%]" />
          <col className="w-[10.2%]" />
          <col className="w-[8.4%]" />
          <col className="w-[7.5%]" />
          <col className="w-[7.7%]" />
          <col className="w-[9.2%]" />
          <col className="w-[7.5%]" />
          <col className="w-[8.2%]" />
          <col className="w-[7.3%]" />
          <col className="w-[6.6%]" />
          <col className="w-[6.1%]" />
        </colgroup>
        <thead>
          <tr>
            <th className="border-b border-r border-gray-200 bg-gray-50 px-2.5 py-2 text-left font-semibold text-gray-700">광고</th>
            {header.map(([label, main]) => (
              <th key={label} className={`whitespace-pre-line break-keep border-b border-r border-gray-200 px-2 py-2 font-semibold leading-tight text-gray-800 ${main ? "bg-[#fff7ed] text-orange-800" : "bg-gray-50"}`}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.channel} className={row.channel === "total" ? "bg-orange-50 text-[12px] font-bold" : "bg-white hover:bg-[#fff7ed]"}>
              <td className="border-b border-r border-gray-100 bg-inherit px-2 py-2 text-left font-black">
                <span className="flex min-w-0 items-center gap-1.5">
                  <AdChannelLogo channel={row.channel} />
                  <span className="truncate">{row.label}</span>
                </span>
              </td>
              <td className="border-b border-r border-gray-100 px-2 py-2">{krw(row.cost)}</td>
              <td className="border-b border-r border-gray-100 px-2 py-2">{krw(row.purchaseValue)}</td>
              <td className={`border-b border-r border-gray-100 px-2 py-2 text-[13.5px] font-black ${roasCellClass(row.roas)}`}>{adPercent(row.roas)}</td>
              <td className="border-b border-r border-gray-100 px-2 py-2">{row.purchases.toLocaleString("ko-KR")}</td>
              <td className={`border-b border-r border-gray-100 px-2 py-2 font-bold ${highLowCellClass(row.purchaseCvr, minPurchaseCvr, maxPurchaseCvr, row.channel === "total")}`}>{adPercent2(row.purchaseCvr)}</td>
              <td className={`border-b border-r border-gray-100 px-2 py-2 font-bold ${cpaCellClass(row)}`}>{krw(row.costPerPurchase)}</td>
              <td className={`border-b border-r border-gray-100 px-2 py-2 font-bold ${highLowCellClass(row.ctr, minCtr, maxCtr, row.channel === "total")}`}>{adPercent2(row.ctr)}</td>
              <td className="border-b border-r border-gray-100 px-2 py-2">{row.impressions.toLocaleString("ko-KR")}</td>
              <td className="border-b border-r border-gray-100 px-2 py-2">{row.clicks.toLocaleString("ko-KR")}</td>
              <td className="border-b border-r border-gray-100 px-2 py-2">{krw(row.cpc)}</td>
              <td className="border-b border-r border-gray-100 px-2 py-2">{krw(row.cpm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 pl-4 text-xs font-bold leading-relaxed text-slate-500">
        ※ 약자: ROAS=광고 수익률, CPA=전환 구매당 광고비, CTR=클릭률, CPM=1000회당 노출비용, CPC=클릭당 비용, CVR=전환 구매율
      </p>
    </div>
  );
}

function AdsAnalysisWorkspace() {
  const searchParams = useSearchParams();
  const defaultRange = adRangeForPreset("yesterday");
  const dateFrom = searchParams.get("adsFrom") || defaultRange.from;
  const dateTo = searchParams.get("adsTo") || defaultRange.to;
  const [summary, setSummary] = useState<AdsSummary | null>(null);
  const [chartSummary, setChartSummary] = useState<AdsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAdChannels, setSelectedAdChannels] = useState<string[]>(adReportChannelOrder);

  const loadSummary = () => {
    setLoading(true);
    const selectedRange = { from: dateFrom, to: dateTo };
    const graphRange = adChartRange(dateFrom, dateTo);
    const selectedSummary = cachedAdsSummary(selectedRange);
    const graphSummary = graphRange.from === selectedRange.from && graphRange.to === selectedRange.to
      ? selectedSummary
      : cachedAdsSummary(graphRange);
    Promise.all([
      selectedSummary,
      graphSummary,
    ])
      .then(([data, graphData]) => {
        setSummary(data);
        setChartSummary(graphData);
      })
      .catch((error) => {
        const fallback = { ok: false, error: error instanceof Error ? error.message : "광고 분석 조회 실패" };
        setSummary(fallback);
        setChartSummary(fallback);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(loadSummary, 0);
    return () => window.clearTimeout(timer);
  }, [dateFrom, dateTo]);

  async function exportAdReportXlsx() {
    const xlsx = await loadXlsxModule();
    const headers = ["광고", "총비용", "전환매출", "ROAS", "전환\n건수", "CVR", "CPA", "CTR", "노출", "클릭", "CPC", "CPM"];
    const rows = reportRows.map((row) => [
      row.label,
      Math.round(row.cost),
      Math.round(row.purchaseValue),
      `${row.roas.toFixed(1)}%`,
      Math.round(row.purchases),
      `${row.purchaseCvr.toFixed(2)}%`,
      Math.round(row.costPerPurchase),
      `${row.ctr.toFixed(2)}%`,
      Math.round(row.impressions),
      Math.round(row.clicks),
      Math.round(row.cpc),
      Math.round(row.cpm),
    ]);
    const note = "※ 약자: ROAS=광고 수익률, CPA=전환 구매당 광고비, CTR=클릭률, CPM=1000회당 노출비용, CPC=클릭당 비용, CVR=전환 구매율";
    const worksheet = xlsx.utils.aoa_to_sheet([headers, ...rows, [], [note]]);
    const range = worksheet["!ref"] ? xlsx.utils.decode_range(worksheet["!ref"]) : null;
    const moneyCols = new Set([1, 2, 6, 10, 11]);
    const yellowCols = new Set([1, 2, 3, 4, 5, 6, 7]);
    const headerStyle = { font: { name: "Pretendard", sz: 11, bold: true }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, fill: { fgColor: { rgb: "FEF08A" } }, border: { bottom: { style: "thin", color: { rgb: "D1D5DB" } }, right: { style: "thin", color: { rgb: "E5E7EB" } } } };
    const normalHeaderStyle = { ...headerStyle, fill: { fgColor: { rgb: "F9FAFB" } } };
    const totalFill = "FFF7ED";
    if (range) {
      for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
        for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
          const address = xlsx.utils.encode_cell({ r: rowIndex, c: colIndex });
          const cell = worksheet[address] as (CellObject & { s?: Record<string, unknown>; z?: string }) | undefined;
          if (!cell) continue;
          if (rowIndex === 0) {
            cell.s = yellowCols.has(colIndex) ? headerStyle : normalHeaderStyle;
            continue;
          }
          if (rowIndex === rows.length + 2) {
            cell.s = { font: { name: "Pretendard", sz: 10, bold: true, color: { rgb: "64748B" } } };
            continue;
          }
          const sourceRow = reportRows[rowIndex - 1];
          const roas = sourceRow?.roas || 0;
          const fill = rowIndex === 1 ? totalFill : colIndex === 3 ? roas <= 300 ? "FEE2E2" : roas < 450 ? "FEF9C3" : "DCFCE7" : undefined;
          cell.s = {
            font: { name: "Pretendard", sz: 11, bold: rowIndex === 1 || colIndex === 3 },
            alignment: { horizontal: colIndex === 0 ? "left" : "center", vertical: "center" },
            fill: fill ? { fgColor: { rgb: fill } } : undefined,
            border: { bottom: { style: "thin", color: { rgb: "E5E7EB" } }, right: { style: "thin", color: { rgb: "E5E7EB" } } },
          };
          if (typeof cell.v === "number" && moneyCols.has(colIndex)) cell.z = "₩#,##0";
          if (typeof cell.v === "number" && [4, 8, 9].includes(colIndex)) cell.z = "#,##0";
        }
      }
    }
    worksheet["!cols"] = [
      { wch: 16 },
      { wch: 12 },
      { wch: 13 },
      { wch: 10 },
      { wch: 8 },
      { wch: 8 },
      { wch: 11 },
      { wch: 8 },
      { wch: 10 },
      { wch: 8 },
      { wch: 9 },
      { wch: 9 },
    ];
    worksheet["!rows"] = [{ hpt: 34 }, ...rows.map(() => ({ hpt: 25 }))];
    if (worksheet["!merges"]) worksheet["!merges"].push({ s: { r: rows.length + 2, c: 0 }, e: { r: rows.length + 2, c: 11 } });
    else worksheet["!merges"] = [{ s: { r: rows.length + 2, c: 0 }, e: { r: rows.length + 2, c: 11 } }];
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "광고리포트");
    const output = xlsx.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
    downloadBlob(`fnos-ad-report-${dateFrom}_${dateTo}.xlsx`, new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  const channels = summary?.channels || [];
  const daily = chartSummary?.daily || summary?.daily || [];
  const reportRows = adMetricReportRows(channels, selectedAdChannels);
  const mainReport = reportRows[0] || adMetricReportRows([], [])[0];
  const rangeNote = dateFrom === dateTo ? `${dateTo} 기준` : `${dateFrom} ~ ${dateTo}`;

  return (
    <div className="space-y-6">
      <PageHeader title="광고분석" className="mb-0" />

      {summary?.ok === false && <Card className="border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{summary.error}</Card>}

      <section className="grid items-stretch gap-2 md:grid-cols-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1fr)]">
        <AdsMetricCard label="총비용" value={krw(mainReport.cost)} note={rangeNote} />
        <AdsMetricCard label="구매완료 전환매출액" value={krw(mainReport.purchaseValue)} note={`ROAS ${adPercent(mainReport.roas)}`} />
        <AdsMetricCard label="ROAS" value={adPercent(mainReport.roas)} note="광고 수익률" />
        <AdsMetricCard label="전환 구매 건수" value={`${mainReport.purchases.toLocaleString("ko-KR")}건`} note="구매완료 기준" />
        <AdsMetricCard label="구매완료 전환율" value={adPercent2(mainReport.purchaseCvr)} note="구매/클릭" tone="rose" />
      </section>

      <Card className="px-3 py-4">
        <SectionHeader
          title="광고 리포트"
          actions={(
          <div className="flex flex-wrap items-center gap-2">
            {adReportChannelOrder.map((channel) => (
              <label key={channel} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-600 transition hover:border-orange-200 hover:bg-orange-50">
                <input
                  className="accent-[#ff6a00]"
                  type="checkbox"
                  checked={selectedAdChannels.includes(channel)}
                  onChange={(event) => setSelectedAdChannels((prev) => event.target.checked ? [...prev, channel] : prev.filter((item) => item !== channel))}
                />
                {adReportChannelNames[channel]}
              </label>
            ))}
            <ActionButton type="button" onClick={() => void exportAdReportXlsx()} className="h-8 px-3 text-xs">엑셀 다운로드</ActionButton>
          </div>
          )}
          className="mb-3"
        />
        <div className="mt-4">
          <AdsReportTable rows={reportRows} />
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_1.05fr]">
        <AdsLineChart rows={daily} from={dateFrom} to={dateTo} />
        <AdsChannelStatus rows={channels} selectedChannels={selectedAdChannels} />
      </section>
    </div>
  );
}

function AdsRightPanel() {
  const searchParams = useSearchParams();
  const defaultRange = adRangeForPreset("yesterday");
  const initialFrom = searchParams.get("adsFrom") || defaultRange.from;
  const initialTo = searchParams.get("adsTo") || defaultRange.to;
  const [summaries, setSummaries] = useState<Record<string, AdsSummary>>({});
  const [uploadedAdFiles, setUploadedAdFiles] = useState<UploadedAdFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isAdDragOver, setIsAdDragOver] = useState(false);
  const [message, setMessage] = useState("");
  const [lastUploadReport, setLastUploadReport] = useState<AdUploadReport | null>(null);
  const [rangePreset, setRangePreset] = useState<AdRangePreset | "custom">(adPresetForRange(initialFrom, initialTo));
  const [dateFrom, setDateFrom] = useState(initialFrom);
  const [dateTo, setDateTo] = useState(initialTo);
  const [uploadReportDate, setUploadReportDate] = useState(initialFrom === initialTo ? initialFrom : defaultRange.from);
  const [replaceConfirm, setReplaceConfirm] = useState<{ message: string } | null>(null);

  function openAdRange(from: string, to: string) {
    const params = new URLSearchParams({ menu: "ads", adsFrom: from, adsTo: to });
    goToInternal(`/?${params.toString()}`);
  }

  function applyRangePreset(preset: AdRangePreset) {
    const range = adRangeForPreset(preset);
    setRangePreset(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
    openAdRange(range.from, range.to);
  }

  function moveRange(direction: -1 | 1) {
    const next = shiftAdDateRange(dateFrom, dateTo, direction);
    setRangePreset("custom");
    setDateFrom(next.from);
    setDateTo(next.to);
    openAdRange(next.from, next.to);
  }

  function pickAdFiles(files: FileList | File[] | null, forcedSource?: AdSourceKey) {
    const next = Array.from(files || []).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name));
    if (!next.length) {
      setMessage("엑셀 또는 CSV 광고 파일을 선택해 주세요.");
      return;
    }
    const incoming = next.map((file, index) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceKey: adSourceForFile(file, index, next.length, forcedSource),
      file,
    }));
    const existing = new Set(uploadedAdFiles.map(uploadedAdFileKey));
    const fresh = incoming.filter((item) => !existing.has(uploadedAdFileKey(item)));
    if (!fresh.length) {
      setMessage("이미 대기 목록에 있는 파일입니다.");
      return;
    }
    setUploadedAdFiles((prev) => [...prev, ...fresh]);
    setLastUploadReport(null);
    setMessage(`${fresh.length}개 파일 대기 중. 데이터 생성을 누르면 저장됩니다.`);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>, sourceKey?: AdSourceKey) {
    pickAdFiles(event.target.files, sourceKey);
    event.target.value = "";
  }

  function onAdDragEnter(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsAdDragOver(true);
  }

  function onAdDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsAdDragOver(true);
  }

  function onAdDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsAdDragOver(false);
  }

  function onAdDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsAdDragOver(false);
    pickAdFiles(event.dataTransfer.files);
  }

  function removeAdFile(target: UploadedAdFile) {
    const key = uploadedAdFileKey(target);
    setUploadedAdFiles((prev) => prev.filter((item) => uploadedAdFileKey(item) !== key));
  }

  async function uploadRows(forceReplace = false) {
    if (!uploadedAdFiles.length) {
      setMessage("먼저 광고 파일을 올려 주세요.");
      return;
    }
    setUploading(true);
    setMessage("");
    const form = new FormData();
    uploadedAdFiles.forEach((item) => {
      form.append("files", item.file);
      form.append("file_channels", adSourceLabels[item.sourceKey]);
    });
    form.append("report_date", uploadReportDate);
    if (forceReplace) form.append("force", "true");
    const res = await fetch("/api/fnos/ads/upload", { method: "POST", body: form });
    const data = await res.json();
    setUploading(false);
    setLastUploadReport(data);
    if (data.needs_confirmation) {
      setReplaceConfirm({ message: data.message || "해당일에 입력된 자료가 있습니다." });
      return;
    }
    setMessage(data.message || data.error || "업로드 처리 완료");
    if (res.ok) {
      invalidateClientCache("/api/fnos/ads/summary");
      setUploadedAdFiles([]);
      openAdRange(uploadReportDate, uploadReportDate);
    }
  }

  useEffect(() => {
    setDateFrom(initialFrom);
    setDateTo(initialTo);
    if (initialFrom === initialTo) setUploadReportDate(initialFrom);
    setRangePreset(adPresetForRange(initialFrom, initialTo));
  }, [initialFrom, initialTo]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      ["어제", adRangeForPreset("yesterday")],
      ["최근 7일", adRangeForPreset("7d")],
      ["최근 30일", adRangeForPreset("30d")],
    ].map(([label, range]) => {
      return cachedAdsSummary(range as AdsSummaryRange)
        .then((data) => [label, data] as const);
    }))
      .then((entries) => {
        if (alive) setSummaries(Object.fromEntries(entries));
      })
      .catch((error) => {
        if (alive) setSummaries({ "최근 30일": { ok: false, error: error instanceof Error ? error.message : "광고 요약 조회 실패" } });
      });
    return () => {
      alive = false;
    };
  }, []);

  const uploadSource = summaries["어제"] || summaries["최근 7일"] || summaries["최근 30일"] || {};
  const recentBatches = uploadSource.batches || [];

  return (
    <>
      <aside className="hidden w-[320px] shrink-0 border-l border-slate-200 bg-white px-4 py-6 xl:block">
        <ToolSection title="광고 업로드" defaultOpen showChevron={false}>
        <div className="space-y-2">
          <label
            className={`flex min-h-16 cursor-pointer flex-col justify-center rounded-md border border-dashed px-3 py-2 transition ${
              isAdDragOver
                ? "border-orange-500 bg-orange-50 shadow-[0_0_0_3px_rgba(249,115,22,0.16)]"
                : "border-slate-300 bg-slate-50 hover:border-orange-300 hover:bg-orange-50"
            }`}
            onDragEnter={onAdDragEnter}
            onDragOver={onAdDragOver}
            onDragLeave={onAdDragLeave}
            onDrop={onAdDrop}
          >
            <span className="text-sm font-black text-slate-800">파일 업로드</span>
            <span className="mt-1 text-xs font-bold text-slate-500">5개 광고 엑셀/CSV를 한번에 드래그</span>
            <span className={`mt-2 inline-flex h-7 w-fit items-center rounded-md border px-3 text-xs font-black transition ${
              isAdDragOver ? "border-orange-500 bg-orange-500 text-white" : "border-orange-200 bg-white text-orange-600"
            }`}>파일 선택</span>
            <input type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => onFileChange(event)} />
          </label>
          <ActionButton type="button" onClick={() => uploadRows()} disabled={uploading || !uploadedAdFiles.length} className="h-9 w-full">
            {uploading ? "생성 중" : `데이터 생성${uploadedAdFiles.length ? ` (${uploadedAdFiles.length})` : ""}`}
          </ActionButton>
          <label className="block rounded-md border border-slate-200 bg-white px-3 py-2">
            <span className="text-xs font-black text-slate-700">저장 기준일</span>
            <input
              type="date"
              value={uploadReportDate}
              onChange={(event) => setUploadReportDate(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-slate-200 px-2 text-xs font-bold text-slate-700 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            <span className="mt-1 block text-[11px] font-bold text-slate-400">파일 안 날짜가 없으면 이 날짜로 광고 DB에 저장됩니다.</span>
          </label>
          {message && <p className="rounded-md bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700">{message}</p>}
          {!!uploadedAdFiles.length && (
            <div className="max-h-32 space-y-1 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              {uploadedAdFiles.map((item) => (
                <div key={uploadedAdFileKey(item)} className="flex items-center gap-2 rounded bg-white px-2 py-1 text-xs font-bold text-slate-600">
                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-black text-orange-700">
                    <AdChannelLogo channel={adSourceLabels[item.sourceKey]} />
                    {adSourceLabels[item.sourceKey]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{adFileSizeLabel(item.file.size)}</span>
                  <button type="button" onClick={() => removeAdFile(item)} className="shrink-0 font-black text-rose-500" aria-label={`${item.file.name} 제외`}>x</button>
                </div>
              ))}
            </div>
          )}
          {!!uploadedAdFiles.length && (
            <div className="rounded-md border border-orange-100 bg-orange-50/70 p-2 text-xs font-bold text-slate-600">
              <p className="font-black text-orange-700">저장 전 매칭 미리보기</p>
              <p className="mt-0.5 text-[11px] text-slate-500">저장 기준일 {uploadReportDate}</p>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {adSourceOrder.map((sourceKey) => {
                  const count = uploadedAdFiles.filter((item) => item.sourceKey === sourceKey).length;
                  return (
                    <span key={sourceKey} className={count ? "text-slate-800" : "text-slate-400"}>
                      {adSourceLabels[sourceKey]} {count}개
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {lastUploadReport && (
            <div className="rounded-md border border-slate-200 bg-white p-2 text-xs font-bold text-slate-600">
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-slate-800">업로드 검증 리포트</span>
                <span className={adNumber(lastUploadReport.fail_count) ? "text-rose-600" : "text-emerald-600"}>{adUploadResultLabel(lastUploadReport)}</span>
              </div>
              {!!adNumber(lastUploadReport.fail_count) && (
                <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-rose-600">제외 주요 사유: 빈 행, 합계 행, 광고 지표가 없는 행을 우선 확인하세요.</p>
              )}
              <div className="mt-2 space-y-1">
                {(lastUploadReport.results || []).slice(0, 5).map((row, index) => (
                  <div key={`${row.channel || index}-${index}`} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1">
                    <span className="truncate">{row.channel || "-"}</span>
                    <span className="shrink-0">저장 {adNumber(row.success_count).toLocaleString("ko-KR")} / 제외 {adNumber(row.fail_count).toLocaleString("ko-KR")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </ToolSection>
        <ToolSection title="기간 선택" defaultOpen showChevron={false}>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => moveRange(-1)} className="h-9 w-9 rounded-md border border-slate-200 bg-white text-sm font-black text-slate-600 hover:bg-orange-50 hover:text-orange-600" aria-label="이전 기간">‹</button>
            <p className="min-w-0 flex-1 text-center text-xs font-black text-slate-600">{dateFrom === dateTo ? compactDateLabel(dateTo) : `${compactDateLabel(dateFrom)} ~ ${compactDateLabel(dateTo)}`}</p>
            <button type="button" onClick={() => moveRange(1)} className="h-9 w-9 rounded-md border border-slate-200 bg-white text-sm font-black text-slate-600 hover:bg-orange-50 hover:text-orange-600" aria-label="다음 기간">›</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["yesterday", "어제"],
              ["7d", "최근 7일"],
              ["14d", "최근 2주"],
              ["30d", "최근 30일"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyRangePreset(key as AdRangePreset)}
                className={`h-8 rounded-md px-2 text-xs font-black transition ${rangePreset === key ? "bg-orange-50 text-orange-600 ring-1 ring-orange-200" : "bg-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
            <label className="relative block min-w-0">
              <span className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-xs font-black tracking-tight text-slate-800">
                {compactDateLabel(dateFrom)}
              </span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setRangePreset("custom");
                  setDateFrom(event.target.value);
                }}
                className="field-input h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white pl-2 pr-7 text-xs font-black tracking-tight text-transparent caret-transparent [color-scheme:light] [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-datetime-edit]:opacity-0"
              />
            </label>
            <span className="text-xs font-black text-slate-400">~</span>
            <label className="relative block min-w-0">
              <span className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-xs font-black tracking-tight text-slate-800">
                {compactDateLabel(dateTo)}
              </span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setRangePreset("custom");
                  setDateTo(event.target.value);
                }}
                className="field-input h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white pl-2 pr-7 text-xs font-black tracking-tight text-transparent caret-transparent [color-scheme:light] [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-datetime-edit]:opacity-0"
              />
            </label>
          </div>
          <ActionButton type="button" onClick={() => openAdRange(dateFrom, dateTo)} className="h-9 w-full text-xs">조회</ActionButton>
        </div>
        </ToolSection>
        <ToolSection title="분석 기준" showChevron={false}>
        <div className="space-y-2 text-xs font-bold text-slate-600">
          <p className="rounded-md bg-slate-50 p-3">먼저 ROAS와 광고비 급증을 보고, 그 다음 SKU별 재고/순이익을 확인합니다.</p>
          <p className="rounded-md bg-orange-50 p-3 text-orange-700">ROAS 높음 + 재고 부족은 발주 우선, ROAS 낮음 + 재고 적음은 광고 중단 후보입니다.</p>
        </div>
        </ToolSection>
        <ToolSection title="최근 업로드" showChevron>
        <div className="space-y-2">
          <p className="rounded-md bg-slate-50 p-3 text-xs font-bold text-slate-500">
            실패는 오류가 아니라 저장 대상에서 제외된 행입니다. 빈 행, 합계 행, 또는 광고비/노출/클릭/구매완료 값이 모두 없는 행이 여기에 잡힙니다.
          </p>
          {recentBatches.slice(0, 8).map((row, index) => (
            <div key={String(row.id || index)} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-black text-slate-700">{String(row.channel || "-")}</span>
                <StatusBadge tone={String(row.status || "").includes("SAVED") ? "success" : String(row.status || "").includes("REPLACED") ? "warning" : "muted"}>{String(row.status || "-")}</StatusBadge>
              </div>
              <p className="mt-1 font-bold text-slate-400">업로드 {adUploadDateLabel(row.uploaded_at)}</p>
              <p className="mt-1 truncate font-bold text-slate-500">{String(row.source_file_name || "-")}</p>
              <p className="mt-1 font-bold text-slate-600">성공 {adNumber(row.success_count).toLocaleString("ko-KR")} / 제외 {adNumber(row.fail_count).toLocaleString("ko-KR")}</p>
            </div>
          ))}
          {!recentBatches.length && <EmptyState title="업로드 내역 없음" className="min-h-24 py-5" />}
        </div>
        </ToolSection>
      </aside>
      {replaceConfirm && (
        <FormModal
          title="광고 DB 대체 저장"
          description="동일 날짜 광고 자료가 이미 저장되어 있습니다."
          onClose={() => setReplaceConfirm(null)}
          size="sm"
          footer={(
            <>
              <ActionButton type="button" variant="secondary" onClick={() => setReplaceConfirm(null)}>
                취소
              </ActionButton>
              <ActionButton
                type="button"
                onClick={() => {
                  setReplaceConfirm(null);
                  void uploadRows(true);
                }}
              >
                대체 저장
              </ActionButton>
            </>
          )}
        >
          <div className="space-y-3 text-sm font-semibold leading-6 text-gray-700">
            <p className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-orange-700">{replaceConfirm.message}</p>
            <p>기존 광고 DB 자료를 현재 업로드한 파일 기준으로 대체 저장할까요?</p>
          </div>
        </FormModal>
      )}
    </>
  );
}

type DashboardSummary = {
  ok?: boolean;
  error?: string;
  today_sales?: number;
  month_sales?: number;
  today_order_count?: number;
  waiting_shipment_count?: number;
  missing_tracking_count?: number;
  unmapped_product_count?: number;
  risk_sku?: number;
  ad_spend?: number;
  expense_amount?: number;
  estimated_profit?: number;
  margin_rate?: number;
  month_purchases?: number;
  purchase_due_count?: number;
  unpaid_customer_count?: number;
  recent_sales?: Array<Record<string, unknown>>;
  recent_purchases?: Array<Record<string, unknown>>;
  recent_import_orders?: Array<Record<string, unknown>>;
  recent_ads?: Array<Record<string, unknown>>;
  recent_archives?: Array<Record<string, unknown>>;
  inventory?: Array<Record<string, unknown>>;
};

function asNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function DashboardMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <article className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-black text-slate-950">{value}</p>
      {note && <p className="mt-2 text-sm font-bold text-orange-600">{note}</p>}
    </article>
  );
}

function DashboardList({ title, rows, primaryKey, amountKey }: { title: string; rows: Array<Record<string, unknown>>; primaryKey: string; amountKey?: string }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-black">{title}</h2>
      <div className="mt-4 space-y-2">
        {rows.slice(0, 6).map((row, index) => (
          <div key={`${title}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span className="truncate font-bold text-slate-700">{String(row[primaryKey] || row.product_name || row.prod_name || row.title || "-")}</span>
            <span className="font-black text-slate-900">{amountKey ? krw(asNumber(row[amountKey])) : String(row.status || row.sale_status || row.sync_status || "-")}</span>
          </div>
        ))}
        {!rows.length && <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-400">데이터 없음</p>}
      </div>
    </section>
  );
}

function ExcelFormIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
      <rect x="4" y="3" width="20" height="26" rx="3" fill="#16a34a" />
      <path d="M19 3v7h7" fill="#bbf7d0" />
      <path d="M19 3v7h7" stroke="#15803d" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="9" y="12" width="14" height="12" rx="1.5" fill="#dcfce7" opacity=".95" />
      <path d="M12 15h8M12 18h8M12 21h8M15 13v11" stroke="#16a34a" strokeWidth="1" />
      <path d="m10.4 15.2 3.1 3.8-3.1 3.8m6.5-7.6-3.1 3.8 3.1 3.8" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AccountingMetric({ label, value, note, tone = "slate" }: { label: string; value: string; note?: string; tone?: "slate" | "orange" | "green" | "rose" }) {
  return <KpiCard label={label} value={value} note={note} tone={tone === "green" ? "success" : tone === "rose" ? "danger" : tone === "orange" ? "orange" : "default"} />;
}

function AccountingLineChart({ rows, compact = false }: { rows: Array<Record<string, unknown>>; compact?: boolean }) {
  const chartRows = rows.slice(0, 8).reverse();
  const max = Math.max(1, ...chartRows.map((row) => asNumber(row.amount)));
  const points = chartRows.length
    ? chartRows.map((row, index) => {
        const x = chartRows.length === 1 ? 50 : (index / (chartRows.length - 1)) * 100;
        const y = 92 - (asNumber(row.amount) / max) * 76;
        return `${x},${y}`;
      }).join(" ")
    : "";
  return (
    <Card className={compact ? "border-0 p-0 shadow-none" : "p-5"}>
      {!compact && <SectionHeader title="월별 비용 추이" />}
      <div className="rounded-xl bg-gray-50 p-3">
        <svg viewBox="0 0 100 100" className="h-44 w-full overflow-visible" role="img" aria-label="월별 비용 추이 그래프">
          <line x1="0" y1="92" x2="100" y2="92" stroke="#cbd5e1" strokeWidth="1" />
          {points && <polyline points={points} fill="none" stroke="#f97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
          {chartRows.map((row, index) => {
            const x = chartRows.length === 1 ? 50 : (index / (chartRows.length - 1)) * 100;
            const y = 92 - (asNumber(row.amount) / max) * 76;
            return <circle key={`${String(row.label)}-${index}`} cx={x} cy={y} r="2.8" fill="#f97316" />;
          })}
        </svg>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {chartRows.slice(-4).map((row, index) => (
            <div key={`${String(row.label)}-${index}`} className="rounded bg-white px-2 py-2 text-xs">
              <p className="font-black text-slate-500">{String(row.label || "-")}</p>
              <p className="mt-1 font-black text-slate-950">{krw(asNumber(row.amount))}</p>
            </div>
          ))}
          {!chartRows.length && <div className="col-span-full"><EmptyState title="데이터 없음" className="min-h-24 border-0 bg-white" /></div>}
        </div>
      </div>
    </Card>
  );
}

function AccountingCategoryChart({ rows, compact = false }: { rows: Array<Record<string, unknown>>; compact?: boolean }) {
  const chartRows = rows.slice(0, 6);
  const total = Math.max(1, chartRows.reduce((sum, row) => sum + asNumber(row.amount), 0));
  const colors = ["#f97316", "#0ea5e9", "#10b981", "#f43f5e", "#64748b", "#a855f7"];
  let offset = 0;
  return (
    <Card className={compact ? "border-0 p-0 shadow-none" : "p-5"}>
      {!compact && <SectionHeader title="카테고리 비중" />}
      <div className="grid gap-4 rounded-xl bg-gray-50 p-3 md:grid-cols-[160px_1fr]">
        <svg viewBox="0 0 42 42" className="h-40 w-40">
          <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#e2e8f0" strokeWidth="6" />
          {chartRows.map((row, index) => {
            const value = (asNumber(row.amount) / total) * 100;
            const dash = `${value} ${100 - value}`;
            const rotate = offset;
            offset += value;
            return (
              <circle
                key={`${String(row.label)}-${index}`}
                cx="21"
                cy="21"
                r="15.915"
                fill="transparent"
                stroke={colors[index % colors.length]}
                strokeWidth="6"
                strokeDasharray={dash}
                strokeDashoffset="25"
                transform={`rotate(${rotate * 3.6} 21 21)`}
              />
            );
          })}
          <text x="21" y="20" textAnchor="middle" className="fill-slate-950 text-[4px] font-black">비용</text>
          <text x="21" y="25" textAnchor="middle" className="fill-orange-600 text-[4px] font-black">{chartRows.length}개</text>
        </svg>
        <div className="space-y-2">
          {chartRows.map((row, index) => {
            const amount = asNumber(row.amount);
            return (
              <div key={`${String(row.label)}-${index}`}>
                <div className="mb-1 flex justify-between gap-3 text-xs font-bold">
                  <span className="truncate text-slate-700"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />{String(row.label || "-")}</span>
                  <span className="text-slate-950">{krw(amount)}</span>
                </div>
                <div className="h-2 rounded bg-white"><div className="h-2 rounded" style={{ width: `${Math.max(4, (amount / total) * 100)}%`, backgroundColor: colors[index % colors.length] }} /></div>
              </div>
            );
          })}
          {!chartRows.length && <EmptyState title="데이터 없음" className="min-h-24 border-0 bg-white" />}
        </div>
      </div>
    </Card>
  );
}

type AccountingSummary = {
  ok?: boolean;
  error?: string;
  categories?: Array<Record<string, unknown>>;
  expenses?: Array<Record<string, unknown>>;
  batches?: Array<Record<string, unknown>>;
  payables?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  import_orders?: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  by_category?: Array<Record<string, unknown>>;
  by_vendor?: Array<Record<string, unknown>>;
  by_month?: Array<Record<string, unknown>>;
};

type ExpenseUploadItem = {
  file: File;
  sourceType: string;
};

const expenseSourceTypes = ["국민카드 1", "국민카드 2", "국민은행", "기업은행", "세금계산서", "물류비", "택배비", "광고비", "수입비용", "기타"];
const accountingTabs = ["작업실", "비용 내역", "손익 그래프", "미납/결제", "수입비용", "분류 규칙"];
const ACCOUNTING_SUMMARY_ENDPOINT = "/api/accounting/summary";
const ACCOUNTING_CACHE_TTL = 5 * 60_000;
const ACCOUNTING_STORAGE_TTL = 10 * 60_000;

function readCachedAccountingSummary() {
  return readCachedJson<AccountingSummary>(ACCOUNTING_SUMMARY_ENDPOINT, { storageTtl: ACCOUNTING_STORAGE_TTL });
}

function fetchCachedAccountingSummary(force = false) {
  return cachedClientJson<AccountingSummary>(ACCOUNTING_SUMMARY_ENDPOINT, {
    ttl: ACCOUNTING_CACHE_TTL,
    storageTtl: ACCOUNTING_STORAGE_TTL,
    force,
  });
}

function invalidateAccountingCache() {
  invalidateClientCache(ACCOUNTING_SUMMARY_ENDPOINT);
}

function AccountingWorkspace() {
  const [activeTab, setActiveTab] = useState(accountingTabs[0]);
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceType, setSourceType] = useState("자동 분류");
  const [uploadedExpenseFiles, setUploadedExpenseFiles] = useState<ExpenseUploadItem[]>([]);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [parsedFiles, setParsedFiles] = useState<Array<Record<string, unknown>>>([]);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [manualExpenseModalOpen, setManualExpenseModalOpen] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [filters, setFilters] = useState({ q: "", category: "", from: "", to: "" });
  const [manual, setManual] = useState({
    expense_date: new Date().toISOString().slice(0, 10),
    vendor_name: "",
    description: "",
    amount: "",
    vat_amount: "",
    total_amount: "",
    payment_method: "",
    category_name: "기타",
    memo: "",
  });

  function loadSummary(force = false) {
    setLoading(true);
    const cached = force ? null : readCachedAccountingSummary();
    if (cached && !force) {
      setSummary(cached);
      setLoading(false);
    }
    fetchCachedAccountingSummary(force)
      .then((data) => setSummary(data))
      .catch((error) => setSummary({ ok: false, error: error instanceof Error ? error.message : "회계/비용 조회 실패" }))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const timer = window.setTimeout(loadSummary, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function expenseFileKey(item: ExpenseUploadItem) {
    return `${item.sourceType}:${item.file.name}:${item.file.size}:${item.file.lastModified}`;
  }

  function inferExpenseSourceType(fileName: string, fallback = sourceType) {
    const name = fileName.toLowerCase();
    if (/국민.*카드|kb.*card|kbcard|국민카드/.test(name)) return "국민카드";
    if (/국민.*은행|kb.*bank|kbbank|국민은행/.test(name)) return "국민은행";
    if (/기업.*은행|ibk|기업은행/.test(name)) return "기업은행";
    if (/세금계산서|전자세금|tax/.test(name)) return "세금계산서";
    if (/광고|ad|ads|naver|meta|google/.test(name)) return "광고비";
    if (/택배|배송|운임|물류|cj|대한통운/.test(name)) return "택배비";
    return fallback === "자동 분류" ? "기타" : fallback;
  }

  function addExpenseFiles(files: FileList | File[] | null, nextSourceType = sourceType) {
    const nextFiles = Array.from(files || []).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name));
    if (!nextFiles.length) {
      setMessage("엑셀 또는 CSV 비용 파일을 선택해 주세요.");
      return;
    }
    const existing = new Set(uploadedExpenseFiles.map(expenseFileKey));
    const fresh = nextFiles
      .map((file) => ({ file, sourceType: inferExpenseSourceType(file.name, nextSourceType) }))
      .filter((item) => !existing.has(expenseFileKey(item)));
    if (!fresh.length) {
      setMessage("이미 대기 목록에 있는 파일입니다.");
      return;
    }
    setUploadedExpenseFiles((prev) => [...prev, ...fresh]);
    setPreviewRows([]);
    setParsedFiles([]);
    setMessage(`비용 파일 ${fresh.length}개를 대기 목록에 올렸습니다. 데이터 생성을 누르면 파일 기반 비용 데이터가 만들어집니다.`);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    addExpenseFiles(event.target.files);
    event.target.value = "";
  }

  function onExpenseDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addExpenseFiles(event.dataTransfer.files, sourceType);
  }

  function removeExpenseFile(target: ExpenseUploadItem) {
    setUploadedExpenseFiles((prev) => prev.filter((item) => expenseFileKey(item) !== expenseFileKey(target)));
    setPreviewRows([]);
    setParsedFiles([]);
    setMessage(`${target.file.name} 파일을 대기 목록에서 제외했습니다.`);
  }

  async function previewExpenseFiles() {
    if (!uploadedExpenseFiles.length) {
      setMessage("먼저 비용 파일을 업로드해 주세요.");
      return;
    }
    setParsing(true);
    setMessage(`${uploadedExpenseFiles.length}개 파일을 읽어 비용 데이터를 생성하는 중입니다.`);
    const form = new FormData();
    form.append("source_type", sourceType);
    form.append("file_source_types", JSON.stringify(uploadedExpenseFiles.map((item) => item.sourceType)));
    uploadedExpenseFiles.forEach((item) => form.append("files", item.file));
    const res = await fetch("/api/accounting/files/parse", { method: "POST", body: form });
    const data = await res.json();
    setParsing(false);
    if (!res.ok || data.ok === false) {
      setMessage(data.error || "비용 파일 파싱 실패");
      return;
    }
    setPreviewRows(Array.isArray(data.rows) ? data.rows.slice(0, 500) : []);
    setParsedFiles(Array.isArray(data.files) ? data.files : []);
    setPreviewModalOpen(true);
    setMessage(`파일 ${Number(data.files?.length || 0).toLocaleString("ko-KR")}개에서 ${Number(data.rows?.length || 0).toLocaleString("ko-KR")}건의 비용 데이터를 생성했습니다.`);
  }

  async function uploadExpenses() {
    if (!uploadedExpenseFiles.length) {
      setMessage("먼저 비용 파일을 업로드해 주세요.");
      return;
    }
    setUploading(true);
    setMessage("업로드 파일을 기반으로 비용 데이터를 생성하고 저장하는 중입니다.");
    const form = new FormData();
    form.append("source_type", sourceType);
    form.append("file_source_types", JSON.stringify(uploadedExpenseFiles.map((item) => item.sourceType)));
    uploadedExpenseFiles.forEach((item) => form.append("files", item.file));
    const res = await fetch("/api/accounting/upload", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    setUploading(false);
    if (!res.ok || data.ok === false) {
      setMessage(data.error || "비용 업로드 실패");
      return;
    }
    setMessage(`데이터 생성 완료: 파일 ${Number(data.files?.length || uploadedExpenseFiles.length).toLocaleString("ko-KR")}개 / 비용 ${Number(data.success_count || 0).toLocaleString("ko-KR")}건 저장`);
    setUploadedExpenseFiles([]);
    setPreviewRows([]);
    setParsedFiles(Array.isArray(data.files) ? data.files : []);
    invalidateAccountingCache();
    loadSummary(true);
  }

  async function saveManualExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const total = Number(manual.total_amount || 0) || Number(manual.amount || 0) + Number(manual.vat_amount || 0);
    const res = await fetch("/api/accounting/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...manual, source_type: "manual", total_amount: total }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      setMessage(data.error || "비용 저장 실패");
      return;
    }
    setMessage("비용 1건을 저장했습니다.");
    setManual((prev) => ({ ...prev, vendor_name: "", description: "", amount: "", vat_amount: "", total_amount: "", memo: "" }));
    invalidateAccountingCache();
    loadSummary(true);
  }

  async function exportExpenses() {
    const xlsx = await loadXlsxModule();
    const sheet = xlsx.utils.json_to_sheet(filteredExpenses);
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, sheet, "expenses");
    xlsx.writeFile(book, `FN_OS_비용_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const categories = summary?.categories || [];
  const expenses = summary?.expenses || [];
  const categoryById = new Map(categories.map((row) => [String(row.id || ""), String(row.category_name || "")]));
  const filteredExpenses = expenses.filter((row) => {
    const q = filters.q.trim().toLowerCase();
    const rowDate = String(row.expense_date || "");
    const category = categoryById.get(String(row.category_id || "")) || String(row.category || "");
    if (q && !`${row.vendor_name || ""} ${row.description || ""} ${row.memo || ""}`.toLowerCase().includes(q)) return false;
    if (filters.category && category !== filters.category) return false;
    if (filters.from && rowDate < filters.from) return false;
    if (filters.to && rowDate > filters.to) return false;
    return true;
  });
  const totals = summary?.totals || {};
  const recentBatches = summary?.batches || [];
  const monthRows = summary?.by_month || [];
  const categoryRows = summary?.by_category || [];
  const vendorRows = summary?.by_vendor || [];
  const largestCategory = categoryRows[0];
  const pendingUploadCount = uploadedExpenseFiles.length;
  const manualExpenseFields = (
    <div className="grid gap-3 md:grid-cols-2">
      <FormField label="일자">
        <input className={modalInputClass} type="date" value={manual.expense_date} onChange={(event) => setManual((prev) => ({ ...prev, expense_date: event.target.value }))} />
      </FormField>
      <FormField label="업체명">
        <input className={modalInputClass} value={manual.vendor_name} onChange={(event) => setManual((prev) => ({ ...prev, vendor_name: event.target.value }))} />
      </FormField>
      <FormField label="내용" className="md:col-span-2">
        <input className={modalInputClass} value={manual.description} onChange={(event) => setManual((prev) => ({ ...prev, description: event.target.value }))} />
      </FormField>
      <FormField label="카테고리">
        <select className={modalSelectClass} value={manual.category_name} onChange={(event) => setManual((prev) => ({ ...prev, category_name: event.target.value }))}>
          {categories.map((row) => <option key={String(row.id)}>{String(row.category_name)}</option>)}
        </select>
      </FormField>
      <FormField label="결제수단">
        <input className={modalInputClass} value={manual.payment_method} onChange={(event) => setManual((prev) => ({ ...prev, payment_method: event.target.value }))} />
      </FormField>
      <FormField label="공급가액">
        <input className={`${modalInputClass} text-right`} type="number" value={manual.amount} onChange={(event) => setManual((prev) => ({ ...prev, amount: event.target.value }))} />
      </FormField>
      <FormField label="부가세">
        <input className={`${modalInputClass} text-right`} type="number" value={manual.vat_amount} onChange={(event) => setManual((prev) => ({ ...prev, vat_amount: event.target.value }))} />
      </FormField>
      <FormField label="합계">
        <input className={`${modalInputClass} text-right`} type="number" value={manual.total_amount} onChange={(event) => setManual((prev) => ({ ...prev, total_amount: event.target.value }))} />
      </FormField>
      <FormField label="메모" className="md:col-span-2">
        <textarea className={modalTextareaClass} value={manual.memo} onChange={(event) => setManual((prev) => ({ ...prev, memo: event.target.value }))} />
      </FormField>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="회계/비용"
        description="국민카드, 은행 입출금, 세금계산서, 물류/광고 비용을 파일 기반으로 모아 손익까지 봅니다."
      />

      <Card className="flex gap-2 overflow-x-auto p-1 shadow-none">
        {accountingTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`h-10 shrink-0 rounded-lg px-4 text-sm font-semibold transition ${activeTab === tab ? "bg-[#ff6a00] text-white" : "text-gray-600 hover:bg-orange-50 hover:text-[#c2410c]"}`}
          >
            {tab}
          </button>
        ))}
      </Card>

      {loading && <Card className="p-4 text-sm font-semibold text-gray-500">회계 데이터를 불러오는 중입니다.</Card>}
      {summary?.ok === false && <Card className="border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{summary.error}</Card>}
      {message && <Card className="border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-700">{message}</Card>}

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <AccountingLineChart rows={monthRows} />
        <AccountingCategoryChart rows={categoryRows} />
      </section>

      {activeTab === "작업실" && (
        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-semibold text-gray-900">비용 파일 작업실</h2>
                <p className="mt-1 text-sm text-gray-500">국민카드 2개, 국민은행 1개, 기업은행 1개 파일을 한 번에 올립니다.</p>
              </div>
              <select className="field-input h-9 max-w-40 px-3 text-xs font-semibold text-gray-600" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                <option>자동 분류</option>
                {expenseSourceTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
            </div>

            <div
              className="mt-3 grid gap-3 lg:grid-cols-[180px_1fr_auto_auto]"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onExpenseDrop}
            >
              <label className="flex h-10 cursor-pointer items-center justify-center rounded-lg bg-[#ff6a00] px-5 text-sm font-semibold text-white transition hover:bg-[#ea580c]">
                파일 선택
                <input className="hidden" type="file" accept=".xlsx,.xls,.csv" multiple onChange={onFileChange} />
              </label>
              <div className="flex min-h-10 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 text-sm font-semibold text-gray-500">
                국민카드 2개 / 국민은행 / 기업은행 파일을 모두 드래그앤드롭
              </div>
              <div className="flex h-10 items-center justify-center rounded-lg bg-gray-100 px-3 text-xs font-semibold text-gray-600">
                대기 {pendingUploadCount.toLocaleString("ko-KR")}개
              </div>
              <ActionButton type="button" variant="secondary" onClick={previewExpenseFiles} disabled={parsing || !uploadedExpenseFiles.length} className="px-4">
                {parsing ? "생성 중" : "데이터 생성"}
              </ActionButton>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
                파일명에 국민카드, 국민은행, 기업은행이 있으면 출처를 자동으로 잡습니다.
              </div>
              <ActionButton type="button" onClick={uploadExpenses} disabled={uploading || !uploadedExpenseFiles.length} className="px-5">
                {uploading ? "저장 중" : "DB 저장"}
              </ActionButton>
            </div>

            {uploadedExpenseFiles.length > 0 && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-700">대기 중 파일 {uploadedExpenseFiles.length}개</p>
                  <ActionButton type="button" variant="secondary" onClick={() => { setUploadedExpenseFiles([]); setPreviewRows([]); setParsedFiles([]); }} className="h-8 px-3 text-xs">전체 비우기</ActionButton>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {uploadedExpenseFiles.map((item) => (
                    <span key={expenseFileKey(item)} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700">
                      <StatusBadge tone="orange">{item.sourceType}</StatusBadge>
                      <span className="truncate">{item.file.name}</span>
                      <span className="text-gray-400">{(item.file.size / 1024).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} KB</span>
                      <button type="button" onClick={() => removeExpenseFile(item)} className="font-bold text-red-500" aria-label={`${item.file.name} 제외`}>x</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {parsedFiles.length > 0 && (
              <div className="mt-4 rounded-xl bg-gray-50 p-3">
                <p className="text-xs font-semibold text-gray-500">최근 생성 결과</p>
                <div className="mt-2 space-y-1">
                  {parsedFiles.map((file, index) => (
                    <div key={`${String(file.name)}-${index}`} className="flex justify-between gap-2 text-xs font-medium text-gray-600">
                      <span className="truncate">{String(file.name)}</span>
                      <span>{Number(file.row_count || 0).toLocaleString("ko-KR")}건</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionHeader
              title="생성 데이터 미리보기"
              actions={
                <>
                  <StatusBadge>{previewRows.length.toLocaleString("ko-KR")}건</StatusBadge>
                  <ActionButton type="button" variant="secondary" onClick={() => setPreviewModalOpen(true)} disabled={!previewRows.length} className="h-8 px-3 text-xs">미리보기 열기</ActionButton>
                </>
              }
            />
            <div className="mt-4">
              <ExpenseTable rows={previewRows} categoryById={categoryById} compact />
            </div>
          </Card>
        </section>
      )}

      {activeTab === "비용 내역" && (
        <Card className="p-5">
          <SectionHeader
            title="비용 내역"
            description="기간, 카테고리, 업체명을 기준으로 비용을 빠르게 좁혀봅니다."
            actions={<ActionButton type="button" variant="secondary" onClick={exportExpenses}>엑셀 내보내기</ActionButton>}
          />
          <FilterBar className="mb-4 p-3 shadow-none">
            <div className="grid flex-1 gap-2 md:grid-cols-4">
              <input className="field-input px-3 py-2 text-sm" placeholder="업체/내용/메모" value={filters.q} onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))} />
              <select className="field-input px-3 py-2 text-sm" value={filters.category} onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}>
                <option value="">전체 카테고리</option>
                {categories.map((row) => <option key={String(row.id)}>{String(row.category_name)}</option>)}
              </select>
              <input className="field-input px-3 py-2 text-sm" type="date" value={filters.from} onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))} />
              <input className="field-input px-3 py-2 text-sm" type="date" value={filters.to} onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))} />
            </div>
          </FilterBar>
          <ExpenseTable rows={filteredExpenses} categoryById={categoryById} />
        </Card>
      )}

      {activeTab === "분류 규칙" && (
        <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <Card className="p-5">
            <SectionHeader title="규칙 기반 분류 결과" description="업체명과 설명 패턴으로 자동 분류한 후보를 확인합니다." />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {["네이버파이낸셜 -> 광고비 또는 정산", "쿠팡 -> 판매수수료/정산", "CJ대한통운 -> 택배비", "관세사 -> 통관수수료", "카드사 해외결제 -> 샘플비/수입비용 후보", "포장/박스/봉투 -> 포장비"].map((rule) => (
                <div key={rule} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-700">
                  <span>{rule}</span>
                  <StatusBadge tone="orange">규칙</StatusBadge>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <ExpenseTable rows={expenses.slice(0, 20)} categoryById={categoryById} compact />
            </div>
          </Card>
          <Card className="p-5">
            <SectionHeader
              title="수동 비용 입력"
              description="단건 비용은 공통 모달에서 입력합니다."
              actions={<ActionButton type="button" onClick={() => setManualExpenseModalOpen(true)}>비용 등록</ActionButton>}
            />
            <EmptyState
              title="비용 등록 모달"
              description="저장 로직은 기존 수동 비용 저장 API를 그대로 사용합니다."
              action={<ActionButton type="button" onClick={() => setManualExpenseModalOpen(true)}>열기</ActionButton>}
              className="min-h-44"
            />
          </Card>
        </section>
      )}

      {activeTab === "손익 그래프" && (
        <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <Card className="p-5">
            <SectionHeader title="월별 손익 계산" description="매출, 매입, 광고비, 비용을 한 화면에서 비교합니다." />
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <AccountingLineChart rows={monthRows} compact />
              <AccountingCategoryChart rows={categoryRows} compact />
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-gray-50 text-xs font-semibold text-gray-500"><tr><th className="px-3 py-2 text-left">월</th><th className="px-3 py-2 text-right">매출</th><th className="px-3 py-2 text-right">상품매입</th><th className="px-3 py-2 text-right">광고비</th><th className="px-3 py-2 text-right">비용</th><th className="px-3 py-2 text-right">예상 순이익</th></tr></thead>
                <tbody><tr className="border-t border-gray-100 hover:bg-orange-50/60"><td className="px-3 py-3 font-semibold">{String(totals.month || "-")}</td><td className="px-3 py-3 text-right">{krw(asNumber(totals.sales_amount))}</td><td className="px-3 py-3 text-right">{krw(asNumber(totals.purchase_amount))}</td><td className="px-3 py-3 text-right">{krw(asNumber(totals.ad_spend))}</td><td className="px-3 py-3 text-right">{krw(asNumber(totals.expense_amount))}</td><td className="px-3 py-3 text-right font-bold text-[#ff6a00]">{krw(asNumber(totals.estimated_profit))}</td></tr></tbody>
              </table>
            </div>
          </Card>
          <ReportList title="비용 카테고리 비중" rows={summary?.by_category || []} />
        </section>
      )}

      {activeTab === "미납/결제" && (
        <section className="grid gap-4 xl:grid-cols-2">
          <AccountingList title="거래처 미납" rows={summary?.payables || []} primaryKey="base_month" amountKey="balance_amount" emptyText="아직 미납 데이터가 없습니다." />
          <AccountingList title="결제 기록" rows={summary?.payments || []} primaryKey="payment_date" amountKey="amount" emptyText="아직 결제 기록이 없습니다." />
        </section>
      )}

      {activeTab === "수입비용" && (
        <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <AccountingList title="수입 발주 연결 후보" rows={summary?.import_orders || []} primaryKey="order_no" amountKey="total_amount" emptyText="수입 발주 데이터가 없습니다." />
          <ReportList title="수입비용 후보" rows={(summary?.by_category || []).filter((row) => ["수입비용", "관세", "부가세", "통관수수료", "샘플비", "물류비"].includes(String(row.label)))} />
        </section>
      )}

      {activeTab === "작업실" && (
        <section className="grid gap-4 xl:grid-cols-3">
          <AccountingList title="최근 업로드" rows={recentBatches} primaryKey="source_file_name" amountKey="success_count" emptyText="아직 업로드 기록이 없습니다." />
          <ReportList title="업체별 비용" rows={vendorRows} />
          <Card className="p-5">
            <SectionHeader title="한눈에 보기" />
            <div className="mt-4 space-y-2 text-sm font-medium text-gray-600">
              <p className="rounded-md bg-slate-50 px-3 py-2">가장 큰 비용: <b className="text-slate-950">{String(largestCategory?.label || "데이터 없음")}</b></p>
              <p className="rounded-md bg-slate-50 px-3 py-2">최근 비용 행: <b className="text-slate-950">{expenses.length.toLocaleString("ko-KR")}건</b></p>
              <p className="rounded-md bg-slate-50 px-3 py-2">파일 대기: <b className="text-orange-600">{pendingUploadCount.toLocaleString("ko-KR")}개</b></p>
            </div>
          </Card>
        </section>
      )}

      {manualExpenseModalOpen && (
        <FormModal
          title="수동 비용 등록"
          description="카테고리, 금액, 결제수단을 입력해 비용 1건을 저장합니다."
          onClose={() => setManualExpenseModalOpen(false)}
          size="lg"
          footer={
            <>
              <ActionButton type="button" variant="secondary" onClick={() => setManualExpenseModalOpen(false)}>닫기</ActionButton>
              <ActionButton type="submit" form="accounting-manual-expense-form">저장</ActionButton>
            </>
          }
        >
          <form id="accounting-manual-expense-form" onSubmit={saveManualExpense}>
            {manualExpenseFields}
          </form>
        </FormModal>
      )}

      {previewModalOpen && (
        <SelectionModal
          title="비용 파일 미리보기"
          description={`${previewRows.length.toLocaleString("ko-KR")}건의 생성 데이터를 확인합니다.`}
          onClose={() => setPreviewModalOpen(false)}
          size="full"
          footer={
            <>
              <ActionButton type="button" variant="secondary" onClick={() => setPreviewModalOpen(false)}>닫기</ActionButton>
              <ActionButton type="button" onClick={uploadExpenses} disabled={uploading || !uploadedExpenseFiles.length}>
                {uploading ? "저장 중" : "DB 저장"}
              </ActionButton>
            </>
          }
        >
          <ExpenseTable rows={previewRows} categoryById={categoryById} />
        </SelectionModal>
      )}
    </div>
  );
}

function ExpenseTable({ rows, categoryById, compact = false }: { rows: Array<Record<string, unknown>>; categoryById: Map<string, string>; compact?: boolean }) {
  if (!rows.length) return <EmptyState title="데이터 없음" className="min-h-32" />;
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className={`w-full text-sm ${compact ? "min-w-[760px]" : "min-w-[980px]"}`}>
        <thead className="bg-gray-50 text-xs font-semibold text-gray-500">
          <tr><th className="px-3 py-2 text-left">일자</th><th className="px-3 py-2 text-left">자료</th><th className="px-3 py-2 text-left">업체</th><th className="px-3 py-2 text-left">내용</th><th className="px-3 py-2 text-left">분류</th><th className="px-3 py-2 text-right">합계</th>{!compact && <th className="px-3 py-2 text-left">메모</th>}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id || index)} className="border-t border-gray-100 hover:bg-orange-50/60">
              <td className="px-3 py-2 font-semibold text-gray-800">{String(row.expense_date || row["날짜"] || row["일자"] || "-")}</td>
              <td className="px-3 py-2 text-gray-600"><StatusBadge>{String(row.source_type || "-")}</StatusBadge></td>
              <td className="px-3 py-2 font-semibold text-gray-900">{String(row.vendor_name || row["거래처"] || row["가맹점명"] || row["업체명"] || "-")}</td>
              <td className="max-w-[280px] truncate px-3 py-2 text-gray-600">{String(row.description || row["적요"] || row["내용"] || "-")}</td>
              <td className="px-3 py-2"><StatusBadge tone="orange">{categoryById.get(String(row.category_id || "")) || String(row.category || "기타")}</StatusBadge></td>
              <td className="px-3 py-2 text-right font-bold text-gray-900">{krw(asNumber(row.total_amount || row["합계"] || row["금액"] || row.amount))}</td>
              {!compact && <td className="max-w-[220px] truncate px-3 py-2 text-gray-500">{String(row.memo || "-")}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountingList({ title, rows, primaryKey, amountKey, emptyText }: { title: string; rows: Array<Record<string, unknown>>; primaryKey: string; amountKey: string; emptyText: string }) {
  return (
    <Card className="p-5">
      <SectionHeader title={title} />
      <div className="mt-4 space-y-2">
        {rows.map((row, index) => (
          <div key={`${title}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-gray-50 px-3 py-2 text-sm">
            <span className="truncate font-semibold text-gray-700">{String(row[primaryKey] || row.customer_name || row.memo || "-")}</span>
            <span className="font-bold text-gray-900">{amountKey.includes("count") ? `${asNumber(row[amountKey]).toLocaleString("ko-KR")}건` : krw(asNumber(row[amountKey]))}</span>
          </div>
        ))}
        {!rows.length && <EmptyState title={emptyText} className="min-h-32" />}
      </div>
    </Card>
  );
}

function ReportList({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  const max = Math.max(1, ...rows.map((row) => asNumber(row.amount)));
  return (
    <Card className="p-5">
      <SectionHeader title={title} />
      <div className="mt-4 space-y-3">
        {rows.slice(0, 10).map((row, index) => {
          const amount = asNumber(row.amount);
          return (
            <div key={`${title}-${index}`}>
              <div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate font-semibold text-gray-700">{String(row.label || "-")}</span><span className="font-bold text-gray-900">{krw(amount)}</span></div>
              <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-[#ff6a00]" style={{ width: `${Math.max(4, (amount / max) * 100)}%` }} /></div>
            </div>
          );
        })}
        {!rows.length && <EmptyState title="데이터 없음" className="min-h-32" />}
      </div>
    </Card>
  );
}

function AccountingRightPanel() {
  const [summary, setSummary] = useState<AccountingSummary | null>(null);

  useEffect(() => {
    let alive = true;
    let cachedTimer: number | undefined;
    const cached = readCachedAccountingSummary();
    if (cached) {
      cachedTimer = window.setTimeout(() => {
        if (alive) setSummary(cached);
      }, 0);
    }
    fetchCachedAccountingSummary()
      .then((data) => {
        if (alive) setSummary(data);
      })
      .catch((error) => {
        if (alive) setSummary({ ok: false, error: error instanceof Error ? error.message : "회계/비용 조회 실패" });
      });
    return () => {
      alive = false;
      if (cachedTimer) window.clearTimeout(cachedTimer);
    };
  }, []);

  const totals = summary?.totals || {};
  const expenses = summary?.expenses || [];
  const bankCardExpense = expenses.filter((row) => ["국민카드", "국민카드 1", "국민카드 2", "국민은행", "기업은행"].includes(String(row.source_type || "")));
  const bankCardTotal = bankCardExpense.reduce((total, row) => total + asNumber(row.total_amount || row.amount), 0);
  const categoryRows = summary?.by_category || [];
  const recentBatches = summary?.batches || [];

  return (
    <aside className="hidden w-[320px] shrink-0 border-l border-slate-200 bg-white px-4 py-6 xl:block">
      <div className="mb-4">
        <h2 className="text-[18px] font-semibold text-gray-900">회계 대시보드</h2>
        <p className="mt-1 text-xs font-medium text-gray-500">비용, 결제, 손익 핵심만 모아봅니다.</p>
      </div>
      <div className="space-y-3">
        <AccountingMetric label="이번 달 총비용" value={krw(asNumber(totals.expense_amount))} note="업로드/수동 비용" tone="orange" />
        <AccountingMetric label="카드/은행" value={krw(bankCardTotal)} note="국민카드/국민은행/기업은행" />
        <AccountingMetric label="광고비" value={krw(asNumber(totals.ad_spend))} note="광고 DB 연결" />
        <AccountingMetric label="구매/매입" value={krw(asNumber(totals.purchase_amount))} note="매출/재고 연결" />
        <AccountingMetric label="예상 순이익" value={krw(asNumber(totals.estimated_profit))} note={`마진율 ${asNumber(totals.margin_rate).toFixed(1)}%`} tone="green" />
        <AccountingMetric label="미납 거래처" value={`${asNumber(totals.unpaid_count).toLocaleString("ko-KR")}곳`} note="결제 확인" tone="rose" />
      </div>
      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <h3 className="text-xs font-semibold text-gray-500">큰 비용 TOP</h3>
        <div className="mt-2 space-y-2">
          {categoryRows.slice(0, 4).map((row, index) => (
            <div key={`${String(row.label)}-${index}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-semibold text-gray-600">{String(row.label || "-")}</span>
              <span className="font-bold text-gray-900">{krw(asNumber(row.amount))}</span>
            </div>
          ))}
          {!categoryRows.length && <EmptyState title="데이터 없음" className="min-h-24 border-0 bg-white px-2 py-4" />}
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <h3 className="text-xs font-semibold text-gray-500">최근 업로드</h3>
        <div className="mt-2 space-y-2">
          {recentBatches.slice(0, 4).map((row, index) => (
            <div key={`${String(row.id || row.source_file_name)}-${index}`} className="text-xs">
              <p className="truncate font-semibold text-gray-700">{String(row.source_file_name || row.source_type || "-")}</p>
              <p className="mt-0.5 text-gray-400">{asNumber(row.success_count).toLocaleString("ko-KR")}건 저장</p>
            </div>
          ))}
          {!recentBatches.length && <EmptyState title="업로드 없음" className="min-h-24 border-0 bg-white px-2 py-4" />}
        </div>
      </div>
    </aside>
  );
}

function DashboardNew() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    let cachedTimer: number | undefined;
    const cached = readCachedJson<DashboardSummary>("/api/dashboard/summary", { storageTtl: 60_000 });
    if (cached) {
      cachedTimer = window.setTimeout(() => {
        if (!alive) return;
        setSummary(cached);
        setLoading(false);
      }, 0);
    }
    cachedClientJson<DashboardSummary>("/api/dashboard/summary", { ttl: 45_000, storageTtl: 60_000 })
      .then((data) => {
        if (alive) setSummary(data);
      })
      .catch((error) => {
        if (alive) setSummary({ ok: false, error: error instanceof Error ? error.message : "대시보드 조회 실패" });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      if (cachedTimer) window.clearTimeout(cachedTimer);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">FN OS 메인 대시보드</h1>
        <p className="mt-1 text-sm font-bold text-slate-500">쇼핑몰 API, 엑셀 업로드, 자체 입력 데이터를 FN OS 자체 DB 기준으로 요약합니다.</p>
      </div>

      {loading && <div className="rounded-md border border-slate-200 bg-white p-5 text-sm font-bold text-slate-500">대시보드 데이터를 불러오는 중입니다.</div>}
      {summary?.ok === false && <div className="rounded-md border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">{summary.error}</div>}

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <DashboardMetric label="오늘 매출" value={krw(asNumber(summary?.today_sales))} note={`오늘 주문 ${asNumber(summary?.today_order_count).toLocaleString("ko-KR")}건`} />
        <DashboardMetric label="이번 달 매출" value={krw(asNumber(summary?.month_sales))} note={`마진율 ${asNumber(summary?.margin_rate).toFixed(1)}%`} />
        <DashboardMetric label="광고비" value={krw(asNumber(summary?.ad_spend))} note="월 누적 광고비" />
        <DashboardMetric label="이번 달 총비용" value={krw(asNumber(summary?.expense_amount))} note="회계/비용 업로드" />
        <DashboardMetric label="예상 순이익" value={krw(asNumber(summary?.estimated_profit))} note={`구매/입고 ${krw(asNumber(summary?.month_purchases))}`} />
        <DashboardMetric label="재고 위험" value={`${asNumber(summary?.risk_sku).toLocaleString("ko-KR")} SKU`} note="가용 재고 5개 이하" />
        <DashboardMetric label="출고 대기" value={`${asNumber(summary?.waiting_shipment_count).toLocaleString("ko-KR")}건`} note="송장/출고 확인 필요" />
        <DashboardMetric label="송장 미입력" value={`${asNumber(summary?.missing_tracking_count).toLocaleString("ko-KR")}건`} note="tracking_no 없음" />
        <DashboardMetric label="미매칭 상품" value={`${asNumber(summary?.unmapped_product_count).toLocaleString("ko-KR")}건`} note="SKU 매핑 필요" />
        <DashboardMetric label="입고 예정" value={`${asNumber(summary?.purchase_due_count).toLocaleString("ko-KR")}건`} note="수입/구매 입고 예정" />
        <DashboardMetric label="미납 거래처" value={`${asNumber(summary?.unpaid_customer_count).toLocaleString("ko-KR")}곳`} note="비용/정산 확인" />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <DashboardList title="최근 판매" rows={summary?.recent_sales || []} primaryKey="prod_name" amountKey="total_amount" />
        <DashboardList title="최근 구매" rows={summary?.recent_purchases || []} primaryKey="prod_name" amountKey="total_amount" />
        <DashboardList title="재고 위험 TOP" rows={summary?.inventory || []} primaryKey="sku" />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <DashboardList title="최근 수입 발주" rows={summary?.recent_import_orders || []} primaryKey="order_no" amountKey="total_amount" />
        <DashboardList title="최근 광고 성과" rows={summary?.recent_ads || []} primaryKey="campaign_name" amountKey="spend_amount" />
        <DashboardList title="최근 아카이브" rows={summary?.recent_archives || []} primaryKey="title" />
      </section>
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const activeSlug = searchParams.get("menu") || "dashboard";
  const activeMenu = slugMenus[activeSlug] || "대시보드";
  const importPath = searchParams.get("section") || "/orders";
  const salesSection = searchParams.get("salesSection") || "online";

  return (
    <main className="min-h-screen bg-[#f6f7f9] text-slate-950">
      <style jsx global>{`
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type="number"] {
          -moz-appearance: textfield;
        }
        .field-input:focus {
          border-color: #fb923c;
          box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.25);
          outline: none;
        }
      `}</style>
      <div className="flex min-h-screen">
        <LeftSidebar activeMenu={activeMenu} importPath={importPath} salesSection={salesSection} />
        <section className="min-w-0 flex-1 px-5 py-6 sm:px-7">
          {activeSlug === "import" ? (
            <NativeImportWorkspace path={importPath} />
          ) : activeSlug === "dashboard" ? (
            <MainDashboard />
          ) : activeSlug === "sales" ? (
            <SalesInventoryWorkspace section={salesSection} />
          ) : activeSlug === "accounting" ? (
            <AccountingWorkspace />
          ) : activeSlug === "ads" ? (
            <AdsAnalysisWorkspace />
          ) : activeSlug === "archive" ? (
            <ArchiveWorkspace />
          ) : (
            <section className="rounded-md border border-slate-200 bg-white p-8 shadow-sm">
              <h1 className="text-2xl font-black">{activeMenu}</h1>
              <p className="mt-2 text-sm text-slate-500">이 메뉴는 다음 단계에서 실제 데이터와 기능을 연결할 영역입니다.</p>
            </section>
          )}
        </section>
        {activeSlug === "import" && <RightTools />}
        {activeSlug === "sales" && <SalesSyncTools />}
        {activeSlug === "accounting" && <AccountingRightPanel />}
        {activeSlug === "ads" && <AdsRightPanel />}
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
