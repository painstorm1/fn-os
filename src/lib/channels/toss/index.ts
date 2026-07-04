import { readJsonApiResponse } from "../common/api-response";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;

const TOSS_BASE_URL = "https://shopping-fep.toss.im";
const TOSS_TOKEN_URL = "https://oauth2.cert.toss.im/token";
const TOSS_ORDER_PATH = "/api/v3/shopping-fep/orders/v2";
const TOSS_ORDER_STATUS_PATH = "/api/v3/shopping-fep/orders/products/status";
const TOSS_DELIVERY_PATH = "/api/v3/shopping-fep/orders/products/delivery";

function text(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function num(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function first(...values: unknown[]) { for (const value of values) { const next = text(value); if (next) return next; } return ""; }
function date(value: unknown, boundary: "start" | "end") { const raw = text(value); const d = raw ? new Date(raw) : new Date(); if (!raw && boundary === "start") d.setDate(d.getDate() - 7); const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000); return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth()+1).padStart(2,"0")}-${String(kst.getUTCDate()).padStart(2,"0")}`; }
function normalizeDate(value: unknown) { const raw = text(value); const compact = raw.replace(/\D/g, ""); if (compact.length >= 14) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}T${compact.slice(8,10)}:${compact.slice(10,12)}:${compact.slice(12,14)}+09:00`; if (compact.length >= 8) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`; return raw; }
function rowsFrom(data: unknown): AnyRecord[] { const queue = [record(data).success || data]; const rows: AnyRecord[] = []; const seen = new Set<unknown>(); while (queue.length) { const value = queue.shift(); if (!value || seen.has(value) || typeof value !== "object") continue; seen.add(value); if (Array.isArray(value)) { queue.push(...value); continue; } const cur = record(value); if (first(cur.orderProductId, cur.orderId, cur.orderNo, cur.id) && first(cur.productName, cur.itemName, cur.name, record(cur.product).name)) rows.push(cur); else queue.push(...Object.values(cur)); } return rows; }
function tossNextCursor(data: unknown) { return first(record(data).nextCursor, record(record(data).success).nextCursor, record(record(data).data).nextCursor, record(record(data).pagination).nextCursor); }
function tossId(value: unknown) { const raw = text(value); const parsed = Number(raw); return raw && Number.isSafeInteger(parsed) ? parsed : raw; }
function tossDeliveryCompany(value: unknown) { const raw = first(value); const aliases: Record<string, string> = { CJGLS: "CJ대한통운", CJ: "CJ대한통운", KGB: "로젠택배", HANJIN: "한진택배", LOTTE: "롯데택배", EPOST: "우체국택배", POST: "우체국택배" }; return aliases[raw.toUpperCase()] || raw; }
async function readJson(response: Response) { return readJsonApiResponse(response, "토스", { successCodes: ["SUCCESS", "OK", "0"], resultPaths: [["resultType"], ["code"], ["status"]] }); }
async function issueAccessToken(accessKey: string, secretKey: string, tokenUrl: string) {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: accessKey, client_secret: secretKey, scope: "toss-shopping-fep:write" });
  const response = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json; charset=UTF-8" }, body });
  const data = await readJsonApiResponse(response, "토스 토큰", { successCodes: ["SUCCESS", "OK", "0"], resultPaths: [["resultType"], ["code"], ["status"]] }) as AnyRecord;
  const token = first(data.access_token, data.accessToken, record(data.success).access_token, record(data.success).accessToken);
  if (!token) throw new Error("토스 Access Token 발급 응답에 access_token이 없습니다.");
  return token;
}
function normalize(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const product = record(row.product || row.orderProduct || row.item || row.productItem);
  const receiver = record(row.receiver || row.shippingAddress || row.delivery || row.recipient);
  const item: NormalizedOrderItem = { channelProductCode: first(product.id, product.productId, row.productId, row.productNo), channelOptionCode: first(product.optionId, product.productItemId, row.orderProductId, row.optionId, row.stockId), channelProductName: first(product.name, row.productName, row.itemName, "토스 주문"), channelOptionName: first(product.optionName, row.optionName), sku: first(product.sellerProductCode, product.sellerItemCode, row.sku), qty: num(row.quantity || product.quantity || row.orderQuantity) || 1, salesAmount: num(row.paymentAmount || row.salesAmount || row.price || product.price || row.amount) || undefined, raw: row };
  return { ...base, orderNo: first(row.orderNo, row.orderId, row.id), bundleOrderNo: first(row.paymentId, row.orderId, row.orderNo), orderDate: normalizeDate(first(row.paidAt, row.orderedAt, row.createdAt, row.orderDate)), orderStatus: first(row.orderProductStatus, row.status, row.orderStatus, row.deliveryStatus, "주문완료"), receiverName: first(receiver.name, receiver.receiverName, row.receiverName), phone1: first(receiver.phone, receiver.mobile, row.receiverPhone), zipcode: first(receiver.zipcode, receiver.zipCode, row.zipcode, row.zipCode), address: [first(receiver.address, receiver.baseAddress, row.address), first(receiver.detailAddress, row.detailAddress)].filter(Boolean).join(" "), deliveryMessage: first(receiver.message, row.deliveryMessage, row.shippingNote), items: [item], raw: row };
}

export class TossChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const accessKey = first(params.access_key, params.oauth_access_key);
    const secretKey = first(params.secret_key, params.oauth_secret_key);
    if (!accessKey || !secretKey) return { ok: false, data: [], error: "토스 Access Key와 Secret Key를 저장해주세요." };
    const baseUrl = text(params.api_base_url) || TOSS_BASE_URL;
    const path = text(params.orders_path) || TOSS_ORDER_PATH;
    const tokenUrl = text(params.token_url) || TOSS_TOKEN_URL;
    const startDate = date(params.fromDate ?? params.from, "start");
    const endDate = date(params.toDate ?? params.to, "end");
    const query = new URLSearchParams({ startDate, endDate, limit: "50", partnerName: text(params.partner_name) || "FNOS" });
    if (text(params.status)) query.set("status", text(params.status));
    const rows: AnyRecord[] = [];
    try {
      const token = await issueAccessToken(accessKey, secretKey, tokenUrl);
      for (let page = 0; page < 100; page += 1) {
        const response = await fetch(`${baseUrl}${path}?${query.toString()}`, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
        const data = await readJson(response);
        rows.push(...rowsFrom(data));
        const nextCursor = tossNextCursor(data);
        if (!nextCursor) break;
        query.set("nextCursor", nextCursor);
      }
      const base = { channelCode: text(params.channel_code) || "TOSS", channelName: text(params.channel_name) || "토스", customerCode: text(params.customer_code), customerName: text(params.customer_name) };
      return { ok: true, data: rows.map((row) => normalize(row, base)).filter((order) => order.orderNo), message: `토스 주문 ${rows.length}건을 수집했습니다.` };
    } catch (error) { return { ok: false, data: [], error: error instanceof Error ? error.message : "토스 주문 수집 실패" }; }
  }

  async confirmOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const accessKey = first(params.access_key, params.oauth_access_key);
    const secretKey = first(params.secret_key, params.oauth_secret_key);
    if (!accessKey || !secretKey) return { ok: false, data: null, error: "토스 Access Key와 Secret Key를 저장해주세요." };
    const ids = Array.from(new Set((Array.isArray(params.productOrderIds) ? params.productOrderIds : [])
      .map(first)
      .filter(Boolean)));
    if (!ids.length) return { ok: false, data: null, error: "토스 주문확인에 필요한 orderProductId가 없습니다." };
    try {
      const baseUrl = text(params.api_base_url) || TOSS_BASE_URL;
      const tokenUrl = text(params.token_url) || TOSS_TOKEN_URL;
      const path = text(params.order_status_path) || TOSS_ORDER_STATUS_PATH;
      const token = await issueAccessToken(accessKey, secretKey, tokenUrl);
      const body: AnyRecord = { orderProductIds: ids.map(tossId), status: "PREPARING_PRODUCT" };
      const partnerName = first(params.partner_name);
      if (partnerName) body.partnerName = partnerName;
      const data = await readJson(await fetch(`${baseUrl}${path}`, { method: "PUT", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
      const success = record(record(data).success);
      const failedCount = num(success.failedCount);
      if (failedCount > 0) return { ok: false, data, error: `토스 주문확인 일부 실패 ${failedCount}건: ${first(success.failedReasons, record(data).error)}` };
      return { ok: true, data, message: `토스 주문확인 ${ids.length}건 요청 완료` };
    } catch (error) { return { ok: false, data: null, error: error instanceof Error ? error.message : "토스 주문확인 실패" }; }
  }

  async dispatchOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const accessKey = first(params.access_key, params.oauth_access_key);
    const secretKey = first(params.secret_key, params.oauth_secret_key);
    if (!accessKey || !secretKey) return { ok: false, data: null, error: "토스 Access Key와 Secret Key를 저장해주세요." };
    const rows = (Array.isArray(params.dispatchProductOrders) ? params.dispatchProductOrders : [])
    .map(record)
    .map((row) => ({
      orderProductId: first(row.orderProductId, row.productOrderId, row.product_order_id, row.channelOptionCode, row.channel_option_code),
      deliveryCompany: tossDeliveryCompany(first(row.deliveryCompany, row.deliveryCompanyCode, row.delivery_company_code)),
      trackingNumber: first(row.trackingNumber, row.tracking_number),
      partnerName: first(row.partnerName, row.partner_name, params.partner_name),
    }))
    .filter((row) => row.orderProductId && row.deliveryCompany && row.trackingNumber);
    if (!rows.length) return { ok: false, data: null, error: "토스 발송처리에 필요한 orderProductId/택배사/송장번호가 없습니다." };
    try {
    const baseUrl = text(params.api_base_url) || TOSS_BASE_URL;
    const tokenUrl = text(params.token_url) || TOSS_TOKEN_URL;
    const path = text(params.delivery_path) || TOSS_DELIVERY_PATH;
    const token = await issueAccessToken(accessKey, secretKey, tokenUrl);
    const results = [];
    for (const row of rows) {
      const body: AnyRecord = {
        orderProductId: tossId(row.orderProductId),
        deliveryCompany: row.deliveryCompany,
        trackingNumber: row.trackingNumber,
      };
      if (row.partnerName) body.partnerName = row.partnerName;
      results.push(await readJson(await fetch(`${baseUrl}${path}`, { method: "PUT", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })));
    }
    return { ok: true, data: results, message: `토스 발송처리 ${rows.length}건 요청 완료` };
    } catch (error) { return { ok: false, data: null, error: error instanceof Error ? error.message : "토스 발송처리 실패" }; }
    }
    }
