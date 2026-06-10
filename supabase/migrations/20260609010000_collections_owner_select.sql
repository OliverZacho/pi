-- ============================================================
-- Close the world-readable collections leak.
--
-- `collections` and `collection_emails` previously had a SELECT policy of
-- `USING (true)` granted to `anon` (and `authenticated`) — meaning anyone
-- with the public anon key could read EVERY user's collections (names,
-- share slugs, rule definitions, user_id) and their email memberships, not
-- just shared ones. It was also the only SELECT policy on these tables, so
-- it doubled as how owners read their own rows.
--
-- Replace it with owner-scoped, entitlement-gated SELECT policies (matching
-- the other personal tables). The public share view (`/c/[slug]`) reads via
-- the service-role client, which bypasses RLS, so sharing is unaffected.
-- ============================================================

drop policy if exists collections_public_select on public.collections;
drop policy if exists collection_emails_public_select on public.collection_emails;

create policy collections_member_select on public.collections
  for select to authenticated
  using ((user_id = auth.uid()) and public.has_archive_access());

create policy collection_emails_member_select on public.collection_emails
  for select to authenticated
  using (
    (exists (
      select 1
      from public.collections c
      where c.id = collection_emails.collection_id
        and c.user_id = auth.uid()
    ))
    and public.has_archive_access()
  );
