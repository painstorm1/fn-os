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

function mergeOrders(orders: NormalizedOrder[]) {
  const byOrder = new Map<string, NormalizedOrder>();
  const statusRank = (value: unknown) => text(value) === "주문확인" ? 1 : text(value) === "신규주문" ? 0 : -1;
  orders.forEach((order) => {
    const key = `${order.channelCode}:${order.orderNo}`;
    const existing = byOrder.get(key);
    if (!existing) {
      byOrder.set(key, { ...order, items: [...order.items] });
      return;
    }
    existing.items.push(...order.items);
    if (statusRank(order.orderStatus) > statusRank(existing.orderStatus)) existing.orderStatus = order.orderStatus;
    if (!existing.bundleOrderNo) existing.bundleOrderNo = order.bundleOrderNo;
    if (!existing.orderDate) existing.orderDate = order.orderDate;
    if (!existing.receiverName) existing.receiverName = order.receiverName;
    if (!existing.phone1) existing.phone1 = order.phone1;
    if (!existing.phone2) existing.phone2 = order.phone2;
    if (!existing.zipcode) existing.zipcode = order.zipcode;
    if (!existing.address) existing.address = order.address;
    if (!existing.deliveryMessage) existing.deliveryMessage = order.deliveryMessage;
  });
  return Array.from(byOrder.values());
}


