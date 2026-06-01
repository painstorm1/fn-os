"use client";

import { useEffect, useState } from "react";
import { Card, KpiCard, StatusBadge } from "@/components/fn-ui";
import { cachedJson, readCachedJson } from "@/lib/client-cache";

type Row = Record<string, unknown>;
type Point = {
  date?: string;
  label?: string;
  month?: string;
  value?: number;
  cost?: number;
  conversion_sales?: number;
  roas?: number;
  count?: number;
  orders?: Row[];
};

type DashboardSummary = {
  ok?: boolean;
  error?: string;
  today?: string;
  collection_dates?: { orders?: string; ads?: string; accounting?: string };
  sales_label?: string;
  sales_latest_date?: string;
  sales_latest_amount?: number;
  seven_day_sales?: number;
  month_sales?: number;
  sales_daily?: Point[];
  order_count?: number;
  inventory_risk_count?: number;
  inquiry_channels?: Row[];
  ad_label?: string;
  ad_latest_date?: string;
  ad_latest_spend?: number;
  ad_yesterday_spend?: number;
  ad_seven_day_spend?: number;
  ad_month_spend?: number;
  ad_seven_day_roas?: number;
  ad_month_roas?: number;
  ad_conversion_sales?: number;
  ad_roas?: number;
  ad_daily?: Point[];
  card_expense_amount?: number;
  bank_balance?: number | null;
  upcoming_fixed_costs?: Row[];
  import_recent_orders?: Row[];
  import_six_month_amount?: number;
  import_monthly?: Point[];
};

function n(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function krw(value: unknown) {
  return `${Math.round(n(value)).toLocaleString("ko-KR")}원`;
}

function krwLong(value: unknown) {
  return krw(value);
}

function dateText(value: unknown) {
  return String(value || "").trim() || "-";
}

function amountFrom(row: Row) {
  return row.balance_amount ?? row.amount ?? row.total_amount ?? 0;
}

function orderAmount(row: Row) {
  return row.total_won ?? row.total_amount ?? row.amount ?? row.actual_payment_total_krw ?? row.actual_payment_total ?? row.actual_payment_usd ?? 0;
}

function titleFrom(row: Row) {
  return String(row.display_title || row.order_no || row.order_code || row.product_name || row.sku || row.memo || "-");
}

function subFrom(row: Row) {
  return String(row.order_date || row.expected_inbound_date || row.status || row.factory_name || row.customer_name || "").slice(0, 16);
}

function monthTitle(point: Point) {
  const raw = String(point.month || point.label || "");
  if (/^\d{6}$/.test(raw)) return `${Number(raw.slice(4, 6))}월`;
  if (/^\d{4}\.\d{2}$/.test(raw)) return `${Number(raw.slice(5, 7))}월`;
  return raw || "-";
}

function importOrderHref(row: Row) {
  const id = row.id;
  if (id === undefined || id === null || id === "") return "/?menu=import&section=%2Forders";
  return `/?menu=import&section=${encodeURIComponent(`/orders?open=${id}`)}`;
}

function monthOrdersHref(point: Point) {
  const month = String(point.month || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(month)) return "/?menu=import&section=%2Forders";
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(4, 6));
  const from = `${month.slice(0, 4)}-${month.slice(4, 6)}-01`;
  const lastDay = new Date(year, monthIndex, 0).getDate();
  const to = `${month.slice(0, 4)}-${month.slice(4, 6)}-${String(lastDay).padStart(2, "0")}`;
  return `/?menu=import&section=${encodeURIComponent(`/orders?date_from=${from}&date_to=${to}`)}`;
}

function assetUrl(path?: unknown) {
  const value = String(path || "");
  if (!value) return "";
  if (value.startsWith("http") || value.startsWith("data:image/")) return value;
  return `/api/import-erp/static/${value.replace(/^\/?static\//, "")}`;
}

