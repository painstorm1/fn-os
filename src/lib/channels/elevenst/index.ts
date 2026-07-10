import { collectableOnlineOrderStage, normalizeCollectableOnlineOrders } from "../common/order-status";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;

type XmlNode = {
  name: string;
  children: XmlNode[];
  text: string;
};

const ELEVENST_BASE_URL = "https://api.11st.co.kr/rest";
const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 1000;
const DEFAULT_ELEVENST_ORDER_ENDPOINTS = [
  { name: "complete", status: "결제완료" },
  { name: "packaging", status: "배송준비중" },
];

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

function isIdempotentElevenstConfirmStatus(status: { code?: string; message?: string }) {
  const code = text(status.code);
  const message = text(status.message).replace(/\s+/g, "");
  return code === "-3206" && (message.includes("이미발주처리") || message.includes("발주처리할건이없"));
}

function isIdempotentElevenstDispatchStatus(status: { code?: string; message?: string }) {
  const code = text(status.code);
  const message = text(status.message).replace(/\s+/g, "");
  return code === "-3313" && (message.includes("이미변경") || message.includes("배송중") || message.includes("출고"));
}

function elevenstRealStatusLabel(row: AnyRecord) {
  return firstDeepText(row, [
    "ordPrdStatNm",
    "ordPrdStatName",
    "ordPrdStat",
    "orderStatusName",
    "orderStatus",
    "prdStatNm",
  ]);
}

function normalizeElevenstRow(
  row: AnyRecord,
  base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string },
  fallbackStatus: string,
): NormalizedOrder {
  const orderNo = firstDeepText(row, ["ordNo", "orderNo"]);
  const ordPrdSeq = firstDeepText(row, ["ordPrdSeq", "orderProductSequence", "ordSeq"]);
  const dlvNo = firstDeepText(row, ["dlvNo", "deliveryNo"]);
  const realStatus = elevenstRealStatusLabel(row);
  const realStage = collectableOnlineOrderStage(realStatus);
  const placeOrderStatus = realStage ? "" : fallbackStatus === "결제완료" ? "NOTYET" : "OK";
  const rawWithCollectableStatus = placeOrderStatus
    ? { ...row, __fnosPlaceOrderStatusType: placeOrderStatus }
    : { ...row };
  const item: NormalizedOrderItem = {
    channelProductCode: firstDeepText(row, ["prdNo", "productNo", "sellerPrdCd", "sellerProductCode"]),
    channelOptionCode: [ordPrdSeq, dlvNo].filter(Boolean).join("-") || undefined,
    channelProductName: firstDeepText(row, ["prdNm", "productName", "goodsNm", "itemName"]) || "11번가 주문상품",
    channelOptionName: firstDeepText(row, ["slctPrdOptNm", "optionName", "optionNm", "prdOptNm"]),
    sku: firstDeepText(row, ["sellerPrdCd", "sellerStockCd", "sellerProductCode", "sellerManagementCode"]),
    qty: numberValue(firstDeepText(row, ["ordQty", "orderQty", "qty", "quantity"])) || 1,
    salesAmount: numberValue(firstDeepText(row, ["ordPayAmt", "payAmt", "selPrc", "salePrice", "productPrice", "prdPrc"])) || undefined,
    settlementAmount: numberValue(firstDeepText(row, ["stlPlnAmt", "settlementPlannedAmount", "plannedSettlementAmount", "settlementExpectAmount", "sttlAmt", "settlementAmount", "expectedSettlementAmount"])) || undefined,
    raw: rawWithCollectableStatus,
  };
  const receiverPhone = firstDeepText(row, ["rcvrPrtblNo", "receiverMobile", "receiverPhone", "rcvrTlphn", "receiverTel"]);
  return {
    ...base,
    orderNo: orderNo || [ordPrdSeq, dlvNo].filter(Boolean).join("-") || firstDeepText(row, ["orderId"]),
    bundleOrderNo: firstDeepText(row, ["ordNo", "orderNo", "bundleNo"]),
    orderDate: dateFromElevenst(firstDeepText(row, ["ordDtm", "orderDate", "ordDt", "payDt", "paymentDate"])),
    orderStatus: realStage ? realStatus : fallbackStatus,
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
    raw: rawWithCollectableStatus,
  };
}

