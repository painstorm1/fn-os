"use client";

import { useEffect, useState } from "react";

type Row = Record<string, unknown>;

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
  return `${Math.round(n(value)).toLocaleString("ko-KR")}원`;
}

function dateText(value: unknown) {
  const text = String(value || "").trim();
  return text || "-";
}

function amountFrom(row: Row) {
  return row.balance_amount ?? row.amount ?? row.total_amount ?? 0;
}

function Metric({
  label,
  value,
  note,
  tone = "slate",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "slate" | "orange" | "green" | "rose";
}) {
  const toneClass = {
    slate: "text-slate-950",
    orange: "text-orange-600",
    green: "text-emerald-600",
    rose: "text-rose-600",
  }[tone];

  return (
    <article className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${toneClass}`}>{value}</p>
      {note && <p className="mt-1 text-xs font-bold text-slate-500">{note}</p>}
    </article>
  );
}

function DataList({
  title,
  rows,
  labelKey,
  amountKey,
  emptyText,
}: {
  title: string;
  rows: Row[];
  labelKey: string;
  amountKey?: string;
  emptyText: string;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-black">{title}</h2>
      <div className="mt-4 space-y-2">
        {rows.slice(0, 6).map((row, index) => (
          <div key={`${title}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span className="truncate font-bold text-slate-700">
              {String(row[labelKey] || row.display_title || row.product_name || row.sku || "-")}
            </span>
            <span className="font-black text-slate-950">{amountKey ? krw(row[amountKey]) : String(row.status || "-")}</span>
          </div>
        ))}
        {!rows.length && <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-400">{emptyText}</p>}
      </div>
    </section>
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
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-3xl font-black tracking-normal">FN OS</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">{dateText(summary?.today)} 기준 운영 현황</p>
        </div>
        <div className="text-right text-xs font-bold text-slate-500">
          <p>최근 수집</p>
          <p className="mt-1 text-base font-black text-slate-950">{dateText(summary?.last_collected_date)}</p>
        </div>
      </header>

      {loading && <div className="rounded-md border border-slate-200 bg-white p-5 text-sm font-bold text-slate-500">대시보드 데이터를 불러오는 중입니다.</div>}
      {summary?.ok === false && <div className="rounded-md border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">{summary.error}</div>}

      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-slate-700">최근 수집된 내용</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {collected.map((item, index) => (
            <span key={`${String(item.label)}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
              {String(item.label || "-")} · {dateText(item.date)}
            </span>
          ))}
          {!collected.length && <span className="text-sm font-bold text-slate-400">아직 수집된 DB 데이터가 없습니다.</span>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-black">매출/재고 DB</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label={summary?.sales_label || "매출"} value={krw(summary?.sales_latest_amount)} note={`기준일 ${dateText(summary?.sales_latest_date)}`} tone="orange" />
          <Metric label="최근 7일 매출" value={krw(summary?.seven_day_sales)} />
          <Metric label="이번달 매출" value={krw(summary?.month_sales)} />
          <Metric label="주문건수" value={`${n(summary?.order_count).toLocaleString("ko-KR")}건`} note={`기준일 ${dateText(summary?.order_latest_date)}`} />
          <Metric label="재고위험 ITEM" value={`${n(summary?.inventory_risk_count).toLocaleString("ko-KR")}개`} tone={n(summary?.inventory_risk_count) > 0 ? "rose" : "green"} />
          <Metric
            label="문의"
            value={`${inquiryTotal.toLocaleString("ko-KR")}건`}
            note={inquiries.length ? inquiries.map((row) => `${String(row.channel_name || "-")} ${n(row.count)}건`).join(" · ") : "API 호출 채널 기준"}
          />
        </div>
        <DataList title="재고위험 TOP" rows={riskItems} labelKey="sku" emptyText="위험 재고가 없습니다." />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-black">광고분석 DB</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label={summary?.ad_label || "광고비"} value={krw(summary?.ad_latest_spend)} note={`기준일 ${dateText(summary?.ad_latest_date)}`} tone="orange" />
          <Metric label="어제 광고비" value={krw(summary?.ad_yesterday_spend)} />
          <Metric label="최근 7일 광고비" value={krw(summary?.ad_seven_day_spend)} />
          <Metric label="이번달 지출광고비" value={krw(summary?.ad_month_spend)} />
          <Metric label="구매완료 전환매출액" value={krw(summary?.ad_conversion_sales)} />
          <Metric label="ROAS" value={`${n(summary?.ad_roas).toFixed(1)}%`} tone={n(summary?.ad_roas) >= 300 ? "green" : "slate"} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-black">회계/비용 DB</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Metric label="카드 사용금액" value={krw(summary?.card_expense_amount)} note="결제일 기준 설정은 다음 단계" />
          <Metric label="현재 통장잔고" value={summary?.bank_balance == null ? "미설정" : krw(summary.bank_balance)} note="잔고 입력/연동 필요" />
          <Metric label="3일내 고정비" value={krw(fixedCostTotal)} note={`${fixedCosts.length.toLocaleString("ko-KR")}건 예정`} tone={fixedCosts.length ? "rose" : "green"} />
        </div>
        <DataList title="3일내 고정비 리스트" rows={fixedCosts} labelKey="display_title" amountKey="balance_amount" emptyText="3일 내 예정된 고정비가 없습니다." />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-black">수입관리</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Metric label="최근 6개월 발주금액" value={krw(summary?.import_six_month_amount)} />
          <Metric label="최근 발주목록" value={`${importOrders.length.toLocaleString("ko-KR")}건`} note="최근 5건" />
        </div>
        <DataList title="발주목록 최근 5건" rows={importOrders} labelKey="display_title" amountKey="total_amount" emptyText="수입 발주 데이터가 없습니다." />
      </section>
    </div>
  );
}
