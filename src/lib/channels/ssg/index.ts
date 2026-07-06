import { readJsonApiResponse } from "../common/api-response";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;

const SSG_BASE_URL = "https://eapi.ssgadm.com";
const SSG_VERSION = "1";

function text(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function numberValue(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function firstText(...values: unknown[]) { for (const value of values) { const next = text(value); if (next) return next; } return ""; }
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
  return [firstText(row.shppNo, row.ordNo, row.orordNo, row.orderNo), firstText(row.shppSeq, row.ordItemSeq, row.orordItemSeq, row.uitemId, row.itemId)].filter(Boolean).join("|");
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
function ssgOrderStatus(row: AnyRecord) {
  const named = firstText(row.ordItemStatNm, row.ordStatNm, row.shppProgStatDtlNm, row.statusName);
  if (named) return named;
  const code = firstText(row.ordItemStat, row.ordStat, row.shppProgStatDtlCd, row.status);
  const compact = code.replace(/[\s_()/.-]+/g, "").toUpperCase();
  if (["PAYED", "PAID", "PAYMENTCOMPLETED", "PAYMENTCOMPLETE", "ORDERPAID", "NEW", "NEWORDER", "NOTYET", "NOTYETPLACE", "결제완료", "신규주문", "발주전"].includes(compact)) return "신규주문";
  if (["PLACEORDEROK", "PLACEORDER", "ORDERCONFIRMED", "CONFIRMED", "READYTOSHIP", "READYFORDISPATCH", "READYFORDELIVERY", "SHIPPINGREADY", "DELIVERYREADY", "WAITINGDELIVERY", "발주확인", "주문확인", "발송대기", "배송준비", "출고대기"].includes(compact)) return "주문확인";
  if (code) return code;
  return "신규주문";
}

function normalizeRow(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const item: NormalizedOrderItem = {
    channelProductCode: firstText(row.itemId, row.prdNo, row.productNo),
    channelOptionCode: firstText(row.uitemId, row.ordItemSeq, row.itemSeq),
    channelProductName: firstText(row.itemNm, row.prdNm, row.productName, "SSG 주문"),
    channelOptionName: firstText(row.uitemNm, row.optNm, row.optionName),
    sku: firstText(row.splItemCd, row.sellerItemCd, row.itemId),
    qty: numberValue(row.ordQty || row.dircItemQty || row.dircQty || row.qty) || 1,
    salesAmount: numberValue(row.rlordAmt || row.sellprc || row.ordAmt || row.saleAmt || row.payAmt) || undefined,
    raw: row,
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
    zipcode: firstText(row.shpplocZipcd, row.zipcd, row.zipcode, row.postNo),
    address: [firstText(row.shpplocAddr, row.addr1, row.baseAddr, row.receiverAddress), firstText(row.addr2, row.dtlAddr, row.receiverDetailAddress)].filter(Boolean).join(" "),
    deliveryMessage: firstText(row.ordMemoCntt, row.dlvMsg, row.deliveryMessage),
    items: [item],
    raw: row,
  };
}

function ssgShippingIds(row: AnyRecord) {
  const productOrderId = firstText(row.productOrderId, row.product_order_id);
  const [fromProductShppNo, fromProductShppSeq] = productOrderId.includes("-") ? productOrderId.split("-", 2) : ["", ""];
  return {
    shppNo: firstText(row.shipmentBoxId, row.shipment_box_id, row.bundleOrderNo, row.bundle_order_no, row.orderId, row.order_id, row.orderNo, row.order_no, row.shppNo, fromProductShppNo),
    shppSeq: firstText(row.shppSeq, row.shpp_seq, fromProductShppSeq, row.productOrderId, row.product_order_id) || "1",
  };
}
function ssgRequestRows(params: Record<string, unknown>, key: "confirmProductOrders" | "dispatchProductOrders") { const value = params[key]; return Array.isArray(value) ? value.map(record) : []; }
function xmlEscape(value: unknown) { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
function ssgCarrierCode(value: unknown) {
  const raw = text(value).toUpperCase();
  if (/^\d{10}$/.test(raw)) return raw;
  if (!raw || raw === "CJGLS" || raw === "CJ" || raw.includes("CJ")) return "0000033011";
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
      return { ok: true, data: rows.flatMap((row) => arrayify(row).map((item) => normalizeRow(record(item), base))).filter((order) => order.orderNo), message: `SSG 주문 ${rows.length}건을 수집했습니다.` };
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
    try {
      const results = [];
      for (const row of rows) {
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
        results.push({ waybill: waybillResult, release: releaseResult });
      }
      return { ok: true, data: results, message: `SSG 송장등록/출고처리 ${rows.length}건 요청 완료` };
    } catch (error) {
      return { ok: false, data: null, error: error instanceof Error ? error.message : "SSG 송장등록/출고처리 실패" };
    }
  }
}
