"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
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

function CalendarMemo() {
  const today = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(formatDateKey(today));
  const [memoText, setMemoText] = useState("");
  const [memos, setMemos] = useState<Record<string, string[]>>({});

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
          const hasMemo = Boolean(memos[key]?.length);
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
          {(memos[selected] || []).map((memo, index) => (
            <div key={`${memo}-${index}`} className="flex items-start justify-between gap-2 text-xs">
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
                onClick={(event) => {
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
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  href?: string;
  showChevron?: boolean;
}) {
  return (
    <details className="mb-3 rounded-md border border-slate-200 bg-white" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-md bg-slate-50 px-3 py-3 text-sm font-black [&::-webkit-details-marker]:hidden">
        <span>{showChevron ? "▼ " : ""}{title}</span>
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

  async function copy() {
    await navigator.clipboard.writeText(text);
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
      <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 pr-14 text-xs leading-7 text-slate-700">{text}</pre>
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

      <ToolSection title="타배 위해 주소" href="https://www.tabae.co.kr/" showChevron={false}>
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

      <ToolSection title="짐패스 도쿄 주소" href="https://www.jimpass.com/" showChevron={false}>
        <AddressBlock
          text={`우편번호 (郵便番号) : 103-0015

도도부현 (都道府県) : 東京都

시구, 번지 (住所1) : 中央区日本橋箱崎町44-7

그밖의 주소(住所2) : 4階 JK65203

전화번호 (電話番号) : 03-3527-3876`}
        />
      </ToolSection>

      <ToolSection title="FN 영문주소">
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
  shipping_method?: string;
  note?: string;
};

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
  hs_code?: string;
  basic_rate?: number;
  fta_rate?: number;
  moq?: number;
  note?: string;
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
};

type OrderLine = {
  product_id: string;
  product_name: string;
  option_value: string;
  quantity: string;
  unit_price: string;
  item_currency: string;
  line_note: string;
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
};

type ImportOrderDetail = {
  ok: boolean;
  order: ImportOrder;
  items: ImportOrderItem[];
  total_won?: number;
  total_qty?: number;
};

type ImportProductDetail = {
  ok: boolean;
  product: ImportProduct;
  history: Array<{ id: number; order_code?: string; order_date?: string; paid_date?: string; factory?: string; quantity?: number; unit_price?: number; item_currency?: string; status?: string }>;
};

function apiUrl(path: string) {
  return `${IMPORT_ERP_URL}${path}`;
}

function importHref(path: string) {
  return `/?menu=import&section=${encodeURIComponent(path)}`;
}

function assetUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${IMPORT_ERP_URL}/static/${path.replace(/^\/?static\//, "")}`;
}

function krw(value?: number) {
  return `₩${Math.round(value || 0).toLocaleString("ko-KR")}`;
}

function NativeImportDashboard({ compact = false }: { compact?: boolean }) {
  const [recent, setRecent] = useState<ImportOrder[]>([]);
  const [monthly, setMonthly] = useState<Array<{ month: string; cnt: number; amount: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/fnos/dashboard"), { credentials: "include" })
      .then((res) => res.json())
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
      <Panel title="최근 발주" subtitle="수입ERP 데이터 원장 기준 최근 10건">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="py-2">발주일</th>
                <th className="py-2">제품</th>
                <th className="py-2">공급사</th>
                <th className="py-2 text-right">수량</th>
                <th className="py-2 text-right">금액</th>
                <th className="py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((order) => (
                <tr key={order.id} className="border-b border-slate-100">
                  <td className="py-3 font-bold">{order.order_date || order.paid_date || "-"}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      {order.repr_image ? (
                        <img src={assetUrl(order.repr_image)} alt="" className="h-10 w-10 rounded-md object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-slate-100" />
                      )}
                      <div>
                        <div className="font-black">{order.repr_product || "제품 라인 없음"}</div>
                        {(order.line_count || 0) > 1 && <div className="text-xs text-slate-500">외 {(order.line_count || 1) - 1}건</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-3">{order.factory_name || "-"}</td>
                  <td className="py-3 text-right">{Math.round(order.total_qty || 0).toLocaleString("ko-KR")}</td>
                  <td className="py-3 text-right font-black">{krw(order.total_won)}</td>
                  <td className="py-3"><StatusPill status={order.status} /></td>
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
  const orderEditMatch = path.match(/^\/orders\/(\d+)\/edit/);
  const orderMatch = path.match(/^\/orders\/(\d+)/);
  const productEditMatch = path.match(/^\/products\/(\d+)\/edit/);
  const productMatch = path.match(/^\/products\/(\d+)/);
  if (path.startsWith("/orders/new")) return <NativeOrderForm />;
  if (path.startsWith("/products/new")) return <NativeProductForm />;
  if (orderEditMatch) return <NativeOrderForm id={Number(orderEditMatch[1])} />;
  if (orderMatch) return <NativeOrderDetail id={Number(orderMatch[1])} />;
  if (productEditMatch) return <NativeProductForm id={Number(productEditMatch[1])} />;
  if (productMatch) return <NativeProductDetail id={Number(productMatch[1])} />;
  if (path.startsWith("/products")) return <NativeProducts />;
  if (path.startsWith("/settings")) return <NativeSettings />;
  return <NativeOrders />;
}

function NativeOrders() {
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

  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/fnos/products"), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (alive) setProducts(data.products || []);
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
      title="제품"
      subtitle="수입 제품 카탈로그"
      action={<Link className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" href={importHref("/products/new")}>+ 새 제품</Link>}
    >
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : (
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {products.map((product) => (
            <Link key={product.id} href={importHref(`/products/${product.id}`)} className="rounded-md border border-slate-200 bg-white p-3 hover:border-orange-200">
              <div className="aspect-square overflow-hidden rounded-md bg-slate-100">
                {product.image_path && <img src={assetUrl(product.image_path)} alt={product.name} className="h-full w-full object-cover" />}
              </div>
              <div className="mt-3 font-black">{product.name}</div>
              <div className="mt-1 text-xs text-slate-500">{product.factory_name || "-"}</div>
              <div className="mt-2 text-sm font-black text-orange-600">{product.std_price ? `${product.std_price.toLocaleString("ko-KR")} ${product.currency || ""}` : "-"}</div>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function useImportFormData() {
  const [data, setData] = useState<ImportFormData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/fnos/form-data"), { credentials: "include" })
      .then((res) => res.json())
      .then((next) => {
        if (alive) setData(next);
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
    fetch(apiUrl(`/api/fnos/products/${id}`), { credentials: "include" })
      .then((res) => res.json())
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
  return (
    <Panel
      title={product?.name || "제품 상세"}
      subtitle={product ? `${product.factory_name || "-"}` : "수입ERP 제품 데이터"}
      action={<Link className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" href={importHref(`/products/${id}/edit`)}>수정</Link>}
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
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [productUrl, setProductUrl] = useState("");

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleImageChange(nextFile?: File) {
    setFile(nextFile || null);
    setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : "");
  }

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetch(apiUrl(`/api/fnos/products/${id}`), { credentials: "include" })
      .then((res) => res.json())
      .then((next) => {
        if (alive) {
          setProduct(next.product || null);
          setProductUrl(next.product?.product_url || "");
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
    if (file) form.set("image", file);
    try {
      const res = await fetch(apiUrl(id ? `/api/fnos/products/${id}` : "/api/fnos/products"), {
        method: id ? "PUT" : "POST",
        body: form,
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "제품 저장에 실패했습니다.");
      window.location.href = importHref(id ? `/products/${id}` : "/products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "제품 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={id ? "제품 수정" : "새 제품 등록"} subtitle="FN OS 화면에서 입력하고 수입ERP 원장에 저장합니다.">
      {loading || detailLoading ? <p className="text-sm text-slate-500">폼 데이터를 불러오는 중...</p> : (
        <form key={product?.id || "new"} onSubmit={submit} className="grid items-start gap-5 xl:grid-cols-[220px_1fr]">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-black">제품 사진</p>
              <div className="mt-2 h-[200px] w-[200px] overflow-hidden rounded-md border border-slate-200 bg-slate-100">
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
            <GptMiniProductBox />
          </div>

          <div className="grid gap-3">
            <div className="grid items-start gap-3 md:grid-cols-[2fr_.7fr_.8fr_.7fr]">
              <Field label="제품명 *"><input className="field-input" name="name" required defaultValue={product?.name || ""} /></Field>
              <Field label="MOQ"><input className="field-input" type="number" name="moq" defaultValue={product?.moq || ""} /></Field>
              <Field label="표준 단가"><input className="field-input" type="number" step="0.01" name="std_price" defaultValue={product?.std_price || ""} /></Field>
              <Field label="통화">
                <select className="field-input" name="currency" defaultValue={product?.currency || "CNY"}>
                  {["CNY", "USD", "JPY", "KRW", "EUR"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
            </div>
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
            <div className="grid items-start gap-3 md:grid-cols-[2fr_.8fr_.8fr_.8fr]">
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
              <Field label="HS 코드"><input className="field-input" name="hs_code" placeholder="0000.00.0000" defaultValue={product?.hs_code || ""} /></Field>
              <Field label="기본 관세율 (%)"><input className="field-input" type="number" step="0.1" name="basic_rate" defaultValue={product?.basic_rate || 0} /></Field>
              <Field label="FTA 관세율 (%)"><input className="field-input" type="number" step="0.1" name="fta_rate" defaultValue={product?.fta_rate || 0} /></Field>
            </div>
            <Field label="메모"><textarea className="field-input" name="note" defaultValue={product?.note || ""} /></Field>
            {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-bold" href={importHref(id ? `/products/${id}` : "/products")}>취소</Link>
              <button className="inline-flex h-10 items-center justify-center rounded-md bg-orange-500 px-5 text-sm font-black text-white disabled:opacity-50" disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </form>
      )}
    </Panel>
  );
}

function NativeOrderDetail({ id }: { id: number }) {
  const [detail, setDetail] = useState<ImportOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(apiUrl(`/api/fnos/orders/${id}`), { credentials: "include" })
      .then((res) => res.json())
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
  return (
    <Panel
      title={order?.order_code || "발주 상세"}
      subtitle={order ? `${order.factory_name || "-"} · ${order.status || "-"}` : "수입ERP 발주 데이터"}
      action={<Link className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white" href={importHref(`/orders/${id}/edit`)}>수정</Link>}
    >
      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : order ? (
        <div className="grid gap-5">
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

function NativeOrderForm({ id }: { id?: number }) {
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
    fetch(apiUrl(`/api/fnos/orders/${id}`), { credentials: "include" })
      .then((res) => res.json())
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
            <Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold" href={importHref(id ? `/orders/${id}` : "/orders")}>취소</Link>
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

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
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
