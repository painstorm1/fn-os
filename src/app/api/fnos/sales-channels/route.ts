import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, hasDbConfig, selectRows, upsertRows } from "@/lib/fnos-db";

const defaultChannels = [
  ["NAVER", "네이버 스마트스토어", "api", true, "https://sell.smartstore.naver.com/"],
  ["COUPANG", "쿠팡", "api", true, "https://wing.coupang.com/"],
  ["11ST", "11번가", "excel", false, "https://soffice.11st.co.kr/"],
  ["ESM", "ESM/G마켓/옥션", "excel", false, "https://www.esmplus.com/"],
  ["KAKAO", "카카오톡스토어", "excel", false, "https://store-sell.kakao.com/"],
  ["SSG", "SSG", "excel", false, "https://partners.ssgadm.com/"],
  ["LOTTEON", "롯데ON", "excel", false, "https://store.lotteon.com/"],
  ["TODAYHOUSE", "오늘의집", "excel", false, "https://partners.ohou.se/"],
  ["TOSS", "토스", "excel", false, "https://store.toss.im/"],
  ["EZWEL", "현대이지웰", "excel", false, ""],
  ["ETC", "기타몰", "excel", false, ""],
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeChannel(row: Record<string, unknown>) {
  const channelCode = clean(row.channel_code || row["쇼핑몰코드"]).toUpperCase();
  const channelName = clean(row.channel_name || row["쇼핑몰명"]);
  return {
    channel_code: channelCode,
    channel_name: channelName,
    seller_id: clean(row.seller_id || row.ID) || null,
    customer_name: clean(row.customer_name || row["거래처명"]) || null,
    channel_type: clean(row.channel_type || row["수집처구분"]) || "excel",
    is_active: row.is_active === false || clean(row["사용구분"]) === "미사용" ? false : true,
    api_enabled: row.api_enabled === true || clean(row["API 연동 여부"]) === "Y",
    api_status: clean(row.api_status || row["진행상태"]) || "manual",
    seller_site_url: clean(row.seller_site_url || row["판매자사이트 URL"]) || null,
    updated_at: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured.", channels: [] }, { status: 503 });
    }
    const channels = await selectRows("sales_channels", { order: "channel_code.asc", limit: 200 });
    return NextResponse.json({ ok: true, channels });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쇼핑몰 채널 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const body = await request.json().catch(() => ({}));
    const seed = body.seed === true;
    const rawRows = seed
      ? defaultChannels.map(([code, name, type, apiEnabled, url]) => ({
          channel_code: code,
          channel_name: name,
          channel_type: type,
          api_enabled: apiEnabled,
          api_status: apiEnabled ? "planned" : "excel",
          seller_site_url: url,
          is_active: true,
        }))
      : Array.isArray(body.rows)
        ? body.rows
        : [body];
    const rows = (rawRows as Record<string, unknown>[]).map(normalizeChannel).filter((row: ReturnType<typeof normalizeChannel>) => row.channel_code && row.channel_name);
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "저장할 쇼핑몰 채널이 없습니다." }, { status: 400 });
    }
    const saved = await upsertRows("sales_channels", rows, "channel_code");
    return NextResponse.json({ ok: true, count: saved.length, channels: saved });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쇼핑몰 채널 저장 실패" }, { status });
  }
}
