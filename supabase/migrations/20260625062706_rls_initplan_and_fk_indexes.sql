-- Performance: stop per-row re-evaluation in RLS policies.
--
-- auth.uid() and has_archive_access() are STABLE but, inside RLS USING/WITH
-- CHECK clauses, get evaluated once PER ROW. That made catalogue reads slow —
-- especially captured_emails via captured_emails_subscriber_read =
-- has_archive_access() (3 EXISTS subqueries per row). Wrapping each call in a
-- scalar subquery makes Postgres evaluate it once per query (InitPlan).
-- Semantically identical (both are STABLE); access control is unchanged.
-- Resolves the 46 auth_rls_initplan advisor warnings.
do $$
declare
  r record;
  u text;
  c text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(auth\.uid\(\)|has_archive_access\(\))'
  loop
    u := r.qual;
    c := r.with_check;
    if u is not null then
      u := regexp_replace(u, '\(\s*select\s+auth\.uid\(\)\s*\)|auth\.uid\(\)', '(select auth.uid())', 'g');
      u := regexp_replace(u, '\(\s*select\s+has_archive_access\(\)\s*\)|has_archive_access\(\)', '(select has_archive_access())', 'g');
    end if;
    if c is not null then
      c := regexp_replace(c, '\(\s*select\s+auth\.uid\(\)\s*\)|auth\.uid\(\)', '(select auth.uid())', 'g');
      c := regexp_replace(c, '\(\s*select\s+has_archive_access\(\)\s*\)|has_archive_access\(\)', '(select has_archive_access())', 'g');
    end if;
    execute format('alter policy %I on %I.%I%s%s',
      r.policyname, r.schemaname, r.tablename,
      case when u is not null then ' using (' || u || ')' else '' end,
      case when c is not null then ' with check (' || c || ')' else '' end
    );
  end loop;
end $$;

-- Covering indexes for the 7 foreign keys flagged as unindexed.
create index if not exists idx_feature_requests_requested_by on public.feature_requests (requested_by);
create index if not exists idx_saved_emails_email_id on public.saved_emails (email_id);
create index if not exists idx_support_chat_messages_sent_by on public.support_chat_messages (sent_by);
create index if not exists idx_support_email_replies_sent_by on public.support_email_replies (sent_by);
create index if not exists idx_team_invites_invited_by on public.team_invites (invited_by);
create index if not exists idx_teams_created_by on public.teams (created_by);
create index if not exists idx_upgrade_clicks_user_id on public.upgrade_clicks (user_id);
