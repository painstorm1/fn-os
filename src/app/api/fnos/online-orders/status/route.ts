import { NextRequest, NextResponse } from "next/server";
import { NaverChannelAdapter } from "@/lib/channels/naver";
import type { SalesChannelAdapter } from "@/lib/channels/common/types";
import { createAutomationJob } from "@/lib/automation-jobs";
import { FnosDbError, hasDbConfig, selectRows } from "@/lib/fnos-db";
import { readChannelCredentials } from "@/lib/sales-channel-credentials";

type AnyRecord = Record<string, unknown>;

const localBridgeCorsHeaders = {
  "Access-Control-Allow-Origin": "https://fn-os.vercel.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-FNOS-Local-Bridge",
};

const adapters: Record<string, SalesChannelAdapter> = {
  NAVER: new NaverChannelAdapter(),
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
  const code = text(channel.channel_code).toUpperCase();
  const name = text(channel.channel_name).toUpperCase();
  const haystack = `${code} ${name}`;
  if (code === "NAVER" || code.startsWith("NAVER_") || /NAVER|SMARTSTORE|네이버|스마트스토어/.test(haystack)) return "NAVER";
  return code;
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
    row.productOrderId
      || row.product_order_id
      || row.channelOptionCode
      || row.channel_option_code
      || row.mallProductCode
      || row.mall_product_code
      || row.orderNo
      || row.order_no,
  );
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
    const activeChannels = channels.filter((channel) => adapters[adapterCodeForChannel(channel)]);
    const results = [];

    for (const channel of activeChannels) {
      const channelRows = rowsForChannel(rows, channel);
      if (!channelRows.length) continue;
      const adapterCode = adapterCodeForChannel(channel);
      const adapter = adapters[adapterCode];
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
        const productOrderIds = Array.from(new Set(channelRows.map(rowProductOrderId).filter(Boolean)));
        const result = adapter.confirmOrders
          ? await adapter.confirmOrders({ ...baseParams, productOrderIds })
          : { ok: false, error: "해당 쇼핑몰은 발주확인을 지원하지 않습니다." };
        results.push({ channel_name: text(channel.channel_name), ok: result.ok, count: productOrderIds.length, message: result.message || result.error || "", raw: result.data });
      }
      if (action === "dispatch") {
        const dispatchProductOrders = channelRows.map((row) => ({
          productOrderId: rowProductOrderId(row),
          deliveryMethod: text(row.deliveryMethod || row.delivery_method) || "DELIVERY",
          deliveryCompanyCode: text(row.deliveryCompanyCode || row.delivery_company_code) || "CJGLS",
          trackingNumber: text(row.trackingNumber || row.tracking_number).replace(/\D/g, ""),
        })).filter((row) => row.productOrderId && row.trackingNumber);
        const result = adapter.dispatchOrders
          ? await adapter.dispatchOrders({ ...baseParams, dispatchProductOrders })
          : { ok: false, error: "해당 쇼핑몰은 발송처리를 지원하지 않습니다." };
        results.push({ channel_name: text(channel.channel_name), ok: result.ok, count: dispatchProductOrders.length, message: result.message || result.error || "", raw: result.data });
      }
    }

    if (!results.length) return jsonResponse({ ok: false, error: "처리 가능한 쇼핑몰 주문이 없습니다.", results }, { status: 400 });
    return jsonResponse({ ok: results.some((result) => result.ok), results });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "온라인 주문 처리 실패" }, { status });
  }
}
