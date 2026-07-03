import { readJsonApiResponse } from "../common/api-response";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;
const LOTTEON_BASE_URL = "https://openapi.lotteon.com";

function text(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function numberValue(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function firstText(...values: unknown[]) { for (const value of values) { const next = text(value); if (next) return next; } return ""; }
function formatDate(value: unknown, boundary: "start" | "end") { const raw = text(value); if (/^\d{14}$/.test(raw)) return raw; if (/^\d{8}$/.test(raw)) return `${raw}${boundary === "start" ? "000000" : "235959"}`; const date = raw ? new Date(raw) : new Date(); const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000); return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}${boundary === "start" ? "000000" : "235959"}`; }
function ymdToUtcDate(ymd: string) { return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)))); }
function utcDateToYmd(date: Date) { return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`; }
function dailySearchBodies(start: string, end: string, extra: AnyRecord) { const bodies: AnyRecord[] = []; const from = ymdToUtcDate(start.slice(0, 8)); const to = ymdToUtcDate(end.slice(0, 8)); if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return [{ srchStrtDt: start, srchEndDt: end, ...extra }]; for (let cur = new Date(from); cur <= to; cur.setUTCDate(cur.getUTCDate() + 1)) { const ymd = utcDateToYmd(cur); bodies.push({ srchStrtDt: `${ymd}000000`, srchEndDt: `${ymd}235959`, ...extra }); } return bodies; }
function normalizeDate(value: unknown) { const raw = text(value); const compact = raw.replace(/\D/g, ""); if (compact.length >= 14) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}T${compact.slice(8,10)}:${compact.slice(10,12)}:${compact.slice(12,14)}+09:00`; if (compact.length >= 8) return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`; return raw; }
function arrayAt(root: unknown, paths: string[][]) { for (const path of paths) { let current = root; for (const key of path) current = record(current)[key]; if (Array.isArray(current)) return current as AnyRecord[]; } return Array.isArray(root) ? root as AnyRecord[] : []; }
function findRows(data: unknown) { const direct = arrayAt(data, [["deliveryOrderList"], ["data", "deliveryOrderList"], ["data", "orderItems"], ["data", "orders"], ["data"], ["orderItems"], ["orders"], ["result", "orderItems"]]); if (direct.length) return direct; const rows: AnyRecord[] = []; const seen = new Set<unknown>(); function visit(value: unknown) { if (!value || seen.has(value) || typeof value !== "object") return; seen.add(value); if (Array.isArray(value)) { value.forEach(visit); return; } const cur = record(value); if (firstText(cur.odNo, cur.orderNo) && firstText(cur.spdNm, cur.pdNm, cur.goodsNm, cur.prdNm, cur.itemNm)) { rows.push(cur); return; } Object.values(cur).forEach(visit); } visit(data); return rows; }
async function readJson(response: Response) { return readJsonApiResponse(response, "롯데ON", { successCodes: ["0000", "0", "SUCCESS", "OK"], resultPaths: [["returnCode"], ["code"], ["resultCode"], ["status"]] }); }
function lotteonShipmentStarted(row: AnyRecord) {
  return Boolean(firstText(
    row.owhoDttm,
    row.hpDvDttm,
    row.invoiceNo,
    row.invNo,
    row.waybillNo,
    row.dvpWaybilNo,
    row.trackingNo,
  ));
}
function lotteonOrderStatus(row: AnyRecord) {
  const named = firstText(row.odPrgsStepNm, row.orderStatus);
  if (named) return named;
  if (lotteonShipmentStarted(row)) return "배송중";
  const code = firstText(row.odPrgsStepCd);
  if (code === "10") return "신규주문";
  if (code === "11") return "주문확인";
  if (code === "23") return "회수지시";
  return code || "신규주문";
}

function normalizeRow(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const item: NormalizedOrderItem = { channelProductCode: firstText(row.spdNo, row.pdNo, row.prdNo, row.goodsNo, row.itemNo), channelOptionCode: firstText(row.odSeq, row.odDtlSeq, row.sitmNo, row.eitmNo, row.optionNo), channelProductName: firstText(row.spdNm, row.pdNm, row.prdNm, row.goodsNm, row.itemNm, "롯데ON 주문"), channelOptionName: firstText(row.sitmNm, row.optnNm, row.optionNm, row.itemOptnNm), sku: firstText(row.eitmNo, row.epdNo, row.slrPdNo, row.sellerProductCode, row.sku), qty: numberValue(row.ordQty || row.odQty || row.qty) || 1, salesAmount: numberValue(row.slAmt || row.odAmt || row.saleAmt || row.payAmt) || undefined, raw: row };
  return { ...base, orderNo: firstText(row.odNo, row.orderNo), bundleOrderNo: firstText(row.odNo, row.pkgNo), orderDate: normalizeDate(firstText(row.odCmptDttm, row.odDttm, row.ordDttm, row.payDttm, row.orderDate)), orderStatus: lotteonOrderStatus(row), receiverName: firstText(row.dvpCustNm, row.rcvrNm, row.receiverName, row.buyrNm), phone1: firstText(row.dvpMphnNo, row.rcvrCellNo, row.receiverMobile, row.hpNo), phone2: firstText(row.dvpTelNo, row.rcvrTelNo, row.receiverPhone, row.telNo), zipcode: firstText(row.dvpZipNo, row.rcvrZipNo, row.zipcode, row.postNo), address: [firstText(row.dvpStnmZipAddr, row.dvpJbZipAddr, row.rcvrBaseAddr, row.receiverAddress, row.addr), firstText(row.dvpStnmDtlAddr, row.dvpJbDtlAddr, row.rcvrDtlAddr, row.receiverDetailAddress, row.addrDtl)].filter(Boolean).join(" "), deliveryMessage: firstText(row.dvMsg, row.dlvMsg, row.deliveryMessage), items: [item], raw: row };
}


