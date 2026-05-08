create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null,
  subscribed_since timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists companies_domain_unique on public.companies (lower(domain));
create index if not exists companies_deleted_at_idx on public.companies (deleted_at) where deleted_at is null;

create table if not exists public.company_inboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email_address text not null unique,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists company_inboxes_company_primary_unique
  on public.company_inboxes (company_id)
  where is_primary = true;

create table if not exists public.captured_emails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  inbox_id uuid references public.company_inboxes(id) on delete set null,
  resend_message_id text,
  sender_email text not null,
  recipient_email text not null,
  subject text not null,
  sent_at timestamptz,
  received_at timestamptz not null default now(),
  html_content text not null,
  html_storage_path text,
  plain_text text,
  image_urls text[] not null default '{}',
  remote_image_urls text[] not null default '{}',
  category text not null default 'other' check (category in ('new_launch', 'sale', 'newsletter', 'product_update', 'event', 'other')),
  classification_source text not null default 'rules' check (classification_source in ('rules', 'llm', 'manual')),
  classification_confidence numeric(4, 3) not null default 0.0 check (classification_confidence >= 0 and classification_confidence <= 1),
  llm_model text,
  llm_reasoning text,
  raw_payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists captured_emails_resend_message_unique
  on public.captured_emails (resend_message_id)
  where resend_message_id is not null;

create index if not exists captured_emails_company_id_idx on public.captured_emails (company_id);
create index if not exists captured_emails_inbox_id_idx on public.captured_emails (inbox_id);
create index if not exists captured_emails_received_at_idx on public.captured_emails (received_at desc);
create index if not exists captured_emails_category_idx on public.captured_emails (category);
create index if not exists captured_emails_company_received_idx on public.captured_emails (company_id, received_at desc);
create index if not exists captured_emails_classification_source_idx on public.captured_emails (classification_source);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'resend',
  svix_id text,
  event_type text not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed', 'skipped')),
  attempt_count int not null default 0,
  last_error text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists webhook_events_svix_id_unique
  on public.webhook_events (svix_id)
  where svix_id is not null;

create index if not exists webhook_events_status_received_at_idx
  on public.webhook_events (status, received_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row
execute function public.set_updated_at();

alter table public.companies enable row level security;
alter table public.company_inboxes enable row level security;
alter table public.captured_emails enable row level security;
alter table public.webhook_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'companies' and policyname = 'service_role_full_access_companies'
  ) then
    create policy service_role_full_access_companies
    on public.companies
    for all
    to service_role
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'company_inboxes' and policyname = 'service_role_full_access_company_inboxes'
  ) then
    create policy service_role_full_access_company_inboxes
    on public.company_inboxes
    for all
    to service_role
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'captured_emails' and policyname = 'service_role_full_access_captured_emails'
  ) then
    create policy service_role_full_access_captured_emails
    on public.captured_emails
    for all
    to service_role
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'webhook_events' and policyname = 'service_role_full_access_webhook_events'
  ) then
    create policy service_role_full_access_webhook_events
    on public.webhook_events
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

-- Admin gate: link auth.users to Pirol admin access (insert rows via SQL dashboard or service role)
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists admin_users_select_self on public.admin_users;
create policy admin_users_select_self
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists companies_admin_all on public.companies;
create policy companies_admin_all
on public.companies
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

drop policy if exists company_inboxes_admin_all on public.company_inboxes;
create policy company_inboxes_admin_all
on public.company_inboxes
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

drop policy if exists captured_emails_admin_all on public.captured_emails;
create policy captured_emails_admin_all
on public.captured_emails
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

drop policy if exists webhook_events_admin_all on public.webhook_events;
create policy webhook_events_admin_all
on public.webhook_events
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

grant select on public.admin_users to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.company_inboxes to authenticated;
grant select, insert, update, delete on public.captured_emails to authenticated;
grant select, insert, update, delete on public.webhook_events to authenticated;

create or replace function public.claim_webhook_events(batch_limit integer default 5)
returns setof public.webhook_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select id
    from public.webhook_events
    where status = 'received'
    order by received_at asc
    limit batch_limit
    for update skip locked
  )
  update public.webhook_events as w
  set status = 'processing',
      attempt_count = w.attempt_count + 1
  from claimed
  where w.id = claimed.id
  returning w.*;
end;
$$;

revoke all on function public.claim_webhook_events(integer) from public;
revoke all on function public.claim_webhook_events(integer) from anon, authenticated;
