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
  email text,
  address text,
  memo text,
  payment_terms text,
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
alter table customers add column if not exists email text;
alter table customers add column if not exists address text;
alter table customers add column if not exists memo text;
alter table customers add column if not exists payment_terms text;

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

insert into accounting_transaction_sources (source_name, source_type, institution_name, account_name, card_name, source_profile, card_limit, cutoff_start_day, cutoff_end_day, payment_day, payment_month_offset, memo)
values
  ('가온글로벌카드', 'card', 'KB국민카드', '가온글로벌카드', '가온글로벌카드', 'gaon_global_card', 20000000, 22, 21, 5, 1, '매월 22일~다음달 21일 사용, 다음달 5일 출금'),
  ('국민기업카드', 'card', 'KB국민카드', '국민기업카드', '국민기업카드', 'kb_business_card', null, 6, 5, 20, 0, '매월 6일~다음달 5일 사용, 마감달 20일 출금'),
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

insert into accounting_categories (category_large, category_middle, category_small, affects_profit, affects_cashflow, affects_card_settlement, default_review_required, sort_order, memo)
values
  ('매출/정산입금', '스마트스토어', '네이버파이낸셜 정산', true, true, false, false, 10, '통장 입금 기준 스마트스토어 정산'),
  ('매출/정산입금', '쿠팡', '쿠팡 정산', true, true, false, false, 20, '쿠팡 정산 입금'),
  ('매출/정산입금', '오픈마켓', '11번가/지마켓/옥션', true, true, false, false, 30, '오픈마켓 정산 입금'),
  ('매입/원가', '제품매입', '국내거래처결제', true, true, false, false, 100, '국내 거래처 제품 매입'),
  ('매입/원가', '제품매입', '중국/해외매입', true, false, true, false, 110, '카드 해외 결제 제품 매입'),
  ('매입/원가', '포장재', '박스구매', true, false, true, true, 120, 'KCP 등 포장재 결제 후보'),
  ('매입/원가', '수입비용', '관부가세/포워딩/해외송금', true, true, false, false, 130, '수입 통관 및 포워딩 비용'),
  ('물류/배송', '택배비', 'CJ대한통운', true, true, false, false, 200, 'CJ 택배비'),
  ('물류/배송', '택배비', '타배/반품택배/화물택배', true, true, false, true, 210, '일반명 택배비 후보'),
  ('마케팅/광고', '네이버광고', '비즈월렛/검색광고', true, false, true, false, 300, '네이버 광고비'),
  ('마케팅/광고', '메타광고', 'Facebook/Instagram', true, false, true, false, 310, 'FACEBK 계열 광고비'),
  ('마케팅/광고', '쿠팡광고', '쿠팡 광고비', true, false, true, false, 320, '쿠팡 광고비'),
  ('운영비', '소프트웨어', '이카운트', true, false, true, false, 400, '반복 KCP 확인 후 자동분류'),
  ('운영비', '소프트웨어', 'Adobe/호스팅', true, false, true, false, 410, '구독 및 호스팅'),
  ('운영비', '사무실', '월세/전기세/관리비', true, true, false, false, 420, '사무실 운영비'),
  ('운영비', '통신', '인터넷/휴대폰', true, true, false, false, 430, '통신비'),
  ('차량/교통', '주유비', '', true, false, true, false, 500, '주유비'),
  ('차량/교통', '하이패스', '', true, false, true, false, 510, '하이패스'),
  ('인건비', '급여', '', true, true, false, false, 600, '급여'),
  ('식대/복리', '점심/커피/편의점/회식', '', true, false, true, false, 700, '복리후생'),
  ('세금/보험', '4대보험', '국민연금/건강보험/고용보험/산재보험', true, true, false, false, 800, '세금 보험'),
  ('금융비용', '대출이자/보증료/노란우산', '', true, true, false, false, 900, '금융비용'),
  ('카드대금', '가온글로벌카드', '', false, true, false, false, 1000, '카드대금 출금은 손익 제외'),
  ('카드대금', '국민기업카드', '', false, true, false, false, 1010, '카드대금 출금은 손익 제외'),
  ('자금이동', '계좌간이체/대표자입출금', '', false, true, false, true, 1100, '자금 이동성 거래'),
  ('검토필요', 'KCP확인', '', false, false, false, true, 1200, 'KCP 결제대행 확인'),
  ('검토필요', '네이버확인', '', false, false, false, true, 1210, '네이버파이낸셜/네이버페이 확인'),
  ('검토필요', '미분류', '', false, false, false, true, 1220, '미분류 거래'),
  ('검토필요', '일반명거래', '', false, false, false, true, 1230, '인터넷상거래_4/자동결제_1 등')
on conflict (category_large, category_middle, category_small) do update set
  affects_profit = excluded.affects_profit,
  affects_cashflow = excluded.affects_cashflow,
  affects_card_settlement = excluded.affects_card_settlement,
  default_review_required = excluded.default_review_required,
  sort_order = excluded.sort_order,
  memo = excluded.memo,
  updated_at = now();

