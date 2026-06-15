import bcrypt from "bcryptjs";
import { normalizeCollectableOnlineOrders } from "../common/order-status";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;

const NAVER_BASE_URL = "https://api.commerce.naver.com/external";
const KST_OFFSET = "+09:00";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const next = text(value);
    if (next) return next;
  }
  return "";
}

function firstDeepText(root: unknown, keys: string[], maxDepth = 5) {
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number): string {
    if (!value || depth > maxDepth || seen.has(value)) return "";
    if (typeof value !== "object") return "";
    seen.add(value);
    const nextRecord = record(value);
    for (const key of keys) {
      const direct = text(nextRecord[key]);
      if (direct) return direct;
    }
    for (const child of Object.values(nextRecord)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = visit(item, depth + 1);
          if (found) return found;
        }
        continue;
      }
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return "";
  }
  return visit(root, 0);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatKstDateTime(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return [
    kst.getUTCFullYear(),
    pad2(kst.getUTCMonth() + 1),
    pad2(kst.getUTCDate()),
  ].join("-") + `T${pad2(kst.getUTCHours())}:${pad2(kst.getUTCMinutes())}:${pad2(kst.getUTCSeconds())}.${String(kst.getUTCMilliseconds()).padStart(3, "0")}${KST_OFFSET}`;
}

function normalizeNaverDateTime(value: unknown, boundary: "start" | "end") {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}${KST_OFFSET}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?([zZ]|[+-]\d{2}:\d{2})?$/.test(raw)) {
    const withSeconds = raw.length === 16 ? `${raw}:00` : raw;
    const withMilliseconds = withSeconds.replace(/(T\d{2}:\d{2}:\d{2})(\.\d{1,3})?([zZ]|[+-]\d{2}:\d{2})?$/, (_match, time: string, ms = "", offset = "") => {
      const normalizedMs = ms ? `.${ms.slice(1).padEnd(3, "0")}` : ".000";
      return `${time}${normalizedMs}${offset}`;
    });
    return /([zZ]|[+-]\d{2}:\d{2})$/.test(withMilliseconds) ? withMilliseconds : `${withMilliseconds}${KST_OFFSET}`;
  }
  const parsed = raw ? new Date(raw) : null;
  if (parsed && Number.isFinite(parsed.getTime())) return formatKstDateTime(parsed);
  const fallback = new Date();
  if (boundary === "start") fallback.setDate(fallback.getDate() - 7);
  return formatKstDateTime(fallback);
}

function arrayAt(root: unknown, paths: string[][]) {
  for (const path of paths) {
    let current = root;
    for (const key of path) current = record(current)[key];
    if (Array.isArray(current)) return current as AnyRecord[];
  }
  return Array.isArray(root) ? root as AnyRecord[] : [];
}

