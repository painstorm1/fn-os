"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { ClipboardEvent, FormEvent } from "react";
import { useSearchParams } from "next/navigation";

const IMPORT_ERP_URL = process.env.NEXT_PUBLIC_IMPORT_ERP_URL || "http://localhost:5500";

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

const menuSlugs: Record<string, string> = {
  대시보드: "dashboard",
  "매출/재고": "sales",
  수입관리: "import",
  광고분석: "ads",
  "회계/비용": "accounting",
  아카이브: "archive",
};

const slugMenus = Object.fromEntries(Object.entries(menuSlugs).map(([key, value]) => [value, key]));

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

type CalendarServerMemo = {
  memo: string;
  order_id?: number;
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
      fetch(apiUrl("/api/fnos/calendar-production-memos"), { credentials: "include" })
        .then((res) => res.ok ? res.json() : {})
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
        <div className="mt-2 space-y-1">
          {(serverMemos[selected] || []).map((memo, index) => (
            <div key={`server-${memo.memo}-${index}`} className="flex items-start justify-between gap-2 text-xs">
              {memo.order_id ? (
                <Link href={importHref(`/orders?open=${memo.order_id}`)} className="break-all hover:underline">
                  - {memo.memo}
                </Link>
              ) : (
                <span className="break-all">- {memo.memo}</span>
              )}
            </div>
          ))}
          {(memos[selected] || []).map((memo, index) => (
            <div key={`local-${memo}-${index}`} className="flex items-start justify-between gap-2 text-xs">
              <span className="break-all">• {memo}</span>
              <button type="button" className="text-slate-400 hover:text-rose-500" onClick={() => deleteMemo(index)}>
                ×
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
            placeholder="일정 입력"
          />
          <button type="button" onClick={addMemo} className="rounded-md bg-orange-500 px-3 text-xs font-black text-white">
            저장
          </button>
        </div>
      </div>
    </section>
  );
}

function LeftSidebar({ activeMenu, importPath }: { activeMenu: string; importPath: string }) {
  const [importOpen, setImportOpen] = useState(activeMenu === "수입관리");

  useEffect(() => {
    if (activeMenu !== "수입관리") return;
    const timer = window.setTimeout(() => setImportOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [activeMenu]);

  return (
    <aside className="hidden h-screen w-[280px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-6 py-5 lg:block">
      <Link href="/?menu=dashboard" className="mb-4 block">
        <Image src="/fn-logo.jpg" alt="F&" width={88} height={88} className="object-contain" priority />
      </Link>

      <nav className="space-y-1">
        {mainMenus.map((item) => (
          <div key={item}>
            {item === "수입관리" ? (
              <Link
                href="/?menu=import"
                onMouseEnter={() => warmImportCache(importPath)}
                onFocus={() => warmImportCache(importPath)}
                onClick={(event) => {
                  warmImportCache(importPath);
                  if (activeMenu === "수입관리") {
                    event.preventDefault();
                    setImportOpen((open) => !open);
                  }
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
                className={`flex h-11 w-full items-center rounded-md px-3 text-left text-sm font-black transition ${
                  item === activeMenu ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item}
              </Link>
            )}
            {item === "수입관리" && activeMenu === "수입관리" && importOpen && (
              <div className="ml-3 mt-1 space-y-1 border-l border-slate-200 pl-3">
                {importSubMenus.map((sub) => (
                  <Link
                    key={sub.path}
                    href={`/?menu=import&section=${encodeURIComponent(sub.path)}`}
                    onMouseEnter={() => warmImportCache(sub.path)}
                    onFocus={() => warmImportCache(sub.path)}
                    className={`flex h-9 w-full items-center rounded-md px-3 text-left text-xs font-black ${
                      importPath === sub.path ? "bg-orange-50 text-orange-600" : "text-slate-500 hover:bg-slate-50"
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
      const res = await fetch(`${IMPORT_ERP_URL}/api/lcl-fee?method=${encodeURIComponent(next.method)}&cbm=${encodeURIComponent(cbm.toFixed(3))}`, {
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
      setLclResult("수입ERP 서버 연결을 확인해 주세요. localhost:5500이 켜져 있어야 계산됩니다.");
    }
  }

  function updateLcl(patch: Partial<typeof lcl>) {
    const next = { ...lcl, ...patch };
    setLcl(next);
    void calcLcl(next);
  }

  return (
    <aside className="hidden h-screen w-[320px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-4 py-6 xl:block">
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

type CostGridRow = {
  order_item_id?: number;
  option_name?: string;
  product_name?: string;
  quantity?: number;
  item_currency?: string;
  unit_price?: number;
  cost_ratio?: number;
  unit_extra_cost?: number;
  material_unit_cost?: number;
  estimated_unit_cost?: number;
  coupang_free_price?: number | null;
  naver_free_price?: number | null;
  naver_cod_price?: number | null;
  coupang_margin?: { amount?: number | null; pct?: number | null };
  naver_free_margin?: { amount?: number | null; pct?: number | null };
  naver_cod_margin?: { amount?: number | null; pct?: number | null };
};

type CostGrid = {
  rows?: CostGridRow[];
  china_extra_cost?: number;
  korea_extra_cost?: number;
  total_extra_cost?: number;
  product_base_total?: number;
  goods_total_won?: number;
};

type ImportProductDetail = {
  ok: boolean;
  product: ImportProduct;
  materials?: ProductMaterialLink[];
  history: Array<{ id: number; order_code?: string; order_date?: string; paid_date?: string; factory?: string; quantity?: number; unit_price?: number; item_currency?: string; status?: string }>;
};

function apiUrl(path: string) {
  return `${IMPORT_ERP_URL}${path}`;
}

type CacheEntry<T> = {
  at: number;
  data?: T;
  promise?: Promise<T>;
};

const apiCache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_CACHE_TTL = 45_000;

function cachedJson<T>(path: string, ttl = DEFAULT_CACHE_TTL): Promise<T> {
  const key = apiUrl(path);
  const now = Date.now();
  const cached = apiCache.get(key) as CacheEntry<T> | undefined;
  if (cached?.data !== undefined && now - cached.at < ttl) return Promise.resolve(cached.data);
  if (cached?.promise) return cached.promise;
  const promise = fetch(key, { credentials: "include" })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<T>;
    })
    .then((data) => {
      apiCache.set(key, { at: Date.now(), data });
      return data;
    })
    .catch((error) => {
      apiCache.delete(key);
      throw error;
    });
  apiCache.set(key, { at: now, promise });
  return promise;
}

function invalidateApiCache(match?: string) {
  if (!match) {
    apiCache.clear();
    return;
  }
  const needle = apiUrl(match);
  for (const key of Array.from(apiCache.keys())) {
    if (key.includes(needle) || key.includes(match)) apiCache.delete(key);
  }
}

function warmImportCache(section?: string) {
  void cachedJson("/api/fnos/form-data", 60_000).catch(() => undefined);
  if (!section || section === "/orders") {
    void cachedJson("/api/fnos/orders", 30_000).catch(() => undefined);
  }
  if (!section || section === "/products") {
    void cachedJson("/api/fnos/products", 60_000).catch(() => undefined);
  }
  if (!section || section === "/settings") {
    void cachedJson("/api/fnos/settings", 60_000).catch(() => undefined);
  }
}

function importHref(path: string) {
  return `/?menu=import&section=${encodeURIComponent(path)}`;
}

function assetUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("data:image/")) return path;
  return `${IMPORT_ERP_URL}/static/${path.replace(/^\/?static\//, "")}`;
}

function sortFactories(factories?: ImportFactory[]) {
  return [...(factories || [])].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko-KR"));
}

function isMaterial(product?: ImportProduct | null) {
  return String(product?.item_type || "").toUpperCase() === "MATERIAL";
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
  return String(order?.actual_payment_currency || (actualUsdTotal(order) > 0 ? "USD" : "KRW")).toUpperCase() === "USD" ? "USD" : "KRW";
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

function rateNoteText(rates?: Record<string, number>, currencies: string[] = []) {
  const ordered = Array.from(new Set([...currencies, "CNY", "USD"].filter(Boolean)));
  return ordered.map((currency) => `${currency}=₩${Number(rates?.[currency] || (currency === "KRW" ? 1 : 0)).toLocaleString("ko-KR")}`).join(" · ");
}

function productionDueText(order: ImportOrder) {
  const days = Number(order.production_days || 0);
  const paidOrOrder = order.paid_date || order.order_date;
  if (!days || !paidOrOrder) return "-";
  const base = new Date(`${paidOrOrder}T00:00:00`);
  if (Number.isNaN(base.getTime())) return "-";
  const due = new Date(base);
  due.setDate(base.getDate() + days);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return "D-Day";
  return `D+${Math.abs(diff)}`;
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
            {openStage === stage.name && <input className="field-input" type="date" value={value} onChange={(event) => { onChange(stage.name, event.target.value); setOpenStage(""); }} />}
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
                  className="field-input max-w-[140px]"
                  type="date"
                  value={value}
                  onChange={(event) => {
                    onChange(stage.name, event.target.value);
                    setOpenStage("");
                  }}
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

  if (loading) return <Panel title="수입제품 현황"><p className="text-sm text-slate-500">수입ERP 데이터를 불러오는 중...</p></Panel>;

  return (
    <div className={`grid gap-4 ${compact ? "xl:grid-cols-[1fr_320px]" : "2xl:grid-cols-[1fr_360px]"}`}>
      <Panel title="최근 발주" subtitle="수입ERP 데이터 원장 기준 최근 5건">
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
                <th className="py-2 text-right">상태</th>
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
                  <td className="py-3"><Link className="flex justify-end" href={importHref(`/orders?open=${order.id}`)}><StatusPill status={order.status} /></Link></td>
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
  const orderEditMatch = basePath.match(/^\/orders\/(\d+)\/edit/);
  const orderMatch = basePath.match(/^\/orders\/(\d+)/);
  const productEditMatch = basePath.match(/^\/products\/(\d+)\/edit/);
  const productMatch = basePath.match(/^\/products\/(\d+)/);
  if (basePath.startsWith("/orders/new")) return <NativeOrderForm copyId={copyOrderId} />;
  if (basePath.startsWith("/products/new")) return <NativeProductForm />;
  if (orderEditMatch) return <NativeOrderForm id={Number(orderEditMatch[1])} />;
  if (orderMatch) return <NativeOrderDetail id={Number(orderMatch[1])} />;
  if (productEditMatch) return <NativeProductForm id={Number(productEditMatch[1])} />;
  if (productMatch) return <NativeProductForm id={Number(productMatch[1])} />;
  if (basePath.startsWith("/products")) return <NativeProducts />;
  if (basePath.startsWith("/settings")) return <NativeSettings />;
  return <NativeOrders initialOpenOrderId={openOrderId} />;
}

function NativeOrders({ initialOpenOrderId = null }: { initialOpenOrderId?: number | null }) {
  const [orders, setOrders] = useState<ImportOrder[]>([]);
  const [details, setDetails] = useState<Record<number, ImportOrderDetail>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadOrders() {
    const data = await cachedJson<{ orders?: ImportOrder[] }>("/api/fnos/orders", 30_000);
    setOrders(data.orders || []);
  }

  useEffect(() => {
    let alive = true;
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

  useEffect(() => {
    if (loading || !initialOpenOrderId) return;
    void openOrder(initialOpenOrderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, initialOpenOrderId]);

  return (
    <Panel title="발주" subtitle="리스트를 클릭하면 아래에서 바로 수정할 수 있습니다." action={<Link className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" href={importHref("/orders/new")}>+ 새 발주</Link>}>
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="hidden grid-cols-[120px_1.4fr_1fr_80px_128px_128px_90px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-600 xl:grid">
            <span className="text-left">주문날짜</span><span className="text-left">대표 제품</span><span className="text-left">공장</span><span className="text-right">수량</span><span className="text-right">금액(원)</span><span className="pr-3 text-right">출고예정</span><span className="text-right">상태</span>
          </div>
          {orders.map((order) => (
            <div key={order.id} className={expandedId === order.id ? "border-l-4 border-orange-500 bg-orange-50/40" : "border-l-4 border-transparent"}>
              <button type="button" onClick={() => toggleOrder(order.id)} className="grid w-full items-center gap-4 border-b border-slate-200 px-4 py-3 text-left text-sm hover:bg-orange-50 xl:grid-cols-[120px_1.4fr_1fr_80px_128px_128px_90px]">
                <span className="font-black">{order.order_date || order.paid_date || "-"}</span>
                <span className="grid grid-cols-[56px_1fr] items-center gap-3">
                  {order.repr_image ? <img src={assetUrl(order.repr_image)} alt="" className="h-14 w-14 rounded-md object-cover" /> : <span className="h-14 w-14 rounded-md bg-slate-100" />}
                  <span><b>{order.repr_product || `${order.line_count || 0}개 라인`}</b>{order.child_count ? <small className="ml-2 text-slate-500">+{order.child_count}</small> : null}</span>
                </span>
                <span className="font-bold text-slate-600">{order.factory_name || "-"}</span>
                <span className="text-right">{Math.round(order.total_qty || 0).toLocaleString("ko-KR")}</span>
                <span className="text-right font-black">{krw(order.total_won)}</span>
                <span className="pr-3 text-right font-black text-orange-600">{productionDueText(order)}</span>
                <span className="flex justify-end"><StatusPill status={order.status} /></span>
              </button>
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
                    setDetails((prev) => ({ ...prev, [order.id]: next }));
                    void loadOrders();
                  }} />
                  : <div className="border-b border-slate-200 p-5 text-sm font-bold text-slate-500">상세 불러오는 중...</div>
              )}
            </div>
          ))}
          {!orders.length && <p className="p-8 text-center text-sm font-bold text-slate-500">아직 발주가 없습니다.</p>}
        </div>
      )}
    </Panel>
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
  const [actualCurrency, setActualCurrency] = useState<"KRW" | "USD">(actualPaymentCurrency(order));
  const [actualPayment, setActualPayment] = useState(actualPaymentSingle(order));
  const [actualPayment1, setActualPayment1] = useState(actualPaymentFirst(order));
  const [actualPayment2, setActualPayment2] = useState(actualPaymentSecond(order));
  const productWon = Number(detail.product_won ?? Math.max(0, Number(detail.total_won || 0) - orderExtraCost(order)));
  const nativeTotals = nativeTotalText(detail.native_totals, order.currency || "CNY");
  const usedCurrencies = Object.keys(detail.native_totals || (order.currency ? { [order.currency]: 0 } : { CNY: 0 }));
  const rateNote = rateNoteText(detail.fx_rates, Array.from(new Set([...usedCurrencies, "CNY", "USD"])));
  const isTT = isTTPayment(order.payment_method);
  const actualPaymentValue = isTT ? Number(actualPayment1 || 0) + Number(actualPayment2 || 0) : Number(actualPayment || 0);
  const actualPaymentKrw = actualPaymentValue > 0 ? (actualCurrency === "KRW" ? actualPaymentValue : actualPaymentValue * Number(detail.fx_rates?.USD || 0)) : 0;
  const chinaExtraWon = Number(detail.cost_grid?.china_extra_cost || 0);
  const panelProductWon = Math.max(0, productWon - chinaExtraWon);
  const koreaExtraWon = Number(detail.cost_grid?.korea_extra_cost || orderExtraCost(order));
  const panelTotalWon = panelProductWon + Number(detail.cost_grid?.total_extra_cost || orderExtraCost(order));

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
    const payload = {
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
      items: (detail.items || []).map((item) => ({
        product_id: item.product_id || "",
        product_name: item.product_name || "",
        option_value: item.option_value || "",
        quantity: item.quantity || "",
        unit_price: item.unit_price || "",
        item_currency: item.item_currency || order.currency || "CNY",
        line_note: item.line_note || "",
      })),
    };
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
      invalidateApiCache("/api/fnos/dashboard");
      invalidateApiCache("/api/fnos/calendar-production-memos");
      window.dispatchEvent(new Event("fnos-calendar-refresh"));
      onSaved(null);
    } catch {
      alert("삭제 요청이 서버에 닿지 않았습니다. 수입ERP 서버를 확인해주세요.");
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
            <p className="flex justify-between"><span>제품합계(원화)</span><b>{krw(panelProductWon)}</b></p>
            <p className="flex justify-between"><span>중국내 부대비용</span><b>{krw(chinaExtraWon)}</b></p>
            <p className="flex justify-between"><span>한국 부대비용</span><b>{krw(koreaExtraWon)}</b></p>
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
              <select className="field-input" value={actualCurrency} onChange={(e) => setActualCurrency(e.target.value as "KRW" | "USD")}>
                <option>KRW</option>
                <option>USD</option>
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
        <CostMarginGrid orderId={order.id} grid={detail.cost_grid} />
      </div>
    </div>
  );
}

function CostMarginGrid({ orderId, grid }: { orderId: number; grid?: CostGrid }) {
  const rows = grid?.rows || [];
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
    setSaving(false);
  }

  function update(rowId: number | undefined, key: "coupang" | "naverFree" | "naverCod", value: string) {
    if (!rowId) return;
    setPrices((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || { coupang: "", naverFree: "", naverCod: "" }), [key]: value },
    }));
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
        <h3 className="font-black">옵션별 원가/마진표</h3>
        <button type="button" onClick={save} disabled={saving} className="h-9 rounded-md border border-blue-500 px-4 text-sm font-black text-blue-600 disabled:opacity-50">{saving ? "저장 중..." : "마진 저장"}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1120px] text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {["옵션명", "수량", "상품단가", "비용%", "개당비용", "부자재", "예상원가", "쿠팡(무료)", "쿠팡MG", "네이버(무료)", "네이버MG", "네이버(착불)", "네이버MG"].map((head) => (
                <th key={head} className="border-b border-r border-slate-200 px-2 py-2 text-left font-black last:border-r-0">{head}</th>
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
              return (
                <tr key={row.order_item_id || `${row.option_name}-${row.product_name}`} className="odd:bg-white even:bg-slate-50/50">
                  <td className="border-r border-slate-200 px-2 py-2 font-bold">{row.option_name || row.product_name || "-"}</td>
                  <td className="border-r border-slate-200 px-2 py-2 text-right">{Number(row.quantity || 0).toLocaleString("ko-KR")}</td>
                  <td className="border-r border-slate-200 px-2 py-2 text-right">{Number(row.unit_price || 0).toLocaleString("ko-KR")} {row.item_currency}</td>
                  <td className="border-r border-slate-200 px-2 py-2 text-right">{fmtPct(Number(row.cost_ratio || 0) * 100)}</td>
                  <td className="border-r border-slate-200 px-2 py-2 text-right">{krw(row.unit_extra_cost || 0)}</td>
                  <td className="border-r border-slate-200 px-2 py-2 text-right">{krw(row.material_unit_cost || 0)}</td>
                  <td className="border-r border-slate-200 px-2 py-2 text-right font-black text-orange-600">{krw(row.estimated_unit_cost || 0)}</td>
                  <td className="w-[96px] border-r border-slate-200 px-1.5 py-1"><input className="h-8 w-full rounded border border-slate-200 px-2 text-right outline-orange-400" type="number" value={price.coupang} onChange={(e) => update(row.order_item_id, "coupang", e.target.value)} /></td>
                  <td className="border-r border-slate-200 px-2 py-2 text-right">{formatMargin(cp)}</td>
                  <td className="w-[96px] border-r border-slate-200 px-1.5 py-1"><input className="h-8 w-full rounded border border-slate-200 px-2 text-right outline-orange-400" type="number" value={price.naverFree} onChange={(e) => update(row.order_item_id, "naverFree", e.target.value)} /></td>
                  <td className="border-r border-slate-200 px-2 py-2 text-right">{formatMargin(nf)}</td>
                  <td className="w-[96px] border-r border-slate-200 px-1.5 py-1"><input className="h-8 w-full rounded border border-slate-200 px-2 text-right outline-orange-400" type="number" value={price.naverCod} onChange={(e) => update(row.order_item_id, "naverCod", e.target.value)} /></td>
                  <td className="px-2 py-2 text-right">{formatMargin(nc)}</td>
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
    fetch(apiUrl("/api/fnos/orders"), { credentials: "include" })
      .then((res) => res.json())
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
      subtitle="FN OS 안으로 흡수한 수입ERP 발주 목록"
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
  const [products, setProducts] = useState<ImportProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"products" | "materials">("products");

  useEffect(() => {
    let alive = true;
    try {
      const cached = sessionStorage.getItem("fnos-products-cache");
      if (cached) {
        setProducts(JSON.parse(cached));
        setLoading(false);
      }
    } catch {
      // Cache is only a speed hint; ignore invalid data.
    }
    cachedJson<{ products?: ImportProduct[] }>("/api/fnos/products", 60_000)
      .then((data) => {
        if (!alive) return;
        const nextProducts = data.products || [];
        setProducts(nextProducts);
        sessionStorage.setItem("fnos-products-cache", JSON.stringify(nextProducts));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const visibleProducts = products
    .filter((product) => tab === "materials" ? isMaterial(product) : !isMaterial(product))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko-KR", { numeric: true, sensitivity: "base" }));

  return (
    <Panel
      title="제품"
      subtitle="수입 제품 카탈로그"
      action={<Link className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" href={importHref("/products/new")}>+ 새 제품</Link>}
    >
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : (
        <>
        <div className="mb-4 flex items-center gap-3 text-sm font-black">
          <button type="button" onClick={() => setTab("products")} className={tab === "products" ? "text-orange-600" : "text-slate-500"}>상품</button>
          <span className="text-slate-300">|</span>
          <button type="button" onClick={() => setTab("materials")} className={tab === "materials" ? "text-orange-600" : "text-slate-500"}>부자재</button>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {visibleProducts.map((product) => (
            <Link key={product.id} href={importHref(`/products/${product.id}/edit`)} className="min-w-0 rounded-md border border-slate-200 bg-white p-3 hover:border-orange-200">
              <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-100">
                {product.image_path && <img src={assetUrl(product.image_path)} alt={product.name} className="h-full w-full object-cover" />}
              </div>
              <div className="mt-3 font-black">{product.name}</div>
              <div className="mt-1 text-xs text-slate-500">{product.factory_name || "-"}</div>
              {isMaterial(product) ? (
                <div className="mt-2 grid gap-1 text-sm">
                  <p className="font-black text-orange-600">재고 {Number(product.material_stock || 0).toLocaleString("ko-KR")}개</p>
                  <p className="text-xs font-bold text-slate-500">원가 {krw(product.material_cost || 0)}</p>
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
    </Panel>
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    cachedJson<ImportProductDetail>(`/api/fnos/products/${id}`, 60_000)
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
      invalidateApiCache("/api/fnos/form-data");
      sessionStorage.removeItem("fnos-products-cache");
      window.location.href = importHref("/products");
    } catch {
      alert("삭제 요청이 서버에 닿지 않았습니다. 수입ERP 서버를 확인해주세요.");
    }
  }


  return (
    <Panel
      title={product?.name || "제품 상세"}
      subtitle={product ? `${product.factory_name || "-"}` : "수입ERP 제품 데이터"}
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
      const res = await fetch(`${IMPORT_ERP_URL}/api/gptmini/hs`, {
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
      setResult(error instanceof Error ? error.message : "수입ERP 서버 연결을 확인해 주세요.");
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
  const [itemType, setItemType] = useState<"PRODUCT" | "MATERIAL">("PRODUCT");
  const [linkedMaterials, setLinkedMaterials] = useState<ProductMaterialLink[]>([]);
  const [linkedProducts, setLinkedProducts] = useState<MaterialProductLink[]>([]);
  const [productLinkOpen, setProductLinkOpen] = useState(false);
  const [productLinkQuery, setProductLinkQuery] = useState("");

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
      return [...prev, { material_id: material.id, material_name: material.name, quantity_per_unit: 1, material_stock: material.material_stock || 0, material_cost: material.material_cost || 0 }];
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
      invalidateApiCache("/api/fnos/products");
      invalidateApiCache("/api/fnos/form-data");
      sessionStorage.removeItem("fnos-products-cache");
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
      invalidateApiCache("/api/fnos/form-data");
      sessionStorage.removeItem("fnos-products-cache");
      window.location.href = importHref("/products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "제품 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Panel title={id ? "제품 수정" : "새 제품 등록"} subtitle="FN OS 화면에서 입력하고 수입ERP 원장에 저장합니다.">
      {loading || detailLoading ? <p className="text-sm text-slate-500">폼 데이터를 불러오는 중...</p> : (
        <>
        <form key={product?.id || "new"} onSubmit={submit} className="grid items-start gap-5 xl:grid-cols-[220px_1fr]">
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
              {itemType === "MATERIAL" ? (
                <>
                  <Field label="재고 설정"><input className="field-input" type="number" step="1" name="material_initial_qty" defaultValue={product?.material_stock ?? product?.material_initial_qty ?? product?.material_stock_adjust ?? 0} /></Field>
                </>
              ) : null}
            </div>
            <div className="grid items-start gap-3 md:grid-cols-[2fr_.7fr_.8fr_.7fr]">
              <Field label={itemType === "MATERIAL" ? "부자재명 *" : "제품명 *"}><input className="field-input" name="name" required defaultValue={product?.name || ""} /></Field>
              <Field label="MOQ"><input className="field-input" type="number" name="moq" defaultValue={product?.moq || ""} /></Field>
              <Field label="표준 단가"><input className="field-input" type="number" step="0.01" name="std_price" defaultValue={product?.std_price || ""} /></Field>
              <Field label="통화">
                <select className="field-input" name="currency" defaultValue={product?.currency || "CNY"}>
                  {["CNY", "USD", "JPY", "KRW", "EUR"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
            </div>
            {itemType === "MATERIAL" ? (
              <div className="grid items-start gap-3 md:grid-cols-[2fr_1fr]">
                <Field label="옵션"><input className="field-input" name="options" placeholder="쉼표로 구분" defaultValue={product?.options || ""} /></Field>
                <Field label="원가 설정(원)"><input className="field-input" type="number" min="0" step="1" name="material_unit_cost" defaultValue={product?.material_unit_cost ?? product?.material_cost ?? 0} /></Field>
              </div>
            ) : (
              <div className="grid items-start gap-3 md:grid-cols-[2fr_1fr_.7fr]">
                <Field label="옵션"><input className="field-input" name="options" placeholder="예: 블랙, 화이트, 그레이 / 또는: S, M, L" defaultValue={product?.options || ""} /></Field>
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
              <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-black">부자재 연동</h3>
                  <span className="text-xs font-bold text-slate-500">상품 1개당 사용 수량</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {(data?.materials || []).filter((material) => material.id !== id).map((material) => {
                    const checked = linkedMaterials.some((item) => item.material_id === material.id);
                    const linked = linkedMaterials.find((item) => item.material_id === material.id);
                    return (
                      <label key={material.id} className={`grid grid-cols-[20px_1fr_86px] items-center gap-2 rounded-md border bg-white p-2 text-sm ${checked ? "border-orange-300" : "border-slate-200"}`}>
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
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 py-10">
            <div className="w-full max-w-4xl rounded-md bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h3 className="text-lg font-black">상품 선택</h3>
                <button type="button" className="text-2xl text-slate-400 hover:text-slate-700" onClick={() => setProductLinkOpen(false)}>×</button>
              </div>
              <div className="grid gap-3 p-5">
                <input className="field-input" value={productLinkQuery} onChange={(event) => setProductLinkQuery(event.target.value)} placeholder="제품명 검색" />
                <div className="max-h-[58vh] overflow-auto rounded-md border border-slate-200">
                  {(data?.products || [])
                    .filter((item) => !isMaterial(item) && item.id !== id)
                    .filter((item) => !productLinkQuery.trim() || item.name.toLowerCase().includes(productLinkQuery.trim().toLowerCase()))
                    .map((item) => {
                      const checked = linkedProducts.some((link) => link.product_id === item.id);
                      const linked = linkedProducts.find((link) => link.product_id === item.id);
                      return (
                        <div key={item.id} className="grid grid-cols-[72px_1fr_120px_96px] items-center gap-3 border-b border-slate-200 p-3 last:border-b-0">
                          <div className="h-14 w-14 overflow-hidden rounded-md bg-slate-100">
                            {item.image_path && <img src={assetUrl(item.image_path)} alt={item.name} className="h-full w-full object-cover" />}
                          </div>
                          <div>
                            <p className="font-black">{item.name}</p>
                            <p className="text-xs font-bold text-slate-500">{item.factory_name || "-"}</p>
                          </div>
                          <input className="field-input h-9 text-right" type="number" min="0" step="0.01" disabled={!checked} value={linked?.qty_per_product || linked?.quantity_per_unit || 1} onChange={(event) => setLinkedProductQty(item.id, event.target.value)} />
                          <button type="button" className={`h-9 rounded-md px-4 text-sm font-black ${checked ? "border border-orange-300 bg-orange-50 text-orange-700" : "bg-orange-500 text-white"}`} onClick={() => toggleLinkedProduct(item)}>
                            {checked ? "선택됨" : "추가"}
                          </button>
                        </div>
                      );
                    })}
                </div>
                <div className="flex justify-end">
                  <button type="button" className="h-10 rounded-md bg-slate-950 px-5 text-sm font-black text-white" onClick={() => setProductLinkOpen(false)}>완료</button>
                </div>
              </div>
            </div>
          </div>
        )}
        </>
      )}
    </Panel>
  );
}

function NativeOrderDetail({ id }: { id: number }) {
  const [detail, setDetail] = useState<ImportOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

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
      alert("삭제 요청이 서버에 닿지 않았습니다. 수입ERP 서버를 확인해주세요.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Panel
      title={order?.order_code || "발주 상세"}
      subtitle={order ? `${order.factory_name || "-"} · ${order.status || "-"}` : "수입ERP 발주 데이터"}
      action={<Link className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" href={importHref(`/orders/${id}/edit`)}>수정</Link>}
    >
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : order ? (
        <div className="grid gap-5">
          <div className="flex justify-end">
            <button type="button" className="rounded-md border border-rose-300 px-4 py-2 text-sm font-black text-rose-600 disabled:opacity-50" onClick={deleteOrder} disabled={deleting}>삭제</button>
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
  const [actualCurrency, setActualCurrency] = useState<"KRW" | "USD">("KRW");
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

  useEffect(() => {
    const sourceId = id || copyId;
    if (!sourceId) return;
    let alive = true;
    const isCopy = !id && Boolean(copyId);
    fetch(apiUrl(`/api/fnos/orders/${sourceId}`), { credentials: "include" })
      .then((res) => res.json())
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

  const blankLine: OrderLine = { product_id: "", product_name: "", option_value: "", quantity: "1", unit_price: "", item_currency: "CNY", line_note: "" };

  const catalogProducts = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) return data?.products || [];
    return (data?.products || []).filter((product) => (
      [product.name, String(product.id), product.factory_name, product.options]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    ));
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
  const actualPaymentKrw = actualPaymentValue > 0 ? (actualCurrency === "KRW" ? actualPaymentValue : actualPaymentValue * Number(data?.rates?.USD || 0)) : 0;
  const orderLineWon = lines.reduce((sum, line) => {
    return sum + (Number(line.quantity || 0) * Number(line.unit_price || 0) * Number(data?.rates?.[line.item_currency || "CNY"] || 0));
  }, 0) + (chinaCostAmount * Number(data?.rates?.[chinaCosts.currency || "CNY"] || 0));
  const orderTotalWon = Math.round(actualPaymentKrw > 0 ? actualPaymentKrw : orderLineWon);
  const formRateNote = rateNoteText(data?.rates, Object.keys(orderNativeTotals));
  const orderSummaryParts = [
    nativeTotalText(orderNativeTotals, "CNY"),
    ...(actualPaymentValue > 0 ? [actualCurrency === "KRW" ? krw(actualPaymentValue) : `${actualPaymentValue.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} USD`] : []),
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
    const nextLine: OrderLine = {
      product_id: String(product.id),
      product_name: product.name || "",
      option_value: selectedOption,
      quantity: "1",
      unit_price: product.std_price ? String(product.std_price) : "",
      item_currency: product.currency || "CNY",
      line_note: "",
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
      const res = await fetch(apiUrl(id ? `/api/fnos/orders/${id}` : "/api/fnos/orders"), {
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
          items: lines.filter((line) => line.product_name && line.quantity && line.unit_price),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "발주 저장에 실패했습니다.");
      invalidateApiCache("/api/fnos/orders");
      invalidateApiCache("/api/fnos/dashboard");
      invalidateApiCache("/api/fnos/calendar-production-memos");
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
      alert("삭제 요청이 서버에 닿지 않았습니다. 수입ERP 서버를 확인해주세요.");
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
    <Panel
      title={id ? "발주서 수정" : "새 발주서 작성"}
      subtitle="발주 정보와 제품 라인을 입력합니다."
      action={<span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{order?.order_code || "PO-NEW"}</span>}
    >
      {loading || detailLoading ? <p className="text-sm text-slate-500">데이터를 불러오는 중...</p> : (
        <form key={order?.id || "new"} onSubmit={submit} className="grid gap-5">
          <input type="hidden" name="platform" value={order?.platform || "FN_OS"} />
          <input type="hidden" name="currency" value={order?.currency || "CNY"} />
          <input type="hidden" name="fx_rate" value={String(fxRate)} />
          {Object.entries(visibleStageValues).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}

          <section className="grid gap-3 border-t border-slate-200 pt-4">
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

          <section className="grid gap-3">
            <div className="flex items-end justify-between border-b border-slate-200 pb-2">
              <h3 className="text-base font-black">진행 상태</h3>
              <p className="text-xs font-bold text-slate-500">날짜는 필요한 단계만 입력하면 됩니다.</p>
            </div>
            <StageProgressLane paymentMethod={paymentMethod} values={visibleStageValues} onChange={(name, value) => setStageValues((prev) => ({ ...prev, [name]: value }))} />
          </section>

          <section className="grid gap-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="text-base font-black">제품 라인</h3>
              <div className="flex gap-2">
                <button type="button" className="inline-flex h-9 items-center rounded-md border border-slate-300 px-3 text-sm font-black" onClick={() => setCatalogOpen(true)}>카탈로그에서 추가</button>
                <button type="button" className="inline-flex h-9 items-center rounded-md border border-slate-900 px-3 text-sm font-black" onClick={addEmptyLine}>+ 직접 입력</button>
              </div>
            </div>
            <div className="hidden grid-cols-[76px_1.6fr_1fr_80px_160px_120px_1fr_40px] gap-3 border-b border-slate-200 px-2 py-2 text-sm font-black text-slate-600 xl:grid">
              <span>사진</span><span>제품</span><span>옵션</span><span>수량</span><span>단가 / 통화</span><span>소계</span><span>비고</span><span />
            </div>
            <div className="grid gap-2">
              {lines.map((line, index) => {
                const subtotal = Number(line.quantity || 0) * Number(line.unit_price || 0);
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
                    <input className="field-input xl:col-start-7 xl:row-start-1" value={line.line_note} onChange={(e) => updateLine(index, { line_note: e.target.value })} placeholder="비고" />
                    <button type="button" className="h-[38px] rounded-md border border-rose-200 text-rose-600 disabled:opacity-40 xl:col-start-8 xl:row-start-1" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>×</button>
                  </div>
                );
              })}
            </div>
            <div className="grid items-end gap-4 md:grid-cols-[minmax(0,660px)_1fr]">
              <div className={`grid gap-3 rounded-md border border-slate-200 bg-white p-3 ${isTT ? "md:grid-cols-[1fr_1fr_1fr_1.55fr]" : "md:grid-cols-2"}`}>
                {isTT ? (
                  <>
                    <Field label="실결제 통화">
                      <select className="field-input" value={actualCurrency} onChange={(event) => setActualCurrency(event.target.value as "KRW" | "USD")}>
                        <option>KRW</option>
                        <option>USD</option>
                      </select>
                    </Field>
                    <Field label={`1차 결제(${actualCurrency})`}><input className="field-input text-right" type="number" min="0" step="0.01" value={actualPayment1} onChange={(event) => setActualPayment1(event.target.value)} /></Field>
                    <Field label={`2차 결제(${actualCurrency})`}><input className="field-input text-right" type="number" min="0" step="0.01" value={actualPayment2} onChange={(event) => setActualPayment2(event.target.value)} /></Field>
                    <Field label={`최종 실 결제금액(${actualCurrency})`}><p className="whitespace-nowrap px-1 py-2 text-right text-sm font-black">{actualPaymentValue.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} {actualCurrency}</p></Field>
                  </>
                ) : (
                  <>
                    <Field label="실결제 통화">
                      <select className="field-input" value={actualCurrency} onChange={(event) => setActualCurrency(event.target.value as "KRW" | "USD")}>
                        <option>KRW</option>
                        <option>USD</option>
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
            <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_1fr_1fr_1.2fr_110px]">
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

          <section className="grid gap-3 border-t border-slate-200 pt-4">
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
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 py-10">
              <div className="w-full max-w-5xl rounded-md bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-200 p-4">
                  <h3 className="text-lg font-black">제품 선택</h3>
                  <button type="button" className="text-2xl text-slate-500" onClick={() => setCatalogOpen(false)}>×</button>
                </div>
                <div className="grid gap-3 p-4">
                  <input className="field-input" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="제품명 검색" />
                  <div className="grid max-h-[58vh] gap-2 overflow-auto">
                    {catalogProducts.map((product) => {
                      const options = optionsFor(product);
                      return (
                        <div key={product.id} className="grid items-center gap-3 rounded-md border border-slate-200 p-2 md:grid-cols-[76px_1fr_180px_90px]">
                          <div className="h-16 w-16 overflow-hidden rounded-md bg-slate-100">
                            {product.image_path ? <img src={assetUrl(product.image_path)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">사진</div>}
                          </div>
                          <div>
                            <p className="font-black">{product.name}</p>
                            <p className="mt-1 text-xs font-bold text-slate-500">{product.factory_name || "-"} · {product.std_price ? `${product.std_price.toLocaleString("ko-KR")} ${product.currency || "CNY"}` : "단가 없음"}</p>
                          </div>
                          {options.length ? (
                            <select className="field-input" value={catalogOptions[product.id] || options[0]} onChange={(event) => setCatalogOptions((prev) => ({ ...prev, [product.id]: event.target.value }))}>
                              {options.map((option) => <option key={option}>{option}</option>)}
                            </select>
                          ) : <span className="text-sm font-bold text-slate-500">옵션 없음</span>}
                          <button type="button" className="inline-flex h-10 items-center justify-center rounded-md bg-orange-500 px-4 text-sm font-black text-white" onClick={() => addProduct(product)}>추가</button>
                        </div>
                      );
                    })}
                    {!catalogProducts.length && <p className="rounded-md bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">등록된 제품이 없습니다.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </form>
      )}
    </Panel>
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
        body: JSON.stringify({ ...payload, items: lines.filter((line) => line.product_name && line.quantity && line.unit_price) }),
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
        <form key={order?.id || "new"} onSubmit={submit} className="grid gap-5">
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
  const [saving, setSaving] = useState(false);
  const [factoryFormOpen, setFactoryFormOpen] = useState(false);
  const [factoryDraft, setFactoryDraft] = useState({ name: "", country: "중국", platform: "1688", contact: "", note: "" });

  async function loadSettings() {
    const next = await cachedJson<{ rates: Record<string, number>; factories: ImportFactory[] }>("/api/fnos/settings", 60_000);
    setData({ ...next, factories: sortFactories(next.factories) });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSettings();
  }, []);

  async function saveRates(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);
    await fetch(apiUrl("/api/fnos/settings/rates"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(Object.fromEntries(form.entries())),
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
        <form onSubmit={saveRates} className="grid gap-3 sm:grid-cols-2">
          {(["CNY", "USD", "JPY", "EUR"] as const).map((currency) => (
            <Field key={currency} label={`${currency} → KRW`}>
              <input className="field-input text-right" type="number" step="0.0001" name={currency} defaultValue={data?.rates?.[currency] || ""} />
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
    fetch(apiUrl("/api/fnos/settings"), { credentials: "include" })
      .then((res) => res.json())
      .then((next) => {
        if (alive) setData(next);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <Panel title="환율" subtitle="수입ERP 설정값">
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

function Panel({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-md border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status?: string }) {
  return <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{status || "-"}</span>;
}

function Dashboard() {
  return (
    <div className="space-y-6">
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
        <div className="mb-4">
          <h2 className="text-lg font-black">수입제품 현황</h2>
          <p className="mt-1 text-sm text-slate-500">수입ERP 데이터를 FN OS 네이티브 화면으로 표시합니다.</p>
        </div>
        <NativeImportDashboard compact />
      </section>
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const activeMenu = slugMenus[searchParams.get("menu") || "dashboard"] || "대시보드";
  const importPath = searchParams.get("section") || "/orders";

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
        <LeftSidebar activeMenu={activeMenu} importPath={importPath} />
        <section className="min-w-0 flex-1 px-5 py-6 sm:px-7">
          {activeMenu === "수입관리" ? (
            <NativeImportWorkspace path={importPath} />
          ) : activeMenu === "대시보드" ? (
            <Dashboard />
          ) : (
            <section className="rounded-md border border-slate-200 bg-white p-8 shadow-sm">
              <h1 className="text-2xl font-black">{activeMenu}</h1>
              <p className="mt-2 text-sm text-slate-500">이 메뉴는 다음 단계에서 실제 데이터와 기능을 연결할 영역입니다.</p>
            </section>
          )}
        </section>
        {activeMenu === "수입관리" && <RightTools />}
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
