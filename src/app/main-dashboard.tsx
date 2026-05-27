"use client";

import { useEffect, useState } from "react";

type Row = Record<string, unknown>;
type Point = { date?: string; label?: string; value?: number };

type DashboardSummary = {
  ok?: boolean;
  error?: string;
  today?: string;
  last_collected_date?: string;
  last_collected_items?: Row[];
  sales_label?: string;
  sales_latest_date?: string;
  sales_latest_amount?: number;
  seven_day_sales?: number;
  month_sales?: number;
  sales_daily?: Point[];
  order_count?: number;
  order_latest_date?: string;
  inventory_risk_count?: number;
  inventory_risk_items?: Row[];
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

function MiniBars({ points, tone = "orange" }: { points?: Point[]; tone?: "orange" | "green" | "rose" }) {
  const rows: Point[] = points?.length ? points : Array.from({ length: 14 }, (_, index) => ({ label: String(index + 1), value: 0 }));
  const max = Math.max(...rows.map((point) => n(point.value)), 1);
  const color = tone === "green" ? "bg-emerald-500" : tone === "rose" ? "bg-rose-500" : "bg-orange-500";

  return (
    <div className="flex h-16 items-end gap-1.5">
      {rows.map((point, index) => (
        <div key={`${point.date || point.label || index}`} className="group relative flex flex-1 items-end">
          <div
            className={`w-full rounded-t-sm ${color} opacity-80 transition group-hover:opacity-100`}
            style={{ height: `${Math.max(8, (n(point.value) / max) * 100)}%` }}
          />
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
      <p className="truncate text-[11px] font-black uppercase text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-xl font-black ${color}`}>{value}</p>
      {note && <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400">{note}</p>}
    </div>
  );
}

function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-md border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-black text-slate-950">{title}</h2>
          {subtitle && <p className="mt-1 truncate text-xs font-bold text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function CompactList({ rows, amountKey, emptyText }: { rows: Row[]; amountKey?: string; emptyText: string }) {
  if (!rows.length) return <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-400">{emptyText}</p>;
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 5).map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
          <span className="truncate font-bold text-slate-700">
            {String(row.display_title || row.product_name || row.sku || row.order_no || row.order_code || "-")}
          </span>
          <span className="font-black text-slate-900">{amountKey ? krw(row[amountKey]) : String(row.status || "")}</span>
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

  const collected = summary?.last_collected_items || [];
  const inquiries = summary?.inquiry_channels || [];
  const fixedCosts = summary?.upcoming_fixed_costs || [];
  const importOrders = summary?.import_recent_orders || [];
  const riskItems = summary?.inventory_risk_items || [];
  const inquiryTotal = inquiries.reduce((total, row) => total + n(row.count), 0);
  const fixedCostTotal = fixedCosts.reduce((total, row) => total + n(amountFrom(row)), 0);

  return (
    <div className="min-h-[calc(100vh-120px)] space-y-3 bg-slate-50/40">
      <header className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm xl:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end gap-3">
            <h1 className="text-3xl font-black tracking-normal text-slate-950">FN OS</h1>
            <span className="mb-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
              {dateText(summary?.today)} 기준
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {collected.map((item, index) => (
              <span key={`${String(item.label)}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-black text-slate-700">
                {String(item.label || "-")} · {dateText(item.date)}
              </span>
            ))}
            {!collected.length && <span className="text-xs font-bold text-slate-400">아직 수집된 DB 데이터가 없습니다.</span>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 xl:w-[520px]">
          <Stat label="최근 수집" value={dateText(summary?.last_collected_date)} />
          <Stat label="주문" value={`${n(summary?.order_count).toLocaleString("ko-KR")}건`} note={dateText(summary?.order_latest_date)} />
          <Stat label="재고위험" value={`${n(summary?.inventory_risk_count).toLocaleString("ko-KR")}개`} tone={n(summary?.inventory_risk_count) ? "rose" : "green"} />
        </div>
      </header>

      {loading && <div className="rounded-md border border-slate-200 bg-white p-4 text-sm font-bold text-slate-500">대시보드 데이터를 불러오는 중입니다.</div>}
      {summary?.ok === false && <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{summary.error}</div>}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="grid auto-rows-min gap-3 lg:grid-cols-2">
          <Panel title="매출/재고" subtitle={`매출 기준일 ${dateText(summary?.sales_latest_date)}`} className="lg:col-span-1">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={summary?.sales_label || "매출"} value={krw(summary?.sales_latest_amount)} tone="orange" />
              <Stat label="최근 7일" value={krw(summary?.seven_day_sales)} />
              <Stat label="이번달" value={krw(summary?.month_sales)} />
            </div>
            <div className="mt-4 rounded-md bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-black text-slate-500">
                <span>14일 매출 추이</span>
                <span>{krwLong(summary?.seven_day_sales)}</span>
              </div>
              <MiniBars points={summary?.sales_daily} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
              <Stat label="주문건수" value={`${n(summary?.order_count).toLocaleString("ko-KR")}건`} />
              <Stat label="문의" value={`${inquiryTotal.toLocaleString("ko-KR")}건`} />
              <Stat label="위험 ITEM" value={`${n(summary?.inventory_risk_count).toLocaleString("ko-KR")}개`} tone={n(summary?.inventory_risk_count) ? "rose" : "green"} />
            </div>
          </Panel>

          <Panel title="광고성과" subtitle={`광고 기준일 ${dateText(summary?.ad_latest_date)}`}>
            <div className="grid grid-cols-3 gap-3">
              <Stat label={summary?.ad_label || "광고비"} value={krw(summary?.ad_latest_spend)} tone="orange" />
              <Stat label="전환매출" value={krw(summary?.ad_conversion_sales)} />
              <Stat label="ROAS" value={`${n(summary?.ad_roas).toFixed(1)}%`} tone={n(summary?.ad_roas) >= 300 ? "green" : "slate"} />
            </div>
            <div className="mt-4 rounded-md bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-black text-slate-500">
                <span>14일 광고비 추이</span>
                <span>{krwLong(summary?.ad_seven_day_spend)}</span>
              </div>
              <MiniBars points={summary?.ad_daily} tone="green" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
              <Stat label="어제 광고비" value={krw(summary?.ad_yesterday_spend)} />
              <Stat label="최근 7일" value={krw(summary?.ad_seven_day_spend)} />
              <Stat label="이번달" value={krw(summary?.ad_month_spend)} />
            </div>
          </Panel>

          <Panel title="회계/비용" subtitle="잔고와 예정 지출은 설정 확장 예정">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="카드 사용" value={krw(summary?.card_expense_amount)} tone="orange" />
              <Stat label="통장잔고" value={summary?.bank_balance == null ? "미설정" : krw(summary.bank_balance)} />
              <Stat label="3일내 고정비" value={krw(fixedCostTotal)} tone={fixedCosts.length ? "rose" : "green"} />
            </div>
            <div className="mt-4">
              <CompactList rows={fixedCosts} amountKey="balance_amount" emptyText="3일 내 예정된 고정비가 없습니다." />
            </div>
          </Panel>

          <Panel title="수입관리" subtitle="발주 흐름 요약">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="최근 6개월 발주" value={krw(summary?.import_six_month_amount)} tone="orange" />
              <Stat label="최근 발주목록" value={`${importOrders.length.toLocaleString("ko-KR")}건`} note="최근 5건" />
            </div>
            <div className="mt-4">
              <CompactList rows={importOrders} amountKey="total_amount" emptyText="수입 발주 데이터가 없습니다." />
            </div>
          </Panel>
        </main>

        <aside className="space-y-3">
          <Panel title="오른쪽 요약" subtitle="주의할 항목만 모아보기">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="재고위험" value={`${n(summary?.inventory_risk_count).toLocaleString("ko-KR")}개`} tone={n(summary?.inventory_risk_count) ? "rose" : "green"} />
              <Stat label="고정비 예정" value={`${fixedCosts.length.toLocaleString("ko-KR")}건`} tone={fixedCosts.length ? "rose" : "green"} />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-2 text-[11px] font-black text-slate-500">재고위험 TOP</p>
              <CompactList rows={riskItems} emptyText="위험 재고가 없습니다." />
            </div>
          </Panel>

          <Panel title="채널/문의" subtitle="온라인 발주 API 호출 채널 기준">
            <div className="space-y-1.5">
              {inquiries.slice(0, 6).map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_auto] rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
                  <span className="truncate font-bold text-slate-700">{String(row.channel_name || "-")}</span>
                  <span className="font-black text-slate-950">{n(row.count).toLocaleString("ko-KR")}건</span>
                </div>
              ))}
              {!inquiries.length && <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-400">API 호출 채널이 없습니다.</p>}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
