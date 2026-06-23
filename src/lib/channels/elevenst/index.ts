import { normalizeCollectableOnlineOrders } from "../common/order-status";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;

type XmlNode = {
  name: string;
  children: XmlNode[];
  text: string;
};

const ELEVENST_BASE_URL = "https://api.11st.co.kr/rest";
const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 1000;

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

function firstRecordValue(source: AnyRecord, keys: string[]) {
  const lowerKeyMap = new Map(Object.keys(source).map((key) => [key.toLowerCase(), key]));
  for (const key of keys) {
    const exact = source[key];
    const lower = lowerKeyMap.get(key.toLowerCase());
    const value = exact ?? (lower ? source[lower] : undefined);
    if (text(value)) return value;
  }
  return "";
}

function firstDeepText(root: unknown, keys: string[], maxDepth = 5) {
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number): string {
    if (!value || depth > maxDepth || seen.has(value)) return "";
    if (typeof value !== "object") return "";
    seen.add(value);
    const current = record(value);
    const direct = firstRecordValue(current, keys);
    if (text(direct)) return text(direct);
    for (const child of Object.values(current)) {
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

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlNodeToValue(node: XmlNode): unknown {
  const children = node.children.filter((child) => child.name !== "#text");
  const ownText = node.text.trim();
  if (!children.length) return decodeXmlEntities(ownText);
  const output: AnyRecord = {};
  for (const child of children) {
    const value = xmlNodeToValue(child);
    if (output[child.name] === undefined) {
      output[child.name] = value;
    } else if (Array.isArray(output[child.name])) {
      (output[child.name] as unknown[]).push(value);
    } else {
      output[child.name] = [output[child.name], value];
    }
  }
  if (ownText) output._text = decodeXmlEntities(ownText);
  return output;
}

function parseXml(xml: string) {
  const root: XmlNode = { name: "root", children: [], text: "" };
  const stack = [root];
  const tokenPattern = /<!--([\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<([^!?][^>]*?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(xml))) {
    const cdata = match[2];
    const tag = match[3];
    const bodyText = match[4];
    const current = stack[stack.length - 1];
    if (cdata !== undefined) {
      current.text += cdata;
      continue;
    }
    if (bodyText !== undefined) {
      current.text += bodyText;
      continue;
    }
    if (!tag) continue;
    const rawTag = tag.trim();
    if (!rawTag || rawTag.startsWith("?")) continue;
    if (rawTag.startsWith("/")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = rawTag.endsWith("/");
    const name = rawTag.replace(/\/$/, "").split(/\s+/)[0];
    const next: XmlNode = { name, children: [], text: "" };
    current.children.push(next);
    if (!selfClosing) stack.push(next);
  }
  return xmlNodeToValue(root);
}

function decodeMaybeEucKr(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder("euc-kr").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function elevenstDate(value: unknown, boundary: "start" | "end") {
  const raw = text(value);
  if (/^\d{12}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw}${boundary === "start" ? "0000" : "2359"}`;
  const parsed = raw ? new Date(raw) : null;
  const date = parsed && Number.isFinite(parsed.getTime()) ? parsed : new Date();
  if (!raw && boundary === "start") date.setDate(date.getDate() - 7);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const min = String(kst.getUTCMinutes()).padStart(2, "0");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${yyyy}${mm}${dd}${boundary === "start" ? "0000" : "2359"}`;
  return `${yyyy}${mm}${dd}${hh}${min}`;
}

function dateFromElevenst(value: unknown) {
  const raw = text(value);
  const compact = raw.replace(/\D/g, "");
  if (compact.length >= 12) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(8, 10)}:${compact.slice(10, 12)}:00+09:00`;
  }
  if (compact.length >= 8) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return raw;
}

function elevenstRanges(fromValue: unknown, toValue: unknown) {
  const from = elevenstDate(fromValue, "start");
  const to = elevenstDate(toValue, "end");
  const parse = (value: string) => new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:00+09:00`).getTime();
  const fromMs = parse(from);
  const toMs = parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return [{ startTime: from, endTime: to }];
  const ranges: Array<{ startTime: string; endTime: string }> = [];
  let cursor = fromMs;
  const format = (ms: number) => {
    const kst = new Date(ms + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}${String(kst.getUTCHours()).padStart(2, "0")}${String(kst.getUTCMinutes()).padStart(2, "0")}`;
  };
  while (cursor <= toMs && ranges.length < 60) {
    const end = Math.min(cursor + MAX_RANGE_MS, toMs);
    ranges.push({ startTime: format(cursor), endTime: format(end) });
    cursor = end + 60 * 1000;
  }
  return ranges;
}

function arrayify(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function hasOrderIdentity(value: AnyRecord) {
  return Boolean(firstRecordValue(value, ["ordNo", "orderNo", "ordPrdSeq", "dlvNo"]));
}

function findOrderRows(root: unknown) {
  const rows: AnyRecord[] = [];
  const seen = new Set<unknown>();
  function visit(value: unknown) {
    if (!value || seen.has(value)) return;
    if (typeof value !== "object") return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const current = record(value);
    if (hasOrderIdentity(current) && firstDeepText(current, ["prdNm", "productName", "ordQty", "ordPrdSeq", "ordNo"])) {
      rows.push(current);
      return;
    }
    Object.values(current).forEach(visit);
  }
  visit(root);
  const unique = new Map<string, AnyRecord>();
  rows.forEach((row, index) => {
    const key = [
      firstDeepText(row, ["ordNo", "orderNo"]),
      firstDeepText(row, ["ordPrdSeq", "orderProductSequence"]),
      firstDeepText(row, ["dlvNo", "deliveryNo"]),
      firstDeepText(row, ["addPrdNo", "additionalProductNo"]),
    ].filter(Boolean).join(":") || `row-${index}`;
    unique.set(key, row);
  });
  return Array.from(unique.values());
}

function resultStatus(data: unknown) {
  const code = firstDeepText(data, ["result_code", "resultCode", "code"]);
  const message = firstDeepText(data, ["result_message", "resultMessage", "result_text", "message"]);
  return { code, message };
}

function statusLabel(row: AnyRecord, fallback: string) {
  return firstDeepText(row, [
    "ordPrdStatNm",
    "ordPrdStatName",
    "ordPrdStat",
    "orderStatusName",
    "orderStatus",
    "prdStatNm",
  ]) || fallback;
}

function normalizeElevenstRow(
  row: AnyRecord,
  base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string },
  fallbackStatus: string,
): NormalizedOrder {
  const orderNo = firstDeepText(row, ["ordNo", "orderNo"]);
  const ordPrdSeq = firstDeepText(row, ["ordPrdSeq", "orderProductSequence", "ordSeq"]);
  const dlvNo = firstDeepText(row, ["dlvNo", "deliveryNo"]);
  const item: NormalizedOrderItem = {
    channelProductCode: firstDeepText(row, ["prdNo", "productNo", "sellerPrdCd", "sellerProductCode"]),
    channelOptionCode: [ordPrdSeq, dlvNo].filter(Boolean).join("-") || undefined,
    channelProductName: firstDeepText(row, ["prdNm", "productName", "goodsNm", "itemName"]) || "11번가 주문상품",
    channelOptionName: firstDeepText(row, ["slctPrdOptNm", "optionName", "optionNm", "prdOptNm"]),
    sku: firstDeepText(row, ["sellerPrdCd", "sellerStockCd", "sellerProductCode", "sellerManagementCode"]),
    qty: numberValue(firstDeepText(row, ["ordQty", "orderQty", "qty", "quantity"])) || 1,
    salesAmount: numberValue(firstDeepText(row, ["ordPayAmt", "payAmt", "selPrc", "salePrice", "productPrice", "prdPrc"])) || undefined,
    settlementAmount: numberValue(firstDeepText(row, ["sttlAmt", "settlementAmount", "expectedSettlementAmount"])) || undefined,
    raw: row,
  };
  const receiverPhone = firstDeepText(row, ["rcvrPrtblNo", "receiverMobile", "receiverPhone", "rcvrTlphn", "receiverTel"]);
  return {
    ...base,
    orderNo: orderNo || [ordPrdSeq, dlvNo].filter(Boolean).join("-") || firstDeepText(row, ["orderId"]),
    bundleOrderNo: firstDeepText(row, ["ordNo", "orderNo", "bundleNo"]),
    orderDate: dateFromElevenst(firstDeepText(row, ["ordDtm", "orderDate", "ordDt", "payDt", "paymentDate"])),
    orderStatus: statusLabel(row, fallbackStatus),
    receiverName: firstDeepText(row, ["rcvrNm", "receiverName", "recipientName", "recvNm"]),
    phone1: receiverPhone,
    phone2: firstDeepText(row, ["rcvrTlphn", "receiverTel", "receiverPhone2"]),
    zipcode: firstDeepText(row, ["rcvrMailNo", "receiverZipcode", "zipcode", "zipCode"]),
    address: [
      firstDeepText(row, ["rcvrBaseAddr", "receiverBaseAddress", "baseAddress", "address1"]),
      firstDeepText(row, ["rcvrDtlsAddr", "receiverDetailAddress", "detailAddress", "address2"]),
    ].filter(Boolean).join(" "),
    deliveryMessage: firstDeepText(row, ["dlvMsg", "deliveryMessage", "ordDlvReqCont", "shippingMemo"]),
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
    if (!existing.phone1) existing.phone1 = order.phone1;
    if (!existing.address) existing.address = order.address;
    if (!existing.deliveryMessage) existing.deliveryMessage = order.deliveryMessage;
  });
  return Array.from(byOrder.values());
}

export class ElevenstChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const apiKey = firstText(params.api_key, params.openapikey, params.openapi_key, params.access_key);
    if (!apiKey) return { ok: false, data: [], error: "11번가 API Key를 먼저 저장해주세요." };

    try {
      const baseUrl = firstText(params.api_base_url, params.base_url) || ELEVENST_BASE_URL;
      const base = {
        channelCode: text(params.channel_code) || "ELEVENST",
        channelName: text(params.channel_name) || "11번가",
        customerCode: text(params.customer_code),
        customerName: text(params.customer_name),
      };
      const endpoint = text(params.elevenst_order_endpoint || params.order_endpoint) || "complete";
      const includePackaging = params.include_packaging === true || text(params.include_packaging).toLowerCase() === "true";
      const endpoints = [{ name: endpoint, status: "결제완료" }];
      if (includePackaging && endpoint !== "packaging") endpoints.push({ name: "packaging", status: "배송준비중" });
      const rows: Array<{ row: AnyRecord; status: string }> = [];
      const ranges = elevenstRanges(params.from, params.to);

      for (const currentEndpoint of endpoints) {
        for (const range of ranges) {
          const url = `${baseUrl.replace(/\/$/, "")}/ordservices/${encodeURIComponent(currentEndpoint.name)}/${range.startTime}/${range.endTime}`;
          const response = await fetch(url, {
            headers: {
              openapikey: apiKey,
              accept: "application/xml, text/xml; q=0.9",
            },
          });
          const xml = decodeMaybeEucKr(await response.arrayBuffer());
          if (!response.ok) throw new Error(`11번가 API HTTP ${response.status}: ${xml.slice(0, 300)}`);
          const parsed = parseXml(xml);
          const status = resultStatus(parsed);
          if (status.code && !["0", "1", "100", "200"].includes(status.code)) {
            throw new Error(`11번가 API result_code=${status.code}${status.message ? ` - ${status.message}` : ""}`);
          }
          rows.push(...findOrderRows(parsed).flatMap((row) => arrayify(row).map((item) => ({ row: record(item), status: currentEndpoint.status }))));
        }
      }

      if (!rows.length) return { ok: true, data: [], message: "11번가 신규 주문이 없습니다." };
      const normalized = rows
        .map(({ row, status }) => normalizeElevenstRow(row, base, status))
        .filter((order) => order.orderNo && order.items.length);
      const collectableOrders = normalizeCollectableOnlineOrders(normalized);
      return {
        ok: true,
        data: mergeOrders(collectableOrders),
        message: `11번가 주문 ${collectableOrders.length}건을 수집했습니다. 수집 제외 ${Math.max(0, normalized.length - collectableOrders.length)}건.`,
      };
    } catch (error) {
      return { ok: false, data: [], error: error instanceof Error ? error.message : "11번가 주문 수집 실패" };
    }
  }
}
