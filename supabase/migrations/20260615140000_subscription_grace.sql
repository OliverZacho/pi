-- ============================================================
-- Dunning grace period for failed renewals.
--
-- When a renewal payment fails, Stripe marks the subscription `past_due` and
-- retries over a window. Previously `past_due` was not an entitled status, so
-- a single failed charge cut access instantly. This adds a bounded grace: the
-- webhook stamps `grace_until` (now + 14d) on the transition into `past_due`,
-- and `has_archive_access()` keeps the user entitled until that moment. When
-- Stripe exhausts retries and moves the subscription to canceled/unpaid — or
-- the grace elapses — access drops normally.
-- ============================================================

alter table public.subscriptions
  add column if not exists grace_until timestamptz;

-- Entitlement = admin OR (active/trialing within period) OR (past_due within
-- grace). SECURITY DEFINER + locked search_path unchanged from the original.
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
        and (
          (
            s.status in ('active','trialing')
            and (s.current_period_end is null or s.current_period_end > now())
          )
          or (
            s.status = 'past_due'
            and s.grace_until is not null
            and s.grace_until > now()
          )
        )
    );
$$;
