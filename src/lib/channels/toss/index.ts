import { createHmac } from "crypto";
import { readJsonApiResponse } from "../common/api-response";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;

const TOSS_BASE_URL = "https://api-public.toss.im";
const TOSS_ORDER_PATH = "/api-public/v1/shopping-order/order/histories/paging";

function text(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function num(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function first(...values: unknown[]) { for (const value of values) { const next = text(value); if (next) return next; } return ""; }
function date(value: unknown, boundary: "start" | "end") { const raw = text(value); const d = raw ? new Date(raw) : new Date(); if (!raw && boundary === "start") d.setDate(d.getDate() - 7); const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000); return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth()+1).padStart(2,"0")}-${String(kst.getUTCDate()).padStart(2,"0")}`; }
function normalizeDate(value: unknown) { const raw = text(value); const compact = raw.replace(/\D/g, ""); if (compact.length >= 14) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}T${compact.slice(8,10)}:${compact.slice(10,12)}:${compact.slice(12,14)}+09:00`; if (compact.length >= 8) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`; return raw; }
function hmac(secret: string, message: string) { return createHmac("sha256", secret).update(message).digest("hex"); }
function rowsFrom(data: unknown): AnyRecord[] { const queue = [data]; const rows: AnyRecord[] = []; const seen = new Set<unknown>(); while (queue.length) { const value = queue.shift(); if (!value || seen.has(value) || typeof value !== "object") continue; seen.add(value); if (Array.isArray(value)) { queue.push(...value); continue; } const cur = record(value); if (first(cur.orderId, cur.orderNo, cur.id) && first(cur.productName, cur.itemName, cur.name, record(cur.product).name)) rows.push(cur); else queue.push(...Object.values(cur)); } return rows; }
async function readJson(response: Response) { return readJsonApiResponse(response, "토스", { successCodes: ["SUCCESS", "OK", "0"], resultPaths: [["resultType"], ["code"], ["status"]] }); }
function normalize(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const product = record(row.product || row.orderProduct || row.item || row.productItem);
  const receiver = record(row.receiver || row.shippingAddress || row.delivery || row.recipient);
  const item: NormalizedOrderItem = { channelProductCode: first(product.id, product.productId, row.productId, row.productNo), channelOptionCode: first(product.optionId, product.productItemId, row.orderProductId, row.optionId), channelProductName: first(product.name, row.productName, row.itemName, "토스 주문"), channelOptionName: first(product.optionName, row.optionName), sku: first(product.sellerProductCode, product.sellerItemCode, row.sku), qty: num(row.quantity || product.quantity || row.orderQuantity) || 1, salesAmount: num(row.paymentAmount || row.salesAmount || product.price || row.amount) || undefined, raw: row };
  return { ...base, orderNo: first(row.orderNo, row.orderId, row.id), bundleOrderNo: first(row.paymentId, row.orderId, row.orderNo), orderDate: normalizeDate(first(row.paidAt, row.orderedAt, row.createdAt, row.orderDate)), orderStatus: first(row.status, row.orderStatus, row.deliveryStatus, "주문완료"), receiverName: first(receiver.name, receiver.receiverName, row.receiverName), phone1: first(receiver.phone, receiver.mobile, row.receiverPhone), zipcode: first(receiver.zipcode, receiver.zipCode, row.zipcode), address: [first(receiver.address, receiver.baseAddress, row.address), first(receiver.detailAddress, row.detailAddress)].filter(Boolean).join(" "), deliveryMessage: first(receiver.message, row.deliveryMessage), items: [item], raw: row };
}

export class TossChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const accessKey = first(params.access_key, params.oauth_access_key);
    const secretKey = first(params.secret_key, params.oauth_secret_key);
    const merchantId = first(params.merchant_id, params.partner_no, params.seller_id);
    if (!accessKey || !secretKey) return { ok: false, data: [], error: "토스 Access Key와 Secret Key를 저장해주세요." };
    const baseUrl = text(params.api_base_url) || TOSS_BASE_URL;
    const path = text(params.orders_path) || TOSS_ORDER_PATH;
    const body = { merchantId: merchantId || undefined, from: date(params.fromDate ?? params.from, "start"), to: date(params.toDate ?? params.to, "end"), page: 0, size: 100 };
    const payload = JSON.stringify(body);
    const timestamp = Date.now().toString();
    const signature = hmac(secretKey, `${timestamp}.${payload}`);
    try {
      const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${accessKey}`, "X-Toss-Access-Key": accessKey, "X-Toss-Timestamp": timestamp, "X-Toss-Signature": signature }, body: payload });
      const data = await readJson(response);
      const rows = rowsFrom(data);
      const base = { channelCode: text(params.channel_code) || "TOSS", channelName: text(params.channel_name) || "토스", customerCode: text(params.customer_code), customerName: text(params.customer_name) };
      return { ok: true, data: rows.map((row) => normalize(row, base)).filter((order) => order.orderNo), message: `토스 주문 ${rows.length}건을 수집했습니다.` };
    } catch (error) { return { ok: false, data: [], error: error instanceof Error ? error.message : "토스 주문 수집 실패" }; }
  }
}
