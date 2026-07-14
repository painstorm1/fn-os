import { readJsonApiResponse } from "../common/api-response";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;

const SSG_BASE_URL = "https://eapi.ssgadm.com";
const SSG_VERSION = "1";

function text(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function numberValue(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function firstText(...values: unknown[]) { for (const value of values) { const next = text(value); if (next) return next; } return ""; }
function firstDeepText(root: unknown, keys: string[], maxDepth = 4) {
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number): string {
    if (!value || depth > maxDepth || seen.has(value)) return "";
    if (typeof value !== "object") return "";
    seen.add(value);
    const current = record(value);
    for (const key of keys) {
      const directValue = current[key];
      const direct = typeof directValue === "string" || typeof directValue === "number" ? String(directValue).trim() : "";
      if (direct) return direct;
    }
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
function primitiveText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).replace(/\s+/g, " ").trim() : "";
}
function firstSsgColumnText(row: AnyRecord, keys: string[], deepKeys: string[] = []) {
  for (const value of [...keys.map((key) => row[key]), deepKeys.length ? firstDeepText(row, deepKeys) : ""]) {
    const next = primitiveText(value);
    if (next) return next;
  }
  return "";
}
function ssgZipcode(row: AnyRecord) {
  return firstSsgColumnText(row, [
    "shpplocZipcd",
    "shpplocZipCd",
    "shppLocZipcd",
    "shppLocZipCd",
    "rcptpeZipcd",
    "receiverZipCode",
    "zipcd",
    "zipcode",
    "zipCode",
    "postNo",
    "postNo1",
  ], [
    "shpplocZipcd",
    "shpplocZipCd",
    "shppLocZipcd",
    "shppLocZipCd",
    "rcptpeZipcd",
    "receiverZipCode",
  ]);
}
function ssgReceiverAddress(row: AnyRecord) {
  return firstSsgColumnText(row, ["수취인주소", "수취인 주소", "ordpeRoadAddr"], ["수취인주소", "수취인 주소", "ordpeRoadAddr"]);
}
function arrayify(value: unknown): unknown[] { if (Array.isArray(value)) return value; if (value === undefined || value === null || value === "") return []; return [value]; }
function arrayAt(root: unknown, paths: string[][]) { for (const path of paths) { let current = root; for (const key of path) current = record(current)[key]; if (Array.isArray(current)) return current as AnyRecord[]; } return Array.isArray(root) ? root as AnyRecord[] : []; }
function formatCompactDate(value: unknown, boundary: "start" | "end") {
  const raw = text(value);
  if (/^\d{14}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw}${boundary === "start" ? "000000" : "235959"}`;
  const date = raw ? new Date(raw) : new Date();
  if (!raw && boundary === "start") date.setDate(date.getDate() - 7);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}${boundary === "start" ? "000000" : "235959"}`;
}
function normalizeDate(value: unknown) {
  const raw = text(value); const compact = raw.replace(/\D/g, "");
  if (compact.length >= 14) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}T${compact.slice(8,10)}:${compact.slice(10,12)}:${compact.slice(12,14)}+09:00`;
  if (compact.length >= 8) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`;
  return raw;
}
function formatSsgDate(value: unknown, boundary: "start" | "end") {
  return formatCompactDate(value, boundary).slice(0, 8);
}
async function readBody(response: Response) {
  return readJsonApiResponse(response, "SSG", { successCodes: ["00", "0", "SUCCESS", "OK"], resultPaths: [["result", "resultCode"], ["result", "code"], ["code"], ["status"]] });
}
function unwrapSsgRow(row: AnyRecord) {
  const nested = record(row.shppDirection || row.order || row.item);
  return Object.keys(nested).length ? nested : row;
}
function isSsgOrderRow(row: AnyRecord) {
  const identifiers = firstText(row.ordNo, row.orordNo, row.orderNo, row.shppNo, row.shppDirectionNo, row.ordItemSeq, row.itemId);
  const item = firstText(row.itemNm, row.prdNm, row.productName, row.uitemNm, row.uitemId, row.splVenItemId, row.uSplVenItemId);
  return Boolean(identifiers && item);
}

