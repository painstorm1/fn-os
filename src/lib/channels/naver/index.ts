import bcrypt from "bcryptjs";
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

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatKstDateTime(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return [
    kst.getUTCFullYear(),
    pad2(kst.getUTCMonth() + 1),
    pad2(kst.getUTCDate()),
  ].join("-") + `T${pad2(kst.getUTCHours())}:${pad2(kst.getUTCMinutes())}:${pad2(kst.getUTCSeconds())}${KST_OFFSET}`;
}

function normalizeNaverDateTime(value: unknown, boundary: "start" | "end") {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T${boundary === "start" ? "00:00:00" : "23:59:59"}${KST_OFFSET}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([zZ]|[+-]\d{2}:\d{2})?$/.test(raw)) {
    const withSeconds = raw.length === 16 ? `${raw}:00` : raw;
    return /([zZ]|[+-]\d{2}:\d{2})$/.test(withSeconds) ? withSeconds : `${withSeconds}${KST_OFFSET}`;
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
  const order = record(row.order);
  const productOrder = record(row.productOrder || row.product_order || row);
  const delivery = record(row.delivery || row.shippingAddress || row.receiver);
  const address = record(row.shippingAddress || row.receiverAddress || delivery.address);
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
    orderStatus: firstText(productOrder.productOrderStatus, productOrder.orderStatus, row.productOrderStatus),
    receiverName: firstText(address.name, address.receiverName, delivery.receiverName),
    phone1: firstText(address.tel1, address.phone1, delivery.receiverPhoneNumber1, delivery.receiverTelNo1),
    phone2: firstText(address.tel2, address.phone2, delivery.receiverPhoneNumber2, delivery.receiverTelNo2),
    zipcode: firstText(address.zipCode, address.zipcode, delivery.zipCode),
    address: [firstText(address.baseAddress, address.address1, delivery.baseAddress), firstText(address.detailedAddress, address.address2, delivery.detailedAddress)]
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

export class NaverChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const clientId = text(params.api_client_id || params.client_id);
    const clientSecret = text(params.api_client_secret || params.client_secret);
    if (!clientId || !clientSecret) {
      return { ok: false, data: [], error: "네이버 API Client ID/Secret을 먼저 저장해주세요." };
    }

    try {
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

      const from = normalizeNaverDateTime(params.from, "start");
      const to = normalizeNaverDateTime(params.to, "end");
      const statusUrl = new URL(`${NAVER_BASE_URL}/v1/pay-order/seller/product-orders/last-changed-statuses`);
      statusUrl.searchParams.set("lastChangedFrom", from);
      statusUrl.searchParams.set("lastChangedTo", to);
      statusUrl.searchParams.set("limitCount", "300");
      const changedData = await readJson(await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${token}` },
      }));
      const changedRows = arrayAt(changedData, [
        ["data", "lastChangeStatuses"],
        ["data", "productOrderChangeStatuses"],
        ["lastChangeStatuses"],
        ["productOrderChangeStatuses"],
        ["contents"],
        ["data"],
      ]);
      const productOrderIds = Array.from(new Set(changedRows
        .map((row) => firstText(row.productOrderId, row.productOrderNo, row.product_order_id))
        .filter(Boolean)))
        .slice(0, 300);
      if (!productOrderIds.length) return { ok: true, data: [], message: "네이버 신규/변경 주문이 없습니다." };

      const detailData = await readJson(await fetch(`${NAVER_BASE_URL}/v1/pay-order/seller/product-orders/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productOrderIds }),
      }));
      const detailRows = arrayAt(detailData, [
        ["data", "productOrders"],
        ["data", "orderProductList"],
        ["productOrders"],
        ["contents"],
        ["data"],
      ]);
      const base = {
        channelCode: text(params.channel_code) || "NAVER",
        channelName: text(params.channel_name) || "네이버 스마트스토어",
        customerCode: text(params.customer_code),
        customerName: text(params.customer_name),
      };
      return {
        ok: true,
        data: mergeOrders(detailRows.map((row) => normalizeDetail(row, base)).filter((order) => order.orderNo)),
        message: `네이버 주문 ${detailRows.length}건을 수집했습니다.`,
      };
    } catch (error) {
      return { ok: false, data: [], error: error instanceof Error ? error.message : "네이버 주문 수집 실패" };
    }
  }
}
