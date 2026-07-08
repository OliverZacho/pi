-- The onboarding tour now keys on tour_completed_at alone, so paid signups
-- get it too (it used to be held to unpaid viewers and additionally gated on
-- plan_selected_at being null). Existing users from before the tour shipped
-- were backfilled with plan_selected_at only; stamp their tour as done so the
-- widened gate doesn't suddenly auto-start the tour for them. Reuses the
-- plan_selected_at timestamp rather than now() to keep the stamps honest
-- about when onboarding happened.
update public.user_profiles
set tour_completed_at = plan_selected_at,
    updated_at = now()
where tour_completed_at is null
  and plan_selected_at is not null;
