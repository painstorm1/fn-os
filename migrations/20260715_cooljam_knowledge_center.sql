begin;

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
  'sourcing_research',
  'knowledge_daily_capture',
  'knowledge_action',
  'product_card_upsert'
));

create table if not exists knowledge_index (
  id uuid primary key default gen_random_uuid(),
  archive_id uuid references archive_items(id) on delete set null,
  source_card_path text not null unique,
  title text not null,
  scope text not null default 'company',
  category text,
  source_date date,
  value_score smallint,
  value_label varchar(10),
  status text not null default 'pending',
  confirmation_method text,
  relationship text,
  target_hint varchar(500),
  source_type text,
  source_ref text,
  source_url text,
  obsidian_path text,
  preview varchar(500),
  legacy_decision text,
  legacy_decided_at text,
  requested_action text,
  processing_status text not null default 'idle',
  automation_job_id uuid references automation_jobs(id) on delete set null,
  error_message text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table knowledge_index add column if not exists category text;
alter table knowledge_index add column if not exists source_date date;
alter table knowledge_index add column if not exists value_score smallint;
alter table knowledge_index add column if not exists value_label varchar(10);
alter table knowledge_index add column if not exists target_hint varchar(500);
alter table knowledge_index add column if not exists source_ref text;

alter table knowledge_index drop constraint if exists knowledge_index_scope_check;
alter table knowledge_index add constraint knowledge_index_scope_check check (scope in ('company', 'personal'));
alter table knowledge_index drop constraint if exists knowledge_index_status_check;
alter table knowledge_index add constraint knowledge_index_status_check check (status in ('confirmed', 'pending', 'rejected'));
alter table knowledge_index drop constraint if exists knowledge_index_confirmation_check;
alter table knowledge_index add constraint knowledge_index_confirmation_check check (confirmation_method is null or confirmation_method in ('merge', 'new'));
alter table knowledge_index drop constraint if exists knowledge_index_value_score_check;
alter table knowledge_index add constraint knowledge_index_value_score_check check (value_score is null or value_score between 0 and 5);
alter table knowledge_index drop constraint if exists knowledge_index_action_check;
alter table knowledge_index add constraint knowledge_index_action_check check (requested_action is null or requested_action in ('pending', 'rejected', 'confirm_new', 'confirm_merge'));
alter table knowledge_index drop constraint if exists knowledge_index_processing_check;
alter table knowledge_index add constraint knowledge_index_processing_check check (processing_status in ('idle', 'queued', 'running', 'success', 'failed'));

create table if not exists knowledge_daily_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  title text not null,
  scope text not null default 'company',
  entry_preview varchar(500) not null,
  source_card_path text unique,
  obsidian_path text,
  processing_status text not null default 'idle',
  automation_job_id uuid references automation_jobs(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table knowledge_daily_entries drop constraint if exists knowledge_daily_scope_check;
alter table knowledge_daily_entries add constraint knowledge_daily_scope_check check (scope in ('company', 'personal'));
alter table knowledge_daily_entries drop constraint if exists knowledge_daily_processing_check;
alter table knowledge_daily_entries add constraint knowledge_daily_processing_check check (processing_status in ('idle', 'queued', 'running', 'success', 'failed'));

alter table knowledge_index enable row level security;
alter table knowledge_daily_entries enable row level security;
revoke all privileges on table knowledge_index from anon, authenticated;
revoke all privileges on table knowledge_daily_entries from anon, authenticated;

create index if not exists idx_knowledge_index_review on knowledge_index(status, processing_status, updated_at desc);
create index if not exists idx_knowledge_index_scope_status on knowledge_index(scope, status, updated_at desc);
create index if not exists idx_knowledge_index_archive on knowledge_index(archive_id);
create index if not exists idx_knowledge_index_source_date on knowledge_index(source_date desc);
create index if not exists idx_knowledge_index_value_score on knowledge_index(value_score desc nulls last, updated_at desc);
create unique index if not exists idx_knowledge_index_source_ref_unique on knowledge_index(source_type, source_ref) where source_ref is not null;
create index if not exists idx_knowledge_daily_date on knowledge_daily_entries(entry_date desc, created_at desc);

commit;
