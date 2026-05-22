import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, selectRows } from "@/lib/fnos-db";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeProduct(row: AnyRecord) {
  return {
    code: text(row.prod_cd || row.PROD_CD),
    name: text(row.prod_name || row.PROD_DES || row.PROD_NAME),
    size: text(row.size_des || row.SIZE_DES),
    unit: text(row.unit || row.UNIT),
    inPrice: text(row.in_price || row.IN_PRICE),
    outPrice: text(row.out_price || row.OUT_PRICE),
    raw: row,
  };
}

function normalizeInventory(row: AnyRecord) {
  return {
    whCode: text(row.wh_cd || row.WH_CD),
    whName: text(row.wh_name || row.WH_DES || row.WH_NAME),
    qty: text(row.bal_qty || row.BAL_QTY || row.QTY),
    syncedAt: text(row.synced_at),
    raw: row,
  };
}

function includesQuery(row: ReturnType<typeof normalizeProduct>, query: string) {
  const haystack = `${row.code} ${row.name} ${row.size}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { query?: string };
    const query = text(body.query);
    if (!query) return NextResponse.json({ ok: false, error: "상품명을 입력해 주세요." }, { status: 400 });

    const dbRows = await selectRows<AnyRecord>("products", { order: "prod_name.asc", limit: 2000 });
    const products = dbRows
      .map(normalizeProduct)
      .filter((row) => includesQuery(row, query))
      .slice(0, 20);

    const first = products[0] || null;
    let inventory: ReturnType<typeof normalizeInventory>[] = [];
    if (first?.code) {
      const inventoryRows = await selectRows<AnyRecord>("inventory_snapshots", {
        prod_cd: `eq.${first.code}`,
        order: "synced_at.desc",
        limit: 100,
      });
      const seen = new Set<string>();
      inventory = inventoryRows
        .map(normalizeInventory)
        .filter((row) => {
          const key = row.whCode || row.whName || "_";
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 30);
    }

    return NextResponse.json({
      ok: true,
      source: "fnos-db",
      product: first,
      products,
      inventory,
      counts: {
        products: products.length,
        inventory: inventory.length,
      },
      message: products.length ? undefined : "FN OS DB에서 검색 결과가 없습니다. 먼저 품목 동기화를 실행해 주세요.",
    });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "상품 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
