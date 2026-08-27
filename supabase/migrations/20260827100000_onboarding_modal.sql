-- ============================================================================
-- Onboarding modal: replaces the driver.js tour for brand-new signups.
--
-- The app shell shows a 3-step modal (role -> categories -> follow 3-20
-- brands) to any signed-in user whose onboarding_completed_at is null. The
-- answers land on user_profiles; untracked brand picks from the step-3
-- typeahead (resolved via the Logo.dev Brand Search API) become
-- brand_requests rows for the admin queue and render as "Requested" pending
-- cards on /following.
--
-- Backfill marks every existing user as already onboarded (preferring their
-- real tour stamp) so ONLY rows created after this migration - i.e. genuinely
-- new signups, whose profile row the on_auth_user_change trigger inserts with
-- a null onboarding_completed_at - ever see the modal.
-- ============================================================================

-- 1) New-signup gate + captured answers.
alter table public.user_profiles
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_role text,
  add column if not exists onboarding_categories text[],
  add column if not exists own_brand_domain text;

update public.user_profiles
  set onboarding_completed_at = coalesce(tour_completed_at, now())
  where onboarding_completed_at is null;

-- 2) Brand requests: canonical domain (from Logo.dev search) + provenance.
--    `domain` is the normalized registrable host; `website` keeps holding
--    whatever the requester typed (the public form) or the same domain (the
--    onboarding flow). `source` distinguishes the anonymous request form
--    ('form') from onboarding picks ('onboarding').
alter table public.brand_requests
  add column if not exists domain text,
  add column if not exists source text not null default 'form';

-- Pending-card lookups on /following (requested_by = user, status = pending).
create index if not exists brand_requests_requested_by_status_idx
  on public.brand_requests (requested_by, status);

-- Idempotency for the onboarding completion route: at most one live pending
-- request per user per domain. Legacy rows (null domain or requester) exempt.
create unique index if not exists brand_requests_pending_user_domain_uidx
  on public.brand_requests (requested_by, lower(domain))
  where status = 'pending' and domain is not null and requested_by is not null;
