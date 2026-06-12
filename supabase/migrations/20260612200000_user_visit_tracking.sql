-- ============================================================
-- Per-visit activity tracking so the "new emails from brands you follow"
-- sidebar notice can say "since you last logged in" instead of using a
-- fixed 7-day window.
--
--   * last_active_at — bumped on every authenticated app load (the
--     sidebar fetches its notices once per mount).
--   * last_visit_at  — the frozen reference shown as "since you last
--     logged in": the moment the user was last active BEFORE the current
--     visit. A visit boundary is any inactivity gap longer than the gap
--     argument below. Null until the user has a prior visit to compare to.
-- ============================================================

alter table public.user_profiles
  add column if not exists last_active_at timestamptz,
  add column if not exists last_visit_at timestamptz;

-- Advance the caller's visit window and return the "since you were last
-- here" reference (null on the very first visit, when there's nothing to
-- compare against). SECURITY DEFINER + service_role-only: the sidebar
-- builds notices through the service-role client, which has no auth.uid(),
-- so the target user is passed explicitly.
create or replace function public.touch_user_visit(
  p_user_id uuid,
  p_gap interval default interval '30 minutes'
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_since timestamptz;
begin
  update public.user_profiles up
    set last_visit_at = case
          when up.last_active_at is null or v_now - up.last_active_at > p_gap
          then up.last_active_at      -- new visit: remember when we last saw them
          else up.last_visit_at       -- same visit: keep the frozen reference
        end,
        last_active_at = v_now,
        updated_at = v_now
    where up.user_id = p_user_id
    returning up.last_visit_at into v_since;

  -- No profile row yet (rare — the auth trigger seeds one on signup).
  -- Treat as a first visit: record activity, but offer no reference.
  if not found then
    insert into public.user_profiles (user_id, email, last_active_at)
    select p_user_id, coalesce(u.email, ''), v_now
    from auth.users u
    where u.id = p_user_id
    on conflict (user_id) do update set last_active_at = v_now;
    return null;
  end if;

  return v_since;
end;
$$;

revoke all on function public.touch_user_visit(uuid, interval) from public;
revoke all on function public.touch_user_visit(uuid, interval) from anon;
revoke all on function public.touch_user_visit(uuid, interval) from authenticated;
grant execute on function public.touch_user_visit(uuid, interval) to service_role;
