import { NextRequest, NextResponse } from "next/server";
import pg, { type QueryResultRow } from "pg";
import { uploadStorageFile } from "./fnos-db";

type AnyRecord = Record<string, any>;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_POOLER_URL ||
  "";

const pool = DATABASE_URL
  ? new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const TABLES = {
  categories: "import_erp_categories",
  factories: "import_erp_factories",
  products: "import_erp_products",
  productMaterials: "import_erp_product_materials",
  materialMovements: "import_erp_material_movements",
  orders: "import_erp_orders",
  orderItems: "import_erp_order_items",
  margins: "import_erp_order_item_margin_calc",
  attachments: "import_erp_attachments",
  rates: "import_erp_fx_rates",
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value: unknown) {
  return text(value).slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function q(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function db<T extends QueryResultRow = AnyRecord>(sql: string, params: unknown[] = []) {
  if (!pool) throw new Error("FN OS DATABASE_URL이 없습니다.");
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

async function nextId(table: string) {
  const [row] = await db<{ id: string }>(`select coalesce(max(id), 0) + 1 as id from ${q(table)}`);
  return Number(row.id);
}

async function ratesMap() {
  const rows = await db(`select * from ${q(TABLES.rates)} order by currency`);
  return Object.fromEntries(rows.map((row) => [row.currency, numberValue(row.rate)]));
}

function lineRate(order: AnyRecord, line: AnyRecord, rates: AnyRecord) {
  const currency = text(line.item_currency || order.currency || "CNY");
  return numberValue(line.item_fx_rate) || numberValue(rates[currency]) || numberValue(order.fx_rate) || 1;
}

function actualPaymentKrw(order: AnyRecord, rates: AnyRecord) {
  const totalKrw = numberValue(order.actual_payment_total_krw);
  if (totalKrw) return totalKrw;
  const total = numberValue(order.actual_payment_total || order.actual_payment_usd);
  if (!total) return 0;
  const currency = text(order.actual_payment_currency || (order.actual_payment_usd ? "USD" : "KRW"));
  return currency === "KRW" ? total : total * numberValue(rates[currency]);
}

function productTotals(order: AnyRecord, lines: AnyRecord[], rates: AnyRecord) {
  const nativeTotals: AnyRecord = {};
  let productWon = 0;
  for (const line of lines) {
    const qty = numberValue(line.quantity);
    const unit = numberValue(line.unit_price);
    const currency = text(line.item_currency || order.currency || "CNY");
    nativeTotals[currency] = numberValue(nativeTotals[currency]) + qty * unit;
    productWon += qty * unit * lineRate(order, line, rates);
  }
  const actualKrw = actualPaymentKrw(order, rates);
  return { nativeTotals, productWon: actualKrw || productWon, displayProductWon: productWon };
}

function orderChinaExtra(order: AnyRecord, rates: AnyRecord) {
  const currency = text(order.china_cost_currency || order.currency || "CNY");
  const rate = numberValue(rates[currency]) || numberValue(order.fx_rate) || 1;
  return (
    numberValue(order.china_domestic_shipping) +
    numberValue(order.china_fee) +
    numberValue(order.china_other_cost)
  ) * rate;
}

function orderTotalWon(order: AnyRecord, lines: AnyRecord[], rates: AnyRecord) {
  const { productWon } = productTotals(order, lines, rates);
  return productWon +
    numberValue(order.shipping_cost) +
    numberValue(order.customs_duty) +
    numberValue(order.vat) +
    numberValue(order.customs_fee) +
    numberValue(order.inspection_fee) +
    numberValue(order.domestic_shipping_cost) +
    numberValue(order.other_cost) +
    orderChinaExtra(order, rates);
}

function costGrid(order: AnyRecord, lines: AnyRecord[], rates: AnyRecord) {
  const totalQty = lines.reduce((sum, line) => sum + numberValue(line.quantity), 0);
  const totalWon = orderTotalWon(order, lines, rates);
  const rows = lines.map((line) => {
    const qty = numberValue(line.quantity);
    const lineProductWon = qty * numberValue(line.unit_price) * lineRate(order, line, rates);
    const costRatio = totalWon ? lineProductWon / Math.max(1, totalWon) : 0;
    return {
      order_item_id: line.id,
      product_id: line.product_id,
      product_name: line.product_name,
      option_name: line.option_value,
      quantity: qty,
      item_currency: line.item_currency,
      unit_price: numberValue(line.unit_price),
      line_product_won: lineProductWon,
      cost_ratio: costRatio,
      unit_extra_cost: totalQty ? (totalWon - lineProductWon) / totalQty : 0,
      material_unit_cost: 0,
      base_unit_cost: qty ? lineProductWon / qty : 0,
      estimated_unit_cost: qty ? totalWon / Math.max(totalQty, 1) : 0,
      coupang_margin: { amount: null, pct: null },
      naver_free_margin: { amount: null, pct: null },
      naver_cod_margin: { amount: null, pct: null },
    };
  });
  return { rows, total_extra_cost: totalWon, total_qty: totalQty };
}

async function materialInfoForProducts(productIds: Array<number | string>) {
  if (!productIds.length) return new Map<number, AnyRecord[]>();
  const rows = await db(
    `select pm.*, p.name as material_name, p.material_cost, p.material_unit_cost, p.material_stock_adjust, p.material_initial_qty
       from ${q(TABLES.productMaterials)} pm
       left join ${q(TABLES.products)} p on p.id = pm.material_id
      where pm.product_id = any($1::bigint[])`,
    [productIds.map(Number)],
  );
  const map = new Map<number, AnyRecord[]>();
  for (const row of rows) {
    const key = Number(row.product_id);
    map.set(key, [...(map.get(key) || []), row]);
  }
  return map;
}

async function linkedProductsForMaterials(materialIds: Array<number | string>) {
  if (!materialIds.length) return new Map<number, AnyRecord[]>();
  const rows = await db(
    `select pm.*, p.name as product_name
       from ${q(TABLES.productMaterials)} pm
       left join ${q(TABLES.products)} p on p.id = pm.product_id
      where pm.material_id = any($1::bigint[])`,
    [materialIds.map(Number)],
  );
  const map = new Map<number, AnyRecord[]>();
  for (const row of rows) {
    const key = Number(row.material_id);
    map.set(key, [...(map.get(key) || []), row]);
  }
  return map;
}

async function attachProductInfo(products: AnyRecord[]): Promise<AnyRecord[]> {
  const productIds = products.filter((item) => text(item.item_type).toUpperCase() !== "MATERIAL").map((item) => item.id);
  const materialIds = products.filter((item) => text(item.item_type).toUpperCase() === "MATERIAL").map((item) => item.id);
  const materials = await materialInfoForProducts(productIds);
  const linkedProducts = await linkedProductsForMaterials(materialIds);
  return products.map((product) => ({
    ...product,
    materials: materials.get(Number(product.id)) || [],
    linked_products: linkedProducts.get(Number(product.id)) || [],
    material_stock: numberValue(product.material_initial_qty) + numberValue(product.material_stock_adjust),
  }));
}

async function orderRows(filters: { q?: string; dateFrom?: string; dateTo?: string } = {}) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(o.order_code ilike $${params.length} or f.name ilike $${params.length} or exists (select 1 from ${q(TABLES.orderItems)} qi where qi.order_id=o.id and qi.product_name ilike $${params.length}))`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    where.push(`o.order_date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    where.push(`o.order_date <= $${params.length}`);
  }
  const rows = await db(
    `select o.*, f.name as factory_name,
            coalesce(items.line_count, 0) as line_count,
            coalesce(items.total_qty, 0) as total_qty,
            coalesce(items.item_total, 0) as item_total,
            coalesce(att.attachment_count, 0) as attachment_count,
            (select i.product_name from ${q(TABLES.orderItems)} i where i.order_id=o.id order by sort_order, id limit 1) as repr_product,
            (select p.image_path from ${q(TABLES.orderItems)} i left join ${q(TABLES.products)} p on p.id=i.product_id where i.order_id=o.id order by i.sort_order, i.id limit 1) as repr_image
       from ${q(TABLES.orders)} o
       left join ${q(TABLES.factories)} f on f.id=o.factory_id
       left join (select order_id, count(*) as line_count, sum(quantity) as total_qty, sum(quantity * unit_price) as item_total from ${q(TABLES.orderItems)} group by order_id) items on items.order_id=o.id
       left join (select order_id, count(*) as attachment_count from ${q(TABLES.attachments)} group by order_id) att on att.order_id=o.id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by o.order_date desc nulls last, o.id desc
      limit 500`,
    params,
  );
  const rates = await ratesMap();
  const lineMap = await linesByOrder(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, total_won: orderTotalWon(row, lineMap.get(String(row.id)) || [], rates) }));
}

