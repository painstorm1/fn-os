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
  const compact = (input: unknown) => text(input).toLowerCase().replace(/[\s_.-]+/g, "");
  const needle = compact(value);
  if (!needle) return false;
  return [channel.channel_name, channel.customer_name, channel.channel_code]
    .map(compact)
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

function shouldAdvanceStatus(current: unknown, next: string) {
  const currentRank = orderStatusRank[text(current)] ?? -1;
  const nextRank = orderStatusRank[next] ?? -1;
  return nextRank >= 0 && currentRank < nextRank;
}

function persistedOrderNos(rows: AnyRecord[]) {
  return Array.from(new Set(rows
    .map((row) => text(row.persistedOrderNo || row.persisted_order_no || row.orderNo || row.order_no))
    .filter(Boolean)));
}

async function updatePersistedOrderStatuses(channel: AnyRecord, channelRows: AnyRecord[], nextStatus: "주문확인" | "출고완료") {
  const orderNos = persistedOrderNos(channelRows);
  if (!orderNos.length) return 0;
  const orders = await selectRows<AnyRecord>("orders", {
    order_no: `in.(${orderNos.map((orderNo) => `"${orderNo.replace(/"/g, "\\\"")}"`).join(",")})`,
  });
  const now = new Date().toISOString();
  let persisted = 0;
  for (const order of orders.filter((row) => channelMatches(channel, text(row.channel_name)))) {
    if (shouldAdvanceStatus(order.order_status, nextStatus)) {
      const saved = await patchRows<AnyRecord>("orders", { id: `eq.${text(order.id)}` }, { order_status: nextStatus, updated_at: now });
      if (!saved.length) throw new Error(`${text(order.order_no)} FNOS 주문 상태 저장 결과가 없습니다.`);
    }
    persisted += 1;
  }
  return persisted;
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
          vendorItemId: text(row.vendorItemId || row.vendor_item_id),
          shppNo: text(row.shppNo || row.shpp_no || rowOrderId(row)),
          shppSeq: text(row.shppSeq || row.shpp_seq || rowProductOrderId(row)),
          ordNo: text(row.ordNo || row.ord_no || rowOrderId(row)),
          ordPrdSeq: text(row.ordPrdSeq || row.ord_prd_seq || rowProductOrderId(row)),
          dlvNo: text(row.dlvNo || row.dlv_no || rowShipmentId(row)),
          odNo: text(row.odNo || row.od_no || rowOrderId(row)),
          odSeq: text(row.odSeq || row.od_seq || rowProductOrderId(row)),
          quantity: text(row.quantity || row.qty),
          procSeq: rowApiExtraId(row),
        })).filter((row) => row.productOrderId || row.orderId || row.shipmentBoxId);
        const productOrderIds = Array.from(new Set(confirmProductOrders.map((row) => row.productOrderId).filter(Boolean)));
        const result = adapter.confirmOrders
          ? await adapter.confirmOrders({ ...baseParams, productOrderIds, confirmProductOrders })
          : { ok: false, error: "해당 쇼핑몰은 발주확인을 지원하지 않습니다." };
        const persisted_count = result.ok ? await updatePersistedOrderStatuses(channel, channelRows, "주문확인") : 0;
        const expectedPersistedCount = persistedOrderNos(channelRows).length;
        const persistenceError = result.ok && persisted_count !== expectedPersistedCount ? `쇼핑몰 처리는 성공했지만 FNOS 주문 상태는 ${persisted_count}/${expectedPersistedCount}건만 저장되었습니다.` : "";
        results.push({ channel_name: text(channel.channel_name), ok: result.ok && !persistenceError, count: Math.max(productOrderIds.length, confirmProductOrders.length), persisted_count, message: persistenceError || result.message || result.error || "", raw: result.data });
      }
      if (action === "dispatch") {
        const dispatchProductOrders = channelRows.map((row) => ({
          productOrderId: rowProductOrderId(row),
          orderId: rowOrderId(row),
          orderNo: text(row.orderNo || row.order_no),
          shipmentBoxId: rowShipmentId(row),
          bundleOrderNo: text(row.bundleOrderNo || row.bundle_order_no),
          vendorItemId: text(row.vendorItemId || row.vendor_item_id),
          shppNo: text(row.shppNo || row.shpp_no || rowOrderId(row)),
          shppSeq: text(row.shppSeq || row.shpp_seq || rowProductOrderId(row)),
          ordNo: text(row.ordNo || row.ord_no || rowOrderId(row)),
          ordPrdSeq: text(row.ordPrdSeq || row.ord_prd_seq || rowProductOrderId(row)),
          dlvNo: text(row.dlvNo || row.dlv_no || rowShipmentId(row)),
          odNo: text(row.odNo || row.od_no || rowOrderId(row)),
          odSeq: text(row.odSeq || row.od_seq || rowProductOrderId(row)),
          quantity: text(row.quantity || row.qty),
          procSeq: rowApiExtraId(row),
          deliveryMethod: text(row.deliveryMethod || row.delivery_method) || "DELIVERY",
          deliveryCompanyCode: text(row.deliveryCompanyCode || row.delivery_company_code) || (adapterCode === "LOTTEON" ? "" : "CJGLS"),
          trackingNumber: text(row.trackingNumber || row.tracking_number),
        })).filter((row) => adapterCode === "LOTTEON" || ((row.productOrderId || row.orderId || row.shipmentBoxId) && row.trackingNumber));
        const result = adapter.dispatchOrders
          ? await adapter.dispatchOrders({ ...baseParams, dispatchProductOrders })
          : { ok: false, error: "해당 쇼핑몰은 발송처리를 지원하지 않습니다." };
        const persisted_count = result.ok ? await updatePersistedOrderStatuses(channel, channelRows, "출고완료") : 0;
        const expectedPersistedCount = persistedOrderNos(channelRows).length;
        const persistenceError = result.ok && persisted_count !== expectedPersistedCount ? `쇼핑몰 처리는 성공했지만 FNOS 주문 상태는 ${persisted_count}/${expectedPersistedCount}건만 저장되었습니다.` : "";
        results.push({ channel_name: text(channel.channel_name), ok: result.ok && !persistenceError, count: dispatchProductOrders.length, persisted_count, message: persistenceError || result.message || result.error || "", raw: result.data });
      }
    }

    if (!results.length) return jsonResponse({ ok: false, error: "처리 가능한 쇼핑몰 주문이 없습니다.", results }, { status: 400 });
    const failedResults = results.filter((result) => !result.ok);
    const succeededResults = results.filter((result) => result.ok);
    const partial = failedResults.length > 0 && succeededResults.length > 0;
    const error = failedResults
      .map((result) => [text(result.channel_name), text(result.message)].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" / ") || "온라인 주문 처리 실패";
    return jsonResponse({ ok: failedResults.length === 0 || partial, partial, error: failedResults.length ? error : "", results }, { status: failedResults.length && !partial ? 502 : 200 });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "온라인 주문 처리 실패" }, { status });
  }
}
