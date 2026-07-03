import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { normalizeCollectableOnlineOrders } from "@/lib/channels/common/order-status";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem } from "@/lib/channels/common/types";
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

function orderCount(orders: NormalizedOrder[]) {
  return orders.length;
}

const MANUAL_ORDER_DIR = process.env.FNOS_MANUAL_ORDER_DIR || "D:\\FN_Oder_mall";
const MANUAL_ORDER_EXTENSIONS = new Set([".xlsx", ".xls", ".xlsm", ".csv"]);

type ManualOrderFileResult = {
  fileName: string;
  source: "esm" | "unknown";
  siteName: string;
  orders: NormalizedOrder[];
};

function cleanId(value: unknown) {
  const raw = text(value);
  if (/^\d+\.0$/.test(raw)) return raw.replace(/\.0$/, "");
  return raw;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const next = text(value);
    if (next) return next;
  }
  return "";
}

function pick(row: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && text(value) !== "") return value;
  }
  return "";
}

function workbookRows(buffer: Buffer, fileName: string) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  return workbook.SheetNames.flatMap((sheetName) => XLSX.utils.sheet_to_json<AnyRecord>(workbook.Sheets[sheetName], { defval: "", raw: false })
    .map((row) => ({ ...row, __sheetName: sheetName, __fileName: fileName }))
    .filter((row) => Object.values(row).some((value) => text(value))));
}

function isEsmManualRow(row: AnyRecord) {
  return Boolean(row["판매아이디"] !== undefined && row["주문번호"] !== undefined && (row["배송번호"] !== undefined || row["상품번호"] !== undefined));
}

function esmSiteName(row: AnyRecord) {
  const seller = text(row["판매아이디"]);
  if (/옥션|auction/i.test(seller)) return "옥션";
  if (/지마켓|g마켓|gmarket/i.test(seller)) return "지마켓";
  return "ESM";
}

function normalizeEsmManualRow(row: AnyRecord, fileName: string): NormalizedOrder | null {
  const orderNo = cleanId(pick(row, ["주문번호"]));
  const receiverName = firstText(pick(row, ["수령인명"]), pick(row, ["구매자명"]));
  const productName = firstText(pick(row, ["상품명"]), "ESM 주문");
  if (!orderNo || !receiverName || !productName) return null;
  const siteName = esmSiteName(row);
  const siteCode = siteName === "옥션" ? "A" : siteName === "지마켓" ? "G" : "ESM";
  const productNo = cleanId(pick(row, ["상품번호"]));
  const shipmentNo = cleanId(pick(row, ["배송번호"]));
  const sellerCode = cleanId(pick(row, ["판매자관리코드", "판매자상세관리코드"]));
  const item: NormalizedOrderItem = {
    channelProductCode: sellerCode || productNo || shipmentNo,
    channelOptionCode: shipmentNo || productNo || sellerCode,
    channelProductName: productName,
    channelOptionName: text(pick(row, ["옵션", "추가구성"])),
    sku: sellerCode || undefined,
    qty: numberValue(pick(row, ["수량"])) || 1,
    salesAmount: numberValue(pick(row, ["판매금액", "판매단가"])) || undefined,
    settlementAmount: numberValue(pick(row, ["정산예정금액", "판매금액"])) || undefined,
    raw: row,
  };
  return {
    channelCode: siteCode,
    channelName: siteName,
    customerCode: siteCode,
    customerName: siteName,
    orderNo,
    bundleOrderNo: cleanId(pick(row, ["장바구니번호(결제번호)", "배송번호", "주문번호"])) || orderNo,
    orderDate: firstText(pick(row, ["결제일"]), pick(row, ["주문일자(결제확인전)"])),
    orderStatus: "신규주문",
    receiverName,
    phone1: firstText(pick(row, ["수령인 휴대폰"]), pick(row, ["수령인 전화번호"]), pick(row, ["구매자 휴대폰"])),
    phone2: firstText(pick(row, ["수령인 전화번호"]), pick(row, ["수령인 휴대폰"]), pick(row, ["구매자 전화번호"])),
    zipcode: text(pick(row, ["우편번호"])),
    address: text(pick(row, ["주소"])),
    deliveryMessage: text(pick(row, ["배송시 요구사항"])),
    items: [item],
    raw: { ...row, __manualFileName: fileName, __manualSource: "ESM" },
  };
}

function parseManualOrderFile(fileName: string, buffer: Buffer): ManualOrderFileResult[] {
  const rows = workbookRows(buffer, fileName);
  const esmRows = rows.filter(isEsmManualRow);
  if (!esmRows.length) return [];
  const bySite = new Map<string, NormalizedOrder[]>();
  for (const row of esmRows) {
    const order = normalizeEsmManualRow(row, fileName);
    if (!order) continue;
    const siteName = order.channelName || "ESM";
    bySite.set(siteName, [...(bySite.get(siteName) || []), order]);
  }
  return Array.from(bySite.entries()).map(([siteName, orders]) => ({ fileName, source: "esm" as const, siteName, orders }));
}

async function collectManualOrderFiles() {
  let names: string[];
  try {
    names = await fs.readdir(MANUAL_ORDER_DIR);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [] as ManualOrderFileResult[];
    throw error;
  }
  const results: ManualOrderFileResult[] = [];
  for (const name of names) {
    if (name.startsWith("~$")) continue;
    const extension = path.extname(name).toLowerCase();
    if (!MANUAL_ORDER_EXTENSIONS.has(extension)) continue;
    const filePath = path.join(MANUAL_ORDER_DIR, name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) continue;
    const buffer = await fs.readFile(filePath);
    results.push(...parseManualOrderFile(name, buffer));
  }
  return results;
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
    // API 사용 채널이 없어도 D:\\FN_Oder_mall 수동 주문파일은 F1에서 함께 수집한다.

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
    const manualResults = await collectManualOrderFiles().catch((error) => {
      const message = error instanceof Error ? error.message : "수동 주문파일 수집 실패";
      return [{ fileName: MANUAL_ORDER_DIR, source: "unknown" as const, siteName: "수동 주문수집", orders: [] as NormalizedOrder[], error: message }];
    });
    const apiOrders = results.flatMap((result) => result.orders);
    const manualOrders = manualResults.flatMap((result) => result.orders);
    const orders = [...apiOrders, ...manualOrders];
    return jsonResponse({
      ok: results.some((result) => result.ok) || manualOrders.length > 0,
      dry_run: body.dry_run === true,
      statuses: [
        ...results.map((result) => ({
          source: "api",
          channel_code: text(result.channel.channel_code),
          channel_name: text(result.channel.channel_name),
          ok: result.ok,
          skipped: Boolean(result.skipped),
          count: orderCount(result.orders),
          item_count: orderItemCount(result.orders),
          message: result.message,
        })),
        ...manualResults.map((result) => ({
          source: "manual",
          channel_code: result.source.toUpperCase(),
          channel_name: `수동 주문수집 - ${result.siteName}`,
          ok: result.orders.length > 0,
          skipped: !result.orders.length,
          count: orderCount(result.orders),
          item_count: orderItemCount(result.orders),
          message: "error" in result ? result.error : `${result.fileName} / ${orderCount(result.orders)}건`,
        })).filter((item) => item.ok || item.message),
      ],
      orders,
      count: orderCount(orders),
      item_count: orderItemCount(orders),
    });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "온라인 주문 수집 실패" }, { status });
  }
}