async function linesByOrder(orderIds: Array<number | string>) {
  const map = new Map<string, AnyRecord[]>();
  if (!orderIds.length) return map;
  const rows = await db(
    `select i.*, p.image_path, p.item_type
       from ${q(TABLES.orderItems)} i
       left join ${q(TABLES.products)} p on p.id=i.product_id
      where i.order_id = any($1::bigint[])
      order by i.order_id, i.sort_order, i.id`,
    [orderIds.map(Number)],
  );
  for (const row of rows) {
    const key = String(row.order_id);
    map.set(key, [...(map.get(key) || []), row]);
  }
  return map;
}

async function factories() {
  return db(`select * from ${q(TABLES.factories)} order by name`);
}

async function categories() {
  return db(`select * from ${q(TABLES.categories)} order by name`);
}

async function productsList(): Promise<AnyRecord[]> {
  const rows = await db(
    `select p.*, f.name as factory_name
       from ${q(TABLES.products)} p
       left join ${q(TABLES.factories)} f on f.id=p.factory_id
      order by p.updated_at desc nulls last, p.id desc
      limit 500`,
  );
  return attachProductInfo(rows);
}

async function productDetail(id: number) {
  const [product] = await db(
    `select p.*, f.name as factory_name
       from ${q(TABLES.products)} p
       left join ${q(TABLES.factories)} f on f.id=p.factory_id
      where p.id=$1`,
    [id],
  );
  if (!product) return null;
  const [hydrated] = await attachProductInfo([product]);
  const history = await db(
    `select i.*, o.order_code, o.order_date, o.status, f.name as factory
       from ${q(TABLES.orderItems)} i
       join ${q(TABLES.orders)} o on o.id=i.order_id
       left join ${q(TABLES.factories)} f on f.id=o.factory_id
      where i.product_id=$1
      order by o.order_date desc nulls last, o.id desc`,
    [id],
  );
  return { product: hydrated, materials: hydrated.materials || [], history };
}

