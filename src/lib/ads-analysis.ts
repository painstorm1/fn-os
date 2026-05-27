import { deleteRows, hasDbConfig, insertRows, patchRows, selectRows, upsertRows } from "./fnos-db";

type AnyRecord = Record<string, unknown>;

export type AdImportResult = {
  ok: boolean;
  message: string;
  batch_id?: string;
  success_count: number;
  fail_count: number;
  duplicate?: boolean;
  needs_confirmation?: boolean;
  replaced_count?: number;
  replaced_dates?: string[];
};

type SummaryRange = {
  from?: string;
  to?: string;
};

const FALLBACK_USD_KRW_RATE = Number(process.env.AD_USD_KRW_RATE || 1380);
const IMPORT_API_URL =
  process.env.IMPORT_API_URL ||
  process.env.IMPORT_ERP_URL ||
  process.env.NEXT_PUBLIC_IMPORT_API_URL ||
  process.env.NEXT_PUBLIC_IMPORT_ERP_URL ||
  "http://localhost:5500";
const IMPORT_API_BYPASS_SECRET = process.env.IMPORT_API_BYPASS_SECRET || "";
const IMPORT_API_AUTH_TOKEN = process.env.IMPORT_API_AUTH_TOKEN || IMPORT_API_BYPASS_SECRET;
let cachedUsdKrwRate: { value: number; at: number } | null = null;

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
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = text(value).replace(/,/g, "");
  if (!raw) return 0;
  const parsed = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentValue(value: unknown) {
  const raw = text(value);
  const parsed = numberValue(raw);
  if (!parsed) return 0;
  return raw.includes("%") || parsed > 1 ? parsed : parsed * 100;
}