function ssgRowKey(row: AnyRecord) {
  const orderIdentity = firstText(row.shppNo, row.shppDirectionNo, row.ordNo, row.orordNo, row.orderNo, row.dircNo);
  const lineIdentity = firstText(row.shppSeq, row.ordItemSeq, row.orordItemSeq, row.itemSeq, row.uitemId, row.uSplVenItemId, row.splVenItemId);
  const productIdentity = [
    firstText(row.itemId, row.prdNo, row.productNo, row.splItemCd, row.sellerItemCd),
    firstText(row.uitemId, row.uitemNm, row.optNm, row.optionName),
    firstText(row.itemNm, row.prdNm, row.productName),
    firstText(row.rcptpeNm, row.receiverName, row.rcverNm),
    firstText(row.ordCmplDts, row.ordCmplDt, row.ordRcpDts, row.paymtCmplDt, row.ordDt, row.orderDate),
  ].filter(Boolean).join("|");
  return [orderIdentity, lineIdentity || productIdentity].filter(Boolean).join("|");
}

function findRows(data: unknown) {
  const direct = arrayAt(data, [["result", "shppDirections"], ["result", "shppDirections", "shppDirection"], ["data"], ["data", "list"], ["data", "items"], ["result", "list"], ["orders"], ["orderList"], ["shppList"], ["listShppDirection"]]);
  const roots = direct.length ? direct : [data];
  const rows: AnyRecord[] = [];
  const seenObjects = new Set<unknown>();
  const seenRows = new Set<string>();
  function pushRow(row: AnyRecord) {
    const key = ssgRowKey(row) || JSON.stringify(row).slice(0, 500);
    if (seenRows.has(key)) return;
    seenRows.add(key);
    rows.push(row);
  }
  function visit(value: unknown) {
    if (!value || seenObjects.has(value)) return;
    if (typeof value !== "object") return;
    seenObjects.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const current = unwrapSsgRow(record(value));
    if (isSsgOrderRow(current)) { pushRow(current); return; }
    const nested = record(value);
    for (const key of ["shppDirection", "shppDirections", "orders", "orderList", "list", "items"]) visit(nested[key]);
    Object.values(nested).forEach(visit);
  }
  roots.forEach(visit);
  return rows;
}
const SSG_NEW_ORDER_CODES = ["11", "011", "PAYED", "PAID", "PAYMENTCOMPLETED", "PAYMENTCOMPLETE", "ORDERPAID", "NEW", "NEWORDER", "NOTYET", "NOTYETPLACE", "결제완료", "신규주문", "발주전"];
const SSG_CONFIRMED_ORDER_CODES = ["12", "012", "20", "020", "21", "021", "PLACEORDEROK", "PLACEORDER", "ORDERCONFIRMED", "CONFIRMED", "READYTOSHIP", "READYFORDISPATCH", "READYFORDELIVERY", "SHIPPINGREADY", "DELIVERYREADY", "WAITINGDELIVERY", "발주확인", "주문확인", "발송대기", "배송준비", "출고대기"];
const SSG_TERMINAL_ORDER_ITEM_STATUSES = new Set(["160", "170", "180", "380", "390"]);

function ssgOrderStatus(row: AnyRecord) {
  // shppProgStatDtlCd/Nm은 배송진행 상세 단계(구체적)를 가리키므로, ordItemStatNm/ordStatNm 같은
  // 광범위한 주문항목 상태명(오래된 값일 수 있음)보다 먼저 확인한다.
  // 현장 확인: SSG 판매자센터 신규주문 1건이 shppProgStatDtlCd=11, ordStatCd=120,
  // shppStatCd=10, shppStatNm="정상"으로 내려왔다. 11/011은 신규주문으로 둔다.
  const detailCode = firstText(row.shppProgStatDtlCd);
  const compactDetail = detailCode.replace(/[\s_()/.-]+/g, "").toUpperCase();
  if (compactDetail) {
    if (SSG_NEW_ORDER_CODES.includes(compactDetail)) return "신규주문";
    if (SSG_CONFIRMED_ORDER_CODES.includes(compactDetail)) return "주문확인";
  }
  const detailName = firstText(row.shppProgStatDtlNm);
  if (detailName) return detailName;

  const named = firstText(row.ordItemStatNm, row.ordStatNm, row.statusName);
  if (named) return named;

  const code = firstText(row.ordItemStat, row.ordStat, row.ordStatCd, row.shppStatCd, row.status);
  const compact = code.replace(/[\s_()/.-]+/g, "").toUpperCase();
  if (SSG_NEW_ORDER_CODES.includes(compact)) return "신규주문";
  if (SSG_CONFIRMED_ORDER_CODES.includes(compact)) return "주문확인";
  if (code) return code;
  return "신규주문";
}

