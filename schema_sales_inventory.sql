-- FN OS sales/inventory MVP schema for Supabase/PostgreSQL.
-- Run this in the Supabase SQL editor before enabling the sales/inventory menu.

create extension if not exists pgcrypto;

create table if not exists upload_batches (
  id uuid primary key default gen_random_uuid(),
  batch_type text not null,
  source_file_name text,
  total_count integer default 0,
  success_count integer default 0,
  fail_count integer default 0,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  source_type text default 'excel',
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
  qty double precision default 0,
  price double precision default 0,
  foreign_amt double precision,
  supply_amt double precision default 0,
  vat_amt double precision,
  remarks text,
  make_flag text,
  ecount_slip_no text,
  ecount_sync_status text default 'PENDING',
  ecount_sync_message text,
  ecount_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references upload_batches(id) on delete set null,
  source_file_name text,
  io_date text,
  ord_date text,
  ord_no text,
  cust_code text,
  cust_name text,
  wh_cd text,
  prod_cd text,
  prod_name text,
  qty double precision default 0,
  price double precision default 0,
  supply_amt double precision default 0,
  vat_amt double precision,
  remarks text,
  ecount_slip_no text,
  ecount_sync_status text default 'PENDING',
  ecount_sync_message text,
  ecount_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  prod_cd text not null unique,
  prod_name text,
  size_des text,
  prod_type text,
  barcode text,
  is_active boolean default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_mappings (
  id uuid primary key default gen_random_uuid(),
  mall_name text,
  mall_product_code text,
  mall_option_key text,
  fn_sku text,
  ecount_prod_cd text references products(prod_cd) on delete set null,
  mapping_status text default 'UNMAPPED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date,
  wh_cd text,
  wh_name text,
  prod_cd text,
  prod_name text,
  size_des text,
  bal_qty double precision default 0,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists ecount_sync_logs (
  id uuid primary key default gen_random_uuid(),
  target_type text,
  target_id text,
  api_name text,
  request_payload jsonb,
  response_payload jsonb,
  status text,
  error_message text,
  trace_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_io_date on sales(io_date);
create index if not exists idx_sales_prod_cd on sales(prod_cd);
create index if not exists idx_sales_batch on sales(upload_batch_id);
create index if not exists idx_purchases_io_date on purchases(io_date);
create index if not exists idx_purchases_prod_cd on purchases(prod_cd);
create index if not exists idx_inventory_prod_date on inventory_snapshots(prod_cd, snapshot_date);
create index if not exists idx_inventory_synced_at on inventory_snapshots(synced_at desc);

