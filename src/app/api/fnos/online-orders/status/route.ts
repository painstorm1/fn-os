import { NextRequest, NextResponse } from "next/server";
import { ONLINE_ORDER_ADAPTERS, onlineOrderAdapterCodeForChannel } from "@/lib/channels/registry";
import { createAutomationJob } from "@/lib/automation-jobs";
import { FnosDbError, hasDbConfig, patchRows, selectRows } from "@/lib/fnos-db";
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

function adapterCodeForChannel(channel: AnyRecord) {
  return onlineOrderAdapterCodeForChannel(channel);
}


function credentialMap(rows: Array<{ key: string; value?: string; error?: string }>) {
  return Object.fromEntries(rows.map((row) => [row.key, row.value || ""]));
}

function credentialReadError(rows: Array<{ error?: string }>) {
  return rows.find((row) => row.error)?.error || "";
}

function channelMatches(channel: AnyRecord, value: string) {
  const needle = text(value);
  if (!needle) return false;
  return [channel.channel_name, channel.customer_name, channel.channel_code]
    .map(text)
    .some((value) => value === needle || (value && (value.includes(needle) || needle.includes(value))));
}

function shouldQueueForLocalWorker(body: AnyRecord) {
  if (body.worker_direct === true || body.run_direct === true) return false;
  if (body.use_worker === false) return false;
  return body.use_worker === true || process.env.VERCEL === "1";
}

function rowsForChannel(rows: AnyRecord[], channel: AnyRecord) {
  return rows.filter((row) => [
    row.channelName,
    row.channel_name,
    row.mallName,
    row.mall_name,
    row.customerName,
    row.customer_name,
    row.channelCode,
    row.channel_code,
    row.customerCode,
    row.customer_code,
  ].some((value) => channelMatches(channel, text(value))));
}

function rowProductOrderId(row: AnyRecord) {
  return text(
    row.apiProductOrderId
      || row.api_product_order_id
      || row.productOrderId
      || row.product_order_id
      || row.shppSeq
      || row.shpp_seq
      || row.odSeq
      || row.od_seq
      || row.vendorItemId
      || row.vendor_item_id
      || row.channelOptionCode
      || row.channel_option_code
      || row.mallProductCode
      || row.mall_product_code
      || row.orderNo
      || row.order_no,
  );
}

function rowOrderId(row: AnyRecord) {
  return text(row.apiOrderId || row.api_order_id || row.orderId || row.order_id || row.shppNo || row.shpp_no || row.odNo || row.od_no || row.orderNo || row.order_no);
}

function rowShipmentId(row: AnyRecord) {
  return text(row.apiShipmentId || row.api_shipment_id || row.shipmentBoxId || row.shipment_box_id || row.bundleOrderNo || row.bundle_order_no);
}

function rowApiExtraId(row: AnyRecord) {
  return text(row.apiExtraId || row.api_extra_id || row.procSeq || row.proc_seq);
}

const orderStatusRank: Record<string, number> = { 신규주문: 0, 주문확인: 1, 출고대기: 2, 출고완료: 3 };

function addIdentity(set: Set<string>, value: unknown) {
  const next = text(value);
  if (next && next.length > 2) set.add(next);
}

function rowIdentities(row: AnyRecord) {
  const ids = new Set<string>();
  [
    row.orderNo,
    row.order_no,
    row.orderId,
    row.order_id,
    row.bundleOrderNo,
    row.bundle_order_no,
    row.shipmentBoxId,
    row.shipment_box_id,
    row.shppNo,
    row.shpp_no,
    row.odNo,
    row.od_no,
  ].forEach((value) => addIdentity(ids, value));
  return ids;
}

function persistedOrderIdentities(row: AnyRecord) {
  const ids = new Set<string>();
  const raw = row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload) ? row.raw_payload as AnyRecord : {};
  const nested = raw.shppDirection && typeof raw.shppDirection === "object" && !Array.isArray(raw.shppDirection) ? raw.shppDirection as AnyRecord : {};
  [
    row.order_no,
    row.bundle_order_no,
    raw.ordNo,
    raw.orordNo,
    raw.orderNo,
    raw.shppNo,
    raw.shppDirectionNo,
    raw.dircNo,
    nested.ordNo,
    nested.orordNo,
    nested.orderNo,
    nested.shppNo,
    nested.shppDirectionNo,
    nested.dircNo,
  ].forEach((value) => addIdentity(ids, value));
  return ids;
}

function shouldAdvanceStatus(current: unknown, next: string) {
  const currentRank = orderStatusRank[text(current)] ?? -1;
  const nextRank = orderStatusRank[next] ?? -1;
  return nextRank >= 0 && currentRank < nextRank;
}

async function updatePersistedOrderStatuses(channel: AnyRecord, channelRows: AnyRecord[], nextStatus: "주문확인" | "출고완료") {
  const targetIds = new Set<string>();
  channelRows.forEach((row) => rowIdentities(row).forEach((id) => targetIds.add(id)));
  if (!targetIds.size) return 0;
  const orders = await selectRows<AnyRecord>("orders", {
    channel_name: `eq.${text(channel.channel_name)}`,
    order: "updated_at.desc",
    limit: 500,
  }).catch(() => []);
  const now = new Date().toISOString();
  let patched = 0;
  for (const order of orders) {
    if (!shouldAdvanceStatus(order.order_status, nextStatus)) continue;
    const ids = persistedOrderIdentities(order);
    if (!Array.from(ids).some((id) => targetIds.has(id))) continue;
    const saved = await patchRows<AnyRecord>("orders", { id: `eq.${text(order.id)}` }, { order_status: nextStatus, updated_at: now }).catch(() => []);
    if (saved.length) patched += 1;
  }
  return patched;
}

