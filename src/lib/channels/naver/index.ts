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

function naverDailyRanges(fromValue: unknown, toValue: unknown) {
  const from = new Date(normalizeNaverDateTime(fromValue, "start"));
  const to = new Date(normalizeNaverDateTime(toValue, "end"));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from.getTime() > to.getTime()) {
    return [{ from: normalizeNaverDateTime(fromValue, "start"), to: normalizeNaverDateTime(toValue, "end") }];
  }
  const ranges: Array<{ from: string; to: string }> = [];
  let cursor = from.getTime();
  const end = to.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  while (cursor <= end && ranges.length < 370) {
    const rangeEnd = Math.min(cursor + dayMs - 1, end);
    ranges.push({ from: formatKstDateTime(new Date(cursor)), to: formatKstDateTime(new Date(rangeEnd)) });
    cursor = rangeEnd + 1;
  }
  return ranges.length ? ranges : [{ from: normalizeNaverDateTime(fromValue, "start"), to: normalizeNaverDateTime(toValue, "end") }];
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
  const placeOrderStatus = firstText(productOrder.placeOrderStatus, row.placeOrderStatus, row.__fnosPlaceOrderStatusType);
  const productOrderId = firstText(productOrder.productOrderId, productOrder.productOrderNo, row.productOrderId);
  const naverOrderId = firstText(order.orderId, productOrder.orderId, row.orderId);
  const qty = numberValue(productOrder.quantity || productOrder.productOrderQuantity || row.quantity) || 1;
  const salesAmount = numberValue(
    productOrder.totalPaymentAmount
      || productOrder.totalProductAmount
      || productOrder.productPaymentAmount
      || productOrder.productPrice,
  );
  const directPhone1 = firstText(address.tel1, address.phone1, delivery.receiverPhoneNumber1, delivery.receiverTelNo1);
  const directPhone2 = firstText(address.tel2, address.phone2, delivery.receiverPhoneNumber2, delivery.receiverTelNo2);
  const phone1 = usablePhoneValue(directPhone1) || usablePhoneValue(directPhone2);
  const phone2 = usablePhoneValue(directPhone2) || usablePhoneValue(directPhone1);
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
    orderNo: productOrderId || naverOrderId,
    bundleOrderNo: naverOrderId || productOrderId,
    orderDate: naverOrderDate(order, productOrder),
    orderStatus: firstText(placeOrderStatus, productOrder.productOrderStatus, productOrder.orderStatus, row.productOrderStatus),
    receiverName: firstText(
      address.name,
      address.receiverName,
      address.recipientName,
      address.receiver,
      delivery.receiverName,
      delivery.recipientName,
      firstDeepText(row, ["receiverName", "receiver_name", "recipientName", "recipient_name", "shipToName"]),
    ),
    phone1,
    phone2,
    zipcode: firstText(address.zipCode, address.zipcode, delivery.zipCode, firstDeepText(row, ["zipCode", "zipcode", "postCode"])),
    address: [firstText(address.baseAddress, address.address1, address.receiverAddress, delivery.baseAddress, delivery.receiverAddress), firstText(address.detailedAddress, address.address2, delivery.detailedAddress, firstDeepText(row, ["receiverDetailAddress"]))]
      .filter(Boolean)
      .join(" "),
    deliveryMessage: firstText(delivery.deliveryMessage, address.deliveryMessage, productOrder.shippingMemo),
    items: [item],
    raw: row,
  };
}

function usablePhoneValue(value: unknown) {
  const raw = text(value);
  if (!raw || /^-+$/.test(raw)) return "";
  return raw;
}

function hasCustomerShippingAddress(row: AnyRecord) {
  const content = record(row.content);
  const productOrder = record(row.productOrder || row.product_order || content.productOrder || row);
  const delivery = record(row.delivery || content.delivery || productOrder.delivery || row.shippingAddress || row.receiver);
  const address = record(row.shippingAddress || row.receiverAddress || productOrder.shippingAddress || productOrder.receiverAddress || delivery.address || delivery.shippingAddress || delivery.receiverAddress);
  return Boolean(firstText(
    address.name,
    address.receiverName,
    address.recipientName,
    address.tel1,
    address.phone1,
    address.baseAddress,
    address.address1,
    address.receiverAddress,
    delivery.receiverName,
    delivery.receiverPhoneNumber1,
    delivery.receiverTelNo1,
    delivery.baseAddress,
    delivery.receiverAddress,
  ));
}

