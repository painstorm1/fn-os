import { hasDbConfig, insertRows, patchRows, selectRows, upsertRows } from "./fnos-db";

type AnyRecord = Record<string, unknown>;

export type AdImportResult = {
  ok: boolean;
  message: string;
  batch_id?: string;
  success_count: number;
  fail_count: number;
  duplicate?: boolean;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function first(row: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  const lowerMap = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const key of keys) {
    const found = lowerMap.get(key.toLowerCase());
    if (found) {
      const value = row[found];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
  }
  return "";
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown) {
  const raw = text(value);
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  const compact = raw.replace(/\D/g, "");
  if (compact.length >= 8) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return new Date().toISOString().slice(0, 10);
}

function pct(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

async function optionalRows(table: string, query?: Record<string, string | number | boolean | null | undefined>) {
  return selectRows<AnyRecord>(table, query).catch(() => []);
}

function normalizeReport(row: AnyRecord, batchId: string, channel: string) {
  const impressions = numberValue(first(row, ["impressions", "노출", "노출수", "imp", "impCnt"]));
  const clicks = numberValue(first(row, ["clicks", "클릭", "클릭수", "clk", "clkCnt"]));
  const cost = numberValue(first(row, ["cost", "광고비", "비용", "spend", "spend_amount"]));
  const conversions = numberValue(first(row, ["conversions", "전환", "전환수", "구매", "ccnt"]));
  const conversionValue = numberValue(first(row, ["conversion_value", "전환금액", "매출", "구매금액", "salesAmt", "revenue"]));
  const ctr = numberValue(first(row, ["ctr", "CTR"])) || pct(clicks, impressions);
  const cpc = numberValue(first(row, ["cpc", "CPC"])) || (clicks > 0 ? cost / clicks : 0);
  const cvr = numberValue(first(row, ["cvr", "CVR"])) || pct(conversions, clicks);
  const roas = numberValue(first(row, ["roas", "ROAS"])) || pct(conversionValue, cost);
  const productCode = text(first(row, ["product_code", "상품코드", "상품 ID", "품목코드", "prod_cd"]));
  const sku = text(first(row, ["sku", "SKU", "옵션코드", "판매자상품코드"])) || productCode;

  return {
    batch_id: batchId,
    channel,
    report_date: dateValue(first(row, ["report_date", "date", "일자", "날짜", "기간"])),
    campaign_name: text(first(row, ["campaign_name", "캠페인", "캠페인명", "campaign"])),
    ad_group_name: text(first(row, ["ad_group_name", "광고그룹", "광고그룹명", "ad_group"])),
    ad_name: text(first(row, ["ad_name", "소재", "소재명", "광고명", "ad"])),
    product_code: productCode,
    sku,
    impressions,
    clicks,
    cost,
    conversions,
    conversion_value: conversionValue,
    ctr,
    cpc,
    cvr,
    roas,
    raw_payload: row,
  };
}

export async function importAdRows(rows: AnyRecord[], channel: string, sourceFileName?: string): Promise<AdImportResult> {
  if (!hasDbConfig()) {
    return { ok: false, message: "Supabase environment variables are not configured.", success_count: 0, fail_count: rows.length };
  }

  const normalizedChannel = text(channel) || "기타";
  const fileName = text(sourceFileName) || null;
  if (fileName) {
    const existing = await optionalRows("ad_upload_batches", {
      channel: `eq.${normalizedChannel}`,
      source_file_name: `eq.${fileName}`,
      status: "eq.SAVED",
      limit: 1,
    });
    if (existing.length) {
      return {
        ok: false,
        duplicate: true,
        message: "이미 업로드된 광고 파일입니다.",
        batch_id: text(existing[0].id),
        success_count: 0,
        fail_count: rows.length,
      };
    }
  }

  const [batch] = await insertRows<{ id: string }>("ad_upload_batches", {
    channel: normalizedChannel,
    source_file_name: fileName,
    total_count: rows.length,
    success_count: 0,
    fail_count: 0,
    status: "SAVED",
  });

  const reports = rows.map((row) => normalizeReport(row, batch.id, normalizedChannel));
  const saved = reports.length ? await insertRows("ad_reports", reports) : [];
  await patchRows("ad_upload_batches", { id: `eq.${batch.id}` }, {
    success_count: saved.length,
    fail_count: Math.max(0, rows.length - saved.length),
  });

  const campaigns = Array.from(new Set(reports.map((row) => row.campaign_name).filter(Boolean))).map((campaignName) => ({
    channel: normalizedChannel,
    campaign_id: `${normalizedChannel}:${campaignName}`,
    campaign_name: campaignName,
    status: "active",
    updated_at: new Date().toISOString(),
  }));
  if (campaigns.length) await upsertRows("ad_campaigns", campaigns, "channel,campaign_id").catch(() => undefined);

  return {
    ok: true,
    message: `광고 데이터 ${saved.length.toLocaleString("ko-KR")}건을 저장했습니다.`,
    batch_id: batch.id,
    success_count: saved.length,
    fail_count: Math.max(0, rows.length - saved.length),
  };
}

function rowDate(row: AnyRecord) {
  return dateValue(row.report_date ?? row.sale_date ?? row.io_date ?? row.created_at);
}

function rowSku(row: AnyRecord) {
  return text(row.sku || row.product_code || row.prod_cd || row.product_id);
}

function addMetric(target: AnyRecord, row: AnyRecord) {
  target.impressions = numberValue(target.impressions) + numberValue(row.impressions);
  target.clicks = numberValue(target.clicks) + numberValue(row.clicks);
  target.cost = numberValue(target.cost) + numberValue(row.cost);
  target.conversions = numberValue(target.conversions) + numberValue(row.conversions);
  target.conversion_value = numberValue(target.conversion_value) + numberValue(row.conversion_value);
  target.ctr = pct(numberValue(target.clicks), numberValue(target.impressions));
  target.cpc = numberValue(target.clicks) > 0 ? numberValue(target.cost) / numberValue(target.clicks) : 0;
  target.cvr = pct(numberValue(target.conversions), numberValue(target.clicks));
  target.roas = pct(numberValue(target.conversion_value), numberValue(target.cost));
}

function mapBy<T extends AnyRecord>(rows: T[], pick: (row: T) => string) {
  const result = new Map<string, T>();
  rows.forEach((row) => {
    const key = pick(row);
    if (key && !result.has(key)) result.set(key, row);
  });
  return result;
}

function adviceFrom(row: AnyRecord) {
  const roas = numberValue(row.roas);
  const stock = numberValue(row.current_stock);
  const ctr = numberValue(row.ctr);
  const cvr = numberValue(row.cvr);
  const cost = numberValue(row.cost);
  const sales = numberValue(row.sales_amount);
  if (roas < 120 && stock <= 5) return "ROAS가 낮고 재고도 적어 광고 중단 또는 예산 축소를 우선 검토하세요.";
  if (roas < 120 && stock > 30) return "재고는 충분하지만 ROAS가 낮습니다. 상세페이지, 가격, 소재를 먼저 개선하세요.";
  if (roas >= 300 && stock <= 10) return "광고 효율은 좋지만 재고가 부족합니다. 발주/입고를 먼저 잡아야 합니다.";
  if (cost > 0 && sales <= 0) return "광고비가 집행됐지만 매출 연결이 없습니다. 캠페인 추적과 SKU 매핑을 점검하세요.";
  if (ctr > 0 && ctr < 1) return "CTR이 낮습니다. 썸네일, 첫 문구, 후킹 소재를 교체해 보세요.";
  if (cvr > 0 && cvr < 1) return "CVR이 낮습니다. 상세페이지, 가격, 리뷰/배송 조건을 확인하세요.";
  return "현재 지표는 유지 관찰 구간입니다. 예산 증액 전 재고와 순이익을 같이 확인하세요.";
}

export async function adsSummary() {
  const [reports, batches, mappings, products, sales, inventory] = await Promise.all([
    optionalRows("ad_reports", { order: "report_date.desc", limit: 2000 }),
    optionalRows("ad_upload_batches", { order: "uploaded_at.desc", limit: 30 }),
    optionalRows("ad_product_mappings", { order: "updated_at.desc", limit: 1000 }),
    optionalRows("products", { order: "product_name.asc", limit: 2000 }),
    optionalRows("sales", { order: "created_at.desc", limit: 2000 }),
    optionalRows("inventory_current", { order: "updated_at.desc", limit: 2000 }),
  ]);

  const mappingByExternal = mapBy(mappings, (row) => `${text(row.channel)}|${text(row.external_product_code || row.external_product_name)}`);
  const productBySku = mapBy(products, (row) => rowSku(row));
  const salesBySku = new Map<string, AnyRecord>();
  sales.forEach((row) => {
    const sku = rowSku(row);
    if (!sku) return;
    const target = salesBySku.get(sku) || { sku, sales_amount: 0, qty: 0 };
    target.sales_amount = numberValue(target.sales_amount) + numberValue(row.total_amount ?? row.supply_amount ?? row.supply_amt);
    target.qty = numberValue(target.qty) + numberValue(row.qty);
    salesBySku.set(sku, target);
  });
  const inventoryBySku = new Map<string, number>();
  inventory.forEach((row) => {
    const sku = rowSku(row);
    if (!sku) return;
    inventoryBySku.set(sku, (inventoryBySku.get(sku) || 0) + numberValue(row.available_qty ?? row.on_hand_qty ?? row.bal_qty));
  });

  const total: AnyRecord = { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0 };
  const daily = new Map<string, AnyRecord>();
  const channels = new Map<string, AnyRecord>();
  const campaigns = new Map<string, AnyRecord>();
  const productsMap = new Map<string, AnyRecord>();
  const unmapped: AnyRecord[] = [];

  reports.forEach((row) => {
    addMetric(total, row);
    const date = rowDate(row);
    const channel = text(row.channel || "기타");
    const campaignName = text(row.campaign_name || "-");
    const externalKey = text(row.product_code || row.sku || row.ad_name || campaignName);
    const mapping = mappingByExternal.get(`${channel}|${externalKey}`) || mappingByExternal.get(`${channel}|${text(row.product_code)}`);
    const sku = text(mapping?.sku) || rowSku(row);
    const product = productBySku.get(sku) || productBySku.get(text(mapping?.external_product_code));
    const productKey = sku || externalKey || campaignName;

    const dailyRow = daily.get(date) || { date, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0 };
    addMetric(dailyRow, row);
    daily.set(date, dailyRow);

    const channelRow = channels.get(channel) || { channel, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0 };
    addMetric(channelRow, row);
    channels.set(channel, channelRow);

    const campaignRow = campaigns.get(`${channel}|${campaignName}|${text(row.ad_group_name)}|${text(row.ad_name)}`) || {
      channel,
      campaign_name: campaignName,
      ad_group_name: text(row.ad_group_name),
      ad_name: text(row.ad_name),
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      conversion_value: 0,
    };
    addMetric(campaignRow, row);
    campaigns.set(`${channel}|${campaignName}|${text(row.ad_group_name)}|${text(row.ad_name)}`, campaignRow);

    const productRow = productsMap.get(productKey) || {
      sku,
      product_code: text(product?.product_code || product?.prod_cd || row.product_code),
      product_name: text(product?.product_name || product?.prod_name || row.ad_name || row.campaign_name),
      channel,
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      conversion_value: 0,
      sales_amount: numberValue(salesBySku.get(sku)?.sales_amount),
      current_stock: inventoryBySku.get(sku) || 0,
      cost_price: numberValue(product?.cost_price || product?.in_price),
    };
    addMetric(productRow, row);
    const grossProfit = numberValue(productRow.sales_amount) - numberValue(productRow.cost_price) * numberValue(productRow.conversions);
    productRow.estimated_profit = grossProfit - numberValue(productRow.cost);
    productRow.margin_rate = pct(numberValue(productRow.estimated_profit), numberValue(productRow.sales_amount));
    productRow.keep_ad = numberValue(productRow.roas) >= 150 && numberValue(productRow.current_stock) > 5 ? "유지" : "점검";
    productRow.advice = adviceFrom(productRow);
    productsMap.set(productKey, productRow);

    if (!sku && externalKey) {
      unmapped.push({
        channel,
        external_product_name: text(row.ad_name || row.campaign_name),
        external_product_code: text(row.product_code),
        campaign_name: campaignName,
        cost: numberValue(row.cost),
      });
    }
  });

  const productRows = Array.from(productsMap.values()).sort((a, b) => numberValue(b.cost) - numberValue(a.cost));
  const campaignRows = Array.from(campaigns.values()).map((row): AnyRecord => ({
    ...row,
    grade: numberValue(row.roas) >= 300 ? "A" : numberValue(row.roas) >= 150 ? "B" : numberValue(row.cost) > 0 ? "C" : "-",
  })).sort((a, b) => numberValue(b.cost) - numberValue(a.cost));

  return {
    ok: true,
    total,
    batches,
    daily: Array.from(daily.values()).sort((a, b) => text(a.date).localeCompare(text(b.date))),
    channels: Array.from(channels.values()).sort((a, b) => numberValue(b.cost) - numberValue(a.cost)),
    products: productRows,
    campaigns: campaignRows,
    unmapped: unmapped.slice(0, 100),
    mappings,
    advice: productRows.slice(0, 12).map((row) => ({ title: text(row.product_name || row.sku), message: adviceFrom(row), tone: numberValue(row.roas) < 120 ? "danger" : "info" })),
  };
}

export async function saveAdMapping(payload: AnyRecord) {
  const channel = text(payload.channel || "기타");
  const externalProductName = text(payload.external_product_name);
  const externalProductCode = text(payload.external_product_code);
  const sku = text(payload.sku);
  const productId = text(payload.fn_product_id);
  if (!sku && !productId) throw new Error("SKU 또는 상품 ID가 필요합니다.");
  const row = {
    channel,
    external_product_name: externalProductName,
    external_product_code: externalProductCode,
    fn_product_id: productId || null,
    sku: sku || null,
    mapping_status: "MAPPED",
    updated_at: new Date().toISOString(),
  };
  return insertRows("ad_product_mappings", row);
}

export async function searchAdProducts(query: string) {
  const keyword = text(query).replace(/[%*]/g, "");
  if (!keyword) return [];
  const [byCode, bySku, byName] = await Promise.all([
    optionalRows("products", { product_code: `ilike.*${keyword}*`, limit: 20 }),
    optionalRows("products", { sku: `ilike.*${keyword}*`, limit: 20 }),
    optionalRows("products", { product_name: `ilike.*${keyword}*`, limit: 20 }),
  ]);
  return Array.from(mapBy([...byCode, ...bySku, ...byName], (row) => text(row.id || row.product_code || row.sku)).values()).slice(0, 30);
}
