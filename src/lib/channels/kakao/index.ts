import { readJsonApiResponse } from "../common/api-response";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;
const KAKAO_BASE_URL = "https://kapi.kakao.com";

function text(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function numberValue(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function firstText(...values: unknown[]) { for (const value of values) { const next = text(value); if (next) return next; } return ""; }
function pad2(value: number) { return String(value).padStart(2, "0"); }
function formatKakaoDate(value: unknown, boundary: "start" | "end") {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) return raw.replace("T", " ").slice(0, 19);
  if (/^\d{8}\d{6}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)} ${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}`;
  const date = raw ? new Date(raw) : new Date();
  if (!raw && boundary === "start") date.setDate(date.getDate() - 1);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth()+1)}-${pad2(kst.getUTCDate())} ${boundary === "start" ? "00:00:00" : "23:59:59"}`;
}
function normalizeDate(value: unknown) { const raw = text(value); const compact = raw.replace(/\D/g, ""); if (compact.length >= 14) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}T${compact.slice(8,10)}:${compact.slice(10,12)}:${compact.slice(12,14)}+09:00`; return raw; }
function arrayAt(root: unknown, paths: string[][]) { for (const path of paths) { let current = root; for (const key of path) current = record(current)[key]; if (Array.isArray(current)) return current as AnyRecord[]; } return Array.isArray(root) ? root as AnyRecord[] : []; }
async function readJson(response: Response) { return readJsonApiResponse(response, "카카오", { successCodes: ["SUCCESS", "OK", "0", "200"], resultPaths: [["code"], ["status"], ["extras", "error_code"]] }); }
function authHeaders(apiKey: string, authScheme = "KakaoAK") { return { Authorization: authScheme.toLowerCase() === "bearer" ? `Bearer ${apiKey}` : `KakaoAK ${apiKey}`, "Content-Type": "application/json" }; }
function findRows(data: unknown) { const direct = arrayAt(data, [["orders"], ["contents"], ["content"], ["data", "contents"], ["data", "orders"], ["data"]]); if (direct.length) return direct; const rows: AnyRecord[] = []; const seen = new Set<unknown>(); function visit(value: unknown) { if (!value || seen.has(value) || typeof value !== "object") return; seen.add(value); if (Array.isArray(value)) { value.forEach(visit); return; } const cur = record(value); const base = record(cur.orderBase); const product = record(cur.orderProduct); if (firstText(cur.id, base.id, cur.orderId) && firstText(product.name, cur.productName, cur.orderStatus)) { rows.push(cur); return; } Object.values(cur).forEach(visit); } visit(data); return rows; }
function kakaoOrderId(row: AnyRecord) { const base = record(row.orderBase || row.base); return firstText(row.orderId, row.id, base.id); }
function kakaoNextCursor(row: AnyRecord) { return { lastOrderId: kakaoOrderId(row), lastModifiedAt: firstText(row.orderModifiedAt, row.modifiedAt, record(row.orderBase).modifiedAt) }; }
function normalizeRow(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const orderBase = record(row.orderBase || row.base);
  const product = record(row.orderProduct || row.product || row.item);
  const delivery = record(row.orderDelivery || row.delivery);
  const deliveryRequest = record(row.orderDeliveryRequest || row.deliveryRequest || row.receiver);
  const orderId = kakaoOrderId(row);
  const item: NormalizedOrderItem = { channelProductCode: firstText(product.id, product.productId, row.productId), channelOptionCode: orderId, channelProductName: firstText(product.name, row.productName, "카카오톡스토어 주문"), channelOptionName: firstText(product.optionContent, product.optionName), sku: firstText(product.sellerItemNo, product.sellerProductCode), qty: numberValue(product.quantity || row.quantity) || 1, salesAmount: numberValue(product.productPrice || product.settlementBasicPrice || row.productPrice) || undefined, settlementAmount: numberValue(product.settlementBasicPrice) || undefined, raw: row };
  return { ...base, orderNo: orderId, bundleOrderNo: firstText(orderBase.paymentId, row.paymentId, orderId), orderDate: normalizeDate(firstText(orderBase.paidAt, orderBase.createdAt, row.paidAt, row.createdAt)), orderStatus: firstText(orderBase.status, row.orderStatus, row.status, "결제완료"), receiverName: firstText(deliveryRequest.receiverName, row.receiverName), phone1: firstText(deliveryRequest.receiverMobileNumber, deliveryRequest.receiverPhoneNumber, row.receiverMobile), phone2: firstText(deliveryRequest.receiverPhoneNumber, row.receiverPhone), zipcode: firstText(deliveryRequest.zipcode, deliveryRequest.zipCode, row.zipcode), address: firstText(deliveryRequest.receiverAddress, row.receiverAddress), deliveryMessage: firstText(deliveryRequest.requirement, delivery.deliveryMessage), items: [item], raw: row };
}
function kakaoOrderIdsFromParams(params: Record<string, unknown>, key: "confirmProductOrders" | "dispatchProductOrders") {
  return Array.from(new Set((Array.isArray(params[key]) ? params[key] : []).map(record).map((row) => firstText(row.orderId, row.order_id, row.productOrderId, row.product_order_id, row.orderNo, row.order_no)).filter(Boolean)));
}
function kakaoDispatchRows(params: Record<string, unknown>) {
  return (Array.isArray(params.dispatchProductOrders) ? params.dispatchProductOrders : [])
    .map(record)
    .map((row) => ({
      orderId: firstText(row.orderId, row.order_id, row.productOrderId, row.product_order_id, row.orderNo, row.order_no),
      shippingMethod: firstText(row.shippingMethod, row.shipping_method, row.deliveryMethod, row.delivery_method) || "SHIPPING",
      deliveryCompanyCode: firstText(row.deliveryCompanyCode, row.delivery_company_code),
      invoiceNumber: firstText(row.trackingNumber, row.tracking_number),
    }))
    .filter((row) => row.orderId && (row.shippingMethod !== "SHIPPING" || (row.deliveryCompanyCode && row.invoiceNumber)));
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
      const summaries: AnyRecord[] = [];
      for (let page = 0; page < 100; page += 1) {
        const response = await fetch(`${baseUrl}${ordersPath}?${search.toString()}`, { headers: authHeaders(apiKey, authScheme) });
        const data = await readJson(response);
        const rows = findRows(data);
        summaries.push(...rows);
        if (rows.length < 100) break;
        const cursor = kakaoNextCursor(rows[rows.length - 1]);
        if (!cursor.lastOrderId || !cursor.lastModifiedAt) break;
        search.set("lastOrderId", cursor.lastOrderId);
        search.set("lastModifiedAt", cursor.lastModifiedAt);
      }
      const rows: AnyRecord[] = [];
      for (const row of summaries) {
        const orderId = kakaoOrderId(row);
        if (!orderId) continue;
        try {
          const detail = await readJson(await fetch(`${baseUrl}${detailPath}?order_id=${encodeURIComponent(orderId)}`, { headers: authHeaders(apiKey, authScheme) }));
          rows.push(record(detail));
        } catch {
          rows.push(row);
        }
      }
      if (!rows.length && text(params.order_id)) {
        const detail = await readJson(await fetch(`${baseUrl}${detailPath}?order_id=${encodeURIComponent(text(params.order_id))}`, { headers: authHeaders(apiKey, authScheme) }));
        rows.push(record(detail));
      }
      const base = { channelCode: text(params.channel_code) || "KAKAO", channelName: text(params.channel_name) || "카카오톡스토어", customerCode: text(params.customer_code), customerName: text(params.customer_name) };
      return { ok: true, data: rows.map((row) => normalizeRow(row, base)).filter((order) => order.orderNo), message: `카카오 주문 ${rows.length}건을 수집했습니다.` };
    } catch (error) { return { ok: false, data: [], error: error instanceof Error ? error.message : "카카오 주문 수집 실패" }; }
  }

  async confirmOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: null, error: "카카오쇼핑 API Key를 먼저 저장해주세요." };
    const orderIds = kakaoOrderIdsFromParams(params, "confirmProductOrders");
    if (!orderIds.length) return { ok: false, data: null, error: "카카오 주문확인에 필요한 orderId가 없습니다." };
    try {
      const baseUrl = text(params.api_base_url) || KAKAO_BASE_URL;
      const path = text(params.confirm_path) || "/v1/shopping/orders/deliveries/status/confirm";
      const authScheme = text(params.auth_scheme) || "KakaoAK";
      const results = [];
      for (let index = 0; index < orderIds.length; index += 200) {
        const batch = orderIds.slice(index, index + 200);
        results.push(await readJson(await fetch(`${baseUrl}${path}`, { method: "POST", headers: authHeaders(apiKey, authScheme), body: JSON.stringify({ orderIds: batch.map((id) => (/^\d+$/.test(id) ? Number(id) : id)) }) })));
      }
      return { ok: true, data: results, message: `카카오 주문확인 ${orderIds.length}건 요청 완료` };
    } catch (error) { return { ok: false, data: null, error: error instanceof Error ? error.message : "카카오 주문확인 실패" }; }
  }

  async dispatchOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: null, error: "카카오쇼핑 API Key를 먼저 저장해주세요." };
    const rows = kakaoDispatchRows(params);
    if (!rows.length) return { ok: false, data: null, error: "카카오 발송처리에 필요한 orderId/택배사코드/송장번호가 없습니다." };
    try {
      const baseUrl = text(params.api_base_url) || KAKAO_BASE_URL;
      const path = text(params.dispatch_path) || "/v1/shopping/orders/deliveries/invoices";
      const authScheme = text(params.auth_scheme) || "KakaoAK";
      const results = [];
      for (let index = 0; index < rows.length; index += 100) {
        const batch = rows.slice(index, index + 100).map((row) => ({
          orderId: /^\d+$/.test(row.orderId) ? Number(row.orderId) : row.orderId,
          shippingMethod: row.shippingMethod,
          ...(row.shippingMethod === "SHIPPING" ? { deliveryInvoiceInfo: { deliveryCompanyCode: row.deliveryCompanyCode, invoiceNumber: row.invoiceNumber } } : {}),
        }));
        results.push(await readJson(await fetch(`${baseUrl}${path}`, { method: "POST", headers: authHeaders(apiKey, authScheme), body: JSON.stringify(batch) })));
      }
      return { ok: true, data: results, message: `카카오 발송처리 ${rows.length}건 요청 완료` };
    } catch (error) { return { ok: false, data: null, error: error instanceof Error ? error.message : "카카오 발송처리 실패" }; }
  }
}
