import { NextRequest, NextResponse } from "next/server";
import { CoupangChannelAdapter } from "@/lib/channels/coupang";
import { NaverChannelAdapter } from "@/lib/channels/naver";
import type { ChannelResult, NormalizedOrder, SalesChannelAdapter } from "@/lib/channels/common/types";
import { createAutomationJob } from "@/lib/automation-jobs";
import { deleteRows, FnosDbError, hasDbConfig, insertRows, patchRows, selectRows, upsertRows } from "@/lib/fnos-db";
import { readChannelCredentials } from "@/lib/sales-channel-credentials";

type AnyRecord = Record<string, unknown>;

const adapters: Record<string, SalesChannelAdapter> = {
  NAVER: new NaverChannelAdapter(),
  COUPANG: new CoupangChannelAdapter(),
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function credentialMap(rows: Array<{ key: string; value?: string; error?: string }>) {
  return Object.fromEntries(rows.map((row) => [row.key, row.value || ""]));
}

function credentialReadError(rows: Array<{ error?: string }>) {
  return rows.find((row) => row.error)?.error || "";
}

function credentialValueCount(rows: Array<{ value?: string; error?: string }>) {
  return rows.filter((row) => text(row.value) && !row.error).length;
}

function shouldQueueForLocalWorker(body: AnyRecord) {
  if (body.worker_direct === true || body.run_direct === true) return false;
  if (body.use_worker === false) return false;
  return body.use_worker === true || process.env.VERCEL === "1";
}

function orderJobType(channelCode: string) {
  return channelCode === "COUPANG" ? "collect_coupang_orders" : "collect_smartstore_orders";
}

function adapterCodeForChannel(channel: AnyRecord) {
  const code = text(channel.channel_code).toUpperCase();
  const name = text(channel.channel_name).toUpperCase();
  const haystack = `${code} ${name}`;
  if (code === "NAVER" || code.startsWith("NAVER_") || /NAVER|네이버|스마트스토어|SMARTSTORE/.test(haystack)) return "NAVER";
  if (code === "COUPANG" || code.startsWith("COUPANG_") || /COUPANG|쿠팡|WING/.test(haystack)) return "COUPANG";
  return code;
}

async function logSync(row: AnyRecord) {
  await insertRows("api_sync_logs", row).catch(() => null);
}

async function persistOrders(channel: AnyRecord, orders: NormalizedOrder[]) {
  if (!orders.length) return [];
  const now = new Date().toISOString();
  const orderRows = orders.map((order) => ({
    channel_id: text(channel.id) || null,
    channel_name: order.channelName || text(channel.channel_name),
    order_no: order.orderNo,
    bundle_order_no: order.bundleOrderNo || null,
    order_date: order.orderDate || null,
    order_status: order.orderStatus || null,
    receiver_name: order.receiverName || null,
    phone1: order.phone1 || null,
    phone2: order.phone2 || null,
    zipcode: order.zipcode || null,
    address: order.address || null,
    delivery_message: order.deliveryMessage || null,
    raw_payload: order.raw || order,
    collected_at: now,
    updated_at: now,
  }));
  const savedOrders = await upsertRows<AnyRecord>("orders", orderRows, "channel_name,order_no");
  const orderIdByNo = new Map(savedOrders.map((row) => [text(row.order_no), text(row.id)]));

  await Promise.all(savedOrders
    .map((row) => text(row.id))
    .filter(Boolean)
    .map((id) => deleteRows("order_items", { order_id: `eq.${id}` }).catch(() => [])));

  const itemRows = orders.flatMap((order) => {
    const orderId = orderIdByNo.get(order.orderNo);
    if (!orderId) return [];
    return order.items.map((item) => ({
      order_id: orderId,
      channel_product_code: item.channelProductCode || null,
      channel_option_code: item.channelOptionCode || null,
      channel_product_name: item.channelProductName || "",
      channel_option_name: item.channelOptionName || null,
      sku: item.sku || null,
      qty: numberValue(item.qty),
      sales_amount: numberValue(item.salesAmount),
      settlement_amount: numberValue(item.settlementAmount),
      mapping_status: item.sku ? "MAPPED_BY_SKU" : "UNMAPPED",
      raw_payload: item.raw || item,
      updated_at: now,
    }));
  });
  if (itemRows.length) await insertRows("order_items", itemRows).catch(async (error) => {
    if (error instanceof Error && /raw_payload|updated_at/i.test(error.message)) {
      await insertRows("order_items", itemRows.map(({ raw_payload: _raw, updated_at: _updated, ...row }) => row));
      return;
    }
    throw error;
  });
  return savedOrders;
}

async function collectChannel(channel: AnyRecord, body: AnyRecord) {
  const channelCode = text(channel.channel_code).toUpperCase();
  const adapterCode = adapterCodeForChannel(channel);
  const adapter = adapters[adapterCode];
  const startedAt = new Date().toISOString();
  if (!adapter) {
    const message = `${text(channel.channel_name) || channelCode} API 어댑터가 아직 준비되지 않았습니다.`;
    return { channel, ok: false, orders: [] as NormalizedOrder[], message };
  }

  const credentialRows = await readChannelCredentials(text(channel.id), true);
  const credentialError = credentialReadError(credentialRows);
  if (credentialError) {
    return { channel, ok: false, skipped: true, orders: [] as NormalizedOrder[], message: credentialError };
  }
  if (!credentialValueCount(credentialRows)) {
    return { channel, ok: false, skipped: true, orders: [] as NormalizedOrder[], message: "API 인증값을 먼저 저장해 주세요." };
  }
  const credentials = credentialMap(credentialRows);
  const params = {
    ...credentials,
    ...body,
    channel_code: adapterCode,
    channel_name: text(channel.channel_name),
    customer_code: text(channel.customer_code),
    customer_name: text(channel.customer_name),
    seller_id: text(channel.seller_id),
  };
  let result: ChannelResult<NormalizedOrder[]>;
  try {
    result = await adapter.collectOrders(params);
    const orders = result.data || [];
    if (result.ok) {
      await persistOrders(channel, orders);
      await patchRows("sales_channels", { id: `eq.${text(channel.id)}` }, {
        last_synced_at: new Date().toISOString(),
        api_status: "connected",
        updated_at: new Date().toISOString(),
      }).catch(() => []);
    }
    await logSync({
      channel_id: text(channel.id) || null,
      sync_type: "orders",
      target_type: "online_orders",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      success_count: result.ok ? orders.length : 0,
      fail_count: result.ok ? 0 : 1,
      status: result.ok ? "success" : "failed",
      error_message: result.ok ? null : result.error || result.message || null,
      raw_response: result,
    });
    return { channel, ok: result.ok, orders, message: result.message || result.error || "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "주문 수집 실패";
    await logSync({
      channel_id: text(channel.id) || null,
      sync_type: "orders",
      target_type: "online_orders",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      success_count: 0,
      fail_count: 1,
      status: "failed",
      error_message: message,
    });
    return { channel, ok: false, orders: [] as NormalizedOrder[], message };
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const body = await request.json().catch(() => ({})) as AnyRecord;
    const channelCode = text(body.channel_code).toUpperCase();
    if (shouldQueueForLocalWorker(body)) {
      const job = await createAutomationJob({
        job_type: orderJobType(channelCode),
        title: channelCode ? `온라인 주문수집 ${channelCode}` : "온라인 주문수집",
        requested_by: "sales_inventory",
        input_json: {
          ...body,
          worker_direct: true,
          use_worker: false,
          requested_from: request.nextUrl.origin,
        },
      });
      return NextResponse.json({
        ok: true,
        queued: true,
        job_id: job.id,
        statuses: [{
          channel_code: channelCode,
          channel_name: "온라인 발주",
          ok: false,
          skipped: true,
          count: 0,
          message: "주문수집 작업을 로컬 워커에 등록했습니다.",
        }],
        orders: [],
        count: 0,
      });
    }
    const query: Record<string, string | number> = {
      order: "channel_code.asc",
      limit: 100,
      is_active: "eq.true",
      api_enabled: "eq.true",
    };
    if (channelCode) query.channel_code = `eq.${channelCode}`;
    const channels = await selectRows<AnyRecord>("sales_channels", query);
    const activeChannels = channels.filter((channel) => adapters[adapterCodeForChannel(channel)]);
    if (!activeChannels.length) {
      return NextResponse.json({
        ok: false,
        error: "API 사용으로 저장된 네이버/쿠팡 쇼핑몰이 없습니다. 기초관리 > 쇼핑몰에서 API 정보를 저장해주세요.",
        statuses: [],
        orders: [],
      }, { status: 400 });
    }

    const results = await Promise.all(activeChannels.map((channel) => collectChannel(channel, body)));
    const orders = results.flatMap((result) => result.orders);
    return NextResponse.json({
      ok: results.some((result) => result.ok),
      statuses: results.map((result) => ({
        channel_code: text(result.channel.channel_code),
        channel_name: text(result.channel.channel_name),
        ok: result.ok,
        skipped: Boolean(result.skipped),
        count: result.orders.length,
        message: result.message,
      })),
      orders,
      count: orders.length,
    });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "온라인 주문 수집 실패" }, { status });
  }
}
