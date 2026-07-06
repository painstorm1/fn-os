import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, deleteRows, hasDbConfig, selectRows, upsertRows } from "@/lib/fnos-db";

const FALLBACK_SETTING_KEY = "sales_channel_product_mappings_fallback";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeBody(body: Record<string, unknown>) {
  const productCode = text(body.product_code || body.productCode);
  const mallProductKey = text(body.mall_product_key || body.mallProductKey);
  const channelName = text(body.channel_name || body.channelName || body.mall_name || body.mallName);
  return {
    channel_name: channelName,
    channel_code: text(body.channel_code || body.channelCode),
    mall_product_code: text(body.mall_product_code || body.mallProductCode),
    mall_product_key: mallProductKey,
    mall_product_name: text(body.mall_product_name || body.mallProductName),
    fn_product_id: text(body.fn_product_id || body.fnProductId) || null,
    product_code: productCode,
    product_name: text(body.product_name || body.productName),
    source_type: text(body.source_type || body.sourceType) || "online_orders",
    updated_at: new Date().toISOString(),
  };
}

function isMappingTableUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = error instanceof FnosDbError ? error.status : 0;
  return status === 404 || /sales_channel_product_mappings|DB 테이블|schema_sales_inventory|Could not find the table|schema cache/i.test(message);
}

function isActiveProduct(row: AnyRecord) {
  return text(row.status).toLowerCase() !== "deleted" && row.is_active !== false;
}

function productCode(row: AnyRecord) {
  return text(row.product_code || row.prod_cd || row.sku);
}

function productName(row: AnyRecord) {
  return text(row.product_name || row.prod_name);
}

function customerCode(row: AnyRecord) {
  return text(row.customer_code || row.cust_code);
}

function customerName(row: AnyRecord) {
  return text(row.customer_name || row.cust_name);
}

function normalizeCustomerType(value: unknown) {
  const normalized = text(value).toLowerCase();
  if (["shopping", "mall", "shop", "쇼핑몰"].includes(normalized)) return "shopping";
  return "general";
}

function isActiveCustomer(row: AnyRecord) {
  return text(row.status).toLowerCase() !== "deleted" && row.is_active !== false;
}

function isActiveChannel(row: AnyRecord) {
  return row.is_active !== false && !["deleted", "미사용", "중단"].includes(text(row.status || row["사용구분"]).toLowerCase());
}

function findShoppingCustomer(row: AnyRecord, customers: AnyRecord[]) {
  const customerId = text(row.customer_id);
  const code = text(row.customer_code || row["거래처코드"]);
  const name = text(row.customer_name || row["거래처명"] || row.channel_name || row["쇼핑몰명"]);
  return customers.find((customer) => {
    if (!isActiveCustomer(customer)) return false;
    if (normalizeCustomerType(customer.customer_type || customer.cust_type) !== "shopping") return false;
    if (customerId && text(customer.id) === customerId) return true;
    if (code && customerCode(customer) === code) return true;
    if (name && customerName(customer) === name) return true;
    return false;
  }) || null;
}

function channelCode(row: AnyRecord) {
  return text(row.channel_code || row["쇼핑몰코드"]);
}

function channelName(row: AnyRecord) {
  return text(row.channel_name || row["쇼핑몰명"] || row.customer_name || row["거래처명"]);
}

function channelWithCurrentCustomer(channel: AnyRecord, customers: AnyRecord[]) {
  const customer = findShoppingCustomer(channel, customers);
  if (!customer) return channel;
  const currentName = customerName(customer);
  return {
    ...channel,
    customer_id: text(customer.id) || channel.customer_id || null,
    customer_code: customerCode(customer) || channel.customer_code || null,
    customer_name: currentName || channel.customer_name || null,
    channel_name: currentName || channelName(channel),
  };
}

async function activeChannelLookup() {
  const [channels, customers] = await Promise.all([
    selectRows<AnyRecord>("sales_channels", { order: "channel_name.asc", limit: 5000 }).catch(() => []),
    selectRows<AnyRecord>("customers", { order: "customer_name.asc", limit: 5000 }).catch(() => []),
  ]);
  const byCode = new Map<string, AnyRecord>();
  const byName = new Map<string, AnyRecord>();
  channels.filter(isActiveChannel).forEach((channel) => {
    const current = channelWithCurrentCustomer(channel, customers);
    const code = channelCode(current);
    if (code) byCode.set(code, current);
    [channelName(channel), text(channel.customer_name), channelName(current), text(current.customer_name)]
      .filter(Boolean)
      .forEach((name) => byName.set(name, current));
  });
  return { byCode, byName };
}

function mappingWithCurrentChannel(mapping: AnyRecord, lookup: Awaited<ReturnType<typeof activeChannelLookup>>) {
  const channel = lookup.byCode.get(text(mapping.channel_code)) || lookup.byName.get(text(mapping.channel_name));
  if (!channel) return mapping;
  return {
    ...mapping,
    channel_code: channelCode(channel) || text(mapping.channel_code),
    channel_name: channelName(channel) || text(mapping.channel_name),
  };
}

async function activeProductLookup() {
  const products = await selectRows<AnyRecord>("products", { order: "product_name.asc", limit: 10000 }).catch(() => []);
  const byId = new Map<string, AnyRecord>();
  const byCode = new Map<string, AnyRecord>();
  products.filter(isActiveProduct).forEach((product) => {
    const id = text(product.id);
    const code = productCode(product);
    if (id) byId.set(id, product);
    if (code) byCode.set(code, product);
  });
  return { byId, byCode };
}

