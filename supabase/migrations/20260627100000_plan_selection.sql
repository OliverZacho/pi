-- ============================================================
-- Onboarding plan choice.
--
-- `plan_selected_at` is the gate for the forced "pick a plan" modal shown to
-- brand-new signups on /explore. It is null until the user makes a choice
-- (Free, Solo or Team); once stamped, the modal never shows again.
-- ============================================================

alter table public.user_profiles
  add column if not exists plan_selected_at timestamptz;

-- Backfill every existing profile so only NEW signups (rows created after this
-- migration, where the column stays null) are prompted. Existing users have
-- already been using the app — don't nag them.
update public.user_profiles
  set plan_selected_at = now()
  where plan_selected_at is null;