function dateValue(value: unknown) {
  const raw = text(value);
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const compact = raw.replace(/\D/g, "");
  if (compact.length >= 8) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function pct(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function inRange(date: string, range?: SummaryRange) {
  const value = dateValue(date);
  if (range?.from && value < range.from) return false;
  if (range?.to && value > range.to) return false;
  return true;
}

function todayKstStartIso() {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const ymd = kstNow.toISOString().slice(0, 10);
  return new Date(`${ymd}T00:00:00+09:00`).toISOString();
}

async function optionalRows(table: string, query?: Record<string, string | number | boolean | null | undefined>) {
  return selectRows<AnyRecord>(table, query).catch(() => []);
}

function isAggregateRow(row: AnyRecord) {
  const campaignId = text(first(row, ["캠페인 ID", "campaign_id"]));
  const campaignName = text(first(row, ["캠페인명", "캠페인 이름", "campaign_name"]));
  return !campaignId && /결과|합계|total/i.test(campaignName);
}

function hasAdSignal(row: AnyRecord) {
  return ["impressions", "clicks", "cost", "conversions", "conversion_value"].some((key) => numberValue(row[key]) > 0);
}

async function getUsdKrwRate() {
  const now = Date.now();
  if (cachedUsdKrwRate && now - cachedUsdKrwRate.at < 60_000) return cachedUsdKrwRate.value;
  try {
    const response = await fetch(`${IMPORT_API_URL.replace(/\/$/, "")}/api/fnos/settings`, {
      cache: "no-store",
      headers: {
        Origin: process.env.FN_OS_ORIGIN || "http://127.0.0.1:3000",
        ...(IMPORT_API_BYPASS_SECRET ? { "x-vercel-protection-bypass": IMPORT_API_BYPASS_SECRET } : {}),
        ...(IMPORT_API_AUTH_TOKEN ? { "x-fn-os-api-key": IMPORT_API_AUTH_TOKEN } : {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const usdRate = numberValue(data?.rates?.USD);
    if (usdRate > 0) {
      cachedUsdKrwRate = { value: usdRate, at: now };
      return usdRate;
    }
  } catch {
    // 수입관리 서버가 꺼져 있으면 환경변수 기준 fallback을 사용한다.
  }
  cachedUsdKrwRate = { value: FALLBACK_USD_KRW_RATE, at: now };
  return FALLBACK_USD_KRW_RATE;
}

function normalizeReport(row: AnyRecord, batchId: string, channel: string, usdKrwRate: number) {
  const isCoupang = channel.includes("쿠팡");
  const isMeta = channel.includes("메타");
  const impressions = numberValue(first(row, ["impressions", "노출수", "노출", "imp", "impCnt"]));
  const clicks = numberValue(first(row, ["clicks", "클릭수", "링크 클릭", "클릭(전체)", "클릭", "clk", "clkCnt"]));
  const metaUsdCost = numberValue(first(row, ["지출 금액 (USD)", "Amount spent (USD)", "spend_usd"]));
  const baseCost = numberValue(first(row, ["cost", "광고비", "총비용", "비용", "spend", "spend_amount"]));
  const cost = baseCost || (isMeta && metaUsdCost ? Math.round(metaUsdCost * usdKrwRate) : 0);
  const purchaseConversions = numberValue(first(row, ["구매완료 전환수", "구매완료 수", "구매", "purchase_conversions"]));
  const purchaseValue = numberValue(first(row, ["구매완료 전환매출액", "구매 전환값", "purchase_conversion_value"]));
  const coupangOrders = numberValue(first(row, ["총 주문수(14일)", "총 주문수(1일)", "직접주문수(14일)", "직접 주문수(1일)"]));
  const coupangSales = numberValue(first(row, ["총 전환매출액(14일)", "총 전환매출액(1일)", "직접 전환매출액(14일)", "직접 전환매출액(1일)"]));
  const conversions = isCoupang
    ? coupangOrders
    : purchaseConversions || numberValue(first(row, ["conversions", "전환수", "전환", "결과", "ccnt"]));
  const conversionValue = isCoupang
    ? coupangSales
    : purchaseValue || numberValue(first(row, ["conversion_value", "전환금액", "매출", "구매금액", "salesAmt", "revenue"]));
  const ctr = percentValue(first(row, ["ctr", "CTR", "클릭률(%)", "CTR(링크 클릭률)", "아웃바운드 CTR(클릭률)", "클릭률"])) || pct(clicks, impressions);
  const cpc = numberValue(first(row, ["cpc", "CPC", "평균 CPC"])) || (clicks > 0 ? cost / clicks : 0);
  const cvr = pct(conversions, clicks);
  const roas = percentValue(first(row, [
    "구매완료 광고수익률(%)",
    "purchase_roas",
    ...(isCoupang ? ["총광고수익률(14일)", "총광고수익률(1일)"] : []),
    "roas",
    "ROAS",
  ])) || pct(conversionValue, cost);
  const productCode = text(first(row, [
    "product_code",
    "상품코드",
    "상품 ID",
    "품목코드",
    "prod_cd",
    "광고집행 옵션ID",
    "광고전환매출발생 옵션ID",
  ]));
  const sku = text(first(row, ["sku", "SKU", "옵션코드", "판매자상품코드"])) || productCode;
  const campaignName = text(first(row, ["campaign_name", "캠페인명", "캠페인 이름", "광고 세트 이름", "campaign"]));
  const adGroupName = text(first(row, ["ad_group_name", "광고그룹", "광고 그룹 이름", "ad_group"]));
  const adName = text(first(row, ["ad_name", "소재", "소재명", "광고명", "광고집행 상품명", "광고전환매출발생 상품명", "ad"]));

  return {
    batch_id: batchId,
    channel,
    report_date: dateValue(first(row, ["보고 시작", "report_date", "date", "일자", "날짜", "기간", "__report_date"])),
    campaign_name: campaignName || adGroupName || adName || "-",
    ad_group_name: adGroupName,
    ad_name: adName || campaignName,
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
    raw_payload: isMeta ? { ...row, __usd_krw_rate: usdKrwRate } : row,
  };
}

export async function importAdRows(rows: AnyRecord[], channel: string, sourceFileName?: string, options?: { forceReplace?: boolean }): Promise<AdImportResult> {
  if (!hasDbConfig()) {
    return { ok: false, message: "Supabase 환경변수가 설정되지 않았습니다.", success_count: 0, fail_count: rows.length };
  }

  const normalizedChannel = text(channel) || "기타";
  const fileName = text(sourceFileName) || null;
  const recentBatches = await optionalRows("ad_upload_batches", {
    channel: `eq.${normalizedChannel}`,
    status: "eq.SAVED",
    uploaded_at: `gte.${todayKstStartIso()}`,
    limit: 30,
  });

  const usdKrwRate = await getUsdKrwRate();
  const previewReports = rows
    .filter((row) => !isAggregateRow(row))
    .map((row) => normalizeReport(row, "__preview__", normalizedChannel, usdKrwRate))
    .filter(hasAdSignal);
  const reportDates = Array.from(new Set(previewReports.map((row) => text(row.report_date)).filter(Boolean))).sort();
  let replacedCount = 0;
  const replacedReportIds = new Set<string>();
  if (reportDates.length) {
    const existingReports = await optionalRows("ad_reports", {
      channel: `eq.${normalizedChannel}`,
      report_date: `in.(${reportDates.join(",")})`,
      limit: 5000,
    });
    existingReports.forEach((row) => {
      if (row.id) replacedReportIds.add(text(row.id));
    });
  }
  for (const recentBatch of recentBatches) {
    const batchId = text(recentBatch.id);
    if (!batchId) continue;
    const existingReports = await optionalRows("ad_reports", { batch_id: `eq.${batchId}`, limit: 5000 });
    existingReports.forEach((row) => {
      if (row.id) replacedReportIds.add(text(row.id));
    });
  }
  replacedCount = replacedReportIds.size;
  if (replacedCount > 0 && !options?.forceReplace) {
    return {
      ok: false,
      duplicate: true,
      needs_confirmation: true,
      message: `${reportDates.join(", ") || "선택 날짜"} ${normalizedChannel} 데이터가 이미 ${replacedCount.toLocaleString("ko-KR")}건 있습니다. 기존 데이터를 대체할까요?`,
      success_count: 0,
      fail_count: rows.length,
      replaced_count: replacedCount,
      replaced_dates: reportDates,
    };
  }

  const [batch] = await insertRows<{ id: string }>("ad_upload_batches", {
    channel: normalizedChannel,
    source_file_name: fileName,
    total_count: rows.length,
    success_count: 0,
    fail_count: 0,
    status: "SAVED",
  });

  if (reportDates.length) {
    await deleteRows("ad_reports", {
      channel: `eq.${normalizedChannel}`,
      report_date: `in.(${reportDates.join(",")})`,
    }).catch(() => []);
  }
  for (const recentBatch of recentBatches) {
    const batchId = text(recentBatch.id);
    if (!batchId) continue;
    await deleteRows("ad_reports", { batch_id: `eq.${batchId}` }).catch(() => []);
    await patchRows("ad_upload_batches", { id: `eq.${batchId}` }, { status: "REPLACED", memo: `새 ${normalizedChannel} 업로드로 교체됨` }).catch(() => []);
  }

  const reports = previewReports.map((row) => ({ ...row, batch_id: batch.id }));
  const saved = reports.length ? await insertRows("ad_reports", reports) : [];
  await patchRows("ad_upload_batches", { id: `eq.${batch.id}` }, {
    success_count: saved.length,
    fail_count: Math.max(0, rows.length - saved.length),
    memo: reportDates.length
      ? `${reportDates.join(", ")} 기존 ${replacedCount.toLocaleString("ko-KR")}건 교체`
      : null,
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
    message: replacedCount
      ? `${reportDates.join(", ")} ${normalizedChannel} 기존 ${replacedCount.toLocaleString("ko-KR")}건을 새 데이터 ${saved.length.toLocaleString("ko-KR")}건으로 교체했습니다.`
      : `광고 데이터 ${saved.length.toLocaleString("ko-KR")}건을 저장했습니다.`,
    batch_id: batch.id,
    success_count: saved.length,
    fail_count: Math.max(0, rows.length - saved.length),
    replaced_count: replacedCount,
    replaced_dates: reportDates,
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
  if (cost > 0 && sales <= 0) return "광고비가 집행됐지만 매출 연결이 없습니다. 캠페인 추적과 SKU 매핑을 확인하세요.";
  if (ctr > 0 && ctr < 1) return "CTR이 낮습니다. 썸네일, 첫 문구, 후킹 소재를 교체해 보세요.";
  if (cvr > 0 && cvr < 1) return "CVR이 낮습니다. 상세페이지, 가격, 리뷰/배송 조건을 확인하세요.";
  return "현재 지표는 유지 가능한 구간입니다. 예산 증액 전 재고와 순이익을 같이 확인하세요.";
}

export async function adsSummary(range?: SummaryRange) {
  const [reportsRaw, batches, mappings, products, salesRaw, inventory] = await Promise.all([
    optionalRows("ad_reports", { order: "report_date.desc", limit: 5000 }),
    optionalRows("ad_upload_batches", { order: "uploaded_at.desc", limit: 30 }),
    optionalRows("ad_product_mappings", { order: "updated_at.desc", limit: 1000 }),
    optionalRows("products", { order: "product_name.asc", limit: 2000 }),
    optionalRows("sales", { order: "created_at.desc", limit: 5000 }),
    optionalRows("inventory_current", { order: "updated_at.desc", limit: 2000 }),
  ]);

  const reports = reportsRaw.filter((row) => inRange(rowDate(row), range));
  const sales = salesRaw.filter((row) => inRange(rowDate(row), range));
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
    range: range || {},
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