export async function POST(request: NextRequest) {
  try {
    if (!hasDbConfig()) {
      return jsonResponse({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const body = await request.json().catch(() => ({})) as AnyRecord;
    const action = text(body.action);
    const rows = Array.isArray(body.rows) ? body.rows.map((row) => row as AnyRecord) : [];
    if (!["confirm", "dispatch"].includes(action)) return jsonResponse({ ok: false, error: "지원하지 않는 주문 처리입니다." }, { status: 400 });
    if (!rows.length) return jsonResponse({ ok: false, error: "처리할 주문이 없습니다." }, { status: 400 });

    if (shouldQueueForLocalWorker(body)) {
      const job = await createAutomationJob({
        job_type: "online_order_status_update",
        title: action === "confirm" ? "온라인 주문 발주확인" : "온라인 주문 발송처리",
        requested_by: "sales_inventory",
        input_json: {
          ...body,
          worker_direct: true,
          use_worker: false,
        },
      });
      return jsonResponse({ ok: true, queued: true, job_id: job.id, results: [] });
    }

    const channels = await selectRows<AnyRecord>("sales_channels", {
      order: "channel_code.asc",
      limit: 100,
      is_active: "eq.true",
      api_enabled: "eq.true",
    });
    const activeChannels = channels.filter((channel) => ONLINE_ORDER_ADAPTERS[adapterCodeForChannel(channel)]);
    const results = [];

    for (const channel of activeChannels) {
      const channelRows = rowsForChannel(rows, channel);
      if (!channelRows.length) continue;
      const adapterCode = adapterCodeForChannel(channel);
      const adapter = ONLINE_ORDER_ADAPTERS[adapterCode];
      const credentialRows = await readChannelCredentials(text(channel.id), true);
      const credentialError = credentialReadError(credentialRows);
      if (credentialError) {
        results.push({ channel_name: text(channel.channel_name), ok: false, message: credentialError });
        continue;
      }
      const credentials = credentialMap(credentialRows);
      const baseParams = {
        ...credentials,
        channel_code: adapterCode,
        channel_name: text(channel.channel_name),
      };
      if (action === "confirm") {
        const confirmProductOrders = channelRows.map((row) => ({
          productOrderId: rowProductOrderId(row),
          orderId: rowOrderId(row),
          orderNo: text(row.orderNo || row.order_no),
          shipmentBoxId: rowShipmentId(row),
          bundleOrderNo: text(row.bundleOrderNo || row.bundle_order_no),
          quantity: text(row.quantity || row.qty),
          procSeq: rowApiExtraId(row),
        })).filter((row) => row.productOrderId || row.orderId || row.shipmentBoxId);
        const productOrderIds = Array.from(new Set(confirmProductOrders.map((row) => row.productOrderId).filter(Boolean)));
        const result = adapter.confirmOrders
          ? await adapter.confirmOrders({ ...baseParams, productOrderIds, confirmProductOrders })
          : { ok: false, error: "해당 쇼핑몰은 발주확인을 지원하지 않습니다." };
        const persisted_count = result.ok ? await updatePersistedOrderStatuses(channel, channelRows, "주문확인") : 0;
        results.push({ channel_name: text(channel.channel_name), ok: result.ok, count: Math.max(productOrderIds.length, confirmProductOrders.length), persisted_count, message: result.message || result.error || "", raw: result.data });
      }
      if (action === "dispatch") {
        const dispatchProductOrders = channelRows.map((row) => ({
          productOrderId: rowProductOrderId(row),
          orderId: rowOrderId(row),
          orderNo: text(row.orderNo || row.order_no),
          shipmentBoxId: rowShipmentId(row),
          bundleOrderNo: text(row.bundleOrderNo || row.bundle_order_no),
          quantity: text(row.quantity || row.qty),
          procSeq: rowApiExtraId(row),
          deliveryMethod: text(row.deliveryMethod || row.delivery_method) || "DELIVERY",
          deliveryCompanyCode: text(row.deliveryCompanyCode || row.delivery_company_code) || "CJGLS",
          trackingNumber: text(row.trackingNumber || row.tracking_number).replace(/\D/g, ""),
        })).filter((row) => (row.productOrderId || row.orderId || row.shipmentBoxId) && row.trackingNumber);
        const result = adapter.dispatchOrders
          ? await adapter.dispatchOrders({ ...baseParams, dispatchProductOrders })
          : { ok: false, error: "해당 쇼핑몰은 발송처리를 지원하지 않습니다." };
        const persisted_count = result.ok ? await updatePersistedOrderStatuses(channel, channelRows, "출고완료") : 0;
        results.push({ channel_name: text(channel.channel_name), ok: result.ok, count: dispatchProductOrders.length, persisted_count, message: result.message || result.error || "", raw: result.data });
      }
    }

    if (!results.length) return jsonResponse({ ok: false, error: "처리 가능한 쇼핑몰 주문이 없습니다.", results }, { status: 400 });
    const failedResults = results.filter((result) => !result.ok);
    const error = failedResults
      .map((result) => [text(result.channel_name), text(result.message)].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" / ") || "온라인 주문 처리 실패";
    return jsonResponse({ ok: failedResults.length === 0, error: failedResults.length ? error : "", results }, { status: failedResults.length ? 502 : 200 });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "온라인 주문 처리 실패" }, { status });
  }
}