function valuesFromForm(form: FormData, names: string[]) {
  return Object.fromEntries(names.map((name) => [name, form.get(name)]));
}

async function saveProduct(request: NextRequest, id?: number) {
  const form = await request.formData();
  const fields = valuesFromForm(form, [
    "sku", "name", "category_id", "factory_id", "image_url", "product_url", "options", "hs_code",
    "basic_rate", "fta_rate", "moq", "std_price", "currency", "status", "note", "item_type",
    "material_cost", "material_stock_adjust", "material_unit_cost", "material_safe_qty",
    "material_initial_qty", "material_note", "shipping_address",
  ]);
  const file = form.get("image");
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadStorageFile(file, "import-erp/products");
    fields.image_url = uploaded.url;
  }
  const imageUrl = text(fields.image_url);
  const values: AnyRecord = {
    ...fields,
    image_path: imageUrl || null,
    category_id: text(fields.category_id) ? Number(fields.category_id) : null,
    factory_id: text(fields.factory_id) ? Number(fields.factory_id) : null,
    basic_rate: numberValue(fields.basic_rate),
    fta_rate: numberValue(fields.fta_rate),
    moq: text(fields.moq) ? Number(fields.moq) : null,
    std_price: text(fields.std_price) ? numberValue(fields.std_price) : null,
    material_cost: numberValue(fields.material_cost),
    material_stock_adjust: numberValue(fields.material_stock_adjust),
    material_unit_cost: numberValue(fields.material_unit_cost),
    material_safe_qty: numberValue(fields.material_safe_qty),
    material_initial_qty: numberValue(fields.material_initial_qty),
    updated_at: nowIso(),
  };
  delete values.image_url;

  const savedId = id || await nextId(TABLES.products);
  if (id) {
    const setColumns = Object.keys(values).map((key, index) => `${q(key)}=$${index + 1}`).join(", ");
    await db(`update ${q(TABLES.products)} set ${setColumns} where id=$${Object.keys(values).length + 1}`, [...Object.values(values), id]);
  } else {
    values.id = savedId;
    values.created_at = nowIso();
    const keys = Object.keys(values);
    await db(`insert into ${q(TABLES.products)} (${keys.map(q).join(", ")}) values (${keys.map((_, index) => `$${index + 1}`).join(", ")})`, Object.values(values));
  }
  await saveProductMaterials(savedId, text(values.item_type).toUpperCase(), text(form.get("materials")), text(form.get("linked_products")));
  const detail = await productDetail(savedId);
  return json({ ok: true, product: detail?.product || { id: savedId } });
}

