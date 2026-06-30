import { createHmac } from "crypto";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;

const COUPANG_BASE_URL = "https://api-gateway.coupang.com";

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

function arrayAt(root: unknown, paths: string[][]) {
  for (const path of paths) {
    let current = root;
    for (const key of path) current = record(current)[key];
    if (Array.isArray(current)) return current as AnyRecord[];
  }
  return Array.isArray(root) ? root as AnyRecord[] : [];
}

function signedDate() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").slice(2);
}

function coupangAuthorization(method: string, path: string, query: string, accessKey: string, secretKey: string) {
  const date = signedDate();
  const signature = createHmac("sha256", secretKey).update(`${date}${method}${path}${query}`).digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${date}, signature=${signature}`;
}

async function readJson(response: Response) {
  const body = await response.text();
  const data = body ? JSON.parse(body) : {};
  if (!response.ok) {
    const message = firstText(record(data).message, record(data).resultMessage, body) || `Coupang API ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function koreaDate(value: Date) {
  const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}+09:00`;
}

function coupangDate(value: unknown, fallback: Date) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}\+\d{2}:00$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}+09:00`;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}+09:00`;
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return koreaDate(date);
  }
  return koreaDate(fallback);
}

function coupangSearchStatuses(value: unknown) {
  const raw = text(value);
  if (raw) return raw.split(",").map((item) => item.trim()).filter(Boolean);
  return ["ACCEPT", "INSTRUCT"];
}

function coupangOrderStatus(value: unknown) {
  const status = text(value).toUpperCase();
  if (status === "ACCEPT" || status === "INSTRUCT") return "신규주문";
  return text(value);
}

function normalizeOrder(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const receiver = record(row.receiver);
  const orderer = record(row.orderer);
  const orderItems = arrayAt(row, [["orderItems"], ["items"], ["vendorItems"]]);
  const items = (orderItems.length ? orderItems : [row]).map((itemRow) => {
    const qty = numberValue(itemRow.shippingCount || itemRow.orderCount || itemRow.quantity) || 1;
    const amount = numberValue(
      itemRow.orderPrice
        || itemRow.salesPrice
        || itemRow.vendorItemPrice
        || itemRow.instantDiscountedPrice,
    );
    return {
      channelProductCode: firstText(itemRow.sellerProductId, itemRow.vendorItemId, itemRow.productId),
      channelOptionCode: firstText(itemRow.vendorItemId, itemRow.optionId, itemRow.sellerProductItemId),
      channelProductName: firstText(itemRow.vendorItemName, itemRow.sellerProductName, itemRow.productName, "쿠팡 주문"),
      channelOptionName: firstText(itemRow.sellerProductItemName, itemRow.optionName),
      sku: firstText(itemRow.externalVendorSkuCode, itemRow.sellerProductItemId, itemRow.vendorItemId),
      qty,
      salesAmount: amount ? amount * qty : undefined,
      settlementAmount: numberValue(itemRow.settlementAmount) || undefined,
      raw: itemRow,
    } satisfies NormalizedOrderItem;
  });

  return {
    ...base,
    orderNo: firstText(row.orderId, row.shipmentBoxId, row.orderSheetId),
    bundleOrderNo: firstText(row.shipmentBoxId, row.orderId),
    orderDate: firstText(row.orderedAt, row.orderDate, row.paidAt),
    orderStatus: coupangOrderStatus(row.status || row.orderStatus),
    receiverName: firstText(receiver.name, row.receiverName, orderer.name),
    phone1: firstText(receiver.safeNumber, receiver.mobile, row.receiverMobile, row.receiverPhone),
    phone2: firstText(receiver.phone, row.receiverPhone, orderer.phone),
    zipcode: firstText(receiver.postCode, row.postCode, row.zipcode),
    address: [firstText(receiver.addr1, row.receiverAddress, row.shippingAddress), firstText(receiver.addr2, row.receiverDetailAddress)]
      .filter(Boolean)
      .join(" "),
    deliveryMessage: firstText(row.parcelPrintMessage, row.deliveryMessage, row.shippingMemo),
    items,
    raw: row,
  };
}

export class CoupangChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const accessKey = text(params.access_key);
    const secretKey = text(params.secret_key);
    const vendorId = text(params.vendor_id || params.seller_id || params.api_client_id);
    if (!accessKey || !secretKey || !vendorId) {
      return { ok: false, data: [], error: "쿠팡 Access Key, Secret Key, Vendor ID를 먼저 저장해주세요." };
    }

    try {
      const now = new Date();
      const fromDate = coupangDate(params.fromDate ?? params.from, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      const toDate = coupangDate(params.toDate ?? params.to, now);
      const path = `/v2/providers/openapi/apis/api/v5/vendors/${encodeURIComponent(vendorId)}/ordersheets`;
      const rows: AnyRecord[] = [];
      const seenRows = new Set<string>();
      for (const status of coupangSearchStatuses(params.status)) {
        let nextToken = "";
        do {
          const search = new URLSearchParams({
            createdAtFrom: fromDate,
            createdAtTo: toDate,
            maxPerPage: "50",
            status,
          });
          if (nextToken) search.set("nextToken", nextToken);
          const query = search.toString();
          const response = await fetch(`${COUPANG_BASE_URL}${path}?${query}`, {
            headers: {
              Authorization: coupangAuthorization("GET", path, query, accessKey, secretKey),
              "X-Requested-By": vendorId,
              "Content-Type": "application/json;charset=UTF-8",
            },
          });
          const data = await readJson(response);
          arrayAt(data, [["data"], ["content"], ["contents"], ["orderSheets"]]).forEach((row) => {
            const key = firstText(row.shipmentBoxId, row.orderId, row.orderSheetId, JSON.stringify(row));
            if (seenRows.has(key)) return;
            seenRows.add(key);
            rows.push(row);
          });
          nextToken = firstText(record(data).nextToken, record(record(data).data).nextToken);
        } while (nextToken);
      }
      const base = {
        channelCode: text(params.channel_code) || "COUPANG",
        channelName: text(params.channel_name) || "쿠팡",
        customerCode: text(params.customer_code),
        customerName: text(params.customer_name),
      };
      return {
        ok: true,
        data: rows.map((row) => normalizeOrder(row, base)).filter((order) => order.orderNo),
        message: `쿠팡 주문 ${rows.length}건을 수집했습니다.`,
      };
    } catch (error) {
      return { ok: false, data: [], error: error instanceof Error ? error.message : "쿠팡 주문 수집 실패" };
    }
  }
}