async function readCurrentSsgOrderItemStatuses(apiKey: string, baseUrl: string, orderNo: string) {
  try {
    const response = await fetch(`${baseUrl}/api/claim/v2/order/${encodeURIComponent(orderNo)}`, {
      headers: { Authorization: apiKey, Accept: "application/xml" },
    });
    if (!response.ok) return [];
    const body = await response.text();
    return Array.from(body.matchAll(/<ordItemStat(?:\s[^>]*)?>\s*([^<\s]+)\s*<\/ordItemStat>/gi), (match) => match[1]);
  } catch {
    return [];
  }
}

export async function applyCurrentSsgOrderStatuses(apiKey: string, baseUrl: string, orders: NormalizedOrder[]) {
  const orderNos = Array.from(new Set(orders.map((order) => firstText(record(order.raw).orordNo, record(order.raw).ordNo)).filter(Boolean)));
  const statusesByOrderNo = new Map(await Promise.all(orderNos.map(async (orderNo) => [
    orderNo,
    await readCurrentSsgOrderItemStatuses(apiKey, baseUrl, orderNo),
  ] as const)));
  return orders.map((order) => {
    const raw = record(order.raw);
    const currentStatuses = statusesByOrderNo.get(firstText(raw.orordNo, raw.ordNo)) || [];
    if (!currentStatuses.some((status) => SSG_TERMINAL_ORDER_ITEM_STATUSES.has(status))) return order;
    return { ...order, orderStatus: "출고완료", raw: { ...raw, __fnosSsgCurrentOrderItemStatuses: currentStatuses } };
  });
}

function normalizeRow(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const rowKey = ssgRowKey(row);
  const rawRow = { ...row, __fnosRowKey: rowKey };
  const item: NormalizedOrderItem = {
    channelProductCode: firstText(row.itemId, row.prdNo, row.productNo),
    channelOptionCode: firstText(row.shppSeq, row.ordItemSeq, row.orordItemSeq, row.uitemId, row.itemSeq) || rowKey,
    channelProductName: firstText(row.itemNm, row.prdNm, row.productName, "SSG 주문"),
    channelOptionName: firstText(row.uitemNm, row.optNm, row.optionName),
    sku: firstText(row.splItemCd, row.sellerItemCd, row.itemId),
    qty: numberValue(row.ordQty || row.dircItemQty || row.dircQty || row.qty) || 1,
    salesAmount: numberValue(row.rlordAmt || row.sellprc || row.ordAmt || row.saleAmt || row.payAmt) || undefined,
    raw: rawRow,
  };
  return {
    ...base,
    orderNo: firstText(row.ordNo, row.orordNo, row.orderNo, row.shppNo, row.shppSeq, row.dircNo, row.shppDirectionNo, row.ordItemSeq, row.itemId) || ["SSG", firstText(row.itemId, row.prdNo, row.productNo), firstText(row.uitemId, row.ordItemSeq, row.itemSeq), firstText(row.rcptpeNm, row.receiverName, row.rcverNm), firstText(row.ordCmplDts, row.ordCmplDt, row.ordRcpDts, row.paymtCmplDt, row.ordDt, row.orderDate)].filter(Boolean).join("-"),
    bundleOrderNo: firstText(row.ordNo, row.orordNo, row.orderNo, row.shppNo, row.shppDirectionNo),
    orderDate: normalizeDate(firstText(row.ordCmplDts, row.ordCmplDt, row.ordRcpDts, row.paymtCmplDt, row.ordDt, row.orderDate)),
    orderStatus: ssgOrderStatus(row),
    receiverName: firstText(row.rcptpeNm, row.receiverName, row.rcverNm),
    phone1: firstText(row.rcptpeHpno, row.receiverMobile, row.hpno, row.phone1),
    phone2: firstText(row.rcptpeTelno, row.receiverPhone, row.telno, row.phone2),
    zipcode: ssgZipcode(row),
    address: ssgReceiverAddress(row),
    deliveryMessage: firstText(row.ordMemoCntt, row.dlvMsg, row.deliveryMessage),
    items: [item],
    raw: rawRow,
  };
}

