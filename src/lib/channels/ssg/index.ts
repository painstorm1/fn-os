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
  const body = await response.text();
  let data: unknown = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    const snippet = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(`SSG API 응답을 JSON으로 읽을 수 없습니다. HTTP ${response.status}${snippet ? ` - ${snippet}` : ""}`);
  }
  const result = record(record(data).result);
  const resultCode = firstText(result.resultCode, result.code);
  if (!response.ok || (resultCode && resultCode !== "00")) {
    throw new Error(firstText(result.resultDesc, result.resultMessage, record(data).message, record(data).error, body) || `SSG API ${response.status}`);
  }
  return data;
}
function findRows(data: unknown) {
  const direct = arrayAt(data, [["result", "shppDirections"], ["result", "shppDirections", "shppDirection"], ["data"], ["data", "list"], ["data", "items"], ["result", "list"], ["orders"], ["orderList"], ["shppList"], ["listShppDirection"]]);
  if (direct.length) return direct.map(record).filter((row) => Object.keys(row).length);
  const rows: AnyRecord[] = [];
  const seen = new Set<unknown>();
  function visit(value: unknown) {
    if (!value || seen.has(value)) return; if (typeof value !== "object") return; seen.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const current = record(value);
    if (firstText(current.ordNo, current.orordNo, current.orderNo) && firstText(current.itemNm, current.prdNm, current.uitemNm, current.itemId)) { rows.push(current); return; }
    Object.values(current).forEach(visit);
  }
  visit(data);
  return rows;
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
    orderNo: firstText(row.ordNo, row.orordNo, row.orderNo),
    bundleOrderNo: firstText(row.ordNo, row.orordNo),
    orderDate: normalizeDate(firstText(row.ordCmplDts, row.ordCmplDt, row.ordRcpDts, row.paymtCmplDt, row.ordDt, row.orderDate)),
    orderStatus: firstText(row.ordItemStat, row.ordStat, row.shppProgStatDtlCd, row.status, "발송대기"),
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

export class SsgChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const apiKey = text(params.api_key || params.access_key);
    if (!apiKey) return { ok: false, data: [], error: "SSG API Key를 먼저 저장해주세요." };
    const baseUrl = text(params.api_base_url) || SSG_BASE_URL;
    const version = text(params.api_version) || SSG_VERSION;
    const path = `/api/pd/${version.replace(/^v/i, "")}/listShppDirection.ssg`;
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
}
