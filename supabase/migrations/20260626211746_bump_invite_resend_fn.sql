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