function ssgShippingIds(row: AnyRecord) {
  const productOrderId = firstText(row.productOrderId, row.product_order_id);
  const productOrderIdSeparator = productOrderId.lastIndexOf("-");
  const [fromProductShppNo, fromProductShppSeq] = productOrderIdSeparator > 0 && productOrderIdSeparator < productOrderId.length - 1
    ? [productOrderId.slice(0, productOrderIdSeparator), productOrderId.slice(productOrderIdSeparator + 1)]
    : ["", ""];
  return {
    shppNo: firstText(row.shppNo, row.shpp_no, fromProductShppNo, row.shipmentBoxId, row.shipment_box_id, row.bundleOrderNo, row.bundle_order_no, row.orderId, row.order_id, row.orderNo, row.order_no),
    shppSeq: firstText(row.shppSeq, row.shpp_seq, fromProductShppSeq, row.productOrderId, row.product_order_id) || "1",
  };
}
function ssgRequestRows(params: Record<string, unknown>, key: "confirmProductOrders" | "dispatchProductOrders") { const value = params[key]; return Array.isArray(value) ? value.map(record) : []; }
function xmlEscape(value: unknown) { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
// SSG delicoVenId: CJ대한통운 0000033011, 롯데택배 0000033073, 우체국택배 0000033052
function ssgCarrierCode(value: unknown) {
  const raw = text(value).toUpperCase();
  if (/^\d{10}$/.test(raw)) return raw;
  if (!raw || raw.includes("CJ")) return "0000033011";
  if (raw.includes("LOTTE") || raw.includes("HYUNDAI") || raw.includes("롯데")) return "0000033073";
  if (raw.includes("POST") || raw.includes("우체국")) return "0000033052";
  return text(value);
}
function ssgDispatchRows(params: Record<string, unknown>) {
  return ssgRequestRows(params, "dispatchProductOrders")
    .map((row) => {
      const ids = ssgShippingIds(row);
      return {
        ...ids,
        trackingNumber: text(row.trackingNumber || row.tracking_number).replace(/\D/g, ""),
        deliveryCompanyCode: ssgCarrierCode(row.deliveryCompanyCode || row.delivery_company_code),
        quantity: numberValue(row.quantity || row.qty) || 1,
      };
    })
    .filter((row) => row.shppNo && row.shppSeq && row.trackingNumber);
}

export class SsgChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: [], error: "SSG API Key를 먼저 저장해주세요." };
    const baseUrl = text(params.api_base_url) || SSG_BASE_URL;
    const version = text(params.api_version) || SSG_VERSION;
    const path = text(params.orders_path) || `/api/pd/${version.replace(/^v/i, "")}/listShppDirection.ssg`;
    const fromDate = params.fromDate ?? params.from;
    const toDate = params.toDate ?? params.to;
    const body = `<requestShppDirection><perdType>01</perdType><perdStrDts>${formatSsgDate(fromDate, "start")}</perdStrDts><perdEndDts>${formatSsgDate(toDate, "end")}</perdEndDts></requestShppDirection>`;
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: apiKey, Accept: "application/json", "Content-Type": "application/xml" },
        body,
      });
      const data = await readBody(response);
      const rows = findRows(data);
      const base = { channelCode: text(params.channel_code) || "SSG", channelName: text(params.channel_name) || "SSG", customerCode: text(params.customer_code), customerName: text(params.customer_name) };
      const orders = rows.flatMap((row) => arrayify(row).map((item) => normalizeRow(record(item), base))).filter((order) => order.orderNo);
      const currentOrders = await applyCurrentSsgOrderStatuses(apiKey, baseUrl, orders);
      const terminalCount = currentOrders.filter((order) => order.orderStatus === "출고완료").length;
      return { ok: true, data: currentOrders, message: `SSG 주문 ${rows.length}건 조회, 현재 출고완료 ${terminalCount}건 제외.` };
    } catch (error) {
      return { ok: false, data: [], error: error instanceof Error ? error.message : "SSG 주문 수집 실패" };
    }
  }

  async confirmOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: null, error: "SSG API Key를 먼저 저장해주세요." };
    const baseUrl = text(params.api_base_url) || SSG_BASE_URL;
    const version = text(params.api_version) || SSG_VERSION;
    const path = text(params.confirm_path) || `/api/pd/${version.replace(/^v/i, "")}/updateOrderSubjectManage.ssg`;
    const rows = ssgRequestRows(params, "confirmProductOrders")
      .map(ssgShippingIds)
      .filter((row) => row.shppNo && row.shppSeq);
    if (!rows.length) return { ok: false, data: null, error: "SSG 주문확인에 필요한 shppNo/shppSeq가 없습니다." };
    try {
      const results = [];
      for (const row of rows) {
        const body = `<requestOrderSubjectManage><shppNo>${xmlEscape(row.shppNo)}</shppNo><shppSeq>${xmlEscape(row.shppSeq)}</shppSeq></requestOrderSubjectManage>`;
        const response = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { Authorization: apiKey, Accept: "application/json", "Content-Type": "application/xml" },
          body,
        });
        results.push(await readBody(response));
      }
      return { ok: true, data: results, message: `SSG 주문확인 ${rows.length}건 요청 완료` };
    } catch (error) {
      return { ok: false, data: null, error: error instanceof Error ? error.message : "SSG 주문확인 실패" };
    }
  }

  async dispatchOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: null, error: "SSG API Key를 먼저 저장해주세요." };
    const baseUrl = text(params.api_base_url) || SSG_BASE_URL;
    const version = text(params.api_version) || SSG_VERSION;
    const waybillPath = text(params.waybill_path || params.dispatch_path) || `/api/pd/${version.replace(/^v/i, "")}/saveWblNo.ssg`;
    const releasePath = text(params.release_path) || `/api/pd/${version.replace(/^v/i, "")}/saveWhOutCompleteProcess.ssg`;
    const rows = ssgDispatchRows(params);
    if (!rows.length) return { ok: false, data: null, error: "SSG 송장등록에 필요한 shppNo/shppSeq/송장번호가 없습니다." };
    const results: Array<{ shppNo: string; shppSeq: string; ok: boolean; waybill?: unknown; release?: unknown; error?: string }> = [];
    const failureMessages: string[] = [];
    for (const row of rows) {
      try {
        const waybillBody = `<requestWhOutCompleteProcess><shppNo>${xmlEscape(row.shppNo)}</shppNo><shppSeq>${xmlEscape(row.shppSeq)}</shppSeq><wblNo>${xmlEscape(row.trackingNumber)}</wblNo><delicoVenId>${xmlEscape(row.deliveryCompanyCode)}</delicoVenId><shppTypeCd>20</shppTypeCd><shppTypeDtlCd>22</shppTypeDtlCd></requestWhOutCompleteProcess>`;
        const waybillResponse = await fetch(`${baseUrl}${waybillPath}`, {
          method: "POST",
          headers: { Authorization: apiKey, Accept: "application/json", "Content-Type": "application/xml" },
          body: waybillBody,
        });
        const waybillResult = await readBody(waybillResponse);
        const releaseBody = `<requestWhOutCompleteProcess><shppNo>${xmlEscape(row.shppNo)}</shppNo><shppSeq>${xmlEscape(row.shppSeq)}</shppSeq><procItemQty>${xmlEscape(row.quantity)}</procItemQty></requestWhOutCompleteProcess>`;
        const releaseResponse = await fetch(`${baseUrl}${releasePath}`, {
          method: "POST",
          headers: { Authorization: apiKey, Accept: "application/json", "Content-Type": "application/xml" },
          body: releaseBody,
        });
        const releaseResult = await readBody(releaseResponse);
        results.push({ shppNo: row.shppNo, shppSeq: row.shppSeq, ok: true, waybill: waybillResult, release: releaseResult });
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "SSG 송장등록/출고처리 실패";
        // 릴리스(출고완료) 단계는 SSG측 주문이 '피킹완료' 상태일 때만 허용된다. 송장 등록만으로는
        // SSG가 자동으로 피킹완료 처리를 하지 않으므로, 해당 실패는 재시도가 아니라 SSG 판매자센터에서
        // 피킹완료(또는 이미 출고완료된 상태인지) 확인이 필요하다는 것을 알려준다.
        const message = /피킹완료/.test(rawMessage)
          ? `${rawMessage} (SSG 판매자센터에서 해당 주문이 피킹완료 상태인지, 혹은 이미 출고완료 처리되었는지 확인 후 재시도해주세요. 송장번호는 저장되었을 수 있습니다.)`
          : rawMessage;
        results.push({ shppNo: row.shppNo, shppSeq: row.shppSeq, ok: false, error: message });
        failureMessages.push(`${row.shppNo}/${row.shppSeq}: ${message}`);
      }
    }
    const succeeded = results.filter((row) => row.ok).length;
    if (!succeeded) return { ok: false, data: results, error: failureMessages.join(" / ") || "SSG 송장등록/출고처리 실패" };
    if (failureMessages.length) return { ok: false, data: results, error: `SSG 송장등록/출고처리 ${succeeded}/${rows.length}건 성공, 나머지 실패: ${failureMessages.join(" / ")}` };
    return { ok: true, data: results, message: `SSG 송장등록/출고처리 ${rows.length}건 요청 완료` };
  }
}