function mergeOrders(orders: NormalizedOrder[]) {
  const byOrder = new Map<string, NormalizedOrder>();
  const statusRank = (value: unknown) => {
    const stage = collectableOnlineOrderStage(value);
    if (stage === "주문확인") return 1;
    if (stage === "신규주문") return 0;
    return -1;
  };
  orders.forEach((order) => {
    const key = `${order.channelCode}:${order.orderNo}`;
    const existing = byOrder.get(key);
    if (!existing) {
      byOrder.set(key, { ...order, items: [...order.items] });
      return;
    }
    existing.items.push(...order.items);
    if (statusRank(order.orderStatus) > statusRank(existing.orderStatus)) existing.orderStatus = order.orderStatus;
    if (!existing.receiverName) existing.receiverName = order.receiverName;
    if (!existing.phone1) existing.phone1 = order.phone1;
    if (!existing.address) existing.address = order.address;
    if (!existing.deliveryMessage) existing.deliveryMessage = order.deliveryMessage;
  });
  return Array.from(byOrder.values());
}

function configuredElevenstEndpoints(params: Record<string, unknown>) {
  const raw = text(
    params.elevenst_order_endpoints
      || params.order_endpoints
      || params.elevenst_order_endpoint
      || params.order_endpoint,
  );
  const endpoints = raw
    ? raw.split(",")
      .map((item) => {
        const [name, status] = item.split(/[:=]/, 2).map((part) => text(part));
        return name ? { name, status: status || endpointStatusLabel(name) } : null;
      })
      .filter((item): item is { name: string; status: string } => Boolean(item))
    : [...DEFAULT_ELEVENST_ORDER_ENDPOINTS];

  const includePackaging = params.include_packaging !== false && text(params.include_packaging).toLowerCase() !== "false";
  if (includePackaging && !endpoints.some((endpoint) => endpoint.name === "packaging")) {
    endpoints.push({ name: "packaging", status: "배송준비중" });
  }
  const includeShipping = params.include_shipping === true || text(params.include_shipping).toLowerCase() === "true";
  if (includeShipping && !endpoints.some((endpoint) => endpoint.name === "shipping")) {
    endpoints.push({ name: "shipping", status: "배송중" });
  }
  const unique = new Map<string, { name: string; status: string }>();
  endpoints.forEach((endpoint) => unique.set(endpoint.name, endpoint));
  return Array.from(unique.values());
}

function endpointStatusLabel(endpoint: string) {
  const compact = endpoint.toLowerCase().replace(/[\s_/-]+/g, "");
  if (compact === "complete") return "결제완료";
  if (compact === "packaging") return "배송준비중";
  if (compact === "shipping") return "배송중";
  return endpoint;
}


function uniqueNonEmpty(values: unknown[]) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function elevenstApiKey(params: Record<string, unknown>) {
  return firstText(params.api_key, params.openapikey, params.openapi_key, params.access_key);
}

function elevenstBaseUrl(params: Record<string, unknown>) {
  return (firstText(params.api_base_url, params.base_url) || ELEVENST_BASE_URL).replace(/\/$/, "");
}

function fillElevenstPathTemplate(template: string, row: AnyRecord) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => encodeURIComponent(text(row[key])));
}

function queryString(payload: AnyRecord) {
  const search = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    const next = text(value);
    if (next) search.set(key, next);
  });
  return search.toString();
}

// 11번가 dlvEtprsCd(택배사 코드): 5자리 숫자 체계. CJ대한통운 00034, 로젠 00002, 우체국 00007, 한진 00011, 롯데 00012, CU 00061
const ELEVENST_CARRIER_CODES: Array<[string, string]> = [
  ["CJ", "00034"],
  ["KGB", "00002"],
  ["LOGEN", "00002"],
  ["로젠", "00002"],
  ["POST", "00007"],
  ["우체국", "00007"],
  ["HANJIN", "00011"],
  ["한진", "00011"],
  ["LOTTE", "00012"],
  ["HYUNDAI", "00012"],
  ["롯데", "00012"],
  ["CUPOST", "00061"],
];
function elevenstCarrierCode(value: unknown) {
  const raw = text(value).toUpperCase();
  if (/^\d{5}$/.test(raw)) return raw;
  for (const [alias, code] of ELEVENST_CARRIER_CODES) {
    if (raw.includes(alias)) return code;
  }
  return "00034";
}