async function readJson(response: Response) {
  const body = await response.text();
  const data = body ? JSON.parse(body) : {};
  if (!response.ok) {
    const dataRecord = record(data);
    const message = firstText(
      dataRecord.message,
      dataRecord.error_description,
      dataRecord.error,
      record(dataRecord.data).message,
      body,
    ) || `Naver API ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function naverOrderDate(order: AnyRecord, productOrder: AnyRecord) {
  return firstText(
    order.orderDate,
    order.paymentDate,
    productOrder.orderDate,
    productOrder.paymentDate,
    productOrder.placeOrderDate,
  );
}

function normalizeDetail(
  row: AnyRecord,
  base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string },
): NormalizedOrder {
  const content = record(row.content);
  const order = record(row.order || content.order);
  const productOrder = record(row.productOrder || row.product_order || content.productOrder || row);
  const delivery = record(row.delivery || content.delivery || productOrder.delivery || row.shippingAddress || row.receiver);
  const address = record(row.shippingAddress || row.receiverAddress || productOrder.shippingAddress || productOrder.receiverAddress || delivery.address || delivery.shippingAddress || delivery.receiverAddress);
  const productOrderId = firstText(productOrder.productOrderId, productOrder.productOrderNo, row.productOrderId);
  const orderNo = firstText(order.orderId, productOrder.orderId, row.orderId, productOrderId);
  const qty = numberValue(productOrder.quantity || productOrder.productOrderQuantity || row.quantity) || 1;
  const salesAmount = numberValue(
    productOrder.totalPaymentAmount
      || productOrder.totalProductAmount
      || productOrder.productPaymentAmount
      || productOrder.productPrice,
  );
  const item: NormalizedOrderItem = {
    channelProductCode: firstText(productOrder.sellerManagementCode, productOrder.productId, productOrder.productNo),
    channelOptionCode: productOrderId,
    channelProductName: firstText(productOrder.productName, productOrder.productOrderName, productOrder.itemName, "네이버 주문"),
    channelOptionName: firstText(productOrder.productOption, productOrder.optionName, productOrder.optionManageCode),
    sku: firstText(productOrder.sellerManagementCode, productOrder.merchantProductId),
    qty,
    salesAmount: salesAmount || undefined,
    settlementAmount: numberValue(productOrder.settlementExpectAmount || productOrder.expectedSettlementAmount) || undefined,
    raw: row,
  };
  return {
    ...base,
    orderNo: orderNo || productOrderId,
    bundleOrderNo: firstText(order.orderId, row.orderId),
    orderDate: naverOrderDate(order, productOrder),
    orderStatus: firstText(productOrder.productOrderStatus, productOrder.orderStatus, row.productOrderStatus, productOrder.placeOrderStatus, row.placeOrderStatus),
    receiverName: firstText(address.name, address.receiverName, delivery.receiverName, firstDeepText(row, ["receiverName", "recipientName", "shipToName"])),
    phone1: firstText(address.tel1, address.phone1, delivery.receiverPhoneNumber1, delivery.receiverTelNo1, firstDeepText(row, ["receiverPhoneNumber1", "receiverTelNo1", "tel1", "phone1", "mobile"])),
    phone2: firstText(address.tel2, address.phone2, delivery.receiverPhoneNumber2, delivery.receiverTelNo2, firstDeepText(row, ["receiverPhoneNumber2", "receiverTelNo2", "tel2", "phone2", "phone"])),
    zipcode: firstText(address.zipCode, address.zipcode, delivery.zipCode, firstDeepText(row, ["zipCode", "zipcode", "postCode"])),
    address: [firstText(address.baseAddress, address.address1, delivery.baseAddress, firstDeepText(row, ["baseAddress", "address1", "receiverAddress"])), firstText(address.detailedAddress, address.address2, delivery.detailedAddress, firstDeepText(row, ["detailedAddress", "address2", "receiverDetailAddress"]))]
      .filter(Boolean)
      .join(" "),
    deliveryMessage: firstText(delivery.deliveryMessage, address.deliveryMessage, productOrder.shippingMemo),
    items: [item],
    raw: row,
  };
}

function mergeOrders(orders: NormalizedOrder[]) {
  const byOrder = new Map<string, NormalizedOrder>();
  orders.forEach((order) => {
    const key = `${order.channelCode}:${order.orderNo}`;
    const existing = byOrder.get(key);
    if (!existing) {
      byOrder.set(key, { ...order, items: [...order.items] });
      return;
    }
    existing.items.push(...order.items);
    if (!existing.receiverName) existing.receiverName = order.receiverName;
    if (!existing.address) existing.address = order.address;
  });
  return Array.from(byOrder.values());
}

async function issueNaverToken(params: Record<string, unknown>) {
  const clientId = text(params.api_client_id || params.client_id);
  const clientSecret = text(params.api_client_secret || params.client_secret);
  if (!clientId || !clientSecret) throw new Error("네이버 API Client ID/Secret을 먼저 저장해 주세요.");
  const timestamp = Date.now();
  const clientSecretSign = Buffer.from(bcrypt.hashSync(`${clientId}_${timestamp}`, clientSecret), "utf8").toString("base64");
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: clientSecretSign,
    grant_type: "client_credentials",
    type: "SELF",
  });
  const tokenData = record(await readJson(await fetch(`${NAVER_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  })));
  const token = firstText(tokenData.access_token, tokenData.accessToken, record(tokenData.data).access_token);
  if (!token) throw new Error("네이버 접근 토큰을 받지 못했습니다.");
  return token;
}

function productOrderIdsFromParams(params: Record<string, unknown>) {
  const raw = params.productOrderIds || params.product_order_ids || [];
  return (Array.isArray(raw) ? raw : [raw]).map((value) => text(value)).filter(Boolean).slice(0, 30);
}