function lotteonRequestRows(params: Record<string, unknown>, key: "confirmProductOrders" | "dispatchProductOrders") { const value = params[key]; return Array.isArray(value) ? value.map(record) : []; }
function lotteonIds(row: AnyRecord) {
  return {
    odNo: firstText(row.orderNo, row.order_no, row.orderId, row.order_id),
    odSeq: firstText(row.productOrderId, row.product_order_id, row.odSeq, row.od_seq) || "1",
    procSeq: firstText(row.procSeq, row.proc_seq) || "1",
    slQty: numberValue(row.quantity || row.qty) || 1,
  };
}
function lotteonCarrierCode(value: unknown) { const raw = text(value).toUpperCase(); if (!raw || raw === "CJGLS" || raw === "CJ" || raw.includes("CJ")) return "CJGLS"; return text(value); }
function lotteonProgressPayload(rows: AnyRecord[], odPrgsStepCd: "12" | "13") {
  return {
    deliveryProgressStateList: rows.map((source) => {
      const ids = lotteonIds(source);
      const trackingNumber = text(source.trackingNumber || source.tracking_number).replace(/\D/g, "");
      const item: AnyRecord = {
        odNo: ids.odNo,
        odSeq: Number(ids.odSeq),
        procSeq: Number(ids.procSeq),
        odPrgsStepCd,
        dvTrcStatDttm: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace(/[-:T.Z]/g, "").slice(0, 14),
        slQty: ids.slQty,
        dvRtrvDvsCd: "DV",
      };
      if (odPrgsStepCd === "13") {
        item.invcNbr = 1;
        item.dvCoCd = lotteonCarrierCode(source.deliveryCompanyCode || source.delivery_company_code);
        item.invcNoList = [trackingNumber];
      }
      return item;
    }),
  };
}

export class LotteonChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: [], error: "롯데ON OpenAPI Key를 먼저 저장해주세요." };
    try {
      const baseUrl = text(params.api_base_url) || LOTTEON_BASE_URL;
      const path = text(params.orders_path) || "/v1/openapi/delivery/v1/SellerDeliveryOrdersSearch";
      const start = formatDate(params.fromDate ?? params.from, "start");
      const end = formatDate(params.toDate ?? params.to, "end");
      const extra: AnyRecord = { odPrgsStepCd: text(params.odPrgsStepCd || params.order_status_code) || "11" };
      const lrtrNo = text(params.sub_partner_no);
      if (lrtrNo) extra.lrtrNo = lrtrNo;
      const rows: AnyRecord[] = [];
      for (const body of dailySearchBodies(start, end, extra)) {
        const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "ko", "X-Timezone": "GMT+09:00", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
        const data = await readJson(response);
        rows.push(...findRows(data));
      }
      const base = { channelCode: text(params.channel_code) || "LOTTEON", channelName: text(params.channel_name) || "롯데ON", customerCode: text(params.customer_code), customerName: text(params.customer_name) };
      const collectableRows = rows.filter((row) => !lotteonShipmentStarted(row));
      const excludedShipmentCount = rows.length - collectableRows.length;
      return {
        ok: true,
        data: collectableRows.map((row) => normalizeRow(row, base)).filter((order) => order.orderNo),
        message: excludedShipmentCount
          ? `롯데ON 주문 ${collectableRows.length}건을 수집했습니다. 송장입력/배송중 ${excludedShipmentCount}건은 제외했습니다.`
          : `롯데ON 주문 ${collectableRows.length}건을 수집했습니다.`,
      };
    } catch (error) { return { ok: false, data: [], error: error instanceof Error ? error.message : "롯데ON 주문 수집 실패" }; }
  }

  async confirmOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: null, error: "롯데ON OpenAPI Key를 먼저 저장해주세요." };
    const rows = lotteonRequestRows(params, "confirmProductOrders").filter((row) => lotteonIds(row).odNo);
    if (!rows.length) return { ok: false, data: null, error: "롯데ON 주문확인에 필요한 주문번호/주문순번이 없습니다." };
    try {
      const baseUrl = text(params.api_base_url) || LOTTEON_BASE_URL;
      const path = text(params.status_path) || "/v1/openapi/delivery/v2/SellerDeliveryProgressStateInform";
      const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "ko", "X-Timezone": "GMT+09:00", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(lotteonProgressPayload(rows, "12")) });
      const data = await readJson(response);
      return { ok: true, data, message: `롯데ON 상품준비 ${rows.length}건 요청 완료` };
    } catch (error) { return { ok: false, data: null, error: error instanceof Error ? error.message : "롯데ON 상품준비 처리 실패" }; }
  }

  async dispatchOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: null, error: "롯데ON OpenAPI Key를 먼저 저장해주세요." };
    const rows = lotteonRequestRows(params, "dispatchProductOrders").filter((row) => lotteonIds(row).odNo && text(row.trackingNumber || row.tracking_number));
    if (!rows.length) return { ok: false, data: null, error: "롯데ON 발송완료에 필요한 주문번호/주문순번/송장번호가 없습니다." };
    try {
      const baseUrl = text(params.api_base_url) || LOTTEON_BASE_URL;
      const path = text(params.status_path) || "/v1/openapi/delivery/v2/SellerDeliveryProgressStateInform";
      const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "ko", "X-Timezone": "GMT+09:00", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(lotteonProgressPayload(rows, "13")) });
      const data = await readJson(response);
      return { ok: true, data, message: `롯데ON 발송완료 ${rows.length}건 요청 완료` };
    } catch (error) { return { ok: false, data: null, error: error instanceof Error ? error.message : "롯데ON 발송완료 처리 실패" }; }
  }
}