async function saveProductMaterials(productId: number, itemType: string, materialsJson: string, linkedJson: string) {
  await db(`delete from ${q(TABLES.productMaterials)} where product_id=$1 or material_id=$1`, [productId]);
  const rows = itemType === "MATERIAL"
    ? JSON.parse(linkedJson || "[]").map((item: AnyRecord) => ({
        product_id: Number(item.product_id),
        material_id: productId,
        quantity_per_unit: numberValue(item.quantity_per_unit || item.qty_per_product) || 1,
        qty_per_product: numberValue(item.qty_per_product || item.quantity_per_unit) || 1,
      }))
    : JSON.parse(materialsJson || "[]").map((item: AnyRecord) => ({
        product_id: productId,
        material_id: Number(item.material_id),
        quantity_per_unit: numberValue(item.quantity_per_unit) || 1,
        qty_per_product: numberValue(item.qty_per_product || item.quantity_per_unit) || 1,
      }));
  for (const row of rows.filter((item: AnyRecord) => item.product_id && item.material_id)) {
    row.id = await nextId(TABLES.productMaterials);
    row.created_at = nowIso();
    row.updated_at = nowIso();
    const keys = Object.keys(row);
    await db(`insert into ${q(TABLES.productMaterials)} (${keys.map(q).join(", ")}) values (${keys.map((_, index) => `$${index + 1}`).join(", ")})`, Object.values(row));
  }
}

async function orderDetail(id: number) {
  const [order] = await db(
    `select o.*, f.name as factory_name
       from ${q(TABLES.orders)} o
       left join ${q(TABLES.factories)} f on f.id=o.factory_id
      where o.id=$1`,
    [id],
  );
  if (!order) return null;
  const lines = (await linesByOrder([id])).get(String(id)) || [];
  const attachments = await db(`select * from ${q(TABLES.attachments)} where order_id=$1 order by uploaded_at desc nulls last, id desc`, [id]);
  const rates = await ratesMap();
  const totalQty = lines.reduce((sum, line) => sum + numberValue(line.quantity), 0);
  const itemTotal = lines.reduce((sum, line) => sum + numberValue(line.quantity) * numberValue(line.unit_price), 0);
  return {
    ok: true,
    order: { ...order, attachment_count: attachments.length },
    items: lines,
    attachments,
    fx_rates: rates,
    total_qty: totalQty,
    item_total: itemTotal,
    total_won: orderTotalWon(order, lines, rates),
    cost_grid: costGrid(order, lines, rates),
    self_total_won: orderTotalWon(order, lines, rates),
    native_totals: productTotals(order, lines, rates).nativeTotals,
    display_product_won: productTotals(order, lines, rates).displayProductWon,
  };
}