insert into accounting_category_rules (priority, source_type, condition_field, condition_operator, keyword, amount_condition, category_large, category_middle, category_small, auto_confirm, review_required, review_reason, memo)
values
  (10, 'card', 'merchant_name', 'starts_with', 'FACEBK', null, '마케팅/광고', '메타광고', 'Facebook/Instagram', true, false, null, 'FACEBK 계열 메타 광고'),
  (20, 'card', 'merchant_name', 'equals', '네이버페이_비즈월렛', null, '마케팅/광고', '네이버광고', '비즈월렛/검색광고', true, false, null, '네이버 비즈월렛'),
  (30, 'card', 'merchant_name', 'contains', '네이버파이낸셜', null, '검토필요', '네이버확인', '', false, true, '네이버확인', '카드 네이버파이낸셜은 제품 구매/광고/일반구매 혼재'),
  (50, 'card', 'merchant_name', 'contains', 'KCP(자동과금)', '300000', '검토필요', 'KCP확인', '', false, true, 'KCP확인', '반복 확인 전 검토'),
  (60, 'card', 'merchant_name', 'contains', 'KCP(결제대행)', null, '검토필요', 'KCP확인', '', false, true, 'KCP확인', 'KCP 결제대행은 기본 검토'),
  (61, 'card', 'merchant_amount', 'contains', 'KCP(결제대행)', '44000', '운영비', '소프트웨어', '이카운트', true, false, null, '반복 확인된 이카운트 금액'),
  (62, 'card', 'merchant_amount', 'contains', 'KCP(결제대행)', '95040', '운영비', '소프트웨어', 'Adobe/호스팅', true, false, null, '반복 확인된 호스팅 금액'),
  (70, 'card', 'merchant_name', 'contains', '인터넷상거래_4', null, '검토필요', '일반명거래', '', false, true, '일반명거래', '일반명 거래는 검토'),
  (80, 'card', 'merchant_name', 'contains', '자동결제_1', null, '검토필요', '일반명거래', '', false, true, '일반명거래', '자동결제 일반명 거래'),
  (90, 'card', 'merchant_name', 'contains', '1688.com', null, '매입/원가', '제품매입', '중국/해외매입', true, false, null, '1688 제품 매입'),
  (100, 'bank', 'merchant_name', 'contains', '네이버파이낸셜주식회', null, '매출/정산입금', '스마트스토어', '네이버파이낸셜 정산', true, false, null, '통장 입금 네이버 정산'),
  (110, 'bank', 'merchant_name', 'contains', '쿠팡', null, '매출/정산입금', '쿠팡', '쿠팡 정산', true, false, null, '쿠팡 정산 입금'),
  (120, 'bank', 'merchant_name', 'contains', '카드대금', null, '카드대금', '가온글로벌카드', '', true, false, null, '카드대금 출금은 손익 제외'),
  (130, 'bank', 'merchant_name', 'contains', '이체', null, '자금이동', '계좌간이체/대표자입출금', '', false, true, '자금이동 확인', '계좌 이동성 거래')
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
create index if not exists idx_bom_parent on product_boms(parent_product_id);
create index if not exists idx_bom_items_bom on product_bom_items(bom_id);
create index if not exists idx_orders_date on orders(order_date desc);
create index if not exists idx_order_items_mapping on order_items(mapping_status);
create index if not exists idx_shipments_status on shipments(shipment_status);
create index if not exists idx_ad_daily_date on ad_daily_metrics(metric_date desc);
create index if not exists idx_ad_upload_batches_channel_file on ad_upload_batches(channel, source_file_name);
create index if not exists idx_ad_reports_date on ad_reports(report_date desc);
create index if not exists idx_ad_reports_channel on ad_reports(channel);
create index if not exists idx_ad_reports_sku on ad_reports(sku);
create index if not exists idx_ad_reports_product_code on ad_reports(product_code);
create index if not exists idx_ad_product_mappings_channel_code on ad_product_mappings(channel, external_product_code);
create index if not exists idx_ad_product_mappings_sku on ad_product_mappings(sku);
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
create index if not exists idx_import_po_status on import_purchase_orders(status, expected_inbound_date);
create index if not exists idx_import_product_sku_links_import on import_product_sku_links(import_product_id);
create index if not exists idx_import_product_sku_links_option on import_product_sku_links(import_product_id, import_option_key, sort_order);
create index if not exists idx_import_product_sku_links_product on import_product_sku_links(product_id);
create index if not exists idx_import_purchase_alloc_order on import_purchase_sku_allocations(import_order_id);
create index if not exists idx_import_purchase_alloc_item on import_purchase_sku_allocations(import_order_id, import_order_item_id);
create index if not exists idx_import_purchase_alloc_product on import_purchase_sku_allocations(product_id);
create index if not exists idx_archive_created on archive_items(created_at desc);
create index if not exists idx_archive_category on archive_items(category_id);
create index if not exists idx_archive_source on archive_items(source_type);
create index if not exists idx_archive_content on archive_items(content_type);
create index if not exists idx_archive_status on archive_items(status);
create index if not exists idx_archive_preview_status on archive_items(preview_status);
create index if not exists idx_archive_favorite on archive_items(is_favorite);
create index if not exists idx_archive_item_tags_item on archive_item_tags(archive_item_id);
create index if not exists idx_archive_item_tags_tag on archive_item_tags(tag_id);
create index if not exists idx_archive_links_item on archive_links(archive_item_id);
create index if not exists idx_archive_links_target on archive_links(linked_type, linked_id);
