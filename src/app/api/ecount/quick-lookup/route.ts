import { NextRequest, NextResponse } from "next/server";
import { fetchEcountInventory, fetchEcountProducts } from "@/lib/ecount-client";

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function pick(row: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return "";
}

function collectRecords(value: unknown, predicate: (row: AnyRecord) => boolean, out: AnyRecord[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, predicate, out);
    return out;
  }
  const record = asRecord(value);
  if (!record) return out;
  if (predicate(record)) out.push(record);
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") collectRecords(child, predicate, out);
  }
  return out;
}

function isProductRecord(row: AnyRecord) {
  return Boolean(
    pick(row, ["PROD_CD", "prod_cd", "ITEM_CD", "PROD_CODE"]) ||
      pick(row, ["PROD_DES", "PROD_NAME", "prod_name", "ITEM_NM", "ITEM_NAME"]),
  );
}

function isInventoryRecord(row: AnyRecord) {
  return Boolean(
    pick(row, ["WH_CD", "WH_DES", "WH_NAME", "BAL_QTY", "QTY", "INV_QTY", "잔량"]) &&
      (pick(row, ["BAL_QTY", "QTY", "INV_QTY", "잔량"]) || pick(row, ["WH_CD", "WH_DES", "WH_NAME"])),
  );
}

function normalizeProduct(row: AnyRecord) {
  return {
    code: pick(row, ["PROD_CD", "prod_cd", "ITEM_CD", "PROD_CODE"]),
    name: pick(row, ["PROD_DES", "PROD_NAME", "prod_name", "ITEM_NM", "ITEM_NAME"]),
    size: pick(row, ["SIZE_DES", "SIZE", "규격"]),
    inPrice: pick(row, ["IN_PRICE", "IN_PRICE_VAT", "PURCHASE_PRICE", "PUR_PRICE", "입고단가"]),
    outPrice: pick(row, ["OUT_PRICE", "OUT_PRICE_VAT", "SALE_PRICE", "OUT_PRICE1", "출고단가"]),
    raw: row,
  };
}

function normalizeInventory(row: AnyRecord) {
  return {
    whCode: pick(row, ["WH_CD", "wh_cd", "창고코드"]),
    whName: pick(row, ["WH_DES", "WH_NAME", "wh_name", "창고명"]),
    qty: pick(row, ["BAL_QTY", "QTY", "INV_QTY", "잔량", "현재고"]),
    raw: row,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { query?: string };
    const query = String(body.query || "").trim();
    if (!query) return NextResponse.json({ ok: false, error: "상품명을 입력해 주세요." }, { status: 400 });

    const productResponse = await fetchEcountProducts({ PROD_CD: "", PROD_TYPE: "0" });
    const q = query.toLowerCase();
    const products = collectRecords(productResponse, isProductRecord)
      .map(normalizeProduct)
      .filter((row) => `${row.code} ${row.name} ${row.size}`.toLowerCase().includes(q))
      .slice(0, 20);

    const first = products[0];
    let inventory: ReturnType<typeof normalizeInventory>[] = [];
    if (first?.code) {
      const inventoryResponse = await fetchEcountInventory({ PROD_CD: first.code });
      inventory = collectRecords(inventoryResponse, isInventoryRecord).map(normalizeInventory).slice(0, 30);
    }

    return NextResponse.json({
      ok: true,
      product: first || null,
      products,
      inventory,
      counts: {
        products: products.length,
        inventory: inventory.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "이카운트 상품 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