async function generateOrderCode(orderDate: string) {
  const compact = (orderDate || new Date().toISOString().slice(0, 10)).replace(/\D/g, "").slice(2);
  const prefix = `${compact.slice(0, 6)}`;
  const [row] = await db(`select count(*)::int as count from ${q(TABLES.orders)} where order_code like $1`, [`${prefix}-%`]);
  return `${prefix}-${String(numberValue(row.count) + 1).padStart(2, "0")}`;
}

async function saveOrder(request: NextRequest, id?: number) {
  const body = await request.json();
  const orderFields = [
    "order_code", "parent_order_id", "factory_id", "platform", "currency", "fx_rate", "order_date",
    "payment_method", "first_payment_date", "paid_date", "factory_ship_date", "badaeji_arrived",
    "customs_cleared", "fn_arrived", "fn_arrival_method", "shipping_method", "shipping_cost",
    "customs_duty", "vat", "customs_fee", "inspection_fee", "domestic_shipping_cost", "other_cost",
    "status", "folder_path", "note", "production_days", "actual_payment_usd", "actual_payment_usd_1",
    "actual_payment_usd_2", "china_domestic_shipping", "china_other_cost", "china_cost_currency",
    "actual_payment_currency", "actual_payment_1", "actual_payment_2", "actual_payment_total",
    "actual_payment_total_krw", "china_fee", "china_other_note",
  ];
  const savedId = id || await nextId(TABLES.orders);
  const values: AnyRecord = {};
  for (const field of orderFields) {
    if (body[field] !== undefined) values[field] = body[field] === "" ? null : body[field];
  }
  for (const field of ["parent_order_id", "factory_id"]) values[field] = text(values[field]) ? Number(values[field]) : null;
  for (const field of ["fx_rate", "shipping_cost", "customs_duty", "vat", "customs_fee", "inspection_fee", "domestic_shipping_cost", "other_cost", "production_days", "actual_payment_usd", "actual_payment_usd_1", "actual_payment_usd_2", "china_domestic_shipping", "china_other_cost", "actual_payment_1", "actual_payment_2", "actual_payment_total", "actual_payment_total_krw", "china_fee"]) {
    values[field] = numberValue(values[field]);
  }
  values.order_code = text(values.order_code) || await generateOrderCode(dateKey(values.order_date));
  values.updated_at = nowIso();
  if (id) {
    const keys = Object.keys(values);
    await db(`update ${q(TABLES.orders)} set ${keys.map((key, index) => `${q(key)}=$${index + 1}`).join(", ")} where id=$${keys.length + 1}`, [...Object.values(values), id]);
    await db(`delete from ${q(TABLES.orderItems)} where order_id=$1`, [id]);
  } else {
    values.id = savedId;
    values.created_at = nowIso();
    const keys = Object.keys(values);
    await db(`insert into ${q(TABLES.orders)} (${keys.map(q).join(", ")}) values (${keys.map((_, index) => `$${index + 1}`).join(", ")})`, Object.values(values));
  }
  let sortOrder = 0;
  for (const line of (Array.isArray(body.items) ? body.items : [])) {
    const row = {
      id: await nextId(TABLES.orderItems),
      order_id: savedId,
      product_id: text(line.product_id) ? Number(line.product_id) : null,
      product_name: text(line.product_name),
      option_value: text(line.option_value),
      quantity: numberValue(line.quantity),
      unit_price: numberValue(line.unit_price),
      item_currency: text(line.item_currency) || text(values.currency) || "CNY",
      item_fx_rate: numberValue(line.item_fx_rate || values.fx_rate),
      line_note: text(line.line_note) || null,
      sort_order: sortOrder++,
    };
    const keys = Object.keys(row);
    await db(`insert into ${q(TABLES.orderItems)} (${keys.map(q).join(", ")}) values (${keys.map((_, index) => `$${index + 1}`).join(", ")})`, Object.values(row));
  }
  return json({ ok: true, order: (await orderDetail(savedId))?.order || { id: savedId } });
}

