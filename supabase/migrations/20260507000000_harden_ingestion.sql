-- Pirol backend hardening migration.
-- Adds webhook_events queue, captured_emails columns for storage + LLM, soft-delete on companies,
-- private storage buckets for raw HTML and email assets, and matching RLS policies.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- webhook_events: idempotent inbound queue. The webhook handler inserts a row
-- and returns 202 immediately. A processor picks it up and runs the slow work.
-- ---------------------------------------------------------------------------
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

alter table public.webhook_events enable row level security;

do $$
begin
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

drop policy if exists webhook_events_admin_all on public.webhook_events;
create policy webhook_events_admin_all
on public.webhook_events
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

grant select, insert, update, delete on public.webhook_events to authenticated;

-- Atomic batch claim function. Only the service role calls it; no grants for anon/authenticated.
-- Uses FOR UPDATE SKIP LOCKED so concurrent processor invocations never grab the same row.
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

-- ---------------------------------------------------------------------------
-- captured_emails: storage paths, plain text, llm reasoning, processed_at.
-- image_urls semantics flip: it now holds internal storage paths.
-- Pre-existing remote URLs are migrated into remote_image_urls.
-- ---------------------------------------------------------------------------
alter table public.captured_emails
  add column if not exists html_storage_path text,
  add column if not exists plain_text text,
  add column if not exists remote_image_urls text[] not null default '{}',
  add column if not exists llm_reasoning text,
  add column if not exists processed_at timestamptz;

-- Backfill: any existing rows had image_urls populated with remote URLs.
update public.captured_emails
set remote_image_urls = image_urls,
    image_urls = '{}'
where remote_image_urls = '{}'
  and image_urls is not null
  and array_length(image_urls, 1) > 0;

create index if not exists captured_emails_company_received_idx
  on public.captured_emails (company_id, received_at desc);

create index if not exists captured_emails_classification_source_idx
  on public.captured_emails (classification_source);

-- ---------------------------------------------------------------------------
-- companies: soft delete column.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists deleted_at timestamptz;

create index if not exists companies_deleted_at_idx
  on public.companies (deleted_at)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Storage buckets: private buckets for raw HTML and re-hosted image binaries.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('email-html', 'email-html', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('email-assets', 'email-assets', false)
on conflict (id) do nothing;

-- Storage policies: only service_role and admin authenticated users may read.
-- Writes happen only via the service role from the ingestion processor.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'pirol_admin_read_email_html'
  ) then
    create policy pirol_admin_read_email_html
    on storage.objects
    for select
    to authenticated
    using (
      bucket_id = 'email-html'
      and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'pirol_admin_read_email_assets'
  ) then
    create policy pirol_admin_read_email_assets
    on storage.objects
    for select
    to authenticated
    using (
      bucket_id = 'email-assets'
      and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
    );
  end if;
end $$;
