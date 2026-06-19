-- FN OS sales/inventory ERP schema for Supabase/PostgreSQL.
-- Direction: FN OS DB is the source of truth for sales, purchasing, product, and inventory data.
-- Run the whole file in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists fnos_settings (
  setting_key text primary key,
  setting_value text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists upload_batches (
  id uuid primary key default gen_random_uuid(),
  batch_type text not null,
  source_name text,
  source_file_name text,
  total_count integer default 0,
  success_count integer default 0,
  fail_count integer default 0,
  status text default 'SAVED',
  created_by text,
  created_at timestamptz not null default now()
);

alter table upload_batches add column if not exists source_name text;
alter table upload_batches add column if not exists status text default 'SAVED';

create table if not exists sales_channels (
  id uuid primary key default gen_random_uuid(),
  channel_code text not null unique,
  channel_name text not null,
  channel_type text,
  seller_id text,
  account_label text,
  customer_id uuid,
  customer_code text,
  customer_name text,
  api_enabled boolean default false,
  api_status text default 'manual',
  credential_ref text,
  seller_site_url text,
  last_synced_at timestamptz,
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text unique,
  customer_name text,
  customer_type text,
  business_no text,
  contact_name text,
  phone text,
  fax text,
  email text,
  address text,
  memo text,
  payment_terms text,
  balance_reflect boolean default true,
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- legacy import compatibility
  cust_code text unique,
  cust_name text,
  ceo_name text,
  tel text,
  mobile text,
  search_text text,
  transfer_info text,
  last_synced_at timestamptz
);

alter table sales_channels add column if not exists customer_id uuid;
alter table sales_channels add column if not exists customer_code text;
alter table sales_channels add column if not exists customer_name text;
alter table sales_channels add column if not exists seller_id text;
alter table sales_channels add column if not exists account_label text;
alter table sales_channels add column if not exists api_enabled boolean default false;
alter table sales_channels add column if not exists api_status text default 'manual';
alter table sales_channels add column if not exists credential_ref text;
alter table sales_channels add column if not exists seller_site_url text;

create table if not exists sales_channel_credentials (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references sales_channels(id) on delete cascade,
  credential_key text not null,
  credential_value_encrypted text,
  credential_hint text,
  is_secret boolean default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(channel_id, credential_key)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_channels_customer_id_fkey'
  ) then
    alter table sales_channels
      add constraint sales_channels_customer_id_fkey
      foreign key (customer_id) references customers(id) on delete set null;
  end if;
end $$;

alter table customers add column if not exists customer_code text;
alter table customers add column if not exists customer_name text;
alter table customers add column if not exists customer_type text;
alter table customers add column if not exists business_no text;
alter table customers add column if not exists contact_name text;
alter table customers add column if not exists phone text;
alter table customers add column if not exists fax text;
alter table customers add column if not exists email text;
alter table customers add column if not exists address text;
alter table customers add column if not exists memo text;
alter table customers add column if not exists payment_terms text;
alter table customers add column if not exists balance_reflect boolean default true;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  product_code text unique,
  sku text,
  product_name text,
  option_name text,
  product_type text,
  product_attribute text not null default 'plain',
  category text,
  barcode text,
  image_url text,
  standard_price double precision default 0,
  cost_price double precision default 0,
  currency text,
  status text default 'active',
  is_stock_managed boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- legacy import compatibility
  prod_cd text unique,
  prod_name text,
  size_des text,
  prod_type text,
  unit text,
  in_price double precision,
  out_price double precision,
  is_active boolean default true,
  last_synced_at timestamptz
);

alter table products add column if not exists product_code text;
alter table products add column if not exists sku text;
alter table products add column if not exists product_name text;
alter table products add column if not exists option_name text;
alter table products add column if not exists product_type text;
alter table products add column if not exists product_attribute text not null default 'plain';
alter table products add column if not exists category text;
alter table products add column if not exists image_url text;
alter table products add column if not exists standard_price double precision default 0;
alter table products add column if not exists cost_price double precision default 0;
alter table products add column if not exists currency text;
alter table products add column if not exists status text default 'active';
alter table products add column if not exists is_stock_managed boolean default true;
alter table products add column if not exists prod_cd text;
alter table products add column if not exists prod_name text;
alter table products add column if not exists size_des text;
alter table products add column if not exists prod_type text;
alter table products add column if not exists unit text;
alter table products add column if not exists in_price double precision;
alter table products add column if not exists out_price double precision;

alter table products alter column product_attribute set default 'plain';

update products
set
  product_name = regexp_replace(product_name, '\[NG[\]\}]', '[SET]', 'gi'),
  prod_name = regexp_replace(prod_name, '\[NG[\]\}]', '[SET]', 'gi')
where
  coalesce(product_name, '') ~* '\[NG[\]\}]'
  or coalesce(prod_name, '') ~* '\[NG[\]\}]';

update products
set product_attribute = case
  when upper(coalesce(product_name, '') || ' ' || coalesce(product_code, '') || ' ' || coalesce(prod_name, '') || ' ' || coalesce(prod_cd, '')) ~ '\[RG[\]\}]'
    then 'rg'
  when upper(coalesce(product_name, '') || ' ' || coalesce(product_code, '') || ' ' || coalesce(prod_name, '') || ' ' || coalesce(prod_cd, '')) ~ '\[(SET|NG)[\]\}]'
    then 'set'
  else 'plain'
end;

alter table products alter column product_attribute set not null;
alter table products drop constraint if exists products_product_attribute_check;
alter table products add constraint products_product_attribute_check check (product_attribute in ('plain', 'set', 'rg'));
create index if not exists idx_products_product_attribute on products(product_attribute);

create table if not exists product_boms (
  id uuid primary key default gen_random_uuid(),
  parent_product_id uuid references products(id) on delete cascade,
  bom_name text,
  bom_type text default 'standard',
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_bom_items (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid references product_boms(id) on delete cascade,
  component_product_id uuid references products(id) on delete set null,
  component_sku text,
  qty_per_unit double precision default 1,
  loss_rate double precision default 0,
  is_required boolean default true,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text unique,
  warehouse_name text,
  warehouse_type text,
  memo text,
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- legacy import compatibility
  wh_cd text unique,
  wh_name text,
  wh_type text,
  process_name text,
  outsource_cust_name text,
  branch_name text,
  last_synced_at timestamptz
);

alter table warehouses add column if not exists warehouse_code text;
alter table warehouses add column if not exists warehouse_name text;
alter table warehouses add column if not exists warehouse_type text;
alter table warehouses add column if not exists memo text;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references sales_channels(id) on delete set null,
  channel_name text,
  order_no text,
  bundle_order_no text,
  order_date timestamptz,
  order_status text,
  receiver_name text,
  phone1 text,
  phone2 text,
  zipcode text,
  address text,
  delivery_message text,
  raw_payload jsonb,
  collected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_name, order_no)
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  channel_product_code text,
  channel_option_code text,
  channel_product_name text,
  channel_option_name text,
  fn_product_id uuid references products(id) on delete set null,
  sku text,
  qty double precision default 0,
  sales_amount double precision default 0,
  settlement_amount double precision default 0,
  mapping_status text default 'UNMAPPED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  shipment_status text default 'pending',
  carrier_code text,
  carrier_name text,
  tracking_no text,
  shipping_export_batch_id uuid references upload_batches(id) on delete set null,
  tracking_import_batch_id uuid references upload_batches(id) on delete set null,
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  order_item_id uuid references order_items(id) on delete set null,
  sale_date text,
  channel_id uuid references sales_channels(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  sku text,
  qty double precision default 0,
  unit_price double precision default 0,
  supply_amount double precision default 0,
  vat_amount double precision default 0,
  total_amount double precision default 0,
  sale_status text default 'SAVED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- online order/import compatibility
  source_type text default 'fn_os',
  source_ref_id text,
  source_file_name text,
  upload_batch_id uuid references upload_batches(id) on delete set null,
  io_date text,
  upload_ser_no text,
  cust_code text,
  cust_name text,
  emp_cd text,
  wh_cd text,
  io_type text,
  currency text,
  exchange_rate double precision,
  prod_cd text,
  prod_name text,
  size_des text,
  price double precision default 0,
  foreign_amt double precision,
  supply_amt double precision default 0,
  vat_amt double precision,
  remarks text,
  make_flag text,
  sync_status text default 'SAVED',
  sync_message text
);

