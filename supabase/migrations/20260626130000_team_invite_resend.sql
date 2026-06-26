-- ============================================================
-- Resend support for pending team invites.
--
-- The Settings "Resend" button is rate-limited server-side: at most one
-- resend per 60s and a hard cap of 3 resends per invite. Tracking those
-- on the row (not in client state) keeps the limits honest across reloads
-- and devices.
--
-- last_sent_at is null for rows created before this migration; callers
-- coalesce it to created_at (the invite's original send) when measuring
-- the cooldown.
-- ============================================================

alter table public.team_invites
  add column if not exists resend_count integer not null default 0,
  add column if not exists last_sent_at timestamptz;

-- Atomic "I just resent this invite": bump the counter and stamp the time
-- in one statement so concurrent clicks can't race the read-modify-write.
-- SECURITY DEFINER + service_role-only grant mirrors the table's RLS; the
-- resend route already enforces ownership and the cooldown/cap before
-- calling this.
create or replace function public.bump_invite_resend(p_invite_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.team_invites
  set resend_count = resend_count + 1,
      last_sent_at = now()
  where id = p_invite_id and status = 'pending';
$$;
revoke all on function public.bump_invite_resend(uuid) from public;
revoke all on function public.bump_invite_resend(uuid) from anon;
revoke all on function public.bump_invite_resend(uuid) from authenticated;
grant execute on function public.bump_invite_resend(uuid) to service_role;