async function saveFactory(request: NextRequest, id?: number) {
  const body = await request.json().catch(() => ({}));
  const fields = ["name", "name_local", "country", "platform", "contact", "wechat", "email", "bank_account", "address", "first_order", "rating", "note"];
  const values = Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
  values.updated_at = nowIso();
  if (id) {
    const keys = Object.keys(values);
    await db(`update ${q(TABLES.factories)} set ${keys.map((key, index) => `${q(key)}=$${index + 1}`).join(", ")} where id=$${keys.length + 1}`, [...Object.values(values), id]);
  } else {
    values.id = await nextId(TABLES.factories);
    values.created_at = nowIso();
    const keys = Object.keys(values);
    await db(`insert into ${q(TABLES.factories)} (${keys.map(q).join(", ")}) values (${keys.map((_, index) => `$${index + 1}`).join(", ")})`, Object.values(values));
  }
  const [factory] = await db(`select * from ${q(TABLES.factories)} where id=$1`, [values.id || id]);
  return json({ ok: true, factory });
}

async function handleGet(path: string, request: NextRequest) {
  const url = request.nextUrl;
  if (path === "api/fnos/orders") {
    const orders = await orderRows({
      q: text(url.searchParams.get("q")),
      dateFrom: text(url.searchParams.get("date_from")),
      dateTo: text(url.searchParams.get("date_to")),
    });
    return json({ orders, factories: await factories(), q: text(url.searchParams.get("q")), date_from: text(url.searchParams.get("date_from")), date_to: text(url.searchParams.get("date_to")) });
  }
  const orderMatch = path.match(/^api\/fnos\/orders\/(\d+)$/);
  if (orderMatch) return json(await orderDetail(Number(orderMatch[1])) || { ok: false, error: "발주를 찾을 수 없습니다." }, orderMatch ? 200 : 404);
  if (path === "api/fnos/products") return json({ products: await productsList(), materials: (await productsList()).filter((item) => text(item.item_type).toUpperCase() === "MATERIAL"), categories: await categories(), q: "", cat: "", status: "" });
  const productMatch = path.match(/^api\/fnos\/products\/(\d+)$/);
  if (productMatch) return json({ ok: true, ...(await productDetail(Number(productMatch[1]))) });
  if (path === "api/fnos/form-data") {
    const products = await productsList();
    return json({ rates: await ratesMap(), categories: await categories(), factories: await factories(), products, materials: products.filter((item) => text(item.item_type).toUpperCase() === "MATERIAL") });
  }
  if (path === "api/fnos/settings") return json({ rates: await ratesMap(), categories: await categories(), factories: await factories() });
  if (path === "api/fnos/dashboard") {
    const orders = await orderRows();
    const products = await productsList();
    return json({ orders, products, totals: { orders: orders.length, products: products.length } });
  }
  if (path === "api/fnos/calendar-production-memos") {
    const orders = await db(`select id, production_memo, production_due_date, order_code from ${q(TABLES.orders)} where production_due_date is not null or factory_ship_date is not null`);
    const grouped: Record<string, AnyRecord[]> = {};
    for (const order of orders) {
      const key = dateKey(order.production_due_date || order.factory_ship_date);
      if (!key) continue;
      grouped[key] = [...(grouped[key] || []), { memo: text(order.production_memo || order.order_code), order_id: Number(order.id) }];
    }
    return json(grouped);
  }
  const attachmentMatch = path.match(/^api\/fnos\/orders\/(\d+)\/attachments$/);
  if (attachmentMatch) {
    const orderId = Number(attachmentMatch[1]);
    const [order] = await db(`select id, order_code from ${q(TABLES.orders)} where id=$1`, [orderId]);
    const attachments = await db(`select * from ${q(TABLES.attachments)} where order_id=$1 order by uploaded_at desc nulls last, id desc`, [orderId]);
    return json({ ok: true, order, attachments });
  }
  return null;
}

