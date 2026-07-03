import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, selectRows } from "@/lib/fnos-db";

type AnyRecord = Record<string, unknown>;
type QuickLookupRequest = {
  query?: string;
  productAttribute?: string;
  limit?: number;
  includeInventory?: boolean;
  refresh?: boolean;
};

const PRODUCT_CACHE_TTL_MS = 30_000;
let productRowsCache: { rows: AnyRecord[]; expiresAt: number } | null = null;
let productRowsPromise: Promise<AnyRecord[]> | null = null;

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeProduct(row: AnyRecord) {
  return {
    code: text(row.product_code || row.sku || row.prod_cd || row.PROD_CD),
    name: text(row.product_name || row.prod_name || row.PROD_DES || row.PROD_NAME),
    size: text(row.option_name || row.size_des || row.SIZE_DES),
    unit: text(row.unit || row.UNIT),
    inPrice: text(row.cost_price || row.in_price || row.IN_PRICE),
    outPrice: text(row.standard_price || row.out_price || row.OUT_PRICE),
    productAttribute: text(row.product_attribute || row.product_kind || row.relation),
    importLinked: Boolean(row.import_linked || row.import_product_id || row.import_product_code || row.import_product_name),
    raw: row,
  };
}

function normalizeInventory(row: AnyRecord) {
  return {
    whCode: text(row.wh_cd || row.WH_CD),
    whName: text(row.wh_name || row.WH_DES || row.WH_NAME),
    qty: text(row.bal_qty || row.BAL_QTY || row.QTY || row.on_hand_qty || row.available_qty),
    syncedAt: text(row.synced_at),
    raw: row,
  };
}

async function inventoryForProduct(code: string) {
  const bySku = await selectRows<AnyRecord>("inventory_current", {
    sku: `eq.${code}`,
    order: "synced_at.desc",
    limit: 100,
  }).catch(() => []);
  const byProductCode = bySku.length ? [] : await selectRows<AnyRecord>("inventory_current", {
    prod_cd: `eq.${code}`,
    order: "synced_at.desc",
    limit: 100,
  }).catch(() => []);
  const seen = new Set<string>();
  return [...bySku, ...byProductCode]
    .map(normalizeInventory)
    .filter((row) => {
      const key = row.whCode || row.whName || "_";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

function includesQuery(row: ReturnType<typeof normalizeProduct>, query: string) {
  const haystack = `${row.code} ${row.name} ${row.size}`.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

function matchesAttribute(row: ReturnType<typeof normalizeProduct>, attribute: string) {
  if (!attribute || attribute === "all") return true;
  const normalized = row.productAttribute.toLowerCase();
  if (attribute === "plain") return (!normalized || normalized === "plain" || normalized === "general") && !row.name.startsWith("[SET]") && !row.name.startsWith("[RG]");
  if (attribute === "set") return normalized === "set" || row.name.startsWith("[SET]");
  if (attribute === "rg") return normalized === "rg" || row.name.startsWith("[RG]");
  if (attribute === "import") return row.importLinked || ["import", "import_linked", "수입연동"].includes(normalized);
  return true;
}

async function productRows(refresh = false) {
  const now = Date.now();
  if (!refresh && productRowsCache && productRowsCache.expiresAt > now) return productRowsCache.rows;
  if (!refresh && productRowsPromise) return productRowsPromise;
  productRowsPromise = selectRows<AnyRecord>("products", { order: "product_name.asc", limit: 2000 })
    .then((rows) => {
      productRowsCache = { rows, expiresAt: Date.now() + PRODUCT_CACHE_TTL_MS };
      return rows;
    })
    .finally(() => {
      productRowsPromise = null;
    });
  return productRowsPromise;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as QuickLookupRequest;
    const query = text(body.query);
    if (!query) return NextResponse.json({ ok: false, error: "상품명을 입력해 주세요." }, { status: 400 });
    const productAttribute = text(body.productAttribute || "all") || "all";
    const resultLimit = Math.min(50, Math.max(1, Number(body.limit) || 20));
    const includeInventory = body.includeInventory !== false;

    const dbRows = await productRows(Boolean(body.refresh));
    const products = dbRows
      .map(normalizeProduct)
      .filter((row) => includesQuery(row, query))
      .filter((row) => matchesAttribute(row, productAttribute))
      .slice(0, resultLimit);

    const productsWithInventory = includeInventory
      ? await Promise.all(products.map(async (product) => ({
        ...product,
        inventory: product.code ? await inventoryForProduct(product.code) : [],
      })))
      : products.map((product) => ({ ...product, inventory: [] }));
    const first = productsWithInventory[0] || null;
    const inventory = includeInventory ? first?.inventory || [] : [];

    return NextResponse.json({
      ok: true,
      source: "fnos-db",
      product: first,
      products: productsWithInventory,
      inventory,
      counts: {
        products: products.length,
        inventory: inventory.length,
      },
      message: products.length ? undefined : "FN OS DB에서 검색 결과가 없습니다. 먼저 상품정보를 업로드해 주세요.",
    });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "상품 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