function MiniBars({ points, tone = "orange", height = "h-14" }: { points?: Point[]; tone?: "orange" | "green" | "rose"; height?: string }) {
  const rows: Point[] = points?.length ? points : Array.from({ length: 6 }, (_, index) => ({ label: String(index + 1), value: 0 }));
  const max = Math.max(...rows.map((point) => n(point.value)), 1);
  const color = tone === "green" ? "bg-emerald-500" : tone === "rose" ? "bg-rose-500" : "bg-orange-500";

  return (
    <div className={`flex ${height} items-end gap-1.5`}>
      {rows.map((point, index) => (
        <div key={`${point.date || point.month || point.label || index}`} className="flex flex-1 items-end">
          <div className={`w-full rounded-t-sm ${color} opacity-85`} style={{ height: `${Math.max(7, (n(point.value) / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function AdLineChart({ points }: { points?: Point[] }) {
  const rows: Point[] = points?.length ? points : Array.from({ length: 7 }, (_, index) => ({ label: String(index + 1), date: "", cost: 0, value: 0, roas: 0 }));
  const maxCost = Math.max(...rows.map((point) => n(point.cost ?? point.value)), 1);
  const maxRoas = Math.max(...rows.map((point) => n(point.roas)), 1);
  const chartPoints = rows.map((row, index) => {
    const x = rows.length === 1 ? 50 : 6 + (index / (rows.length - 1)) * 88;
    const costY = 88 - (n(row.cost ?? row.value) / maxCost) * 68;
    const roasY = 88 - (n(row.roas) / maxRoas) * 68;
    return { row, x, costY, roasY };
  });
  const costPath = chartPoints.map(({ x, costY }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${costY.toFixed(2)}`).join(" ");
  const roasPath = chartPoints.map(({ x, roasY }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${roasY.toFixed(2)}`).join(" ");

  return (
    <div className="relative h-28 rounded-xl bg-gray-50 px-3 py-3">
      <div className="absolute right-3 top-2 z-10 flex items-center gap-2 text-[10px] font-semibold">
        <span className="flex items-center gap-1 text-orange-600"><span className="h-1.5 w-3 rounded-full bg-orange-500" />총비용</span>
        <span className="flex items-center gap-1 text-emerald-600"><span className="h-1.5 w-3 rounded-full bg-emerald-500" />ROAS</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img" aria-label="최근 7일 광고비와 ROAS">
        {[20, 54, 88].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {chartPoints.length > 1 && <path d={costPath} fill="none" stroke="#f97316" strokeWidth="2.1" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
        {chartPoints.length > 1 && <path d={roasPath} fill="none" stroke="#10b981" strokeWidth="1.9" vectorEffect="non-scaling-stroke" strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      <div className="absolute inset-x-3 top-3 h-[calc(100%-1.5rem)]">
        {chartPoints.map(({ row, x, costY, roasY }, index) => {
          const left = `${x}%`;
          const tooltipLeft = x > 78 ? "right-0" : x < 22 ? "left-0" : "left-1/2 -translate-x-1/2";
          const tooltipTop = `${Math.max(2, Math.min(costY, roasY) - 4)}%`;
          return (
            <div key={`${row.date || row.label || index}`} className="group absolute top-0 h-full w-8 -translate-x-1/2" style={{ left }}>
              <span className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-orange-500 shadow-sm" style={{ left: "50%", top: `${costY}%` }} />
              <span className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-emerald-500 shadow-sm" style={{ left: "50%", top: `${roasY}%` }} />
              <div className={`absolute z-10 hidden min-w-[142px] rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-600 shadow-lg group-hover:block ${tooltipLeft}`} style={{ top: tooltipTop }}>
                <p className="font-semibold text-gray-900">{dateText(row.date || row.label)}</p>
                <p className="mt-1 flex justify-between gap-3"><span>ROAS</span><span>{n(row.roas).toFixed(1)}%</span></p>
                <p className="mt-1 flex justify-between gap-3"><span>총비용</span><span>{krw(row.cost ?? row.value)}</span></p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, note, tone = "slate" }: { label: string; value: string; note?: string; tone?: "slate" | "orange" | "green" | "rose" }) {
  const kpiTone = tone === "green" ? "success" : tone === "rose" ? "danger" : tone === "orange" ? "orange" : "default";
  return <KpiCard label={label} value={value} note={note} tone={kpiTone} className="border-0 bg-transparent p-0 shadow-none" />;
}

function CollectionDate({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-[116px] text-left">
      <p className="text-[11px] font-black text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-black text-slate-900">{dateText(value)}</p>
    </div>
  );
}

function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`p-5 ${className}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold leading-snug text-gray-900">{title}</h2>
        {subtitle && <div className="mt-1 text-sm text-gray-500">{subtitle}</div>}
      </div>
      {children}
    </Card>
  );
}

function importStatusClass(status: unknown) {
  const value = String(status || "");
  if (value.includes("입고완료") || value.includes("통관완료")) return "bg-emerald-50 text-emerald-700";
  if (value.includes("공장출고") || value.includes("출고")) return "bg-orange-50 text-orange-700";
  if (value.includes("결제")) return "bg-rose-50 text-rose-700";
  if (value.includes("발주") || value.includes("생산")) return "bg-sky-50 text-sky-700";
  return "bg-slate-100 text-slate-600";
}

function ImportOrderRows({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="rounded-xl bg-gray-50 px-3 py-8 text-center text-sm font-medium text-gray-400">수입 발주 데이터가 없습니다.</p>;
  return (
    <div className="fn-table-shell">
      <div className="grid h-11 grid-cols-[106px_minmax(0,1.35fr)_minmax(0,0.9fr)_82px_122px_82px] items-center gap-3 bg-gray-50 px-3 text-xs font-semibold text-gray-600">
        <span>주문날짜</span>
        <span>대표 제품</span>
        <span>공장</span>
        <span className="text-right">수량</span>
        <span className="text-right">금액(원)</span>
        <span className="text-right">상태</span>
      </div>
      {rows.slice(0, 10).map((row, index) => (
        <a
          key={`${row.id || index}`}
          href={importOrderHref(row)}
          className="grid min-h-13 grid-cols-[106px_minmax(0,1.35fr)_minmax(0,0.9fr)_82px_122px_82px] items-center gap-3 border-t border-gray-100 px-3 py-2 text-sm transition hover:bg-orange-50/70"
        >
          <span className="font-black text-slate-900">{dateText(row.order_date).slice(0, 10)}</span>
          <span className="grid min-w-0 grid-cols-[48px_1fr] items-center gap-3">
            {assetUrl(row.repr_image) ? <img src={assetUrl(row.repr_image)} alt="" className="h-12 w-12 rounded-md object-cover" /> : <span className="h-12 w-12 rounded-md bg-slate-100" />}
            <span className="truncate font-black text-slate-800">{String(row.repr_product || titleFrom(row))}</span>
          </span>
          <span className="truncate font-bold text-slate-600">{String(row.factory_name || "-")}</span>
          <span className="text-right font-bold text-slate-700">{n(row.total_qty).toLocaleString("ko-KR")}</span>
          <span className="text-right font-black text-slate-950">{krwLong(orderAmount(row))}</span>
          <span className="text-right">
            <StatusBadge className={importStatusClass(row.status)}>{String(row.status || "-")}</StatusBadge>
          </span>
        </a>
      ))}
    </div>
  );
}

function ImportMonthlyAmounts({ months }: { months?: Point[] }) {
  const groups = months || [];
  if (!groups.length) return <p className="py-6 text-center text-sm font-medium text-gray-400">월별 발주금액이 없습니다.</p>;
  return (
    <div className="divide-y divide-gray-100">
      {groups.map((group) => (
        <a key={group.month || group.label} href={monthOrdersHref(group)} className="-mx-2 flex items-baseline justify-between gap-4 rounded-lg px-2 py-2 text-sm transition hover:bg-orange-50/70 hover:text-orange-600">
          <span className="flex items-baseline gap-2">
            <span className="min-w-8 font-black text-slate-950">{monthTitle(group)}</span>
            <span className="text-xs font-black text-slate-500">{n(group.count).toLocaleString("ko-KR")}건</span>
          </span>
          <span className="text-right text-base font-black tabular-nums text-orange-600">{krwLong(group.value)}</span>
        </a>
      ))}
    </div>
  );
}

function FixedCostList({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="rounded-xl bg-gray-50 px-3 py-3 text-center text-xs font-medium text-gray-400">3일 내 예정된 고정비가 없습니다.</p>;
  return (
    <div className="space-y-2">
      {rows.slice(0, 3).map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
          <span className="truncate font-bold text-slate-700">{titleFrom(row)}</span>
          <span className="font-black text-slate-950">{krw(amountFrom(row))}</span>
        </div>
      ))}
    </div>
  );
}

export default function MainDashboard() {
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
    cachedJson<DashboardSummary>("/api/dashboard/summary", {
      ttl: 45_000,
      storageTtl: 60_000,
      onUpdate: (data) => {
        if (alive) setSummary(data);
      },
    })
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

  const fixedCosts = summary?.upcoming_fixed_costs || [];
  const importOrders = summary?.import_recent_orders || [];
  const fixedCostTotal = fixedCosts.reduce((total, row) => total + n(amountFrom(row)), 0);
  const inquiryTotal = (summary?.inquiry_channels || []).reduce((total, row) => total + n(row.count), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-[28px] font-bold leading-[1.3] tracking-normal text-gray-900">FN OS</h1>
          <p className="mt-1.5 text-sm font-medium text-gray-500">{dateText(summary?.today)}</p>
          {loading && <p className="mt-1 text-xs font-medium text-gray-400">대시보드 데이터를 불러오는 중입니다.</p>}
          {summary?.ok === false && <p className="mt-1 text-xs font-semibold text-rose-600">{summary.error}</p>}
        </div>
        <div className="grid grid-cols-3 gap-5 pt-2">
          <CollectionDate label="주문수집" value={summary?.collection_dates?.orders} />
          <CollectionDate label="광고수집" value={summary?.collection_dates?.ads} />
          <CollectionDate label="회계수집" value={summary?.collection_dates?.accounting} />
        </div>
      </header>

      <main className="grid gap-5 xl:grid-cols-3">
        <Panel title="매출/재고" subtitle={`매출 기준일 ${dateText(summary?.sales_latest_date)}`}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={summary?.sales_label || "매출"} value={krw(summary?.sales_latest_amount)} tone="orange" />
            <Stat label="최근 7일" value={krw(summary?.seven_day_sales)} />
            <Stat label="이번달" value={krw(summary?.month_sales)} />
          </div>
          <div className="mt-4 rounded-xl bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-gray-500">
              <span>14일 매출</span>
              <span>{krwLong(summary?.seven_day_sales)}</span>
            </div>
            <MiniBars points={summary?.sales_daily} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-gray-100 pt-4">
            <Stat label="주문" value={`${n(summary?.order_count).toLocaleString("ko-KR")}건`} />
            <Stat label="문의" value={`${inquiryTotal.toLocaleString("ko-KR")}건`} />
            <Stat label="재고위험" value={`${n(summary?.inventory_risk_count).toLocaleString("ko-KR")}개`} tone={n(summary?.inventory_risk_count) ? "rose" : "green"} />
          </div>
        </Panel>

        <Panel title="광고성과" subtitle={`광고 기준일 ${dateText(summary?.ad_latest_date)}`}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={summary?.ad_label || "광고비"} value={krw(summary?.ad_latest_spend)} tone="orange" />
            <Stat label="전환매출" value={krw(summary?.ad_conversion_sales)} />
            <Stat label="ROAS" value={`${n(summary?.ad_roas).toFixed(1)}%`} tone={n(summary?.ad_roas) >= 300 ? "green" : "slate"} />
          </div>
          <div className="mt-4">
            <AdLineChart points={summary?.ad_daily} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4">
            <Stat label="최근 7일" value={krw(summary?.ad_seven_day_spend)} note={`ROAS ${n(summary?.ad_seven_day_roas).toFixed(1)}%`} />
            <Stat label="이번달" value={krw(summary?.ad_month_spend)} note={`ROAS ${n(summary?.ad_month_roas).toFixed(1)}%`} />
          </div>
        </Panel>

        <Panel title="회계/비용" subtitle="카드/잔고/예정 고정비">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="카드 사용" value={krw(summary?.card_expense_amount)} tone="orange" />
            <Stat label="통장잔고" value={summary?.bank_balance == null ? "미설정" : krw(summary.bank_balance)} />
            <Stat label="3일내 고정비" value={krw(fixedCostTotal)} tone={fixedCosts.length ? "rose" : "green"} />
          </div>
          <div className="mt-4">
            <FixedCostList rows={fixedCosts} />
          </div>
        </Panel>

        <Panel title="수입관리" className="xl:col-span-3">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(260px,3fr)]">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-black text-slate-500">최근 발주목록</p>
                <p className="text-xs font-bold text-slate-400">{importOrders.length.toLocaleString("ko-KR")}건</p>
              </div>
              <ImportOrderRows rows={importOrders} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-black text-slate-500">월별 수입 금액</p>
                <p className="text-xs font-bold text-slate-400">최근 6개월</p>
              </div>
              <ImportMonthlyAmounts months={summary?.import_monthly} />
            </div>
          </div>
        </Panel>
      </main>
    </div>
  );
}