function elevenstSendDt() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}${pad(kst.getUTCHours())}${pad(kst.getUTCMinutes())}`;
}

// 수집 시 channelOptionCode를 "ordPrdSeq-dlvNo"로 저장하므로 여기서 되돌린다.
function splitElevenstOptionCode(value: string) {
  if (!value.includes("-")) return { ordPrdSeq: value, dlvNo: "" };
  const [ordPrdSeq, dlvNo] = value.split("-", 2);
  return { ordPrdSeq, dlvNo };
}

function elevenstDeliveryNo(row: AnyRecord, ordNo: string, parsedDlvNo: string) {
  // bundleOrderNo에는 주문번호가 들어오므로 주문번호와 같은 값은 배송번호로 쓰지 않는다.
  return [
    firstText(row.dlvNo, row.dlv_no),
    parsedDlvNo,
    firstText(row.shipmentBoxId, row.shipment_box_id, row.bundleOrderNo, row.bundle_order_no),
  ].map(text).find((value) => value && value !== ordNo) || "";
}

function normalizeElevenstConfirmRows(params: Record<string, unknown>) {
  const rawRows = Array.isArray(params.confirmProductOrders) ? params.confirmProductOrders.map(record) : [];
  return rawRows.map((row) => {
    const optionCode = splitElevenstOptionCode(firstText(row.productOrderId, row.product_order_id));
    const ordNo = firstText(row.orderNo, row.order_no, row.orderId, row.order_id, row.ordNo, row.ord_no);
    return {
      ordNo,
      ordPrdSeq: firstText(row.ordPrdSeq, row.ord_prd_seq, optionCode.ordPrdSeq) || "1",
      dlvNo: elevenstDeliveryNo(row, ordNo, optionCode.dlvNo),
      addPrdYn: firstText(row.addPrdYn, row.add_prd_yn) || "N",
      addPrdNo: firstText(row.addPrdNo, row.add_prd_no) || "null",
    };
  }).filter((row) => row.ordNo && row.dlvNo);
}

function normalizeElevenstDispatchRows(params: Record<string, unknown>) {
  const rawRows = Array.isArray(params.dispatchProductOrders) ? params.dispatchProductOrders.map(record) : [];
  return rawRows.map((row) => {
    const optionCode = splitElevenstOptionCode(firstText(row.productOrderId, row.product_order_id));
    const ordNo = firstText(row.orderNo, row.order_no, row.orderId, row.order_id, row.ordNo, row.ord_no);
    const trackingNumber = firstText(row.trackingNumber, row.tracking_number, row.invoiceNo, row.invoice_no, row.invcNo, row.invc_no).replace(/\D/g, "");
    return {
      ordNo,
      ordPrdSeq: firstText(row.ordPrdSeq, row.ord_prd_seq, optionCode.ordPrdSeq) || "1",
      dlvNo: elevenstDeliveryNo(row, ordNo, optionCode.dlvNo),
      sendDt: firstText(row.sendDt, row.send_dt, row.dispatchDate, row.dispatch_date).replace(/\D/g, "").slice(0, 12) || elevenstSendDt(),
      dlvMthdCd: firstText(row.dlvMthdCd, row.dlv_mthd_cd) || "01",
      dlvEtprsCd: elevenstCarrierCode(firstText(row.deliveryCompanyCode, row.delivery_company_code, row.dlvEtprsCd, row.dlv_etprs_cd)),
      invcNo: trackingNumber,
    };
  }).filter((row) => row.dlvNo && row.invcNo);
}

function elevenstRequestPayload(row: AnyRecord, mode: "confirm" | "dispatch") {
  if (mode === "confirm") {
    return {
      ordNo: row.ordNo,
      ordPrdSeq: row.ordPrdSeq,
      addPrdYn: row.addPrdYn,
      addPrdNo: row.addPrdNo,
      dlvNo: row.dlvNo,
    };
  }
  return {
    ordNo: row.ordNo,
    ordPrdSeq: row.ordPrdSeq,
    dlvNo: row.dlvNo,
    sendDt: row.sendDt,
    dlvMthdCd: row.dlvMthdCd,
    dlvEtprsCd: row.dlvEtprsCd,
    invcNo: row.invcNo,
  };
}

async function callElevenstOrderMutation(
  params: Record<string, unknown>,
  row: AnyRecord,
  mode: "confirm" | "dispatch",
) {
  const apiKey = elevenstApiKey(params);
  // 공식 스펙: 발주확인 reqpackaging, 발송처리 reqdelivery — 모두 path 파라미터 GET 방식
  const defaultPath = mode === "confirm"
    ? "/ordservices/reqpackaging/{ordNo}/{ordPrdSeq}/{addPrdYn}/{addPrdNo}/{dlvNo}"
    : "/ordservices/reqdelivery/{sendDt}/{dlvMthdCd}/{dlvEtprsCd}/{invcNo}/{dlvNo}";
  const configuredPath = firstText(
    mode === "confirm"
      ? (params.confirm_path || params.elevenst_confirm_path || params.order_confirm_path)
      : (params.dispatch_path || params.elevenst_dispatch_path || params.shipping_path || params.delivery_path),
  ) || defaultPath;
  const method = (firstText(
    mode === "confirm"
      ? (params.confirm_method || params.elevenst_confirm_method)
      : (params.dispatch_method || params.elevenst_dispatch_method),
  ) || "GET").toUpperCase();
  const isPathTemplate = configuredPath.includes("{");
  const path = fillElevenstPathTemplate(configuredPath, row);
  const payload = isPathTemplate ? {} : elevenstRequestPayload(row, mode);
  const encoded = queryString(payload);
  const separator = path.includes("?") ? "&" : "?";
  const fullPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${elevenstBaseUrl(params)}${fullPath}${method === "GET" && encoded ? `${separator}${encoded}` : ""}`;
  const response = await fetch(url, {
    method,
    headers: {
      openapikey: apiKey,
      accept: "application/xml, text/xml; q=0.9, application/json; q=0.8",
      ...(method === "GET" || !encoded ? {} : { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }),
    },
    body: method === "GET" || !encoded ? undefined : encoded,
  });
  const contentType = response.headers.get("content-type") || "";
  const bodyText = contentType.includes("json") ? await response.text() : decodeMaybeEucKr(await response.arrayBuffer());
  if (!response.ok) throw new Error(`11번가 ${mode === "confirm" ? "발주확인" : "배송처리"} API HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
  const parsed = contentType.includes("json") ? JSON.parse(bodyText || "null") : parseXml(bodyText);
  const status = resultStatus(parsed);
  if (status.code && !["0", "1", "100", "200"].includes(status.code)) {
    if ((mode === "confirm" && isIdempotentElevenstConfirmStatus(status))
      || (mode === "dispatch" && isIdempotentElevenstDispatchStatus(status))) {
      return {
        request: { method, path, payload },
        response: parsed,
        idempotent: true,
        message: status.message || (mode === "confirm" ? "이미 발주 처리된 주문입니다." : "이미 배송 처리된 주문입니다."),
      };
    }
    throw new Error(`11번가 ${mode === "confirm" ? "발주확인" : "배송처리"} API result_code=${status.code}${status.message ? ` - ${status.message}` : ""}`);
  }
  return { request: { method, path, payload }, response: parsed };
}

export class ElevenstChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const apiKey = elevenstApiKey(params);
    if (!apiKey) return { ok: false, data: [], error: "11번가 API Key를 먼저 저장해주세요." };

    try {
      const baseUrl = elevenstBaseUrl(params);
      const base = {
        channelCode: text(params.channel_code) || "ELEVENST",
        channelName: text(params.channel_name) || "11번가",
        customerCode: text(params.customer_code),
        customerName: text(params.customer_name),
      };
      const endpoints = configuredElevenstEndpoints(params);
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

      if (!rows.length) return { ok: true, data: [], message: "11번가 수집 대상 주문이 없습니다." };
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

  async confirmOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = elevenstApiKey(params);
    if (!apiKey) return { ok: false, data: null, error: "11번가 API Key를 먼저 저장해주세요." };
    try {
      const rows = normalizeElevenstConfirmRows(params);
      if (!rows.length) return { ok: false, data: null, error: "11번가 발주확인에 필요한 주문번호/배송번호(dlvNo)가 없습니다." };
      const results = [];
      for (const row of rows) {
        results.push(await callElevenstOrderMutation(params, row, "confirm"));
      }
      return { ok: true, data: results, message: `11번가 발주확인 ${rows.length}건 요청 완료` };
    } catch (error) {
      return { ok: false, data: null, error: error instanceof Error ? error.message : "11번가 발주확인 실패" };
    }
  }

  async dispatchOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = elevenstApiKey(params);
    if (!apiKey) return { ok: false, data: null, error: "11번가 API Key를 먼저 저장해주세요." };
    try {
      const rows = normalizeElevenstDispatchRows(params);
      if (!rows.length) return { ok: false, data: null, error: "11번가 배송처리에 필요한 배송번호(dlvNo)와 송장번호가 없습니다." };
      const results = [];
      for (const row of rows) {
        results.push(await callElevenstOrderMutation(params, row, "dispatch"));
      }
      return { ok: true, data: results, message: `11번가 배송처리 ${rows.length}건 요청 완료` };
    } catch (error) {
      return { ok: false, data: null, error: error instanceof Error ? error.message : "11번가 배송처리 실패" };
    }
  }
}