function currentProductForMapping(mapping: AnyRecord, lookup: Awaited<ReturnType<typeof activeProductLookup>>) {
  return lookup.byId.get(text(mapping.fn_product_id)) || lookup.byCode.get(text(mapping.product_code)) || null;
}

function mappingWithCurrentProduct(mapping: AnyRecord, lookup: Awaited<ReturnType<typeof activeProductLookup>>): AnyRecord | null {
  const product = currentProductForMapping(mapping, lookup);
  if (!product) return null;
  const currentId = text(product.id) || text(mapping.fn_product_id);
  const currentCode = productCode(product) || text(mapping.product_code);
  const currentName = productName(product) || text(mapping.product_name);
  return {
    ...mapping,
    fn_product_id: currentId || null,
    product_code: currentCode,
    product_name: currentName,
  };
}

async function visibleMappings(rows: AnyRecord[]) {
  const [productLookup, channelLookup] = await Promise.all([activeProductLookup(), activeChannelLookup()]);
  return rows
    .map((row) => mappingWithCurrentProduct(row, productLookup))
    .filter((row): row is AnyRecord => Boolean(row))
    .map((row) => mappingWithCurrentChannel(row, channelLookup));
}

async function readFallbackMappings() {
  const rows = await selectRows<{ setting_value?: string }>("fnos_settings", {
    setting_key: `eq.${FALLBACK_SETTING_KEY}`,
    limit: 1,
  });
  const raw = rows[0]?.setting_value || "[]";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

async function writeFallbackMappings(rows: Record<string, unknown>[]) {
  await upsertRows(
    "fnos_settings",
    {
      setting_key: FALLBACK_SETTING_KEY,
      setting_value: JSON.stringify(rows),
      memo: "쇼핑몰 코드연결 fallback 저장소",
      updated_at: new Date().toISOString(),
    },
    "setting_key",
  );
}

export async function GET(request: NextRequest) {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const limit = request.nextUrl.searchParams.get("limit") || "5000";
    const rows = await selectRows<AnyRecord>("sales_channel_product_mappings", {
      order: "updated_at.desc",
      limit,
    });
    const mappings = await visibleMappings(rows);
    return NextResponse.json({ ok: true, mappings, hidden_stale_count: rows.length - mappings.length });
  } catch (error) {
    if (isMappingTableUnavailable(error)) {
      try {
        const rows = await readFallbackMappings();
        const mappings = await visibleMappings(rows);
        return NextResponse.json({ ok: true, mappings, hidden_stale_count: rows.length - mappings.length, fallback: true });
      } catch {
        return NextResponse.json({ ok: true, mappings: [], fallback: true });
      }
    }
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "쇼핑몰 코드연결 조회 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  let row = normalizeBody(body);
  if (!row.channel_name || !row.mall_product_key || !row.product_code) {
    return NextResponse.json({ ok: false, error: "쇼핑몰명, 쇼핑몰품목key, 품목코드가 필요합니다." }, { status: 400 });
  }

  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const lookup = await activeProductLookup();
    const currentRow = mappingWithCurrentProduct(row, lookup);
    if (!currentRow) {
      return NextResponse.json({ ok: false, error: "활성 품목에서 해당 품목코드를 찾을 수 없습니다." }, { status: 400 });
    }
    row = currentRow as ReturnType<typeof normalizeBody>;
    const saved = await upsertRows("sales_channel_product_mappings", row, "channel_name,mall_product_key");
    return NextResponse.json({ ok: true, mapping: saved[0] || row });
  } catch (error) {
    if (isMappingTableUnavailable(error)) {
      try {
        const lookup = await activeProductLookup();
        const currentRow = mappingWithCurrentProduct(row, lookup);
        if (!currentRow) {
          return NextResponse.json({ ok: false, error: "활성 품목에서 해당 품목코드를 찾을 수 없습니다." }, { status: 400 });
        }
        row = currentRow as ReturnType<typeof normalizeBody>;
        const rows = await readFallbackMappings();
        const saved = {
          id: text(body.id) || crypto.randomUUID(),
          ...row,
        };
        const nextRows = rows.filter((item) => {
          return !(text(item.channel_name) === row.channel_name && text(item.mall_product_key) === row.mall_product_key);
        });
        nextRows.unshift(saved);
        await writeFallbackMappings(nextRows);
        return NextResponse.json({ ok: true, mapping: saved, fallback: true });
      } catch (fallbackError) {
        const status = fallbackError instanceof FnosDbError ? fallbackError.status : 500;
        const message = fallbackError instanceof Error ? fallbackError.message : "쇼핑몰 코드연결 저장 실패";
        return NextResponse.json({ ok: false, error: message }, { status });
      }
    }
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "쇼핑몰 코드연결 저장 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const id = text(request.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ ok: false, error: "삭제할 연결 ID가 필요합니다." }, { status: 400 });

  try {
    const deleted = await deleteRows("sales_channel_product_mappings", { id: `eq.${id}` });
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    if (isMappingTableUnavailable(error)) {
      try {
        const rows = await readFallbackMappings();
        const nextRows = rows.filter((row) => text(row.id) !== id);
        await writeFallbackMappings(nextRows);
        return NextResponse.json({ ok: true, deleted: rows.length - nextRows.length, fallback: true });
      } catch (fallbackError) {
        const status = fallbackError instanceof FnosDbError ? fallbackError.status : 500;
        const message = fallbackError instanceof Error ? fallbackError.message : "쇼핑몰 코드연결 삭제 실패";
        return NextResponse.json({ ok: false, error: message }, { status });
      }
    }
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "쇼핑몰 코드연결 삭제 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
