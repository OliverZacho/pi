-- ============================================================
-- Onboarding product tour.
--
-- `tour_completed_at` gates the guided walkthrough shown to brand-new signups
-- before the forced "pick a plan" modal on /explore. It is null until the user
-- finishes or skips the tour; once stamped, the tour never auto-starts again.
--
-- The tour only auto-starts when BOTH `tour_completed_at` and `plan_selected_at`
-- are null, so existing users (already backfilled with a `plan_selected_at`
-- stamp in 20260627100000_plan_selection) never see it — no backfill needed
-- here, the plan-choice gate already excludes them.
-- ============================================================

alter table public.user_profiles
  add column if not exists tour_completed_at timestamptz;
