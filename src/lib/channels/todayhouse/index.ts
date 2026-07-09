import { readJsonApiResponse } from "../common/api-response";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;

const TODAYHOUSE_BASE_URL = "https://api.ohou.se";
const TODAYHOUSE_ORDER_PATH = "/orora/claim/v1/orora/orders/list";
const TODAYHOUSE_CUSTOMER_CODE = "1198691245";
const TODAYHOUSE_CUSTOMER_NAME = "오늘의 집";

function text(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function num(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function first(...values: unknown[]) { for (const value of values) { const next = text(value); if (next) return next; } return ""; }
function date(value: unknown, boundary: "start" | "end") { const raw = text(value); const d = raw ? new Date(raw) : new Date(); if (!raw && boundary === "start") d.setDate(d.getDate() - 7); const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000); return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth()+1).padStart(2,"0")}-${String(kst.getUTCDate()).padStart(2,"0")}`; }
function normalizeDate(value: unknown) { const raw = text(value); const compact = raw.replace(/\D/g, ""); if (compact.length >= 14) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}T${compact.slice(8,10)}:${compact.slice(10,12)}:${compact.slice(12,14)}+09:00`; if (compact.length >= 8) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`; return raw; }
function rowsFrom(data: unknown): AnyRecord[] { const queue = [data]; const rows: AnyRecord[] = []; const seen = new Set<unknown>(); while (queue.length) { const value = queue.shift(); if (!value || seen.has(value) || typeof value !== "object") continue; seen.add(value); if (Array.isArray(value)) { queue.push(...value); continue; } const cur = record(value); if (first(cur.orderId, cur.orderNo, cur.id) && first(cur.productName, cur.name, cur.itemName)) rows.push(cur); else queue.push(...Object.values(cur)); } return rows; }
async function readJson(response: Response) { return readJsonApiResponse(response, "오늘의집", { successCodes: ["SUCCESS", "OK", "0", "200"], resultPaths: [["code"], ["status"], ["result", "code"]] }); }
function normalize(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const product = record(row.product || row.production || row.item || row.option);
  const receiver = record(row.receiver || row.shippingAddress || row.delivery || row.recipient);
  const item: NormalizedOrderItem = { channelProductCode: first(product.id, product.productId, row.productId, row.productionId), channelOptionCode: first(product.optionId, row.optionId, row.orderOptionId), channelProductName: first(product.name, row.productName, row.name, row.itemName, "오늘의집 주문"), channelOptionName: first(product.optionName, row.optionName), sku: first(product.sellerManagementCode, product.sku, row.sku), qty: num(row.quantity || product.quantity || row.orderQuantity) || 1, salesAmount: num(row.paymentAmount || row.salesAmount || row.sellingCost || product.price) || undefined, raw: row };
  return { ...base, orderNo: first(row.orderNo, row.orderId, row.id), bundleOrderNo: first(row.orderId, row.orderNo), orderDate: normalizeDate(first(row.paidAt, row.orderedAt, row.createdAt, row.orderDate)), orderStatus: first(row.status, row.orderStatus, row.deliveryStatus, "결제완료"), receiverName: first(receiver.name, receiver.receiverName, row.receiverName), phone1: first(receiver.phone, receiver.mobile, row.receiverPhone), zipcode: first(receiver.zipcode, receiver.zipCode, row.zipcode), address: [first(receiver.address, receiver.baseAddress, row.address), first(receiver.detailAddress, row.detailAddress)].filter(Boolean).join(" "), deliveryMessage: first(receiver.message, row.deliveryMessage), items: [item], raw: row };
}

export class TodayhouseChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const authCode = first(params.auth_code, params.api_key, params.access_key);
    if (!authCode) return { ok: false, data: [], error: "오늘의집 인증코드/OTP를 저장해주세요. 오늘의집 인증코드는 72시간 유효하므로 만료 시 재저장이 필요합니다." };
    const baseUrl = text(params.api_base_url) || TODAYHOUSE_BASE_URL;
    const path = text(params.orders_path) || TODAYHOUSE_ORDER_PATH;
    const search = new URLSearchParams({ from: date(params.fromDate ?? params.from, "start"), to: date(params.toDate ?? params.to, "end"), page: "1", size: "100" });
    try {
      const response = await fetch(`${baseUrl}${path}?${search.toString()}`, { headers: { Accept: "application/json", Authorization: `Bearer ${authCode}`, "X-Auth-Code": authCode, "X-OTP-Code": authCode } });
      const data = await readJson(response);
      const rows = rowsFrom(data);
      const base = { channelCode: text(params.channel_code) || TODAYHOUSE_CUSTOMER_CODE, channelName: text(params.channel_name) || TODAYHOUSE_CUSTOMER_NAME, customerCode: text(params.customer_code) || TODAYHOUSE_CUSTOMER_CODE, customerName: text(params.customer_name) || TODAYHOUSE_CUSTOMER_NAME };
      return { ok: true, data: rows.map((row) => normalize(row, base)).filter((order) => order.orderNo), message: `오늘의집 주문 ${rows.length}건을 수집했습니다.` };
    } catch (error) { return { ok: false, data: [], error: error instanceof Error ? error.message : "오늘의집 주문 수집 실패" }; }
  }
}