async function fetchConditionalOrders(token: string, from: string, to: string, placeOrderStatusType: "NOT_YET" | "OK") {
  const url = new URL(`${NAVER_BASE_URL}/v1/pay-order/seller/product-orders`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("rangeType", "PAYED_DATETIME");
  url.searchParams.set("productOrderStatuses", "PAYED");
  url.searchParams.set("placeOrderStatusType", placeOrderStatusType);
  url.searchParams.set("pageSize", "300");
  url.searchParams.set("page", "1");
  url.searchParams.set("quantityClaimCompatibility", "true");
  const data = await readJson(await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  }));
  return arrayAt(data, [
    ["data", "contents"],
    ["data", "productOrders"],
    ["contents"],
    ["productOrders"],
    ["data"],
  ]);
}

export class NaverChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const clientId = text(params.api_client_id || params.client_id);
    const clientSecret = text(params.api_client_secret || params.client_secret);
    if (!clientId || !clientSecret) {
      return { ok: false, data: [], error: "네이버 API Client ID/Secret을 먼저 저장해주세요." };
    }

    try {
      const token = await issueNaverToken(params);
      const from = normalizeNaverDateTime(params.from, "start");
      const to = normalizeNaverDateTime(params.to, "end");
      const detailRows = [
        ...await fetchConditionalOrders(token, from, to, "NOT_YET"),
        ...await fetchConditionalOrders(token, from, to, "OK"),
      ];
      if (!detailRows.length) return { ok: true, data: [], message: "네이버 신규/주문확인 주문이 없습니다." };

      const base = {
        channelCode: text(params.channel_code) || "NAVER",
        channelName: text(params.channel_name) || "네이버 스마트스토어",
        customerCode: text(params.customer_code),
        customerName: text(params.customer_name),
      };
      const normalizedOrders = detailRows.map((row) => normalizeDetail(row, base)).filter((order) => order.orderNo);
      const collectableOrders = normalizeCollectableOnlineOrders(normalizedOrders);
      return {
        ok: true,
        data: mergeOrders(collectableOrders),
        message: `네이버 주문 ${collectableOrders.length}건을 수집했습니다. 현재 발주 전/발주 후가 아닌 ${Math.max(0, normalizedOrders.length - collectableOrders.length)}건은 제외했습니다.`,
      };
    } catch (error) {
      return { ok: false, data: [], error: error instanceof Error ? error.message : "네이버 주문 수집 실패" };
    }
  }

  async confirmOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    try {
      const productOrderIds = productOrderIdsFromParams(params);
      if (!productOrderIds.length) return { ok: false, data: null, error: "발주확인할 상품주문번호가 없습니다." };
      const token = await issueNaverToken(params);
      const data = await readJson(await fetch(`${NAVER_BASE_URL}/v1/pay-order/seller/product-orders/confirm`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productOrderIds }),
      }));
      return { ok: true, data, message: `네이버 발주확인 ${productOrderIds.length}건 요청 완료` };
    } catch (error) {
      return { ok: false, data: null, error: error instanceof Error ? error.message : "네이버 발주확인 실패" };
    }
  }

  async dispatchOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    try {
      const rawRows = Array.isArray(params.dispatchProductOrders) ? params.dispatchProductOrders : [];
      const dispatchProductOrders = rawRows
        .map((row) => record(row))
        .map((row) => ({
          productOrderId: text(row.productOrderId || row.product_order_id),
          deliveryMethod: text(row.deliveryMethod || row.delivery_method) || "DELIVERY",
          deliveryCompanyCode: text(row.deliveryCompanyCode || row.delivery_company_code) || "CJGLS",
          trackingNumber: text(row.trackingNumber || row.tracking_number).replace(/\D/g, ""),
          dispatchDate: text(row.dispatchDate || row.dispatch_date) || formatKstDateTime(new Date()),
        }))
        .filter((row) => row.productOrderId && row.trackingNumber)
        .slice(0, 30);
      if (!dispatchProductOrders.length) return { ok: false, data: null, error: "발송처리할 상품주문번호/송장번호가 없습니다." };
      const token = await issueNaverToken(params);
      const data = await readJson(await fetch(`${NAVER_BASE_URL}/v1/pay-order/seller/product-orders/dispatch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dispatchProductOrders }),
      }));
      return { ok: true, data, message: `네이버 발송처리 ${dispatchProductOrders.length}건 요청 완료` };
    } catch (error) {
      return { ok: false, data: null, error: error instanceof Error ? error.message : "네이버 발송처리 실패" };
    }
  }
}
