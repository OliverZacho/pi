-- Strip per-recipient discount/voucher codes from the dedup fingerprint.
--
-- The fingerprint (see 20260608020000 and 20260614120000) already removes
-- URLs and quoted-printable artifacts, so identical multi-list sends
-- collapse. But some welcome flows print a *unique* discount code inline in
-- the body text (Café du Cycliste: "use the code below. NWS1G5GP29BM"),
-- and that code differs per recipient, so two copies of the same campaign
-- hashed differently and never collapsed.
--
-- Fix: after the existing normalization, drop every standalone token that
-- looks like a generated code — 8+ contiguous alphanumerics mixing at least
-- one letter and one digit (allowing leading/trailing punctuation). Real
-- copy that distinguishes campaigns survives: plain words carry no digits,
-- and prices/dates/percentages carry no letters. Verified against the full
-- table: 299 rows contain such tokens, and re-grouping under the new hash
-- links exactly the known Café du Cycliste pair — no existing group changes.
--
-- Deliberately NOT fuzzy similarity matching: a threshold like "95% equal"
-- would also merge genuinely distinct sends that reuse a template with one
-- line changed (e.g. an extended-deadline resend, which the offer-window
-- timeline must keep seeing as its own email).

create or replace function public.captured_email_content_hash(
  p_subject text,
  p_plain_text text
)
returns text
language sql
immutable
as $$
  select md5((
    select coalesce(
             string_agg(
               case
                 -- drop generated-code tokens: 8+ contiguous alphanumerics
                 -- with at least one digit and one letter (punctuation on
                 -- either side allowed, e.g. "NWS1G5GP29BM.").
                 when t.tok ~ '^[^a-z0-9]*[a-z0-9]{8,}[^a-z0-9]*$'
                  and t.tok ~ '[0-9]'
                  and t.tok ~ '[a-z]'
                 then ''
                 else t.tok
               end,
               ' ' order by t.ord
             ),
             ''
           )
      from regexp_split_to_table(
             lower(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     -- 1. drop quoted-printable soft line-breaks so wrapped
                     --    tracking URLs become one contiguous token.
                     replace(
                       coalesce(p_subject, '') || ' ' || coalesce(p_plain_text, ''),
                       '=' || chr(10),
                       ''
                     ),
                     -- 2. strip URLs (now uninterrupted by soft-breaks).
                     'https?://[^\s]+',
                     ' ',
                     'g'
                   ),
                   -- 3. strip QP-encoded bytes and literal non-ASCII chars.
                   '=[0-9A-Fa-f]{2}|[^\x20-\x7E]',
                   ' ',
                   'g'
                 ),
                 -- 4. collapse whitespace runs.
                 '\s+',
                 ' ',
                 'g'
               )
             ),
             ' '
           ) with ordinality as t(tok, ord)
  ));
$$;

comment on column public.captured_emails.content_hash is
  'Fingerprint of subject + plain text, normalized to survive per-recipient variance: quoted-printable soft line-breaks joined, URLs stripped, QP-encoded/non-ASCII bytes dropped, and generated-code tokens (8+ alphanumerics mixing letters and digits, e.g. unique discount codes) removed. Identical campaign copies hash equal even when tracking links or voucher codes differ. Maintained by the captured_emails_set_dedup trigger.';

-- Re-stamp only the rows whose fingerprint actually changes (rows that
-- contain a code-like token) — avoid rewriting the whole table.
update public.captured_emails
   set content_hash = public.captured_email_content_hash(subject, plain_text)
 where content_hash is distinct from
       public.captured_email_content_hash(subject, plain_text);

-- Rebuild duplicate groups, touching only rows whose link changes. The
-- captured_emails_group_segments_upd trigger re-syncs the affected groups'
-- group_segment_categories automatically.
with ranked as (
  select
    id,
    first_value(id) over (
      partition by company_id, content_hash
      order by received_at asc, id asc
    ) as canonical_id
  from public.captured_emails
  where company_id is not null
)
update public.captured_emails ce
   set duplicate_of = nullif(ranked.canonical_id, ce.id)
  from ranked
 where ce.id = ranked.id
   and ce.duplicate_of is distinct from nullif(ranked.canonical_id, ce.id);
