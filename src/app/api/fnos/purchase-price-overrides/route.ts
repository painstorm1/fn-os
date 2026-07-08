import { NextRequest, NextResponse } from "next/server";
import { patchRows, selectRows, upsertRows } from "@/lib/fnos-db";

export const runtime = "nodejs";

const SETTING_KEY = "purchase_price_overrides_by_customer_product";

type OverrideMap = Record<string, number>;

async function readOverrides(): Promise<OverrideMap> {
  const rows = await selectRows<{ setting_value?: string }>("fnos_settings", {
    setting_key: `eq.${SETTING_KEY}`,
    limit: 1,
  }).catch(() => []);
  try {
    const parsed = JSON.parse(rows[0]?.setting_value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as OverrideMap : {};
  } catch {
    return {};
  }
}

async function writeOverrides(overrides: OverrideMap) {
  const now = new Date().toISOString();
  const payload = {
    setting_key: SETTING_KEY,
    setting_value: JSON.stringify(overrides),
    memo: "FN purchase price overrides by customer/product",
    updated_at: now,
  };
  try {
    await upsertRows("fnos_settings", payload, "setting_key");
  } catch {
    await patchRows("fnos_settings", { setting_key: `eq.${SETTING_KEY}` }, { setting_value: payload.setting_value, updated_at: now });
  }
}

function cleanKey(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function overrideKey(row: Record<string, unknown>) {
  const customer = cleanKey(row.customer_code || row.cust_code || row.거래처코드 || row.customer_name || row.cust_name || row.거래처명);
  const product = cleanKey(row.product_code || row.prod_cd || row.품목코드 || row.sku);
  return customer && product ? `${customer}::${product}` : "";
}

export async function GET() {
  const overrides = await readOverrides();
  return NextResponse.json({ ok: true, overrides });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : [];
    if (!rows.length) return NextResponse.json({ ok: true, count: 0 });

    const overrides = await readOverrides();
    let count = 0;
    rows.forEach((row) => {
      const key = overrideKey(row);
      const price = Number(row.price || row.unit_price || row.단가);
      if (!key || !Number.isFinite(price) || price <= 0) return;
      if (overrides[key] !== price) count += 1;
      overrides[key] = price;
    });
    if (count) await writeOverrides(overrides);
    return NextResponse.json({ ok: true, count, overrides });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "구매 단가 예외 저장 실패" }, { status: 500 });
  }
}
