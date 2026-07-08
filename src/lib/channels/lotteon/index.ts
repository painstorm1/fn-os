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
function compactYmd(value: unknown) { const compact = text(value).replace(/\D/g, ""); return compact.length >= 8 ? compact.slice(0, 8) : ""; }
function lotteonOrderYmd(row: AnyRecord) { return compactYmd(firstText(row.odCmptDttm, row.odDttm, row.ordDttm, row.payDttm, row.orderDate)); }
function arrayAt(root: unknown, paths: string[][]) { for (const path of paths) { let current = root; for (const key of path) current = record(current)[key]; if (Array.isArray(current)) return current as AnyRecord[]; } return Array.isArray(root) ? root as AnyRecord[] : []; }
function findRows(data: unknown) { const direct = arrayAt(data, [["deliveryOrderList"], ["data", "deliveryOrderList"], ["data", "orderItems"], ["data", "orders"], ["data"], ["orderItems"], ["orders"], ["result", "orderItems"]]); if (direct.length) return direct; const rows: AnyRecord[] = []; const seen = new Set<unknown>(); function visit(value: unknown) { if (!value || seen.has(value) || typeof value !== "object") return; seen.add(value); if (Array.isArray(value)) { value.forEach(visit); return; } const cur = record(value); if (firstText(cur.odNo, cur.orderNo) && firstText(cur.spdNm, cur.pdNm, cur.goodsNm, cur.prdNm, cur.itemNm)) { rows.push(cur); return; } Object.values(cur).forEach(visit); } visit(data); return rows; }
async function readJson(response: Response) { return readJsonApiResponse(response, "롯데ON", { successCodes: ["0000", "0", "SUCCESS", "OK"], resultPaths: [["returnCode"], ["code"], ["resultCode"], ["status"]] }); }
function lotteonShipmentStarted(row: AnyRecord) {
  // invcNbr은 송장번호가 아니라 송장개수(숫자)라서 0이면 미출고다.
  if (numberValue(row.invcNbr) > 0) return true;
  return Boolean(firstText(
    row.invoiceNo,
    row.invNo,
    row.invcNo,
    row.waybillNo,
    row.dvpWaybilNo,
    row.trackingNo,
  ));
}
function lotteonOrderStatus(row: AnyRecord) {
  const named = firstText(row.odPrgsStepNm, row.orderStatus);
  if (named) return named;
  if (lotteonShipmentStarted(row)) return "배송중";
  // 공식 코드표: 11=출고지시(셀러 확인 전 신규), 12=상품준비(연동완료 후), 23=회수지시
  const code = firstText(row.odPrgsStepCd);
  if (code === "11") return "신규주문";
  if (code === "12") return "주문확인";
  if (code === "23") return "회수지시";
  return code || "신규주문";
}