function lotteonRequestRows(params: Record<string, unknown>, key: "confirmProductOrders" | "dispatchProductOrders") { const value = params[key]; return Array.isArray(value) ? value.map(record) : []; }
function lotteonPositiveInteger(value: unknown) {
  const raw = text(value);
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function lotteonIds(row: AnyRecord) {
  return {
    odNo: firstText(row.orderNo, row.order_no, row.orderId, row.order_id, row.odNo, row.od_no),
    odSeq: firstText(row.productOrderId, row.product_order_id, row.odSeq, row.od_seq),
    procSeq: firstText(row.procSeq, row.proc_seq),
    slQty: numberValue(row.quantity || row.qty) || 1,
  };
}
function lotteonValidatedIds(row: AnyRecord) {
  const ids = lotteonIds(row);
  const odSeq = lotteonPositiveInteger(ids.odSeq);
  const procSeq = lotteonPositiveInteger(ids.procSeq);
  if (!ids.odNo || odSeq === null || procSeq === null) return null;
  return { odNo: ids.odNo, odSeq, procSeq, slQty: ids.slQty };
}
// 롯데ON dvCoCd 공식 코드표: 0001 롯데택배, 0002 CJ대한통운, 0004 우체국, 0005 로젠, 0006 한진, 0024 경동, 9999 기타
function lotteonCarrierCode(value: unknown) {
  const raw = text(value).toUpperCase();
  const allowedCodes = new Set(["0001", "0002", "0004", "0005", "0006", "0024", "9999"]);
  if (allowedCodes.has(raw)) return raw;
  const compact = raw.replace(/[\s_-]+/g, "");
  if (["CJ", "CJGLS", "CJLOGISTICS", "CJ대한통운"].includes(compact)) return "0002";
  if (["LOTTE", "HYUNDAI", "LOTTELOGIS", "LOTTEGLOBALLOGIS", "롯데", "롯데택배", "롯데글로벌로지스"].includes(compact)) return "0001";
  if (["POST", "EPOST", "KOREAPOST", "우체국", "우체국택배"].includes(compact)) return "0004";
  if (["KGB", "LOGEN", "로젠", "로젠택배"].includes(compact)) return "0005";
  if (["HANJIN", "한진", "한진택배"].includes(compact)) return "0006";
  if (["KDEXP", "KYUNGDONG", "경동", "경동택배"].includes(compact)) return "0024";
  if (["OTHER", "기타"].includes(compact)) return "9999";
  return "";
}
function lotteonResponseContainers(data: unknown) {
  const root = record(data);
  const candidates = [root, record(root.data), record(root.result)];
  const seen = new Set<AnyRecord>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}
function lotteonFailList(data: unknown) {
  return lotteonResponseContainers(data).flatMap((container) => Array.isArray(container.failList) ? container.failList.map(record) : []);
}
function lotteonResponseFailureMessage(data: unknown) {
  const messages: string[] = [];
  for (const container of lotteonResponseContainers(data)) {
    const code = firstText(container.rsltCd, container.resultCode, container.returnCode, container.code);
    if (code && !["0000", "0", "SUCCESS", "OK"].includes(code.toUpperCase())) {
      messages.push(firstText(container.rsltMsg, container.resultMessage, container.message, container.errorMessage, code));
    }
  }
  for (const failure of lotteonFailList(data)) {
    messages.push(firstText(failure.rsltMsg, failure.resultMessage, failure.message, failure.errorMessage, failure.rsltCd));
  }
  return Array.from(new Set(messages.filter(Boolean))).join(" / ");
}
function lotteonDispatchPayload(ids: { odNo: string; odSeq: number; procSeq: number; slQty: number }, trackingNumber: string, carrierCode: string) {
  return {
    deliveryProgressStateList: [{
      odNo: ids.odNo,
      odSeq: ids.odSeq,
      procSeq: ids.procSeq,
      odPrgsStepCd: "13",
      dvTrcStatDttm: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace(/[-:T.Z]/g, "").slice(0, 14),
      slQty: ids.slQty,
      dvRtrvDvsCd: "DV",
      invcNbr: 1,
      dvCoCd: carrierCode,
      invcNoList: [trackingNumber],
    }],
  };
}
function lotteonReadbackRows(data: unknown) {
  const rows = record(record(data).data).deliveryProgressStateList;
  return Array.isArray(rows) ? rows.map(record) : [];
}
function lotteonReadbackInvoiceValues(row: AnyRecord) {
  const values: string[] = [];
  if (Array.isArray(row.invcNoList)) {
    for (const value of row.invcNoList) {
      const invoice = record(value);
      const next = firstText(invoice.invcNo, invoice.invoiceNo, invoice.trackingNo, invoice.waybillNo, typeof value === "string" || typeof value === "number" ? value : "");
      if (next) values.push(next);
    }
  }
  const direct = firstText(row.invcNo, row.invoiceNo, row.invNo, row.trackingNo, row.waybillNo);
  if (direct) values.push(direct);
  return values;
}
function lotteonReadbackVerification(data: unknown, ids: { odNo: string; odSeq: number; procSeq: number }, trackingNumber: string) {
  const exactRow = lotteonReadbackRows(data).find((row) => (
    text(row.odNo) === ids.odNo
    && lotteonPositiveInteger(row.odSeq) === ids.odSeq
    && lotteonPositiveInteger(row.procSeq) === ids.procSeq
  ));
  if (!exactRow) return { ok: false, error: "요청 식별자와 일치하는 배송상태 행이 없습니다." };
  const stage = text(exactRow.odPrgsStepCd);
  if (!["13", "14", "15"].includes(stage)) return { ok: false, error: `배송단계 ${stage || "미확인"}은 출고완료 상태가 아닙니다.` };
  const invoices = lotteonReadbackInvoiceValues(exactRow);
  if (invoices.length && !invoices.includes(trackingNumber)) return { ok: false, error: "조회된 송장번호가 요청 송장번호와 일치하지 않습니다." };
  return { ok: true, row: exactRow };
}

export class LotteonChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: [], error: "롯데ON OpenAPI Key를 먼저 저장해주세요." };
    try {
      const baseUrl = text(params.api_base_url) || LOTTEON_BASE_URL;
      const path = text(params.orders_path) || "/v1/openapi/delivery/v1/SellerDeliveryOrdersSearch";
      const readbackPath = "/v1/openapi/delivery/v1/SellerDeliveryProgressStateSearch";
      const requestHeaders = { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "ko", "X-Timezone": "GMT+09:00", Authorization: `Bearer ${apiKey}` };
      const start = formatDate(params.fromDate ?? params.from, "start");
      const end = formatDate(params.toDate ?? params.to, "end");
      const explicitStatusCode = text(params.odPrgsStepCd || params.order_status_code);
      // API139는 odPrgsStepCd 11 후보만 모으고, 최종 신규/주문확인 여부는 아래 API140 exact 행으로 판정한다.
      // ifCplYN 빈 값/Y를 모두 조회해야 신규생성/연동완료 후보를 빠뜨리지 않는다.
      // 기본 수집은 요청한 전체 기간을 일 단위로 조회한다. API가 각 일자 호출에 같은 행이나
      // 범위 밖 confirmed 행을 반복 반환할 수 있으므로, 행 자체의 주문일이 있으면 요청 범위로 한 번 더 제한한다.
      const collectionStartYmd = compactYmd(start);
      const collectionEndYmd = compactYmd(end);
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
          const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
          const data = await readJson(response);
          for (const row of findRows(data)) {
            const orderYmd = lotteonOrderYmd(row);
            if (orderYmd && (
              (collectionStartYmd && orderYmd < collectionStartYmd)
              || (collectionEndYmd && orderYmd > collectionEndYmd)
            )) continue;
            const key = [row.odNo, row.orderNo, row.odSeq, row.odDtlSeq, row.procSeq, row.spdNo, row.pdNo, row.sitmNo].map(text).join("|");
            if (key && seenRowKeys.has(key)) continue;
            if (key) seenRowKeys.add(key);
            rows.push({ row, stage: stageQuery.stage });
          }
        }
      }

      const base = { channelCode: text(params.channel_code) || "LOTTEON", channelName: text(params.channel_name) || "롯데ON", customerCode: text(params.customer_code), customerName: text(params.customer_name) };
      const unshippedRows = rows.filter(({ row }) => !lotteonShipmentStarted(row));
      const readbacks = new Map<string, AnyRecord[]>();
      for (const odNo of Array.from(new Set(unshippedRows.map(({ row }) => lotteonIds(row).odNo).filter(Boolean)))) {
        const response = await fetch(`${baseUrl}${readbackPath}`, { method: "POST", headers: requestHeaders, body: JSON.stringify({ odNo }) });
        readbacks.set(odNo, lotteonReadbackRows(await readJson(response)));
      }
      const collectableRows = unshippedRows.flatMap(({ row }) => {
        const ids = lotteonValidatedIds(row);
        if (!ids) throw new Error("롯데ON API140 현재 상태 확인에 필요한 주문 식별자가 누락되었습니다.");
        const exactRow = readbacks.get(ids.odNo)?.find((candidate) => (
          text(candidate.odNo) === ids.odNo
          && lotteonPositiveInteger(candidate.odSeq) === ids.odSeq
          && lotteonPositiveInteger(candidate.procSeq) === ids.procSeq
        ));
        if (!exactRow) throw new Error("롯데ON API140 응답에서 주문 식별자와 일치하는 현재 상태를 찾지 못했습니다.");
        const stage = text(exactRow.odPrgsStepCd);
        return stage === "11" || stage === "12" ? [{ row, stage: stage === "11" ? "신규주문" : "주문확인" }] : [];
      });
      const excludedShipmentCount = rows.length - collectableRows.length;
      const normalizedOrders = collectableRows.map(({ row, stage }) => normalizeRow(row, base, stage)).filter((order) => order.orderNo);
      const mergedOrders = mergeOrders(normalizedOrders);
      const itemCount = normalizedOrders.reduce((sum, order) => sum + Math.max(1, order.items.length), 0);
      const countMessage = itemCount === mergedOrders.length
        ? `롯데ON 주문 ${mergedOrders.length}건을 수집했습니다.`
        : `롯데ON 주문 ${mergedOrders.length}건(${itemCount}개 상품)을 수집했습니다.`;
      return {
        ok: true,
        data: mergedOrders,
        message: excludedShipmentCount
          ? `${countMessage} 송장입력/배송중 ${excludedShipmentCount}건은 제외했습니다.`
          : countMessage,
      };
    } catch (error) { return { ok: false, data: [], error: error instanceof Error ? error.message : "롯데ON 주문 수집 실패" }; }
  }

  async confirmOrders(params: Record<string, unknown>): Promise<ChannelResult<unknown>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: null, error: "롯데ON OpenAPI Key를 먼저 저장해주세요." };
    const rows = lotteonRequestRows(params, "confirmProductOrders");
    if (!rows.length) return { ok: false, data: null, error: "롯데ON 주문확인에 필요한 주문번호/주문순번이 없습니다." };
    const validatedRows = rows.map(lotteonValidatedIds);
    if (validatedRows.some((ids) => !ids)) return { ok: false, data: null, error: "롯데ON 주문확인 필수 식별자(odNo/odSeq/procSeq)가 누락되었거나 올바른 양의 정수가 아닙니다." };
    try {
      const baseUrl = text(params.api_base_url) || LOTTEON_BASE_URL;
      // 공식 플로우: 주문 수신 후 연동완료 통보(ifCplYN=Y)를 필히 수행해야 상품준비 전환 + 고객 즉시취소 차단이 된다.
      const path = "/v1/openapi/delivery/v1/SellerIfCompleteInform";
      const results: unknown[] = [];
      const failureMessages: string[] = [];
      for (let index = 0; index < rows.length; index += 100) {
        const payload = {
          ifCompleteList: validatedRows.slice(index, index + 100).map((ids) => ({
            dvRtrvDvsCd: "DV",
            odNo: ids!.odNo,
            odSeq: ids!.odSeq,
            procSeq: ids!.procSeq,
            ifCplYN: "Y",
          })),
        };
        const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "ko", "X-Timezone": "GMT+09:00", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) });
        const data = await readJson(response);
        const dataResult = record(record(data).data);
        if (!text(dataResult.rsltCd)) failureMessages.push("롯데ON 주문확인 결과 코드(data.rsltCd)가 누락되었습니다.");
        const failureMessage = lotteonResponseFailureMessage(data);
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
    const rows = lotteonRequestRows(params, "dispatchProductOrders");
    if (!rows.length) return { ok: false, data: null, error: "롯데ON 발송완료에 필요한 주문정보가 없습니다." };
    if (rows.length > 1) return { ok: false, data: null, error: "롯데ON 발송완료는 부분 반영 방지를 위해 한 번에 단일 주문행 1건만 처리할 수 있습니다." };

    const source = rows[0];
    const ids = lotteonValidatedIds(source);
    if (!ids) return { ok: false, data: null, error: "롯데ON 발송완료 필수 식별자(odNo/odSeq/procSeq)가 누락되었거나 올바른 양의 정수가 아닙니다." };
    const trackingNumber = firstText(source.trackingNumber, source.tracking_number);
    if (!trackingNumber) return { ok: false, data: null, error: "롯데ON 발송완료 송장번호가 누락되었습니다." };
    if (trackingNumber.length > 30) return { ok: false, data: null, error: "롯데ON 송장번호는 최대 30자까지 입력할 수 있습니다." };
    const carrierCode = lotteonCarrierCode(firstText(source.deliveryCompanyCode, source.delivery_company_code));
    if (!carrierCode) return { ok: false, data: null, error: "롯데ON 배송사가 누락되었거나 지원하지 않는 배송사입니다." };

    try {
      const baseUrl = text(params.api_base_url) || LOTTEON_BASE_URL;
      const mutationPath = "/v1/openapi/delivery/v2/SellerDeliveryProgressStateInform";
      const readbackPath = "/v1/openapi/delivery/v1/SellerDeliveryProgressStateSearch";
      const requestHeaders = { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "ko", "X-Timezone": "GMT+09:00", Authorization: `Bearer ${apiKey}` };

      // API298 mutation은 재시도하지 않는다. 성공 응답 뒤 API140 readback만 최대 3회 수행한다.
      const mutationResponse = await fetch(`${baseUrl}${mutationPath}`, { method: "POST", headers: requestHeaders, body: JSON.stringify(lotteonDispatchPayload(ids, trackingNumber, carrierCode)) });
      const mutationData = await readJson(mutationResponse);
      const mutationFailure = lotteonResponseFailureMessage(mutationData);
      if (mutationFailure) return { ok: false, data: mutationData, error: `롯데ON 발송완료 실패: ${mutationFailure}` };

      const readbacks: unknown[] = [];
      let lastVerificationError = "롯데ON 배송상태를 확인하지 못했습니다.";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const readbackResponse = await fetch(`${baseUrl}${readbackPath}`, { method: "POST", headers: requestHeaders, body: JSON.stringify({ odNo: ids.odNo }) });
          const readbackData = await readJson(readbackResponse);
          readbacks.push(readbackData);
          const readbackFailure = lotteonResponseFailureMessage(readbackData);
          if (readbackFailure) {
            lastVerificationError = readbackFailure;
            continue;
          }
          const verification = lotteonReadbackVerification(readbackData, ids, trackingNumber);
          if (verification.ok) {
            return {
              ok: true,
              data: { mutation: mutationData, readback: readbackData },
              message: "롯데ON 발송완료 1건 처리 및 배송상태 확인 완료",
            };
          }
          lastVerificationError = verification.error || "롯데ON 배송상태 검증 실패";
        } catch (error) {
          lastVerificationError = error instanceof Error ? error.message : "롯데ON 배송상태 조회 실패";
        }
      }
      return { ok: false, data: { mutation: mutationData, readbacks }, error: `롯데ON 발송완료 후 API140 확인 실패: ${lastVerificationError}` };
    } catch (error) { return { ok: false, data: null, error: error instanceof Error ? error.message : "롯데ON 발송완료 처리 실패" }; }
  }
}
