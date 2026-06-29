import { readJsonApiResponse } from "../common/api-response";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;
const KAKAO_BASE_URL = "https://kapi.kakao.com";

function text(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function numberValue(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function firstText(...values: unknown[]) { for (const value of values) { const next = text(value); if (next) return next; } return ""; }
function formatKakaoDate(value: unknown, boundary: "start" | "end") { const raw = text(value); if (/^\d{14}$/.test(raw)) return raw; const date = raw ? new Date(raw) : new Date(); if (!raw && boundary === "start") date.setDate(date.getDate() - 1); const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000); return `${kst.getUTCFullYear()}${String(kst.getUTCMonth()+1).padStart(2,"0")}${String(kst.getUTCDate()).padStart(2,"0")}${boundary === "start" ? "000000" : "235959"}`; }
function normalizeDate(value: unknown) { const raw = text(value); const compact = raw.replace(/\D/g, ""); if (compact.length >= 14) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}T${compact.slice(8,10)}:${compact.slice(10,12)}:${compact.slice(12,14)}+09:00`; return raw; }
function arrayAt(root: unknown, paths: string[][]) { for (const path of paths) { let current = root; for (const key of path) current = record(current)[key]; if (Array.isArray(current)) return current as AnyRecord[]; } return Array.isArray(root) ? root as AnyRecord[] : []; }
async function readJson(response: Response) { return readJsonApiResponse(response, "카카오", { successCodes: ["SUCCESS", "OK", "0", "200"], resultPaths: [["code"], ["status"], ["extras", "error_code"]] }); }
function authHeaders(apiKey: string, authScheme = "KakaoAK") { return { Authorization: authScheme.toLowerCase() === "bearer" ? `Bearer ${apiKey}` : `KakaoAK ${apiKey}`, "Content-Type": "application/json" }; }
function findRows(data: unknown) { const direct = arrayAt(data, [["orders"], ["contents"], ["content"], ["data"], ["data", "orders"]]); if (direct.length) return direct; const rows: AnyRecord[] = []; const seen = new Set<unknown>(); function visit(value: unknown) { if (!value || seen.has(value) || typeof value !== "object") return; seen.add(value); if (Array.isArray(value)) { value.forEach(visit); return; } const cur = record(value); const base = record(cur.orderBase); const product = record(cur.orderProduct); if (firstText(cur.id, base.id, cur.orderId) && firstText(product.name, cur.productName)) { rows.push(cur); return; } Object.values(cur).forEach(visit); } visit(data); return rows; }
function normalizeRow(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const orderBase = record(row.orderBase || row.base);
  const product = record(row.orderProduct || row.product || row.item);
  const delivery = record(row.orderDelivery || row.delivery);
  const deliveryRequest = record(row.orderDeliveryRequest || row.deliveryRequest || row.receiver);
  const item: NormalizedOrderItem = { channelProductCode: firstText(product.id, product.productId, row.productId), channelOptionCode: firstText(product.sellerItemNo, product.optionId, product.itemId), channelProductName: firstText(product.name, row.productName, "카카오톡스토어 주문"), channelOptionName: firstText(product.optionContent, product.optionName), sku: firstText(product.sellerItemNo, product.sellerProductCode), qty: numberValue(product.quantity || row.quantity) || 1, salesAmount: numberValue(product.productPrice || product.settlementBasicPrice || row.productPrice) || undefined, settlementAmount: numberValue(product.settlementBasicPrice) || undefined, raw: row };
  return { ...base, orderNo: firstText(row.id, orderBase.id, row.orderId), bundleOrderNo: firstText(orderBase.paymentId, row.paymentId, row.id), orderDate: normalizeDate(firstText(orderBase.paidAt, orderBase.createdAt, row.paidAt, row.createdAt)), orderStatus: firstText(orderBase.status, row.orderStatus, row.status, "결제완료"), receiverName: firstText(deliveryRequest.receiverName, row.receiverName), phone1: firstText(deliveryRequest.receiverMobileNumber, deliveryRequest.receiverPhoneNumber, row.receiverMobile), phone2: firstText(deliveryRequest.receiverPhoneNumber, row.receiverPhone), zipcode: firstText(deliveryRequest.zipcode, deliveryRequest.zipCode, row.zipcode), address: firstText(deliveryRequest.receiverAddress, row.receiverAddress), deliveryMessage: firstText(deliveryRequest.requirement, delivery.deliveryMessage), items: [item], raw: row };
}

export class KakaoChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: [], error: "카카오쇼핑 API Key를 먼저 저장해주세요." };
    try {
      const baseUrl = text(params.api_base_url) || KAKAO_BASE_URL;
      const ordersPath = text(params.orders_path) || "/v2/shopping/orders";
      const detailPath = text(params.detail_path) || "/v1/shopping/order";
      const authScheme = text(params.auth_scheme) || "KakaoAK";
      const search = new URLSearchParams({ size: "100", orderModifiedAtStart: formatKakaoDate(params.fromDate ?? params.from, "start"), orderModifiedAtEnd: formatKakaoDate(params.toDate ?? params.to, "end") });
      if (text(params.status)) search.set("orderStatus", text(params.status));
      const response = await fetch(`${baseUrl}${ordersPath}?${search.toString()}`, { headers: authHeaders(apiKey, authScheme) });
      const data = await readJson(response);
      let rows = findRows(data);
      if (!rows.length && text(params.order_id)) {
        const detail = await readJson(await fetch(`${baseUrl}${detailPath}?order_id=${encodeURIComponent(text(params.order_id))}`, { headers: authHeaders(apiKey, authScheme) }));
        rows = [record(detail)];
      }
      const base = { channelCode: text(params.channel_code) || "KAKAO", channelName: text(params.channel_name) || "카카오톡스토어", customerCode: text(params.customer_code), customerName: text(params.customer_name) };
      return { ok: true, data: rows.map((row) => normalizeRow(row, base)).filter((order) => order.orderNo), message: `카카오 주문 ${rows.length}건을 수집했습니다.` };
    } catch (error) { return { ok: false, data: [], error: error instanceof Error ? error.message : "카카오 주문 수집 실패" }; }
  }
}
