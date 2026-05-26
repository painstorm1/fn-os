-- FN OS sales/inventory ERP schema for Supabase/PostgreSQL.
-- Direction: FN OS DB is the source of truth. ECOUNT-specific sync is no longer required.
-- Run the whole file in the Supabase SQL editor.

create extension if not exists pgcrypto;

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

alter table customers add column if not exists customer_code text;
alter table customers add column if not exists customer_name text;
alter table customers add column if not exists customer_type text;
alter table customers add column if not exists business_no text;
alter table customers add column if not exists contact_name text;
alter table customers add column if not exists phone text;
alter table customers add column if not exists memo text;
alter table customers add column if not exists payment_terms text;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  product_code text unique,
  sku text,
  product_name text,
  option_name text,
  product_type text,
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

create index if not exists idx_sales_io_date on sales(io_date);
create index if not exists idx_sales_prod_cd on sales(prod_cd);
create index if not exists idx_sales_sku on sales(sku);
create index if not exists idx_sales_batch on sales(upload_batch_id);
create index if not exists idx_purchases_io_date on purchases(io_date);
create index if not exists idx_purchases_prod_cd on purchases(prod_cd);
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
