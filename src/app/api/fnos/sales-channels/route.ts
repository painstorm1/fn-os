import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, hasDbConfig, selectRows, upsertRows } from "@/lib/fnos-db";
import { credentialSummary, saveChannelCredentials } from "@/lib/sales-channel-credentials";

type AnyRecord = Record<string, unknown>;

const defaultChannels = [
  ["NAVER", "네이버 스마트스토어", "api", true, "https://sell.smartstore.naver.com/"],
  ["COUPANG", "쿠팡", "api", true, "https://wing.coupang.com/"],
  ["ELEVENST", "11번가", "api", true, "https://soffice.11st.co.kr/"],
  ["2208183676", "ESM이에스엠", "excel", false, "https://www.esmplus.com/"],
  ["KAKAO", "카카오톡스토어", "excel", false, "https://store-sell.kakao.com/"],
  ["SSG", "SSG", "excel", false, "https://partners.ssgadm.com/"],
  ["LOTTEON", "롯데ON", "excel", false, "https://store.lotteon.com/"],
  ["TODAYHOUSE", "오늘의집", "api", true, "https://partners.ohou.se/"],
  ["TOSS", "토스", "api", true, "https://shopping-seller.toss.im/"],
  ["EZWEL", "현대이지웰", "excel", false, ""],
  ["ETC", "기타몰", "excel", false, ""],
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeCustomerType(value: unknown) {
  const normalized = clean(value).toLowerCase();
  if (["shopping", "mall", "shop", "쇼핑몰"].includes(normalized)) return "shopping";
  return "general";
}

function customerCode(row: AnyRecord) {
  return clean(row.customer_code || row.cust_code);
}

function customerName(row: AnyRecord) {
  return clean(row.customer_name || row.cust_name);
}

function publicChannel(row: AnyRecord, credentials: Array<{ key: string; hint: string; is_secret: boolean; has_value: boolean }> = []) {
  return {
    ...row,
    credentials,
    credential_keys: credentials.map((item) => item.key),
    credential_count: credentials.filter((item) => item.has_value).length,
  };
}

function normalizeChannel(row: AnyRecord, customer?: AnyRecord | null) {
  const channelCode = clean(row.channel_code || row["쇼핑몰코드"]).toUpperCase();
  const channelName = clean(row.channel_name || row["쇼핑몰명"]) || customerName(customer || {});
  const code = clean(row.customer_code || row["거래처코드"] || customerCode(customer || {}));
  return {
    channel_code: channelCode,
    channel_name: channelName,
    seller_id: clean(row.seller_id || row.ID) || null,
    customer_id: clean(row.customer_id || customer?.id) || null,
    customer_code: code || null,
    customer_name: clean(row.customer_name || row["거래처명"] || customerName(customer || {})) || null,
    channel_type: clean(row.channel_type || row["수집처구분"]) || "excel",
    is_active: row.is_active === false || clean(row["사용구분"]) === "미사용" ? false : true,
    api_enabled: row.api_enabled === true || clean(row["API 연동 여부"]) === "Y",
    api_status: clean(row.api_status || row["진행상태"]) || "manual",
    seller_site_url: clean(row.seller_site_url || row["판매자사이트 URL"]) || null,
    updated_at: new Date().toISOString(),
  };
}

function findShoppingCustomer(row: AnyRecord, customers: AnyRecord[]) {
  const customerId = clean(row.customer_id);
  const code = clean(row.customer_code || row["거래처코드"]);
  const name = clean(row.customer_name || row["거래처명"]);
  return customers.find((customer) => {
    if (normalizeCustomerType(customer.customer_type || customer.cust_type) !== "shopping") return false;
    if (customerId && clean(customer.id) === customerId) return true;
    if (code && customerCode(customer) === code) return true;
    if (name && customerName(customer) === name) return true;
    return false;
  }) || null;
}

function channelWithCurrentCustomer(channel: AnyRecord, customers: AnyRecord[]) {
  const customer = findShoppingCustomer(channel, customers);
  if (!customer) return channel;
  const currentCode = customerCode(customer);
  const currentName = customerName(customer);
  return {
    ...channel,
    customer_id: clean(customer.id) || channel.customer_id || null,
    customer_code: currentCode || channel.customer_code || null,
    customer_name: currentName || channel.customer_name || null,
    channel_name: currentName || clean(channel.channel_name || channel["쇼핑몰명"]),
  };
}

export async function GET() {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured.", channels: [] }, { status: 503 });
    }
    const [channels, customers] = await Promise.all([
      selectRows<AnyRecord>("sales_channels", { order: "channel_code.asc", limit: 200 }),
      selectRows<AnyRecord>("customers", { order: "customer_name.asc", limit: 5000 }).catch(() => []),
    ]);
    const summaries = await credentialSummary(channels.map((channel) => clean(channel.id)).filter(Boolean));
    return NextResponse.json({
      ok: true,
      channels: channels.map((channel) => {
        const currentChannel = channelWithCurrentCustomer(channel, customers);
        return publicChannel(currentChannel, summaries.get(clean(channel.id)) || []);
      }),
    });
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
    const customers = await selectRows<AnyRecord>("customers", { order: "customer_name.asc", limit: 5000 }).catch(() => []);
    const rows = (rawRows as AnyRecord[])
      .map((row) => normalizeChannel(row, findShoppingCustomer(row, customers)))
      .filter((row: ReturnType<typeof normalizeChannel>) => row.channel_code && row.channel_name);
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "저장할 쇼핑몰 채널이 없습니다." }, { status: 400 });
    }
    const saved = await upsertRows<AnyRecord>("sales_channels", rows, "channel_code");
    if (!seed && !Array.isArray(body.rows) && body.credentials && saved[0]?.id) {
      await saveChannelCredentials(clean(saved[0].id), body.credentials);
    }
    const summaries = await credentialSummary(saved.map((channel) => clean(channel.id)).filter(Boolean));
    return NextResponse.json({
      ok: true,
      count: saved.length,
      channels: saved.map((channel) => publicChannel(channel, summaries.get(clean(channel.id)) || [])),
    });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쇼핑몰 채널 저장 실패" }, { status });
  }
}
