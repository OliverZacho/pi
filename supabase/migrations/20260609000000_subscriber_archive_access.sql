-- ============================================================
-- Entitlement-based access for paying non-admin users.
--
-- Introduces `public.subscriptions` (the entitlement source Stripe will
-- populate) and `public.has_archive_access()` = admin OR active subscription.
-- Shared-archive tables become readable by entitled users (SELECT only);
-- personal tables let entitled users CRUD their own rows. Anonymous / unpaid
-- users get nothing (the curated teaser is served separately via service-role).
--
-- Verified on a throwaway Supabase branch before promotion:
--   admin   -> full archive (unchanged)
--   subscriber -> archive read + own personal CRUD; cannot touch others' rows
--   unpaid  -> denied (no free tier), incl. their own personal rows
--   anon    -> denied archive
-- ============================================================

-- 1. Subscription entitlement source (Stripe will populate later).
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inactive',
  plan text,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

drop policy if exists subscriptions_self_select on public.subscriptions;
create policy subscriptions_self_select on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists subscriptions_service_all on public.subscriptions;
create policy subscriptions_service_all on public.subscriptions
  for all to service_role using (true) with check (true);

-- 2. Entitlement check. SECURITY DEFINER so it reads admin_users/subscriptions
--    past their own RLS; STABLE; locked search_path.
create or replace function public.has_archive_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
    or exists (
      select 1 from public.subscriptions s
      where s.user_id = auth.uid()
        and s.status in ('active','trialing')
        and (s.current_period_end is null or s.current_period_end > now())
    );
$$;
revoke all on function public.has_archive_access() from public;
grant execute on function public.has_archive_access() to authenticated;

-- 3. Shared-archive read access for entitled users (SELECT only; additive,
--    leaves the existing admin/service policies intact).
drop policy if exists companies_subscriber_read on public.companies;
create policy companies_subscriber_read on public.companies
  for select to authenticated using (public.has_archive_access());

drop policy if exists captured_emails_subscriber_read on public.captured_emails;
create policy captured_emails_subscriber_read on public.captured_emails
  for select to authenticated using (public.has_archive_access());

drop policy if exists company_inboxes_subscriber_read on public.company_inboxes;
create policy company_inboxes_subscriber_read on public.company_inboxes
  for select to authenticated using (public.has_archive_access());

drop policy if exists email_products_subscriber_read on public.email_products;
create policy email_products_subscriber_read on public.email_products
  for select to authenticated using (public.has_archive_access());

-- 4. Personal tables: replace the admin half of each owner+admin policy with
--    the entitlement check, preserving owner scoping. Old admin policies are
--    dropped and re-created as `*_member_*`.

-- saved_emails
drop policy if exists saved_emails_admin_select on public.saved_emails;
drop policy if exists saved_emails_admin_insert on public.saved_emails;
drop policy if exists saved_emails_admin_delete on public.saved_emails;
create policy saved_emails_member_select on public.saved_emails
  for select to authenticated using ((user_id = auth.uid()) and public.has_archive_access());
create policy saved_emails_member_insert on public.saved_emails
  for insert to authenticated with check ((user_id = auth.uid()) and public.has_archive_access());
create policy saved_emails_member_delete on public.saved_emails
  for delete to authenticated using ((user_id = auth.uid()) and public.has_archive_access());

-- collections (public_select + service stay untouched)
drop policy if exists collections_admin_insert on public.collections;
drop policy if exists collections_admin_update on public.collections;
drop policy if exists collections_admin_delete on public.collections;
create policy collections_member_insert on public.collections
  for insert to authenticated with check ((user_id = auth.uid()) and public.has_archive_access());
create policy collections_member_update on public.collections
  for update to authenticated using ((user_id = auth.uid()) and public.has_archive_access())
  with check ((user_id = auth.uid()) and public.has_archive_access());
create policy collections_member_delete on public.collections
  for delete to authenticated using ((user_id = auth.uid()) and public.has_archive_access());

-- collection_emails (parent ownership preserved; public_select + service stay)
drop policy if exists collection_emails_admin_insert on public.collection_emails;
drop policy if exists collection_emails_admin_delete on public.collection_emails;
create policy collection_emails_member_insert on public.collection_emails
  for insert to authenticated with check (
    (exists (select 1 from public.collections c where c.id = collection_emails.collection_id and c.user_id = auth.uid()))
    and public.has_archive_access());
create policy collection_emails_member_delete on public.collection_emails
  for delete to authenticated using (
    (exists (select 1 from public.collections c where c.id = collection_emails.collection_id and c.user_id = auth.uid()))
    and public.has_archive_access());

-- competitor_sets
drop policy if exists competitor_sets_admin_select on public.competitor_sets;
drop policy if exists competitor_sets_admin_insert on public.competitor_sets;
drop policy if exists competitor_sets_admin_update on public.competitor_sets;
drop policy if exists competitor_sets_admin_delete on public.competitor_sets;
create policy competitor_sets_member_select on public.competitor_sets
  for select to authenticated using ((user_id = auth.uid()) and public.has_archive_access());
create policy competitor_sets_member_insert on public.competitor_sets
  for insert to authenticated with check ((user_id = auth.uid()) and public.has_archive_access());
create policy competitor_sets_member_update on public.competitor_sets
  for update to authenticated using ((user_id = auth.uid()) and public.has_archive_access())
  with check ((user_id = auth.uid()) and public.has_archive_access());
create policy competitor_sets_member_delete on public.competitor_sets
  for delete to authenticated using ((user_id = auth.uid()) and public.has_archive_access());

-- competitor_set_members (parent ownership preserved)
drop policy if exists competitor_set_members_admin_select on public.competitor_set_members;
drop policy if exists competitor_set_members_admin_insert on public.competitor_set_members;
drop policy if exists competitor_set_members_admin_delete on public.competitor_set_members;
create policy competitor_set_members_member_select on public.competitor_set_members
  for select to authenticated using (
    (exists (select 1 from public.competitor_sets s where s.id = competitor_set_members.set_id and s.user_id = auth.uid()))
    and public.has_archive_access());
create policy competitor_set_members_member_insert on public.competitor_set_members
  for insert to authenticated with check (
    (exists (select 1 from public.competitor_sets s where s.id = competitor_set_members.set_id and s.user_id = auth.uid()))
    and public.has_archive_access());
create policy competitor_set_members_member_delete on public.competitor_set_members
  for delete to authenticated using (
    (exists (select 1 from public.competitor_sets s where s.id = competitor_set_members.set_id and s.user_id = auth.uid()))
    and public.has_archive_access());

-- brand_follows
drop policy if exists brand_follows_admin_select on public.brand_follows;
drop policy if exists brand_follows_admin_insert on public.brand_follows;
drop policy if exists brand_follows_admin_delete on public.brand_follows;
create policy brand_follows_member_select on public.brand_follows
  for select to authenticated using ((user_id = auth.uid()) and public.has_archive_access());
create policy brand_follows_member_insert on public.brand_follows
  for insert to authenticated with check ((user_id = auth.uid()) and public.has_archive_access());
create policy brand_follows_member_delete on public.brand_follows
  for delete to authenticated using ((user_id = auth.uid()) and public.has_archive_access());
