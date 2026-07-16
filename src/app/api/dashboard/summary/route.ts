import { NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { mainDashboardSummary, salesHistorySummary } from "@/lib/main-dashboard";

const MAIN_DASHBOARD_SUMMARY_KEYS = [
  "today",
  "collection_dates",
  "sales_label",
  "sales_latest_date",
  "sales_latest_amount",
  "seven_day_sales",
  "month_sales",
  "sales_daily",
  "order_count",
  "inventory_risk_count",
  "inquiry_channels",
  "ad_label",
  "ad_latest_date",
  "ad_latest_spend",
  "ad_seven_day_spend",
  "ad_month_spend",
  "ad_seven_day_roas",
  "ad_month_roas",
  "ad_conversion_sales",
  "ad_roas",
  "ad_daily",
  "card_expense_amount",
  "bank_balance",
  "upcoming_fixed_costs",
  "import_recent_orders",
  "import_monthly",
] as const satisfies ReadonlyArray<keyof Awaited<ReturnType<typeof mainDashboardSummary>>>;

function projectMainDashboardSummary(summary: Awaited<ReturnType<typeof mainDashboardSummary>>) {
  return Object.fromEntries(MAIN_DASHBOARD_SUMMARY_KEYS.map((key) => [key, summary[key]]));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    const summary = scope === "sales-history"
      ? await salesHistorySummary()
      : scope === "main"
        ? projectMainDashboardSummary(await mainDashboardSummary())
        : await mainDashboardSummary();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "대시보드 요약 조회 실패" },
      { status },
    );
  }
}
