"use client";

import { useEffect, useState } from "react";

type Row = Record<string, unknown>;
type Point = { date?: string; label?: string; month?: string; value?: number; count?: number; orders?: Row[] };

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
  const amount = Math.round(n(value));
  if (Math.abs(amount) >= 100_000_000) return `${(amount / 100_000_000).toFixed(1)}억`;
  if (Math.abs(amount) >= 10_000) return `${Math.round(amount / 10_000).toLocaleString("ko-KR")}만`;
  return `${amount.toLocaleString("ko-KR")}원`;
}

function krwLong(value: unknown) {
  return `${Math.round(n(value)).toLocaleString("ko-KR")}원`;
}

function dateText(value: unknown) {
  return String(value || "").trim() || "-";
}

function amountFrom(row: Row) {
  return row.balance_amount ?? row.amount ?? row.total_amount ?? 0;
}

function orderAmount(row: Row) {
  return row.total_amount ?? row.amount ?? row.actual_payment_total_krw ?? row.actual_payment_total ?? row.actual_payment_usd ?? 0;
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
  return `/?menu=import&section=${encodeURIComponent(`/orders/${id}/edit`)}`;
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

function Stat({ label, value, note, tone = "slate" }: { label: string; value: string; note?: string; tone?: "slate" | "orange" | "green" | "rose" }) {
  const color = {
    slate: "text-slate-950",
    orange: "text-orange-600",
    green: "text-emerald-600",
    rose: "text-rose-600",
  }[tone];

  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-black text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-xl font-black ${color}`}>{value}</p>
      {note && <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400">{note}</p>}
    </div>
  );
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
    <section className={`rounded-md border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3">
        <h2 className="text-sm font-black text-slate-950">{title}</h2>
        {subtitle && <p className="mt-1 text-xs font-bold text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function MonthlyImportList({ months }: { months?: Point[] }) {
  const groups = months || [];
  if (!groups.length) return <p className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm font-bold text-slate-400">수입 발주 데이터가 없습니다.</p>;
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      {groups.map((group) => (
        <section key={group.month || group.label} className="border-b border-slate-100 last:border-b-0">
          <div className="grid grid-cols-[130px_1fr_80px] items-center bg-slate-50 px-3 py-2 text-sm">
            <p className="font-black text-slate-950">{monthTitle(group)}</p>
            <p className="font-black text-orange-600">{krwLong(group.value)}</p>
            <p className="text-right text-xs font-black text-slate-500">{n(group.count).toLocaleString("ko-KR")}건</p>
          </div>
          <div className="divide-y divide-slate-100">
            {(group.orders || []).slice(0, 8).map((row, index) => (
              <a
                key={`${row.id || index}`}
                href={importOrderHref(row)}
                className="grid grid-cols-[96px_minmax(0,1.3fr)_minmax(0,1fr)_80px_110px_82px] items-center gap-3 px-3 py-2 text-xs transition hover:bg-orange-50"
              >
                <span className="font-black text-slate-900">{dateText(row.order_date).slice(0, 10)}</span>
                <span className="truncate font-black text-slate-800">{String(row.repr_product || titleFrom(row))}</span>
                <span className="truncate font-bold text-slate-600">{String(row.factory_name || "-")}</span>
                <span className="text-right font-bold text-slate-700">{n(row.total_qty).toLocaleString("ko-KR")}</span>
                <span className="text-right font-black text-slate-950">{krwLong(orderAmount(row))}</span>
                <span className="text-right font-black text-orange-600">{String(row.status || "-")}</span>
              </a>
            ))}
            {!(group.orders || []).length && <p className="px-3 py-3 text-xs font-bold text-slate-400">해당 월 발주가 없습니다.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

function FixedCostList({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="rounded-md bg-slate-50 px-3 py-3 text-center text-xs font-bold text-slate-400">3일 내 예정된 고정비가 없습니다.</p>;
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 3).map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_auto] gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
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
    fetch("/api/dashboard/summary", { cache: "no-store" })
      .then((res) => res.json())
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
    };
  }, []);

  const fixedCosts = summary?.upcoming_fixed_costs || [];
  const importOrders = summary?.import_recent_orders || [];
  const fixedCostTotal = fixedCosts.reduce((total, row) => total + n(amountFrom(row)), 0);
  const inquiryTotal = (summary?.inquiry_channels || []).reduce((total, row) => total + n(row.count), 0);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-5xl font-black tracking-normal text-slate-950">FN OS</h1>
          <p className="mt-2 text-2xl font-black text-slate-700">{dateText(summary?.today)}</p>
          {loading && <p className="mt-1 text-xs font-bold text-slate-400">대시보드 데이터를 불러오는 중입니다.</p>}
          {summary?.ok === false && <p className="mt-1 text-xs font-bold text-rose-600">{summary.error}</p>}
        </div>
        <div className="grid grid-cols-3 gap-5 pt-2">
          <CollectionDate label="주문수집" value={summary?.collection_dates?.orders} />
          <CollectionDate label="광고수집" value={summary?.collection_dates?.ads} />
          <CollectionDate label="회계수집" value={summary?.collection_dates?.accounting} />
        </div>
      </header>

      <main className="grid gap-3 xl:grid-cols-3">
        <Panel title="매출/재고" subtitle={`매출 기준일 ${dateText(summary?.sales_latest_date)}`}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={summary?.sales_label || "매출"} value={krw(summary?.sales_latest_amount)} tone="orange" />
            <Stat label="최근 7일" value={krw(summary?.seven_day_sales)} />
            <Stat label="이번달" value={krw(summary?.month_sales)} />
          </div>
          <div className="mt-3 rounded-md bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] font-black text-slate-500">
              <span>14일 매출</span>
              <span>{krwLong(summary?.seven_day_sales)}</span>
            </div>
            <MiniBars points={summary?.sales_daily} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
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
          <div className="mt-3 rounded-md bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] font-black text-slate-500">
              <span>14일 광고비</span>
              <span>{krwLong(summary?.ad_seven_day_spend)}</span>
            </div>
            <MiniBars points={summary?.ad_daily} tone="green" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
            <Stat label="어제" value={krw(summary?.ad_yesterday_spend)} />
            <Stat label="최근 7일" value={krw(summary?.ad_seven_day_spend)} />
            <Stat label="이번달" value={krw(summary?.ad_month_spend)} />
          </div>
        </Panel>

        <Panel title="회계/비용" subtitle="카드/잔고/예정 고정비">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="카드 사용" value={krw(summary?.card_expense_amount)} tone="orange" />
            <Stat label="통장잔고" value={summary?.bank_balance == null ? "미설정" : krw(summary.bank_balance)} />
            <Stat label="3일내 고정비" value={krw(fixedCostTotal)} tone={fixedCosts.length ? "rose" : "green"} />
          </div>
          <div className="mt-3">
            <FixedCostList rows={fixedCosts} />
          </div>
        </Panel>

        <Panel title="수입관리" subtitle="월별 발주금액과 발주목록입니다. 행을 클릭하면 해당 발주 빠른수정 화면으로 이동합니다." className="xl:col-span-3">
          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
            <div className="rounded-md bg-orange-50 p-4">
              <p className="text-xs font-black text-orange-700">최근 6개월 발주금액</p>
              <p className="mt-2 text-2xl font-black text-orange-600">{krw(summary?.import_six_month_amount)}</p>
              <p className="mt-1 text-xs font-bold text-orange-700/70">최근 발주 {importOrders.length.toLocaleString("ko-KR")}건</p>
            </div>
            <MonthlyImportList months={summary?.import_monthly} />
          </div>
        </Panel>
      </main>
    </div>
  );
}
