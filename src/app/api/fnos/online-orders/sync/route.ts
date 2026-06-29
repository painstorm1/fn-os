import { NextRequest, NextResponse } from "next/server";
import { normalizeCollectableOnlineOrders } from "@/lib/channels/common/order-status";
import type { ChannelResult, NormalizedOrder } from "@/lib/channels/common/types";
import { onlineOrderAdapterCodeForChannel, onlineOrderAdapterForChannel, ONLINE_ORDER_UNSUPPORTED_MESSAGE } from "@/lib/channels/registry";
import { createAutomationJob } from "@/lib/automation-jobs";
import { deleteRows, FnosDbError, hasDbConfig, insertRows, patchRows, selectRows, upsertRows } from "@/lib/fnos-db";
import { readChannelCredentials } from "@/lib/sales-channel-credentials";

type AnyRecord = Record<string, unknown>;

const localBridgeCorsHeaders = {
  "Access-Control-Allow-Origin": "https://fn-os.vercel.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-FNOS-Local-Bridge",
};

function jsonResponse(body: AnyRecord, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...localBridgeCorsHeaders,
      ...(init?.headers || {}),
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: localBridgeCorsHeaders });
}

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

function orderItemCount(orders: NormalizedOrder[]) {
  return orders.reduce((sum, order) => sum + Math.max(1, Array.isArray(order.items) ? order.items.length : 0), 0);
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
  const adapterCode = onlineOrderAdapterCodeForChannel(channel);
  const adapter = onlineOrderAdapterForChannel(channel);
  const startedAt = new Date().toISOString();
  const dryRun = body.dry_run === true;
  if (!adapter) {
    const message = `${text(channel.channel_name) || channelCode} ${ONLINE_ORDER_UNSUPPORTED_MESSAGE}`;
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
    const orders = normalizeCollectableOnlineOrders(result.data || []);
    if (result.ok && !dryRun) {
      await persistOrders(channel, orders);
      await patchRows("sales_channels", { id: `eq.${text(channel.id)}` }, {
        last_synced_at: new Date().toISOString(),
        api_status: "connected",
        updated_at: new Date().toISOString(),
      }).catch(() => []);
    }
    if (!dryRun) await logSync({
      channel_id: text(channel.id) || null,
      sync_type: "orders",
      target_type: "online_orders",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      success_count: result.ok ? orderItemCount(orders) : 0,
      fail_count: result.ok ? 0 : 1,
      status: result.ok ? "success" : "failed",
      error_message: result.ok ? null : result.error || result.message || null,
      raw_response: result,
    });
    return { channel, ok: result.ok, orders, message: result.message || result.error || "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "주문 수집 실패";
    if (!dryRun) await logSync({
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
      return jsonResponse({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const body = await request.json().catch(() => ({})) as AnyRecord;
    const channelCode = text(body.channel_code).toUpperCase();
    const query: Record<string, string | number> = {
      order: "channel_code.asc",
      limit: 100,
      is_active: "eq.true",
      api_enabled: "eq.true",
    };
    if (channelCode) query.channel_code = `eq.${channelCode}`;
    const channels = await selectRows<AnyRecord>("sales_channels", query);
    const supportedChannels = channels.filter((channel) => onlineOrderAdapterForChannel(channel));
    const unsupportedChannels = channels.filter((channel) => !onlineOrderAdapterForChannel(channel));
    if (!supportedChannels.length && !unsupportedChannels.length) {
      return jsonResponse({
        ok: false,
        error: "API 사용으로 저장된 네이버/쿠팡/11번가 쇼핑몰이 없습니다. 기초관리 > 쇼핑몰에서 API 정보를 저장해주세요.",
        statuses: [],
        orders: [],
      }, { status: 400 });
    }

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
      return jsonResponse({
        ok: true,
        queued: true,
        job_id: job.id,
        statuses: channels.map((channel) => ({
          channel_code: text(channel.channel_code),
          channel_name: text(channel.channel_name) || text(channel.customer_name) || text(channel.channel_code),
          ok: false,
          skipped: true,
          count: 0,
          message: onlineOrderAdapterForChannel(channel) ? "로컬 워커 대기 중입니다." : ONLINE_ORDER_UNSUPPORTED_MESSAGE,
        })),
        orders: [],
        count: 0,
      });
    }

    const results = [];
    for (const channel of supportedChannels) {
      results.push(await collectChannel(channel, body));
    }
    for (const channel of unsupportedChannels) {
      results.push({ channel, ok: false, skipped: true, orders: [] as NormalizedOrder[], message: ONLINE_ORDER_UNSUPPORTED_MESSAGE });
    }
    const orders = results.flatMap((result) => result.orders);
    return jsonResponse({
      ok: results.some((result) => result.ok),
      dry_run: body.dry_run === true,
      statuses: results.map((result) => ({
        channel_code: text(result.channel.channel_code),
        channel_name: text(result.channel.channel_name),
        ok: result.ok,
        skipped: Boolean(result.skipped),
        count: orderItemCount(result.orders),
        message: result.message,
      })),
      orders,
      count: orderItemCount(orders),
    });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "온라인 주문 수집 실패" }, { status });
  }
}