async function handleMutation(path: string, request: NextRequest) {
  if (path === "api/fnos/products" && request.method === "POST") return saveProduct(request);
  const productMatch = path.match(/^api\/fnos\/products\/(\d+)$/);
  if (productMatch && request.method === "PUT") return saveProduct(request, Number(productMatch[1]));
  if (productMatch && request.method === "DELETE") {
    await db(`update ${q(TABLES.orderItems)} set product_id=null where product_id=$1`, [Number(productMatch[1])]);
    await db(`delete from ${q(TABLES.products)} where id=$1`, [Number(productMatch[1])]);
    return json({ ok: true });
  }
  if (path === "api/fnos/orders" && request.method === "POST") return saveOrder(request);
  const orderMatch = path.match(/^api\/fnos\/orders\/(\d+)$/);
  if (orderMatch && request.method === "PUT") return saveOrder(request, Number(orderMatch[1]));
  if (orderMatch && request.method === "DELETE") {
    const id = Number(orderMatch[1]);
    await db(`delete from ${q(TABLES.orderItems)} where order_id=$1`, [id]);
    await db(`delete from ${q(TABLES.attachments)} where order_id=$1`, [id]);
    await db(`delete from ${q(TABLES.orders)} where parent_order_id=$1`, [id]);
    await db(`delete from ${q(TABLES.orders)} where id=$1`, [id]);
    return json({ ok: true });
  }
  if (path === "api/fnos/factories" && request.method === "POST") return saveFactory(request);
  const factoryMatch = path.match(/^api\/fnos\/factories\/(\d+)$/);
  if (factoryMatch && request.method === "PUT") return saveFactory(request, Number(factoryMatch[1]));
  if (factoryMatch && request.method === "DELETE") {
    await db(`update ${q(TABLES.products)} set factory_id=null where factory_id=$1`, [Number(factoryMatch[1])]);
    await db(`update ${q(TABLES.orders)} set factory_id=null where factory_id=$1`, [Number(factoryMatch[1])]);
    await db(`delete from ${q(TABLES.factories)} where id=$1`, [Number(factoryMatch[1])]);
    return json({ ok: true });
  }
  if (path === "api/fnos/settings/rates" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    for (const [currency, rate] of Object.entries(body.rates || body)) {
      await db(
        `insert into ${q(TABLES.rates)} (currency, rate, updated_at) values ($1, $2, now()) on conflict (currency) do update set rate=excluded.rate, updated_at=now()`,
        [currency, numberValue(rate)],
      );
    }
    return json({ ok: true, rates: await ratesMap() });
  }
  const attachmentMatch = path.match(/^api\/fnos\/orders\/(\d+)\/attachments$/);
  if (attachmentMatch && request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) return json({ ok: false, error: "파일이 없습니다." }, 400);
    const uploaded = await uploadStorageFile(file, `import-erp/orders/${attachmentMatch[1]}`);
    const row = {
      id: await nextId(TABLES.attachments),
      order_id: Number(attachmentMatch[1]),
      file_path: uploaded.url,
      file_name: file.name,
      doc_type: text(form.get("doc_type")) || null,
      note: text(form.get("note")) || null,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      uploaded_at: nowIso(),
    };
    const keys = Object.keys(row);
    await db(`insert into ${q(TABLES.attachments)} (${keys.map(q).join(", ")}) values (${keys.map((_, index) => `$${index + 1}`).join(", ")})`, Object.values(row));
    return json({ ok: true, attachment: row });
  }
  const deleteAttachmentMatch = path.match(/^api\/fnos\/attachments\/(\d+)$/);
  if (deleteAttachmentMatch && request.method === "DELETE") {
    await db(`delete from ${q(TABLES.attachments)} where id=$1`, [Number(deleteAttachmentMatch[1])]);
    return json({ ok: true });
  }
  return null;
}

export async function handleLocalImportErp(request: NextRequest, pathParts: string[]) {
  const path = pathParts.join("/");
  if (!path.startsWith("api/fnos/")) return null;
  try {
    if (request.method === "GET") return await handleGet(path, request);
    return await handleMutation(path, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "수입관리 DB 처리 중 오류가 발생했습니다.";
    return json({ ok: false, error: message }, 500);
  }
}
