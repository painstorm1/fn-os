import { createHmac } from "crypto";
import type { ChannelResult, NormalizedOrder, NormalizedOrderItem, SalesChannelAdapter } from "../common/types";

type AnyRecord = Record<string, unknown>;
const ESM_BASE_URL = "https://sa2.esmplus.com";

function text(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): AnyRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}; }
function numberValue(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function firstText(...values: unknown[]) { for (const value of values) { const next = text(value); if (next) return next; } return ""; }
function base64url(value: string | Buffer) { return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function esmJwt(masterId: string, secret: string, ssi: string) {
  const header = { alg: "HS256", typ: "JWT", kid: masterId };
  const payload = { iss: "www.esmplus.com", sub: "sell", aud: "sa.esmplus.com", ssi };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}
function formatDate(value: unknown, boundary: "start" | "end") {
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
function arrayAt(root: unknown, paths: string[][]) { for (const path of paths) { let current = root; for (const key of path) current = record(current)[key]; if (Array.isArray(current)) return current as AnyRecord[]; } return Array.isArray(root) ? root as AnyRecord[] : []; }
function findRows(data: unknown) {
  const direct = arrayAt(data, [["Data"], ["data"], ["Data", "Orders"], ["data", "orders"], ["Orders"], ["orders"], ["OrderList"], ["orderList"]]);
  if (direct.length) return direct;
  const rows: AnyRecord[] = []; const seen = new Set<unknown>();
  function visit(value: unknown) { if (!value || seen.has(value) || typeof value !== "object") return; seen.add(value); if (Array.isArray(value)) { value.forEach(visit); return; } const cur = record(value); if (firstText(cur.OrderNo, cur.orderNo, cur.OrderNumber) && firstText(cur.GoodsName, cur.ItemName, cur.ProductName)) { rows.push(cur); return; } Object.values(cur).forEach(visit); }
  visit(data); return rows;
}
async function readJson(response: Response) { const body = await response.text(); const data = body ? JSON.parse(body) : {}; if (!response.ok) throw new Error(firstText(record(data).Message, record(data).message, record(data).ErrorMessage, body) || `ESM API ${response.status}`); return data; }
function normalizeRow(row: AnyRecord, base: { channelCode: string; channelName: string; customerCode?: string; customerName?: string }): NormalizedOrder {
  const item: NormalizedOrderItem = {
    channelProductCode: firstText(row.GoodsNo, row.ProductNo, row.SellerGoodsCode, row.sellerProductCode),
    channelOptionCode: firstText(row.OrderItemNo, row.OrderSeq, row.OptionCode, row.ItemNo),
    channelProductName: firstText(row.GoodsName, row.ItemName, row.ProductName, "ESM 주문"),
    channelOptionName: firstText(row.OptionName, row.OptionInfo, row.GoodsOption),
    sku: firstText(row.SellerGoodsCode, row.SellerStockCode, row.Sku),
    qty: numberValue(row.OrderQty || row.Quantity || row.Qty) || 1,
    salesAmount: numberValue(row.SellPrice || row.OrderAmount || row.PayAmount) || undefined,
    raw: row,
  };
  return { ...base, orderNo: firstText(row.OrderNo, row.orderNo, row.OrderNumber), bundleOrderNo: firstText(row.PackNo, row.OrderNo), orderDate: normalizeDate(firstText(row.OrderDate, row.PayDate, row.PaymentDate)), orderStatus: firstText(row.OrderStatus, row.Status, row.DeliveryStatus, "결제완료"), receiverName: firstText(row.ReceiverName, row.RcvName, row.BuyerName), phone1: firstText(row.ReceiverMobile, row.RcvMobile, row.ReceiverHp), phone2: firstText(row.ReceiverTel, row.RcvTel), zipcode: firstText(row.ZipCode, row.PostNo), address: [firstText(row.Address, row.ReceiverAddress, row.RcvAddress), firstText(row.AddressDetail, row.ReceiverAddressDetail)].filter(Boolean).join(" "), deliveryMessage: firstText(row.DeliveryMessage, row.Memo), items: [item], raw: row };
}

export class EsmChannelAdapter implements SalesChannelAdapter {
  async collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>> {
    const masterId = text(params.master_id || params.api_client_id);
    const secret = text(params.secret_key || params.api_client_secret || params.seller_password);
    const auctionSellerId = text(params.auction_seller_id || params.partner_no || params.seller_id);
    const gmarketSellerId = text(params.gmarket_seller_id || params.sub_partner_no || params.seller_id);
    if (!masterId || !secret || (!auctionSellerId && !gmarketSellerId)) return { ok: false, data: [], error: "ESM Master ID, Secret Key, Auction/Gmarket 판매자 ID를 먼저 저장해주세요." };
    const ssi = [auctionSellerId ? `A:${auctionSellerId}` : "", gmarketSellerId ? `G:${gmarketSellerId}` : ""].filter(Boolean).join(",");
    try {
      const body = { SearchDateType: "PayDate", StartDate: formatDate(params.fromDate, "start"), EndDate: formatDate(params.toDate, "end") };
      const response = await fetch(`${ESM_BASE_URL}/shipping/v1/Order/RequestOrders`, { method: "POST", headers: { Authorization: `Bearer ${esmJwt(masterId, secret, ssi)}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await readJson(response);
      const rows = findRows(data);
      const base = { channelCode: text(params.channel_code) || "ESM", channelName: text(params.channel_name) || "ESM/G마켓/옥션", customerCode: text(params.customer_code), customerName: text(params.customer_name) };
      return { ok: true, data: rows.map((row) => normalizeRow(row, base)).filter((order) => order.orderNo), message: `ESM 주문 ${rows.length}건을 수집했습니다.` };
    } catch (error) { return { ok: false, data: [], error: error instanceof Error ? error.message : "ESM 주문 수집 실패" }; }
  }
}