function compactNaverDeliveryValue(value: unknown) {
  return text(value).replace(/[\s_()/.-]+/g, "").toUpperCase();
}

function isNaverManagedDeliveryOrder(row: AnyRecord) {
  const content = record(row.content);
  const productOrder = record(row.productOrder || row.product_order || content.productOrder || row);
  const delivery = record(row.delivery || content.delivery || productOrder.delivery || row.shippingAddress || row.receiver);
  const deliveryAttributeType = compactNaverDeliveryValue(firstText(
    productOrder.deliveryAttributeType,
    productOrder.deliveryAttributeCode,
    productOrder.deliveryType,
    row.deliveryAttributeType,
    row.deliveryAttributeCode,
  ));
  const deliveryText = compactNaverDeliveryValue(firstText(
    productOrder.deliveryAttributeTypeName,
    productOrder.deliveryTypeName,
    productOrder.deliveryMethodName,
    productOrder.logisticsDeliveryMethod,
    delivery.deliveryTypeName,
    delivery.deliveryMethodName,
  ));
  const logisticsCompanyId = firstText(
    productOrder.logisticsCompanyId,
    productOrder.logisticsCenterId,
    productOrder.fulfillmentCompanyId,
    delivery.logisticsCompanyId,
    row.logisticsCompanyId,
  );
  const fulfillmentFlag = compactNaverDeliveryValue(firstText(
    productOrder.fulfillmentYn,
    productOrder.naverFulfillmentYn,
    productOrder.nDeliveryYn,
    row.fulfillmentYn,
    row.naverFulfillmentYn,
  ));
  return deliveryAttributeType === "ARRIVALGUARANTEE"
    || deliveryAttributeType.includes("NDELIVERY")
    || deliveryText.includes("N배송")
    || deliveryText.includes("NDELIVERY")
    || Boolean(logisticsCompanyId)
    || ["Y", "TRUE", "1"].includes(fulfillmentFlag);
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

function uniqueNaverRows(rows: AnyRecord[]) {
  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const content = record(row.content);
    const productOrder = record(row.productOrder || row.product_order || content.productOrder || row);
    const key = firstText(productOrder.productOrderId, productOrder.productOrderNo, row.productOrderId) || `row-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return Array.from(new Set((Array.isArray(raw) ? raw : [raw]).map((value) => text(value)).filter(Boolean)));
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

// 발주확인/발송처리는 HTTP 200이어도 data.failProductOrderInfos에 건별 실패가 섞여 온다.
function naverFailureMessage(data: unknown) {
  const failures = arrayAt(data, [["data", "failProductOrderInfos"], ["failProductOrderInfos"]]).map(record);
  if (!failures.length) return "";
  return failures
    .map((row) => [text(row.productOrderId), firstText(row.message, row.code)].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" / ") || `네이버 처리 실패 ${failures.length}건`;
}

function naverOrderRows(data: unknown) {
  return arrayAt(data, [
    ["data", "contents"],
    ["data", "productOrders"],
    ["contents"],
    ["productOrders"],
    ["data"],
  ]);
}

async function fetchConditionalOrders(token: string, from: string, to: string, placeOrderStatusType: "NOT_YET" | "OK") {
  const rows: AnyRecord[] = [];
  const pageSize = 300;
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(`${NAVER_BASE_URL}/v1/pay-order/seller/product-orders`);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("rangeType", "PAYED_DATETIME");
    url.searchParams.set("productOrderStatuses", "PAYED");
    url.searchParams.set("placeOrderStatusType", placeOrderStatusType);
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("page", String(page));
    url.searchParams.set("quantityClaimCompatibility", "true");
    let data: unknown = {};
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        data = await readJson(await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }));
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/요청이 많|too many|429|rate/i.test(message) || attempt === 3) throw error;
        await wait(1500 * (attempt + 1));
      }
    }
    const pageRows = naverOrderRows(data).map((row) => ({ ...row, __fnosPlaceOrderStatusType: placeOrderStatusType }));
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
    await wait(500);
  }
  return rows;
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
      const ranges = naverDailyRanges(params.from, params.to);
      const fetchedRows: AnyRecord[] = [];
      for (const range of ranges) {
        fetchedRows.push(...await fetchConditionalOrders(token, range.from, range.to, "NOT_YET"));
        await wait(700);
        fetchedRows.push(...await fetchConditionalOrders(token, range.from, range.to, "OK"));
        await wait(700);
      }
      const detailRows = uniqueNaverRows(fetchedRows);
      if (!detailRows.length) return { ok: true, data: [], message: "네이버 신규/주문확인 주문이 없습니다." };
      const warehouseShipRows = detailRows.filter((row) => !isNaverManagedDeliveryOrder(row as AnyRecord));
      const shippableRows = warehouseShipRows.filter((row) => hasCustomerShippingAddress(row as AnyRecord));
      const managedDeliveryCount = detailRows.length - warehouseShipRows.length;
      const waitingAddressCount = warehouseShipRows.length - shippableRows.length;

      const base = {
        channelCode: text(params.channel_code) || "NAVER",
        channelName: text(params.channel_name) || "네이버 스마트스토어",
        customerCode: text(params.customer_code),
        customerName: text(params.customer_name),
      };
      const normalizedOrders = shippableRows.map((row) => normalizeDetail(row, base)).filter((order) => order.orderNo);
      const collectableOrders = normalizeCollectableOnlineOrders(normalizedOrders);
      const mergedOrders = mergeOrders(collectableOrders);
      const itemCount = collectableOrders.reduce((sum, order) => sum + Math.max(1, Array.isArray(order.items) ? order.items.length : 0), 0);
      return {
        ok: true,
        data: mergedOrders,
        message: `네이버 주문 ${mergedOrders.length}건(상품 ${itemCount}줄)을 수집했습니다. N배송 ${managedDeliveryCount}건, 배송지 미확정 ${waitingAddressCount}건, 현재 발주 전/발주 후가 아닌 ${Math.max(0, normalizedOrders.length - collectableOrders.length)}건은 제외했습니다.`,
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
      const results = [];
      const failureMessages: string[] = [];
      for (const batch of chunks(productOrderIds, 30)) {
        const data = await readJson(await fetch(`${NAVER_BASE_URL}/v1/pay-order/seller/product-orders/confirm`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ productOrderIds: batch }),
        }));
        const failureMessage = naverFailureMessage(data);
        if (failureMessage) failureMessages.push(failureMessage);
        results.push(data);
      }
      if (failureMessages.length) return { ok: false, data: results, error: `네이버 발주확인 일부 실패: ${failureMessages.join(" / ")}` };
      return { ok: true, data: results, message: `네이버 발주확인 ${productOrderIds.length}건 요청 완료` };
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
          deliveryCompanyCode: text(row.deliveryCompanyCode || row.delivery_company_code),
          trackingNumber: text(row.trackingNumber || row.tracking_number),
          dispatchDate: text(row.dispatchDate || row.dispatch_date) || formatKstDateTime(new Date()),
        }))
        .filter((row) => row.productOrderId && row.deliveryCompanyCode && row.trackingNumber);
      if (!dispatchProductOrders.length) return { ok: false, data: null, error: "발송처리할 상품주문번호/택배사코드/송장번호가 없습니다." };
      const token = await issueNaverToken(params);
      const results = [];
      const failureMessages: string[] = [];
      for (const batch of chunks(dispatchProductOrders, 30)) {
        const data = await readJson(await fetch(`${NAVER_BASE_URL}/v1/pay-order/seller/product-orders/dispatch`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dispatchProductOrders: batch }),
        }));
        const failureMessage = naverFailureMessage(data);
        if (failureMessage) failureMessages.push(failureMessage);
        results.push(data);
      }
      if (failureMessages.length) return { ok: false, data: results, error: `네이버 발송처리 일부 실패: ${failureMessages.join(" / ")}` };
      return { ok: true, data: results, message: `네이버 발송처리 ${dispatchProductOrders.length}건 요청 완료` };
    } catch (error) {
      return { ok: false, data: null, error: error instanceof Error ? error.message : "네이버 발송처리 실패" };
    }
  }
}