alter table sales add column if not exists sale_date text;
alter table sales add column if not exists channel_id uuid;
alter table sales add column if not exists customer_id uuid;
alter table sales add column if not exists product_id uuid;
alter table sales add column if not exists sku text;
alter table sales add column if not exists unit_price double precision default 0;
alter table sales add column if not exists supply_amount double precision default 0;
alter table sales add column if not exists vat_amount double precision default 0;
alter table sales add column if not exists total_amount double precision default 0;
alter table sales add column if not exists sale_status text default 'SAVED';
alter table sales add column if not exists source_ref_id text;
alter table sales add column if not exists sync_status text default 'SAVED';
alter table sales add column if not exists sync_message text;

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_date text,
  supplier_id uuid references customers(id) on delete set null,
  warehouse_id uuid references warehouses(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  sku text,
  qty double precision default 0,
  unit_price double precision default 0,
  supply_amount double precision default 0,
  vat_amount double precision default 0,
  total_amount double precision default 0,
  source_type text default 'fn_os',
  source_ref_id text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- online order/import compatibility
  upload_batch_id uuid references upload_batches(id) on delete set null,
  source_file_name text,
  io_date text,
  upload_ser_no text,
  cust_code text,
  cust_name text,
  wh_cd text,
  prod_cd text,
  prod_name text,
  price double precision default 0,
  supply_amt double precision default 0,
  vat_amt double precision,
  remarks text,
  sync_status text default 'SAVED',
  sync_message text
);

alter table purchases add column if not exists purchase_date text;
alter table purchases add column if not exists supplier_id uuid;
alter table purchases add column if not exists warehouse_id uuid;
alter table purchases add column if not exists product_id uuid;
alter table purchases add column if not exists sku text;
alter table purchases add column if not exists unit_price double precision default 0;
alter table purchases add column if not exists supply_amount double precision default 0;
alter table purchases add column if not exists vat_amount double precision default 0;
alter table purchases add column if not exists total_amount double precision default 0;
alter table purchases add column if not exists source_type text default 'fn_os';
alter table purchases add column if not exists source_ref_id text;
alter table purchases add column if not exists memo text;
alter table purchases add column if not exists upload_ser_no text;
alter table purchases add column if not exists sync_status text default 'SAVED';
alter table purchases add column if not exists sync_message text;

create table if not exists inventory_current (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid references warehouses(id) on delete set null,
  product_id uuid references products(id) on delete cascade,
  sku text,
  on_hand_qty double precision default 0,
  reserved_qty double precision default 0,
  available_qty double precision default 0,
  last_movement_at timestamptz,
  updated_at timestamptz not null default now(),
  -- legacy display compatibility
  wh_cd text default '',
  wh_name text,
  prod_cd text,
  prod_name text,
  size_des text,
  bal_qty double precision default 0,
  base_date text,
  synced_at timestamptz default now(),
  unique (warehouse_id, product_id, sku)
);

alter table inventory_current add column if not exists warehouse_id uuid;
alter table inventory_current add column if not exists product_id uuid;
alter table inventory_current add column if not exists sku text;
alter table inventory_current add column if not exists on_hand_qty double precision default 0;
alter table inventory_current add column if not exists reserved_qty double precision default 0;
alter table inventory_current add column if not exists available_qty double precision default 0;
alter table inventory_current add column if not exists last_movement_at timestamptz;

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_date timestamptz not null default now(),
  movement_type text not null,
  warehouse_id uuid references warehouses(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  sku text,
  qty double precision default 0,
  source_type text,
  source_ref_id text,
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date,
  warehouse_id uuid,
  product_id uuid,
  sku text,
  on_hand_qty double precision default 0,
  wh_cd text,
  wh_name text,
  prod_cd text,
  prod_name text,
  size_des text,
  bal_qty double precision default 0,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists api_sync_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references sales_channels(id) on delete set null,
  sync_type text,
  target_type text,
  target_id text,
  started_at timestamptz,
  finished_at timestamptz,
  success_count integer default 0,
  fail_count integer default 0,
  status text,
  error_message text,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ad_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  channel_id uuid references sales_channels(id) on delete set null,
  ad_platform text,
  campaign_name text,
  spend_amount double precision default 0,
  impressions double precision default 0,
  clicks double precision default 0,
  conversions double precision default 0,
  conversion_value double precision default 0,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ad_upload_batches (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  source_file_name text,
  uploaded_at timestamptz not null default now(),
  total_count integer default 0,
  success_count integer default 0,
  fail_count integer default 0,
  status text default 'SAVED',
  memo text
);

alter table ad_upload_batches add column if not exists channel text;
alter table ad_upload_batches add column if not exists source_file_name text;
alter table ad_upload_batches add column if not exists uploaded_at timestamptz default now();
alter table ad_upload_batches add column if not exists total_count integer default 0;
alter table ad_upload_batches add column if not exists success_count integer default 0;
alter table ad_upload_batches add column if not exists fail_count integer default 0;
alter table ad_upload_batches add column if not exists status text default 'SAVED';
alter table ad_upload_batches add column if not exists memo text;

create table if not exists ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  campaign_id text,
  campaign_name text,
  status text default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, campaign_id)
);

alter table ad_campaigns add column if not exists channel text;
alter table ad_campaigns add column if not exists campaign_id text;
alter table ad_campaigns add column if not exists campaign_name text;
alter table ad_campaigns add column if not exists status text default 'active';
alter table ad_campaigns add column if not exists updated_at timestamptz default now();