function normalizeRow(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }, stageLabel = ""): NormalizedOrder {
  const item: NormalizedOrderItem = { channelProductCode: firstText(row.spdNo, row.pdNo, row.prdNo, row.goodsNo, row.itemNo), channelOptionCode: firstText(row.odSeq, row.odDtlSeq, row.sitmNo, row.eitmNo, row.optionNo), channelProductName: firstText(row.spdNm, row.pdNm, row.prdNm, row.goodsNm, row.itemNm, "롯데ON 주문"), channelOptionName: firstText(row.sitmNm, row.optnNm, row.optionNm, row.itemOptnNm), sku: firstText(row.eitmNo, row.epdNo, row.slrPdNo, row.sellerProductCode, row.sku), qty: numberValue(row.ordQty || row.odQty || row.qty) || 1, salesAmount: numberValue(row.slAmt || row.odAmt || row.saleAmt || row.payAmt) || undefined, raw: row };
  return { ...base, orderNo: firstText(row.odNo, row.orderNo), bundleOrderNo: firstText(row.odNo, row.pkgNo), orderDate: normalizeDate(firstText(row.odCmptDttm, row.odDttm, row.ordDttm, row.payDttm, row.orderDate)), orderStatus: stageLabel || lotteonOrderStatus(row), receiverName: firstText(row.dvpCustNm, row.rcvrNm, row.receiverName, row.buyrNm), phone1: firstText(row.dvpMphnNo, row.rcvrCellNo, row.receiverMobile, row.hpNo), phone2: firstText(row.dvpTelNo, row.rcvrTelNo, row.receiverPhone, row.telNo), zipcode: firstText(row.dvpZipNo, row.rcvrZipNo, row.zipcode, row.postNo), address: [firstText(row.dvpStnmZipAddr, row.dvpJbZipAddr, row.rcvrBaseAddr, row.receiverAddress, row.addr), firstText(row.dvpStnmDtlAddr, row.dvpJbDtlAddr, row.rcvrDtlAddr, row.receiverDetailAddress, row.addrDtl)].filter(Boolean).join(" "), deliveryMessage: firstText(row.dvMsg, row.dlvMsg, row.deliveryMessage), items: [item], raw: row };
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
// 롯데ON dvCoCd 공식 코드표: 0001 롯데택배, 0002 CJ대한통운, 0004 우체국, 0005 로젠, 0006 한진, 0024 경동, 9999 기타
function lotteonCarrierCode(value: unknown) {
  const raw = text(value).toUpperCase();
  if (/^\d{4}$/.test(raw)) return raw;
  if (!raw || raw.includes("CJ")) return "0002";
  if (raw.includes("LOTTE") || raw.includes("HYUNDAI") || raw.includes("롯데")) return "0001";
  if (raw.includes("POST") || raw.includes("우체국")) return "0004";
  if (raw === "KGB" || raw.includes("LOGEN") || raw.includes("로젠")) return "0005";
  if (raw.includes("HANJIN") || raw.includes("한진")) return "0006";
  if (raw.includes("KDEXP") || raw.includes("KYUNGDONG") || raw.includes("경동")) return "0024";
  return "9999";
}
function lotteonFailList(data: unknown) {
  return arrayAt(data, [["failList"], ["data", "failList"], ["result", "failList"]]);
}
function lotteonFailureMessage(data: unknown) {
  const failures = lotteonFailList(data);
  if (!failures.length) return "";
  return failures
    .map((row) => firstText(row.rsltMsg, row.resultMessage, row.message, row.errorMessage, row.rsltCd))
    .filter(Boolean)
    .join(" / ") || `롯데ON 처리 실패 ${failures.length}건`;
}
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
        // V2 스펙: invcNbr(송장개수, 숫자) + invcNoList(송장번호 리스트). invcNbr은 invcNoList 길이와 같아야 한다.
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
      const explicitStatusCode = text(params.odPrgsStepCd || params.order_status_code);
      // 공식 스펙: 조회 odPrgsStepCd는 11(출고지시)/23(회수지시)만 존재.
      // 신규/주문확인 구분은 ifCplYN(연동완료여부)로 한다: 빈 값=신규생성 주문, Y=연동완료(주문확인) 주문.
      // 기본 수집은 최근 N일을 훑어 신규주문 누락을 복구하지만, ifCplYN=Y는 이미 판매자센터에서
      // 출고완료된 과거 주문도 계속 반환될 수 있다. 주문확인 조회는 수집 종료일 주문만 유지해
      // 어제/이전 처리완료 건이 오늘 발주 목록에 재등장하지 않게 한다.
      const confirmedOrderYmd = compactYmd(end);
      const stageQueries = explicitStatusCode
        ? [{ ifCplYN: text(params.ifCplYN || params.if_cpl_yn), stage: "", statusCode: explicitStatusCode }]
        : [
          { ifCplYN: "Y", stage: "주문확인", statusCode: "11" },
          { ifCplYN: "", stage: "신규주문", statusCode: "11" },
        ];
      const extra: AnyRecord = {};
      const lrtrNo = text(params.sub_partner_no);
      if (lrtrNo) extra.lrtrNo = lrtrNo;
      const rows: Array<{ row: AnyRecord; stage: string }> = [];
      const seenRowKeys = new Set<string>();
      for (const stageQuery of stageQueries) {
        const bodyExtra: AnyRecord = { ...extra, odPrgsStepCd: stageQuery.statusCode };
        if (stageQuery.ifCplYN) bodyExtra.ifCplYN = stageQuery.ifCplYN;
        for (const body of dailySearchBodies(start, end, bodyExtra)) {
          const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "ko", "X-Timezone": "GMT+09:00", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
          const data = await readJson(response);
          for (const row of findRows(data)) {
            if (!explicitStatusCode && stageQuery.ifCplYN === "Y" && confirmedOrderYmd && lotteonOrderYmd(row) !== confirmedOrderYmd) continue;
            const key = [row.odNo, row.orderNo, row.odSeq, row.odDtlSeq, row.procSeq, row.spdNo, row.pdNo, row.sitmNo].map(text).join("|");
            if (key && seenRowKeys.has(key)) continue;
            if (key) seenRowKeys.add(key);
            rows.push({ row, stage: stageQuery.stage });
          }
        }
      }

      const base = { channelCode: text(params.channel_code) || "LOTTEON", channelName: text(params.channel_name) || "롯데ON", customerCode: text(params.customer_code), customerName: text(params.customer_name) };
      const collectableRows = rows.filter(({ row }) => !lotteonShipmentStarted(row));
      const excludedShipmentCount = rows.length - collectableRows.length;
      return {
        ok: true,
        data: collectableRows.map(({ row, stage }) => normalizeRow(row, base, stage)).filter((order) => order.orderNo),
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
      // 공식 플로우: 주문 수신 후 연동완료 통보(ifCplYN=Y)를 필히 수행해야 상품준비 전환 + 고객 즉시취소 차단이 된다.
      const path = text(params.confirm_path || params.if_complete_path) || "/v1/openapi/delivery/v1/SellerIfCompleteInform";
      const results: unknown[] = [];
      const failureMessages: string[] = [];
      for (let index = 0; index < rows.length; index += 100) {
        const payload = {
          ifCompleteList: rows.slice(index, index + 100).map((source) => {
            const ids = lotteonIds(source);
            return { dvRtrvDvsCd: "DV", odNo: ids.odNo, odSeq: Number(ids.odSeq), procSeq: Number(ids.procSeq), ifCplYN: "Y" };
          }),
        };
        const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "ko", "X-Timezone": "GMT+09:00", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) });
        const data = await readJson(response);
        const rslt = record(record(data).data);
        const rsltCd = text(rslt.rsltCd);
        if (rsltCd && rsltCd !== "0000") failureMessages.push(firstText(rslt.rsltMsg, rsltCd));
        const failureMessage = lotteonFailureMessage(data);
        if (failureMessage) failureMessages.push(failureMessage);
        results.push(data);
      }
      if (failureMessages.length) return { ok: false, data: results, error: `롯데ON 주문확인 일부 실패: ${failureMessages.join(" / ")}` };
      return { ok: true, data: results, message: `롯데ON 주문확인(연동완료) ${rows.length}건 요청 완료` };
    } catch (error) { return { ok: false, data: null, error: error instanceof Error ? error.message : "롯데ON 주문확인 처리 실패" }; }
  }

  async dispatchOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: null, error: "롯데ON OpenAPI Key를 먼저 저장해주세요." };
    const rows = lotteonRequestRows(params, "dispatchProductOrders").filter((row) => lotteonIds(row).odNo && text(row.trackingNumber || row.tracking_number));
    if (!rows.length) return { ok: false, data: null, error: "롯데ON 발송완료에 필요한 주문번호/주문순번/송장번호가 없습니다." };
    try {
      const baseUrl = text(params.api_base_url) || LOTTEON_BASE_URL;
      const path = text(params.status_path) || "/v1/openapi/delivery/v2/SellerDeliveryProgressStateInform";
      const results: unknown[] = [];
      const failureMessages: string[] = [];
      // 통보 목록은 1회 최대 500건 — 100건 단위로 나눠 보낸다.
      for (let index = 0; index < rows.length; index += 100) {
        const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "ko", "X-Timezone": "GMT+09:00", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(lotteonProgressPayload(rows.slice(index, index + 100), "13")) });
        const data = await readJson(response);
        const failureMessage = lotteonFailureMessage(data);
        if (failureMessage) failureMessages.push(failureMessage);
        results.push(data);
      }
      if (failureMessages.length) return { ok: false, data: results, error: `롯데ON 발송완료 일부 실패: ${failureMessages.join(" / ")}` };
      return { ok: true, data: results, message: `롯데ON 발송완료 ${rows.length}건 요청 완료` };
    } catch (error) { return { ok: false, data: null, error: error instanceof Error ? error.message : "롯데ON 발송완료 처리 실패" }; }
  }
}