create table if not exists ad_reports (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references ad_upload_batches(id) on delete set null,
  channel text not null,
  report_date date,
  campaign_name text,
  ad_group_name text,
  ad_name text,
  product_code text,
  sku text,
  impressions double precision default 0,
  clicks double precision default 0,
  cost double precision default 0,
  conversions double precision default 0,
  conversion_value double precision default 0,
  ctr double precision default 0,
  cpc double precision default 0,
  cvr double precision default 0,
  roas double precision default 0,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

alter table ad_reports add column if not exists batch_id uuid;
alter table ad_reports add column if not exists channel text;
alter table ad_reports add column if not exists report_date date;
alter table ad_reports add column if not exists campaign_name text;
alter table ad_reports add column if not exists ad_group_name text;
alter table ad_reports add column if not exists ad_name text;
alter table ad_reports add column if not exists product_code text;
alter table ad_reports add column if not exists sku text;
alter table ad_reports add column if not exists impressions double precision default 0;
alter table ad_reports add column if not exists clicks double precision default 0;
alter table ad_reports add column if not exists cost double precision default 0;
alter table ad_reports add column if not exists conversions double precision default 0;
alter table ad_reports add column if not exists conversion_value double precision default 0;
alter table ad_reports add column if not exists ctr double precision default 0;
alter table ad_reports add column if not exists cpc double precision default 0;
alter table ad_reports add column if not exists cvr double precision default 0;
alter table ad_reports add column if not exists roas double precision default 0;
alter table ad_reports add column if not exists raw_payload jsonb;

create table if not exists ad_product_mappings (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  external_product_name text,
  external_product_code text,
  fn_product_id uuid references products(id) on delete set null,
  sku text,
  mapping_status text default 'UNMAPPED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ad_product_mappings add column if not exists channel text;
alter table ad_product_mappings add column if not exists external_product_name text;
alter table ad_product_mappings add column if not exists external_product_code text;
alter table ad_product_mappings add column if not exists fn_product_id uuid;
alter table ad_product_mappings add column if not exists sku text;
alter table ad_product_mappings add column if not exists mapping_status text default 'UNMAPPED';
alter table ad_product_mappings add column if not exists updated_at timestamptz default now();

create table if not exists sales_channel_product_mappings (
  id uuid primary key default gen_random_uuid(),
  channel_name text,
  channel_code text,
  mall_product_code text,
  mall_product_key text not null,
  mall_product_name text,
  fn_product_id uuid references products(id) on delete set null,
  product_code text not null,
  product_name text,
  source_type text default 'online_orders',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_name, mall_product_key)
);

alter table sales_channel_product_mappings add column if not exists channel_name text;
alter table sales_channel_product_mappings add column if not exists channel_code text;
alter table sales_channel_product_mappings add column if not exists mall_product_code text;
alter table sales_channel_product_mappings add column if not exists mall_product_key text;
alter table sales_channel_product_mappings add column if not exists mall_product_name text;
alter table sales_channel_product_mappings add column if not exists fn_product_id uuid;
alter table sales_channel_product_mappings add column if not exists product_code text;
alter table sales_channel_product_mappings add column if not exists product_name text;
alter table sales_channel_product_mappings add column if not exists source_type text default 'online_orders';
alter table sales_channel_product_mappings add column if not exists updated_at timestamptz default now();

create table if not exists expense_entries (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  customer_id uuid references customers(id) on delete set null,
  category text,
  title text,
  supply_amount double precision default 0,
  vat_amount double precision default 0,
  total_amount double precision default 0,
  payment_status text default 'unpaid',
  source_type text default 'manual',
  source_ref_id text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  category_name text not null unique,
  parent_category_id uuid references expense_categories(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_upload_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_file_name text,
  uploaded_at timestamptz not null default now(),
  total_count integer default 0,
  success_count integer default 0,
  fail_count integer default 0,
  status text default 'uploaded',
  memo text
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  source_type text default 'manual',
  vendor_name text,
  description text,
  amount double precision default 0,
  vat_amount double precision default 0,
  total_amount double precision default 0,
  payment_method text,
  category_id uuid references expense_categories(id) on delete set null,
  linked_type text,
  linked_id text,
  memo text,
  raw_payload jsonb,
  upload_batch_id uuid references expense_upload_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_records (
  id uuid primary key default gen_random_uuid(),
  payment_date date not null,
  customer_id uuid references customers(id) on delete set null,
  supplier_id uuid references customers(id) on delete set null,
  amount double precision default 0,
  payment_method text,
  memo text,
  linked_type text,
  linked_id text,
  created_at timestamptz not null default now()
);

create table if not exists customer_payables (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  base_month text not null,
  purchase_amount double precision default 0,
  paid_amount double precision default 0,
  balance_amount double precision default 0,
  due_date date,
  status text default 'open',
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_name text,
  source_type text,
  source_file_name text,
  uploaded_by text,
  target_period_from date,
  target_period_to date,
  total_count integer default 0,
  new_count integer default 0,
  duplicate_count integer default 0,
  error_count integer default 0,
  review_count integer default 0,
  status text default 'processing',
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_transaction_sources (
  id uuid primary key default gen_random_uuid(),
  source_name text not null unique,
  source_type text not null,
  institution_name text,
  account_name text,
  card_name text,
  source_profile text,
  card_limit numeric,
  cutoff_start_day integer,
  cutoff_end_day integer,
  payment_day integer,
  payment_month_offset integer default 0,
  is_active boolean default true,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_categories (
  id uuid primary key default gen_random_uuid(),
  category_large text not null,
  category_middle text not null default '',
  category_small text not null default '',
  is_active boolean default true,
  sort_order integer default 0,
  affects_profit boolean default true,
  affects_cashflow boolean default true,
  affects_card_settlement boolean default false,
  default_review_required boolean default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_large, category_middle, category_small)
);

create table if not exists accounting_category_rules (
  id uuid primary key default gen_random_uuid(),
  priority integer default 100,
  is_active boolean default true,
  source_type text,
  source_name text,
  condition_field text default 'merchant_name',
  condition_operator text default 'contains',
  keyword text,
  amount_condition text,
  direction_condition text,
  currency_condition text,
  recurring_condition text,
  merchant_condition text,
  category_id uuid references accounting_categories(id) on delete set null,
  category_large text,
  category_middle text,
  category_small text,
  auto_confirm boolean default false,
  review_required boolean default false,
  review_reason text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_accounting_rules_seed_unique
on accounting_category_rules (
  priority,
  coalesce(source_type, ''),
  coalesce(source_name, ''),
  coalesce(condition_field, ''),
  coalesce(condition_operator, ''),
  coalesce(keyword, ''),
  coalesce(amount_condition, ''),
  coalesce(direction_condition, ''),
  coalesce(currency_condition, ''),
  coalesce(category_large, ''),
  coalesce(category_middle, ''),
  coalesce(category_small, '')
);

create table if not exists accounting_transactions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references accounting_import_batches(id) on delete set null,
  source_id uuid references accounting_transaction_sources(id) on delete set null,
  source_file_name text,
  source_sheet_name text,
  source_row_no integer,
  source_type text not null,
  source_name text not null,
  transaction_date date,
  posting_date date,
  transaction_time text,
  description text,
  merchant_name text,
  debit_amount numeric default 0,
  credit_amount numeric default 0,
  amount numeric default 0,
  currency text default 'KRW',
  fx_rate numeric,
  amount_krw numeric,
  foreign_amount numeric,
  direction text default 'pending_review',
  payment_method text,
  card_name text,
  account_name text,
  approval_no text,
  existing_category_large text,
  existing_category_middle text,
  existing_category_small text,
  category_large text,
  category_middle text,
  category_small text,
  category_id uuid references accounting_categories(id) on delete set null,
  rule_id uuid references accounting_category_rules(id) on delete set null,
  confidence numeric default 0,
  review_status text default 'pending',
  review_reason text,
  affects_profit boolean default false,
  affects_cashflow boolean default true,
  affects_card_settlement boolean default false,
  is_active boolean default true,
  memo text,
  raw_json jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_review_queue (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references accounting_transactions(id) on delete cascade,
  reason text,
  status text default 'pending',
  suggested_category_id uuid references accounting_categories(id) on delete set null,
  suggested_category_large text,
  suggested_category_middle text,
  suggested_category_small text,
  resolved_category_id uuid references accounting_categories(id) on delete set null,
  resolved_by text,
  resolved_at timestamptz,
  create_rule boolean default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(transaction_id)
);

create table if not exists accounting_card_settlements (
  id uuid primary key default gen_random_uuid(),
  card_name text not null,
  settlement_start date not null,
  settlement_end date not null,
  payment_due_date date not null,
  domestic_amount numeric default 0,
  foreign_amount numeric default 0,
  currency text default 'USD',
  amount_krw numeric,
  card_limit numeric,
  usage_rate numeric,
  paid boolean default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(card_name, settlement_start, settlement_end)
);

create table if not exists accounting_fixed_costs (
  id uuid primary key default gen_random_uuid(),
  fixed_cost_name text not null unique,
  category_large text,
  category_middle text,
  category_small text,
  expected_amount numeric default 0,
  last_actual_amount numeric,
  last_actual_date date,
  base_day text not null,
  weekend_policy text default 'previous_business_day',
  holiday_policy text default 'previous_business_day',
  payment_type text not null default 'bank',
  payment_source text,
  source_account_name text,
  source_card_name text,
  affects_profit boolean default true,
  affects_cashflow boolean default true,
  loan_id uuid,
  match_keywords text[],
  is_active boolean default true,
  sort_order integer default 0,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_type text default 'business',
  bank_name text not null,
  account_holder text,
  account_number text,
  password_hint text,
  display_alias text,
  list_enabled boolean default true,
  memo text,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bank_name, account_holder, account_number)
);

create table if not exists accounting_card_accounts (
  id uuid primary key default gen_random_uuid(),
  card_type text default 'business',
  card_name text not null unique,
  card_number text,
  expiry_date date,
  cvc_hint text,
  secure_message text,
  payment_password_hint text,
  cutoff_start_day integer,
  cutoff_end_day integer,
  payment_day integer,
  card_limit numeric,
  withdrawal_account_name text,
  display_alias text,
  list_enabled boolean default true,
  physical_owner text,
  memo text,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table accounting_bank_accounts add column if not exists display_alias text;
alter table accounting_card_accounts add column if not exists display_alias text;

create table if not exists accounting_loans (
  id uuid primary key default gen_random_uuid(),
  loan_name text not null unique,
  principal_amount numeric,
  current_balance numeric,
  bank_name text,
  account_holder text,
  account_number text,
  deposit_account_number text,
  loan_start_date date,
  loan_period_months integer,
  payment_day text,
  loan_type text,
  expected_principal_amount numeric default 0,
  expected_interest_amount numeric default 0,
  expected_payment_amount numeric default 0,
  payer_name text,
  is_active boolean default true,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounting_fixed_costs_loan_id_fkey'
  ) then
    alter table accounting_fixed_costs
      add constraint accounting_fixed_costs_loan_id_fkey
      foreign key (loan_id) references accounting_loans(id) on delete set null;
  end if;
end $$;

create or replace view accounting_card_settlement_calendar as
select
  id,
  card_name,
  settlement_start as cutoff_start_date,
  settlement_end as cutoff_end_date,
  payment_due_date,
  domestic_amount,
  foreign_amount,
  currency,
  amount_krw,
  card_limit,
  usage_rate,
  paid,
  memo,
  created_at,
  updated_at
from accounting_card_settlements;

create or replace view accounting_summary as
select
  current_date as summary_date,
  count(*)::integer as transaction_count,
  coalesce(sum(case when direction = 'income' and affects_profit is true then amount_krw else 0 end), 0) as income_amount,
  coalesce(sum(case when direction = 'expense' and affects_profit is true then amount_krw else 0 end), 0) as expense_amount,
  coalesce(sum(case when direction = 'income' and affects_profit is true then amount_krw else 0 end), 0)
    - coalesce(sum(case when direction = 'expense' and affects_profit is true then amount_krw else 0 end), 0) as net_profit,
  coalesce(sum(case when source_type = 'bank' then credit_amount else 0 end), 0)
    - coalesce(sum(case when source_type = 'bank' then debit_amount else 0 end), 0) as cashflow_amount,
  count(*) filter (where review_status = 'pending')::integer as review_count
from accounting_transactions
where is_active is true;

insert into accounting_transaction_sources (source_name, source_type, institution_name, account_name, card_name, source_profile, card_limit, cutoff_start_day, cutoff_end_day, payment_day, payment_month_offset, memo)
values
  ('가온글로벌카드', 'card', 'KB국민카드', '가온글로벌카드', '가온글로벌카드', 'gaon_global_card', 20000000, 22, 21, 5, 1, '매월 22일~다음달 21일 사용, 다음달 5일 출금'),
  ('국민기업카드', 'card', 'KB국민카드', '국민기업카드', '국민기업카드', 'kb_business_card', 10000000, 6, 5, 20, 0, '매월 6일~다음달 5일 사용, 마감달 20일 출금, 한도 10,000,000원'),
  ('국민은행 통장', 'bank', 'KB국민은행', '국민은행 사업자통장', null, 'kb_bank_account', null, null, null, null, null, '통장 입출금은 실제 현금흐름'),
  ('기업은행 통장', 'bank', 'IBK기업은행', '기업은행 사업자통장', null, 'ibk_bank_account', null, null, null, null, null, '통장 입출금은 실제 현금흐름')
on conflict (source_name) do update set
  source_type = excluded.source_type,
  institution_name = excluded.institution_name,
  account_name = excluded.account_name,
  card_name = excluded.card_name,
  source_profile = excluded.source_profile,
  card_limit = excluded.card_limit,
  cutoff_start_day = excluded.cutoff_start_day,
  cutoff_end_day = excluded.cutoff_end_day,
  payment_day = excluded.payment_day,
  payment_month_offset = excluded.payment_month_offset,
  memo = excluded.memo,
  updated_at = now();

with desired_accounting_categories(category_large, category_middle) as (
  values
    ('판매 정산금', '스마트스토어'),
    ('판매 정산금', '쿠팡'),
    ('판매 정산금', '11번가'),
    ('판매 정산금', '지마켓'),
    ('판매 정산금', '옥션'),
    ('판매 정산금', '롯데온'),
    ('판매 정산금', '토스'),
    ('판매 정산금', '신세계'),
    ('판매 정산금', '오늘의집'),
    ('판매 정산금', '현대이지웰'),
    ('판매 정산금', '카카오'),
    ('판매 정산금', '기타 판매'),
    ('금융비용', '대출 입금'),
    ('금융비용', '환급금'),
    ('금융비용', '거래처 반환'),
    ('금융비용', '대출 원리금'),
    ('금융비용', '보증료/수수료'),
    ('기타 입금', '사비입금'),
    ('기타 입금', '내부이체'),
    ('기타 입금', '미확인 입금'),
    ('기타 입금', '검토필요'),
    ('거래처 결제', '아주레포츠'),
    ('거래처 결제', '제이비컴퍼니'),
    ('거래처 결제', '나스포'),
    ('거래처 결제', '케이모아'),
    ('거래처 결제', '믹스스포츠'),
    ('거래처 결제', '야중사'),
    ('거래처 결제', '스타스포츠'),
    ('거래처 결제', '기타 구매'),
    ('거래처 결제', '해외 거래처'),
    ('마케팅·광고', '네이버 광고'),
    ('마케팅·광고', '메타 광고'),
    ('마케팅·광고', '체험단/협찬'),
    ('업무 비용', '포장재/박스'),
    ('업무 비용', '프로그램/구독료'),
    ('업무 비용', '세무/기장'),
    ('업무 비용', '통신비'),
    ('업무 비용', '사무용품'),
    ('업무 비용', '보안/관리'),
    ('업무 비용', '수입/통관'),
    ('업무 비용', 'CJ대한통운'),
    ('업무 비용', 'N배송'),
    ('업무 비용', '해외배송비'),
    ('업무 비용', '기타 화물비'),
    ('유지비', '임대료'),
    ('유지비', '전기요금'),
    ('유지비', '차량 렌트비'),
    ('유지비', '주차요금'),
    ('유지비', '주유비'),
    ('유지비', '하이패스'),
    ('유지비', '화재보험'),
    ('인건비', '급여'),
    ('카드대금', '가온글로벌카드'),
    ('카드대금', '국민기업카드'),
    ('복리후생비', '회식 식대'),
    ('복리후생비', '4대보험'),
    ('복리후생비', '직원 교통비'),
    ('기타 출금', '사비출금'),
    ('기타 출금', '내부이체'),
    ('기타 출금', '미확인 출금'),
    ('기타 출금', '검토필요')
)
update accounting_categories category
set is_active = false, updated_at = now()
where not exists (
  select 1
  from desired_accounting_categories desired
  where desired.category_large = category.category_large
    and desired.category_middle = category.category_middle
    and coalesce(category.category_small, '') = ''
);

insert into accounting_categories (category_large, category_middle, category_small, is_active, affects_profit, affects_cashflow, affects_card_settlement, default_review_required, sort_order, memo)
values
  ('판매 정산금', '스마트스토어', '', true, true, true, false, false, 10, '스마트스토어 정산 입금'),
  ('판매 정산금', '쿠팡', '', true, true, true, false, false, 20, '쿠팡 정산 입금'),
  ('판매 정산금', '11번가', '', true, true, true, false, false, 30, '11번가 정산 입금'),
  ('판매 정산금', '지마켓', '', true, true, true, false, false, 40, '지마켓 정산 입금'),
  ('판매 정산금', '옥션', '', true, true, true, false, false, 50, '옥션 정산 입금'),
  ('판매 정산금', '롯데온', '', true, true, true, false, false, 60, '롯데온 정산 입금'),
  ('판매 정산금', '토스', '', true, true, true, false, false, 70, '토스 정산 입금'),
  ('판매 정산금', '신세계', '', true, true, true, false, false, 80, '신세계 정산 입금'),
  ('판매 정산금', '오늘의집', '', true, true, true, false, false, 90, '오늘의집 정산 입금'),
  ('판매 정산금', '현대이지웰', '', true, true, true, false, false, 100, '현대이지웰 정산 입금'),
  ('판매 정산금', '카카오', '', true, true, true, false, false, 110, '카카오 정산 입금'),
  ('판매 정산금', '기타 판매', '', true, true, true, false, true, 120, '기타 판매 정산 입금'),
  ('금융비용', '대출 입금', '', true, false, true, false, false, 200, '대출 실행 입금은 손익 제외'),
  ('금융비용', '환급금', '', true, true, true, false, false, 210, '환급 입금'),
  ('금융비용', '거래처 반환', '', true, true, true, false, false, 220, '거래처 반환 입금'),
  ('금융비용', '대출 원리금', '', true, true, true, false, false, 230, '원금/이자 미분리 시 전체 표시, 분리 가능 시 이자만 손익 반영'),
  ('금융비용', '보증료/수수료', '', true, true, true, false, false, 240, '보증료 및 금융 수수료'),
  ('기타 입금', '사비입금', '', true, false, true, false, false, 300, '대표자/개인자금 입금은 손익 제외'),
  ('기타 입금', '내부이체', '', true, false, true, false, false, 310, '계좌 간 내부 이체 입금'),
  ('기타 입금', '미확인 입금', '', true, false, true, false, true, 320, '확인 전 입금'),
  ('기타 입금', '검토필요', '', true, false, true, false, true, 330, '입금 검토필요'),
  ('거래처 결제', '아주레포츠', '', true, true, true, false, false, 400, '거래처 결제'),
  ('거래처 결제', '제이비컴퍼니', '', true, true, true, false, false, 410, '거래처 결제'),
  ('거래처 결제', '나스포', '', true, true, true, false, false, 420, '거래처 결제'),
  ('거래처 결제', '케이모아', '', true, true, true, false, false, 430, '거래처 결제'),
  ('거래처 결제', '믹스스포츠', '', true, true, true, false, false, 440, '거래처 결제'),
  ('거래처 결제', '야중사', '', true, true, true, false, false, 450, '거래처 결제'),
  ('거래처 결제', '스타스포츠', '', true, true, true, false, false, 460, '거래처 결제'),
  ('거래처 결제', '기타 구매', '', true, true, true, false, false, 470, '기타 거래처 구매'),
  ('거래처 결제', '해외 거래처', '', true, true, true, false, false, 480, '해외 거래처 결제'),
  ('마케팅·광고', '네이버 광고', '', true, true, true, false, false, 500, '네이버 광고비'),
  ('마케팅·광고', '메타 광고', '', true, true, true, false, false, 510, '메타 광고비'),
  ('마케팅·광고', '체험단/협찬', '', true, true, true, false, false, 520, '체험단 및 협찬'),
  ('업무 비용', '포장재/박스', '', true, true, true, false, false, 600, '포장재 및 박스'),
  ('업무 비용', '프로그램/구독료', '', true, true, true, false, false, 610, '프로그램, 구독, 호스팅'),
  ('업무 비용', '세무/기장', '', true, true, true, false, false, 620, '세무 및 기장'),
  ('업무 비용', '통신비', '', true, true, true, false, false, 630, '통신비'),
  ('업무 비용', '사무용품', '', true, true, true, false, false, 640, '사무용품'),
  ('업무 비용', '보안/관리', '', true, true, true, false, false, 650, '보안 및 관리'),
  ('업무 비용', '수입/통관', '', true, true, true, false, false, 660, '수입 및 통관'),
  ('업무 비용', 'CJ대한통운', '', true, true, true, false, false, 670, 'CJ대한통운 배송비'),
  ('업무 비용', 'N배송', '', true, true, true, false, false, 680, 'N배송'),
  ('업무 비용', '해외배송비', '', true, true, true, false, false, 690, '해외 배송비'),
  ('업무 비용', '기타 화물비', '', true, true, true, false, false, 700, '기타 화물비'),
  ('유지비', '임대료', '', true, true, true, false, false, 800, '임대료'),
  ('유지비', '전기요금', '', true, true, true, false, false, 810, '전기요금'),
  ('유지비', '차량 렌트비', '', true, true, true, false, false, 820, '차량 렌트비'),
  ('유지비', '주차요금', '', true, true, true, false, false, 830, '주차요금'),
  ('유지비', '주유비', '', true, true, true, false, false, 840, '주유비'),
  ('유지비', '하이패스', '', true, true, true, false, false, 850, '하이패스'),
  ('유지비', '화재보험', '', true, true, true, false, false, 860, '화재보험'),
  ('인건비', '급여', '', true, true, true, false, false, 900, '재직자 급여 합산'),
  ('카드대금', '가온글로벌카드', '', true, false, true, false, false, 1000, '카드대금 출금은 손익 제외'),
  ('카드대금', '국민기업카드', '', true, false, true, false, false, 1010, '카드대금 출금은 손익 제외'),
  ('복리후생비', '회식 식대', '', true, true, true, false, false, 1100, '회식 식대'),
  ('복리후생비', '4대보험', '', true, true, true, false, false, 1110, '4대보험'),
  ('복리후생비', '직원 교통비', '', true, true, true, false, false, 1120, '직원 교통비'),
  ('기타 출금', '사비출금', '', true, false, true, false, false, 1200, '대표자/개인자금 출금은 손익 제외'),
  ('기타 출금', '내부이체', '', true, false, true, false, false, 1210, '계좌 간 내부 이체 출금'),
  ('기타 출금', '미확인 출금', '', true, false, true, false, true, 1220, '확인 전 출금'),
  ('기타 출금', '검토필요', '', true, false, true, false, true, 1230, 'KCP/네이버/일반명 거래 검토필요')
on conflict (category_large, category_middle, category_small) do update set
  is_active = true,
  affects_profit = excluded.affects_profit,
  affects_cashflow = excluded.affects_cashflow,
  affects_card_settlement = excluded.affects_card_settlement,
  default_review_required = excluded.default_review_required,
  sort_order = excluded.sort_order,
  memo = excluded.memo,
  updated_at = now();

delete from accounting_category_rules
where priority between 10 and 130
  and source_type in ('card', 'bank');

insert into accounting_category_rules (priority, source_type, condition_field, condition_operator, keyword, amount_condition, category_large, category_middle, category_small, auto_confirm, review_required, review_reason, memo)
values
  (10, 'card', 'merchant_name', 'starts_with', 'FACEBK', null, '마케팅·광고', '메타 광고', '', true, false, null, 'FACEBK 계열 메타 광고'),
  (20, 'card', 'merchant_name', 'equals', '네이버페이_비즈월렛', null, '마케팅·광고', '네이버 광고', '', true, false, null, '네이버 비즈월렛'),
  (30, 'card', 'merchant_name', 'contains', '네이버파이낸셜', null, '기타 출금', '검토필요', '', false, true, '네이버확인', '카드 네이버파이낸셜은 제품 구매/광고/일반구매 혼재'),
  (50, 'card', 'merchant_name', 'contains', 'KCP(자동과금)', '300000', '마케팅·광고', '네이버 광고', '', true, false, null, '국민카드 KCP 자동과금 30만원 네이버 광고비'),
  (60, 'card', 'merchant_name', 'contains', 'KCP(결제대행)', null, '기타 출금', '검토필요', '', false, true, 'KCP확인', 'KCP 결제대행은 기본 검토'),
  (61, 'card', 'merchant_amount', 'contains', 'KCP(결제대행)', '44000', '업무 비용', '프로그램/구독료', '', true, false, null, '반복 확인된 프로그램/구독료 금액'),
  (62, 'card', 'merchant_amount', 'contains', 'KCP(결제대행)', '95040', '업무 비용', '프로그램/구독료', '', true, false, null, '반복 확인된 호스팅/구독료 금액'),
  (70, 'card', 'merchant_name', 'contains', '인터넷상거래_4', null, '기타 출금', '미확인 출금', '', false, true, '일반명거래', '일반명 거래는 검토'),
  (80, 'card', 'merchant_name', 'contains', '자동결제_1', null, '기타 출금', '미확인 출금', '', false, true, '일반명거래', '자동결제 일반명 거래'),
  (90, 'card', 'merchant_name', 'contains', '1688.com', null, '거래처 결제', '해외 거래처', '', true, false, null, '1688 제품 매입'),
  (100, 'bank', 'merchant_name', 'contains', '네이버파이낸셜주식회', null, '판매 정산금', '스마트스토어', '', true, false, null, '통장 입금 네이버 정산'),
  (110, 'bank', 'merchant_name', 'contains', '쿠팡', null, '판매 정산금', '쿠팡', '', true, false, null, '쿠팡 정산 입금'),
  (120, 'bank', 'merchant_name', 'contains', 'KB카드출금', null, '카드대금', '가온글로벌카드', '', true, false, null, '카드대금 출금은 손익 제외, 날짜 기준 카드명 추정'),
  (130, 'bank', 'merchant_name', 'contains', '이체', null, '기타 출금', '내부이체', '', false, true, '자금이동 확인', '계좌 이동성 거래')
on conflict do nothing;

insert into expense_categories (category_name)
values
  ('광고비'),
  ('물류비'),
  ('택배비'),
  ('수입비용'),
  ('관세'),
  ('부가세'),
  ('통관수수료'),
  ('샘플비'),
  ('포장비'),
  ('상품매입'),
  ('외주비'),
  ('소모품'),
  ('인건비'),
  ('사무실비'),
  ('기타')
on conflict (category_name) do nothing;

create table if not exists import_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references customers(id) on delete set null,
  order_no text,
  order_date date,
  expected_inbound_date date,
  status text default 'planned',
  total_amount double precision default 0,
  currency text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists import_product_sku_links (
  id uuid primary key default gen_random_uuid(),
  import_product_id bigint not null,
  product_id uuid references products(id) on delete cascade,
  sku text,
  import_option_key text,
  import_option_name text,
  match_group_label text,
  variant_label text,
  default_ratio double precision default 1,
  default_qty double precision default 0,
  is_primary boolean default false,
  sort_order integer default 0,
  is_active boolean default true,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_product_id, product_id)
);

alter table import_product_sku_links add column if not exists import_product_id bigint;
alter table import_product_sku_links add column if not exists product_id uuid;
alter table import_product_sku_links add column if not exists sku text;
alter table import_product_sku_links add column if not exists import_option_key text;
alter table import_product_sku_links add column if not exists import_option_name text;
alter table import_product_sku_links add column if not exists match_group_label text;
alter table import_product_sku_links add column if not exists variant_label text;
alter table import_product_sku_links add column if not exists default_ratio double precision default 1;
alter table import_product_sku_links add column if not exists default_qty double precision default 0;
alter table import_product_sku_links add column if not exists is_primary boolean default false;
alter table import_product_sku_links add column if not exists sort_order integer default 0;
alter table import_product_sku_links add column if not exists is_active boolean default true;
alter table import_product_sku_links add column if not exists memo text;
alter table import_product_sku_links add column if not exists updated_at timestamptz default now();

create table if not exists import_purchase_sku_allocations (
  id uuid primary key default gen_random_uuid(),
  import_order_id bigint not null,
  import_order_item_id bigint,
  import_product_id bigint not null,
  import_option_key text,
  import_option_name text,
  product_id uuid references products(id) on delete set null,
  sku text,
  allocated_qty double precision default 0,
  unit_cost double precision default 0,
  warehouse_id uuid references warehouses(id) on delete set null,
  purchase_id uuid references purchases(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table import_purchase_sku_allocations add column if not exists import_order_id bigint;
alter table import_purchase_sku_allocations add column if not exists import_order_item_id bigint;
alter table import_purchase_sku_allocations add column if not exists import_product_id bigint;
alter table import_purchase_sku_allocations add column if not exists import_option_key text;
alter table import_purchase_sku_allocations add column if not exists import_option_name text;
alter table import_purchase_sku_allocations add column if not exists product_id uuid;
alter table import_purchase_sku_allocations add column if not exists sku text;
alter table import_purchase_sku_allocations add column if not exists allocated_qty double precision default 0;
alter table import_purchase_sku_allocations add column if not exists unit_cost double precision default 0;
alter table import_purchase_sku_allocations add column if not exists warehouse_id uuid;
alter table import_purchase_sku_allocations add column if not exists purchase_id uuid;
alter table import_purchase_sku_allocations add column if not exists updated_at timestamptz default now();

create table if not exists archive_items (
  id uuid primary key default gen_random_uuid(),
  archive_type text,
  title text not null,
  url text,
  normalized_url text,
  url_hash text,
  source_type text,
  content_type text default 'link',
  source_ref_id text,
  summary text,
  original_url text,
  description text,
  preview_image_url text,
  preview_status text default 'pending',
  preview_error text,
  preview_generated_at timestamptz,
  thumbnail_url text,
  file_url text,
  status text default 'active',
  is_favorite boolean default false,
  category_id uuid,
  reference_type text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table archive_items add column if not exists url text;
alter table archive_items add column if not exists normalized_url text;
alter table archive_items add column if not exists url_hash text;
alter table archive_items add column if not exists content_type text default 'link';
alter table archive_items add column if not exists summary text;
alter table archive_items add column if not exists original_url text;
alter table archive_items add column if not exists description text;
alter table archive_items add column if not exists preview_image_url text;
alter table archive_items add column if not exists preview_status text default 'pending';
alter table archive_items add column if not exists preview_error text;
alter table archive_items add column if not exists preview_generated_at timestamptz;
alter table archive_items add column if not exists thumbnail_url text;
alter table archive_items add column if not exists status text default 'active';
alter table archive_items add column if not exists is_favorite boolean default false;
alter table archive_items add column if not exists category_id uuid;
alter table archive_items add column if not exists reference_type text;

create table if not exists archive_categories (
  id uuid primary key default gen_random_uuid(),
  category_name text not null unique,
  parent_category_id uuid references archive_categories(id) on delete set null,
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'archive_items_category_id_fkey'
  ) then
    alter table archive_items
      add constraint archive_items_category_id_fkey
      foreign key (category_id) references archive_categories(id) on delete set null;
  end if;
end $$;

create table if not exists archive_tags (
  id uuid primary key default gen_random_uuid(),
  tag_name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists archive_item_tags (
  id uuid primary key default gen_random_uuid(),
  archive_item_id uuid not null references archive_items(id) on delete cascade,
  tag_id uuid not null references archive_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (archive_item_id, tag_id)
);

create table if not exists archive_links (
  id uuid primary key default gen_random_uuid(),
  archive_item_id uuid not null references archive_items(id) on delete cascade,
  linked_type text not null,
  linked_id text not null,
  created_at timestamptz not null default now(),
  unique (archive_item_id, linked_type, linked_id)
);

create table if not exists ai_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  period_from date,
  period_to date,
  source text default 'fnos-ai-snapshot',
  generated_at timestamptz not null default now(),
  payload jsonb not null,
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ai_snapshots add column if not exists snapshot_key text;
alter table ai_snapshots add column if not exists period_from date;
alter table ai_snapshots add column if not exists period_to date;
alter table ai_snapshots add column if not exists source text default 'fnos-ai-snapshot';
alter table ai_snapshots add column if not exists generated_at timestamptz default now();
alter table ai_snapshots add column if not exists payload jsonb;
alter table ai_snapshots add column if not exists summary jsonb;

create table if not exists automation_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  title text not null,
  status text not null default 'queued',
  requested_by text not null default 'manual',
  assigned_agent text,
  source text not null default 'manual',
  trigger_type text,
  requested_text text,
  input_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  error_message text,
  log_text text,
  result_file_url text,
  screenshot_url text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint automation_jobs_type_check check (job_type in (
    'collect_smartstore_orders',
    'collect_coupang_orders',
    'online_order_status_update',
    'generate_invoice_file',
    'download_ads_report',
    'download_accounting_report',
    'create_detail_page_draft',
    'ads_collect',
    'ads_analyze',
    'coupang_report_reservation',
    'orders_collect',
    'invoice_prepare',
    'fnos_report',
    'content_draft',
    'accounting_collect',
    'sourcing_research'
  )),
  constraint automation_jobs_status_check check (status in (
    'queued',
    'running',
    'success',
    'failed',
    'waiting_approval',
    'cancelled'
  ))
);

alter table automation_jobs add column if not exists job_type text;
alter table automation_jobs add column if not exists title text;
alter table automation_jobs add column if not exists status text default 'queued';
alter table automation_jobs add column if not exists requested_by text default 'manual';
alter table automation_jobs add column if not exists assigned_agent text;
alter table automation_jobs add column if not exists source text default 'manual';
alter table automation_jobs add column if not exists trigger_type text;
alter table automation_jobs add column if not exists requested_text text;
alter table automation_jobs add column if not exists input_json jsonb default '{}'::jsonb;
alter table automation_jobs add column if not exists result_json jsonb default '{}'::jsonb;
alter table automation_jobs add column if not exists error_message text;
alter table automation_jobs add column if not exists log_text text;
alter table automation_jobs add column if not exists result_file_url text;
alter table automation_jobs add column if not exists screenshot_url text;
alter table automation_jobs add column if not exists created_at timestamptz default now();
alter table automation_jobs add column if not exists started_at timestamptz;
alter table automation_jobs add column if not exists finished_at timestamptz;

alter table automation_jobs drop constraint if exists automation_jobs_type_check;
alter table automation_jobs add constraint automation_jobs_type_check check (job_type in (
  'collect_smartstore_orders',
  'collect_coupang_orders',
  'online_order_status_update',
  'generate_invoice_file',
  'download_ads_report',
  'download_accounting_report',
  'create_detail_page_draft',
  'ads_collect',
  'ads_analyze',
  'coupang_report_reservation',
  'orders_collect',
  'invoice_prepare',
  'fnos_report',
  'content_draft',
  'accounting_collect',
  'sourcing_research'
));

insert into archive_categories (category_name, sort_order) values
  ('영어', 1),
  ('포토샵', 2),
  ('일러스트', 3),
  ('AI', 4),
  ('소싱', 10),
  ('광고소재', 20),
  ('상세페이지', 30),
  ('업무방법', 40),
  ('경쟁사', 50),
  ('디자인참고', 60),
  ('캠핑', 110),
  ('요리', 120),
  ('살림', 130),
  ('육아', 140),
  ('여행', 150),
  ('맛집', 155),
  ('동기부여', 160),
  ('유머', 170),
  ('기타', 180),
  ('패키지', 190),
  ('공급처', 200),
  ('SNS콘텐츠', 210),
  ('상품아이디어', 220)
on conflict (category_name) do nothing;

create index if not exists idx_sales_io_date on sales(io_date);
create index if not exists idx_sales_prod_cd on sales(prod_cd);
create index if not exists idx_sales_sku on sales(sku);
create index if not exists idx_sales_batch on sales(upload_batch_id);
create unique index if not exists idx_sales_source_ref_unique on sales(source_ref_id) where source_ref_id is not null and source_ref_id <> '';
create index if not exists idx_sales_channels_customer_id on sales_channels(customer_id);
create index if not exists idx_sales_channels_customer_code on sales_channels(customer_code);
create index if not exists idx_sales_channel_credentials_channel on sales_channel_credentials(channel_id);
create unique index if not exists idx_sales_channel_credentials_key on sales_channel_credentials(channel_id, credential_key);
create index if not exists idx_purchases_io_date on purchases(io_date);
create index if not exists idx_purchases_prod_cd on purchases(prod_cd);
create unique index if not exists idx_purchases_source_ref_unique on purchases(source_ref_id) where source_ref_id is not null and source_ref_id <> '';
create index if not exists idx_products_code on products(product_code);
create index if not exists idx_products_name on products(product_name);
create index if not exists idx_products_legacy_code on products(prod_cd);
create index if not exists idx_customers_name on customers(customer_name);
create index if not exists idx_customers_legacy_name on customers(cust_name);
create index if not exists idx_warehouses_name on warehouses(warehouse_name);
create index if not exists idx_inventory_current_sku on inventory_current(sku);
create index if not exists idx_inventory_current_prod on inventory_current(product_id);
create index if not exists idx_inventory_current_synced_at on inventory_current(updated_at desc);
create index if not exists idx_inventory_movements_sku on inventory_movements(sku);
create index if not exists idx_inventory_prod_date on inventory_snapshots(product_id, snapshot_date);
create index if not exists idx_inventory_synced_at on inventory_snapshots(synced_at desc);
create unique index if not exists idx_ai_snapshots_key on ai_snapshots(snapshot_key);
create index if not exists idx_ai_snapshots_period on ai_snapshots(period_from desc, period_to desc);
create index if not exists idx_ai_snapshots_generated_at on ai_snapshots(generated_at desc);
create index if not exists idx_automation_jobs_status_created on automation_jobs(status, created_at asc);
create index if not exists idx_automation_jobs_type_created on automation_jobs(job_type, created_at desc);
create index if not exists idx_automation_jobs_created on automation_jobs(created_at desc);
create index if not exists idx_automation_jobs_agent_status_created on automation_jobs(assigned_agent, status, created_at asc);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  agent text not null,
  task_type text not null,
  title text not null,
  status text not null default 'running',
  requested_by text default 'hermes',
  summary text,
  input_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  error_message text,
  result_file_url text,
  screenshot_url text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_runs_status_check check (status in ('running', 'success', 'failed'))
);

alter table automation_runs add column if not exists source text;
alter table automation_runs add column if not exists agent text;
alter table automation_runs add column if not exists task_type text;
alter table automation_runs add column if not exists title text;
alter table automation_runs add column if not exists status text default 'running';
alter table automation_runs add column if not exists requested_by text default 'hermes';
alter table automation_runs add column if not exists summary text;
alter table automation_runs add column if not exists input_json jsonb default '{}'::jsonb;
alter table automation_runs add column if not exists result_json jsonb default '{}'::jsonb;
alter table automation_runs add column if not exists error_message text;
alter table automation_runs add column if not exists result_file_url text;
alter table automation_runs add column if not exists screenshot_url text;
alter table automation_runs add column if not exists started_at timestamptz default now();
alter table automation_runs add column if not exists finished_at timestamptz;
alter table automation_runs add column if not exists created_at timestamptz default now();
alter table automation_runs add column if not exists updated_at timestamptz default now();
alter table automation_runs drop constraint if exists automation_runs_status_check;
alter table automation_runs add constraint automation_runs_status_check check (status in ('running', 'success', 'failed'));
create index if not exists idx_automation_runs_started on automation_runs(started_at desc);
create index if not exists idx_automation_runs_agent_status_started on automation_runs(agent, status, started_at desc);
create index if not exists idx_automation_runs_task_started on automation_runs(task_type, started_at desc);

create table if not exists automation_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references automation_runs(id) on delete cascade,
  job_id uuid references automation_jobs(id) on delete cascade,
  agent_name text,
  level text not null default 'info',
  event_type text,
  message text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table automation_logs add column if not exists run_id uuid;
alter table automation_logs add column if not exists job_id uuid;
alter table automation_logs add column if not exists agent_name text;
alter table automation_logs add column if not exists level text default 'info';
alter table automation_logs add column if not exists event_type text;
alter table automation_logs add column if not exists message text;
alter table automation_logs add column if not exists payload jsonb default '{}'::jsonb;
alter table automation_logs add column if not exists created_at timestamptz default now();
create index if not exists idx_automation_logs_run_created on automation_logs(run_id, created_at asc);
create index if not exists idx_automation_logs_job_created on automation_logs(job_id, created_at asc);
create index if not exists idx_automation_logs_created on automation_logs(created_at desc);

create table if not exists automation_agent_heartbeats (
  agent_name text primary key,
  status text,
  current_job_id uuid,
  last_seen_at timestamptz default now(),
  updated_at timestamptz not null default now()
);

alter table automation_agent_heartbeats add column if not exists agent_name text;
alter table automation_agent_heartbeats add column if not exists status text;
alter table automation_agent_heartbeats add column if not exists current_job_id uuid;
alter table automation_agent_heartbeats add column if not exists last_seen_at timestamptz default now();
alter table automation_agent_heartbeats add column if not exists updated_at timestamptz default now();
create index if not exists idx_bom_parent on product_boms(parent_product_id);
create index if not exists idx_bom_items_bom on product_bom_items(bom_id);
create index if not exists idx_orders_date on orders(order_date desc);
create index if not exists idx_order_items_mapping on order_items(mapping_status);
insert into accounting_loans (loan_name, principal_amount, bank_name, account_holder, account_number, payment_day, loan_type, expected_payment_amount, payer_name, memo)
values
  ('재욱 교보 무배당베스트라이프종합보험약관(550만원)', 5500000, '교보', '김재욱', '3333-22-4830411(294502-04-042630)', '말일', '원금상환', 37369, '김재욱', '월말 김재욱 출금액에서 대납되는 대출/보험 항목'),
  ('재욱 한화 100세 멀티(1410만원)', 14100000, '한화', '김재욱', '3333-22-4830411(294502-04-042630)', '말일', '원금상환', 62869, '김재욱', '월말 김재욱 출금액에서 대납되는 대출/보험 항목'),
  ('재욱 카카오개인사업자대출상환(5500만원)', 55000000, '카카오뱅크', '김재욱', '3333-22-4830411', '말일', '원금상환', 1339347, '김재욱', '월말 김재욱 출금액에서 대납되는 대출 항목'),
  ('재욱 KB 소상공인 신용대출(3000만원)', 30000000, 'KB국민은행', '김재욱', '3333-22-4830411(294502-04-042630)', '말일', '원금상환', 913465, '김재욱', '월말 김재욱 출금액에서 대납되는 대출 항목'),
  ('재욱 KB 소상공인 신용대출(580만원)', 5800000, 'KB국민은행', '김재욱', '3333-22-4830411(294502-04-042630)', '말일', '원금상환', 28394, '김재욱', '월말 김재욱 출금액에서 대납되는 대출 항목'),
  ('재욱 교보생명 신용대출(2440만원)', 24400000, '교보생명', '김재욱', '3333-22-4830411(294502-04-042630)', '말일', '원금상환', 314460, '김재욱', '월말 김재욱 출금액에서 대납되는 대출 항목'),
  ('재민 쏠편한 직장인 대출(2100만원)', 21000000, '신한은행', '재민', null, '3', '원금상환', 103981, '재민', '기준일 3일'),
  ('재민 현대 약관 대출(600만원)', 6000000, '현대', '재민', null, '3', '원금상환', 17835, '재민', '기준일 3일'),
  ('재민 모친대출(12000만원)', 120000000, null, '재민', '1105-11616-444(신한)', '말일', '원금상환', 458500, '재민', '기준일 말일'),
  ('재민 경남은행(5000만원)', 50000000, '경남은행', '재민', '카카오 3333-08978-7477', '7', '원금상환', 235000, '재민', '기준일 7일'),
  ('재민 JB자동차 담보대출 플러스(2800만원)', 28000000, 'JB전북은행', '재민', '전북 1021-02-9728410', '15', '원금상환', 900000, '재민', '기준일 15일')
on conflict (loan_name) do update set
  principal_amount = excluded.principal_amount,
  bank_name = excluded.bank_name,
  account_holder = excluded.account_holder,
  account_number = excluded.account_number,
  payment_day = excluded.payment_day,
  loan_type = excluded.loan_type,
  expected_payment_amount = excluded.expected_payment_amount,
  payer_name = excluded.payer_name,
  memo = excluded.memo,
  updated_at = now();

insert into accounting_fixed_costs (fixed_cost_name, category_large, category_middle, category_small, expected_amount, base_day, payment_type, payment_source, source_account_name, source_card_name, affects_profit, affects_cashflow, match_keywords, sort_order, memo)
values
  ('[카드 출금] 가온글로벌카드', '카드대금', '가온글로벌카드', '', 0, '5', 'bank', '국민은행', '국민은행', null, false, true, array['KB카드출금'], 10, 'KB카드출금 + 매월 5일 전후 2일. 손익 비용 제외, 현금흐름만 반영'),
  ('[카드 출금] 국민기업카드', '카드대금', '국민기업카드', '', 0, '20', 'bank', '국민은행', '국민은행', null, false, true, array['KB카드출금'], 20, 'KB카드출금 + 매월 20일 전후 2일. 카드 한도 10,000,000원'),
  ('[급여] 직원 급여합계', '인건비', '급여', '', 0, '말일', 'bank', '기업은행', '기업은행', null, true, true, array['급여'], 100, '기초관리 인사관리 재직자 급여 항목 합산값으로 표시'),
  ('[임대료] 최석윤(아진가)', '유지비', '임대료', '', 2205000, '말일', 'bank', '국민은행', '국민은행', null, true, true, array['최석윤','아진가'], 110, '노출 기준은 말일, 실제 비용은 통장 출금 매칭값 사용'),
  ('[4대보험]', '복리후생비', '4대보험', '', 1372310, '10', 'bank', '국민은행', '국민은행', null, true, true, array['4대보험'], 120, '매월 10일 기준'),
  ('[관리비] 조은세무법인', '업무 비용', '세무/기장', '', 110000, '5', 'bank', null, null, null, true, true, array['조은세무법인'], 200, null),
  ('[관리비] KT텔레캅', '업무 비용', '보안/관리', '', 71500, '20', 'bank', null, null, null, true, true, array['KT텔레캅'], 210, null),
  ('[관리비] 한전', '유지비', '전기요금', '', 250000, '20', 'bank', '국민은행', '국민은행', null, true, true, array['한전'], 220, null),
  ('[보험] 현대해상 화재보험', '유지비', '화재보험', '', 79000, '10', 'bank', null, null, null, true, true, array['현대해상'], 230, null),
  ('[차량/주차] 회사차 주차요금', '유지비', '주차요금', '', 20000, '말일', 'bank', '국민은행', '국민은행', null, true, true, array['회사차 주차요금'], 240, '김재욱 월말 출금액에 함께 포함되는 고정 비용'),
  ('[대출] 재욱 월말 대납 합계', '금융비용', '대출 원리금', '', 2750491, '말일', 'bank', '국민은행', '국민은행', null, true, true, array['김재욱'], 300, '김재욱 월말 출금액에서 대출 보험 대납 실제값으로 관리. 원금/이자 분리 전에는 전체 표시'),
  ('[대출] 재민 쏠편한 직장인 대출', '금융비용', '대출 원리금', '', 103981, '3', 'bank', null, null, null, true, true, array['쏠편한'], 310, null),
  ('[대출] 재민 현대 약관 대출', '금융비용', '대출 원리금', '', 17835, '3', 'bank', null, null, null, true, true, array['현대 약관'], 320, null),
  ('[대출] 재민 모친대출', '금융비용', '대출 원리금', '', 458500, '말일', 'bank', null, null, null, true, true, array['재민어머니'], 330, null),
  ('[대출] 재민 경남은행', '금융비용', '대출 원리금', '', 235000, '7', 'bank', null, null, null, true, true, array['경남은행'], 340, null),
  ('[대출] 재민 JB자동차 담보대출 플러스', '금융비용', '대출 원리금', '', 900000, '15', 'bank', null, null, null, true, true, array['JB자동차','전북'], 350, null)
on conflict (fixed_cost_name) do update set
  category_large = excluded.category_large,
  category_middle = excluded.category_middle,
  category_small = excluded.category_small,
  expected_amount = excluded.expected_amount,
  base_day = excluded.base_day,
  payment_type = excluded.payment_type,
  payment_source = excluded.payment_source,
  source_account_name = excluded.source_account_name,
  source_card_name = excluded.source_card_name,
  affects_profit = excluded.affects_profit,
  affects_cashflow = excluded.affects_cashflow,
  match_keywords = excluded.match_keywords,
  sort_order = excluded.sort_order,
  memo = excluded.memo,
  updated_at = now();

insert into accounting_bank_accounts (account_type, bank_name, account_holder, account_number, list_enabled, sort_order, memo)
values
  ('business', '국민은행', '김재욱(에프엔)', null, true, 10, '회계/비용 통장 내역 기본 필터용. 계좌번호/비밀번호는 사용자가 수정'),
  ('business', '기업은행', '에프엔', null, true, 20, '회계/비용 통장 내역 기본 필터용. 계좌번호/비밀번호는 사용자가 수정')
on conflict (bank_name, account_holder, account_number) do update set
  account_type = excluded.account_type,
  list_enabled = excluded.list_enabled,
  sort_order = excluded.sort_order,
  memo = excluded.memo,
  updated_at = now();

insert into accounting_card_accounts (card_type, card_name, cutoff_start_day, cutoff_end_day, payment_day, card_limit, withdrawal_account_name, list_enabled, sort_order, memo)
values
  ('business', '가온글로벌카드', 22, 21, 5, 20000000, '국민은행', true, 10, '매월 22일~다음달 21일 사용, 다음달 5일 KB카드출금'),
  ('business', '국민기업카드', 6, 5, 20, 10000000, '국민은행', true, 20, '매월 6일~다음달 5일 사용, 마감달 20일 KB카드출금')
on conflict (card_name) do update set
  card_type = excluded.card_type,
  cutoff_start_day = excluded.cutoff_start_day,
  cutoff_end_day = excluded.cutoff_end_day,
  payment_day = excluded.payment_day,
  card_limit = excluded.card_limit,
  withdrawal_account_name = excluded.withdrawal_account_name,
  list_enabled = excluded.list_enabled,
  sort_order = excluded.sort_order,
  memo = excluded.memo,
  updated_at = now();

create index if not exists idx_shipments_status on shipments(shipment_status);
create index if not exists idx_ad_daily_date on ad_daily_metrics(metric_date desc);
create index if not exists idx_ad_upload_batches_channel_file on ad_upload_batches(channel, source_file_name);
create index if not exists idx_ad_reports_date on ad_reports(report_date desc);
create index if not exists idx_ad_reports_channel on ad_reports(channel);
create index if not exists idx_ad_reports_sku on ad_reports(sku);
create index if not exists idx_ad_reports_product_code on ad_reports(product_code);
create index if not exists idx_ad_product_mappings_channel_code on ad_product_mappings(channel, external_product_code);
create index if not exists idx_ad_product_mappings_sku on ad_product_mappings(sku);
create index if not exists idx_sales_channel_product_mappings_key on sales_channel_product_mappings(channel_name, mall_product_key);
create index if not exists idx_sales_channel_product_mappings_code on sales_channel_product_mappings(channel_code, mall_product_code);
create index if not exists idx_sales_channel_product_mappings_product on sales_channel_product_mappings(product_code);
create index if not exists idx_expense_date on expense_entries(expense_date desc);
create index if not exists idx_expenses_date on expenses(expense_date desc);
create index if not exists idx_expenses_category on expenses(category_id);
create index if not exists idx_expense_batches_uploaded on expense_upload_batches(uploaded_at desc);
create index if not exists idx_payment_records_date on payment_records(payment_date desc);
create index if not exists idx_customer_payables_month on customer_payables(base_month, status);
create index if not exists idx_accounting_batches_source on accounting_import_batches(source_name, created_at desc);
create index if not exists idx_accounting_sources_type on accounting_transaction_sources(source_type);
create index if not exists idx_accounting_categories_path on accounting_categories(category_large, category_middle, category_small);
create index if not exists idx_accounting_rules_priority on accounting_category_rules(is_active, priority);
create index if not exists idx_accounting_transactions_date on accounting_transactions(transaction_date desc);
create index if not exists idx_accounting_transactions_source on accounting_transactions(source_type, source_name);
create index if not exists idx_accounting_transactions_category on accounting_transactions(category_id);
create index if not exists idx_accounting_transactions_review on accounting_transactions(review_status, review_reason);
create index if not exists idx_accounting_transactions_direction on accounting_transactions(direction);
create index if not exists idx_accounting_review_status on accounting_review_queue(status, reason);
create index if not exists idx_accounting_card_settlements_due on accounting_card_settlements(payment_due_date desc);
create index if not exists idx_accounting_fixed_costs_active on accounting_fixed_costs(is_active, sort_order);
create index if not exists idx_accounting_fixed_costs_day on accounting_fixed_costs(base_day);
create index if not exists idx_accounting_loans_active on accounting_loans(is_active, payment_day);
create index if not exists idx_accounting_bank_accounts_active on accounting_bank_accounts(is_active, list_enabled, sort_order);
create index if not exists idx_accounting_card_accounts_active on accounting_card_accounts(is_active, list_enabled, sort_order);
create index if not exists idx_import_po_status on import_purchase_orders(status, expected_inbound_date);
create index if not exists idx_import_product_sku_links_import on import_product_sku_links(import_product_id);
create index if not exists idx_import_product_sku_links_option on import_product_sku_links(import_product_id, import_option_key, sort_order);
create index if not exists idx_import_product_sku_links_product on import_product_sku_links(product_id);
create index if not exists idx_import_purchase_alloc_order on import_purchase_sku_allocations(import_order_id);
create index if not exists idx_import_purchase_alloc_item on import_purchase_sku_allocations(import_order_id, import_order_item_id);
create index if not exists idx_import_purchase_alloc_product on import_purchase_sku_allocations(product_id);
create index if not exists idx_archive_created on archive_items(created_at desc);
create index if not exists idx_archive_category on archive_items(category_id);
create index if not exists idx_archive_normalized_url on archive_items(normalized_url);
create unique index if not exists archive_items_url_hash_uidx on archive_items(url_hash) where url_hash is not null;
create index if not exists idx_archive_source on archive_items(source_type);
create index if not exists idx_archive_content on archive_items(content_type);
create index if not exists idx_archive_status on archive_items(status);
create index if not exists idx_archive_preview_status on archive_items(preview_status);
create index if not exists idx_archive_favorite on archive_items(is_favorite);
create index if not exists idx_archive_item_tags_item on archive_item_tags(archive_item_id);
create index if not exists idx_archive_item_tags_tag on archive_item_tags(tag_id);
create index if not exists idx_archive_links_item on archive_links(archive_item_id);
create index if not exists idx_archive_links_target on archive_links(linked_type, linked_id);
