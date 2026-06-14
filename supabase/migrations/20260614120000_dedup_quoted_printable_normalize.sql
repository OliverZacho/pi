-- Make identical-campaign de-duplication robust to quoted-printable text.
--
-- captured_emails.plain_text is stored as the raw quoted-printable MIME
-- part Resend hands us, not decoded text. Two QP artifacts defeated the
-- original fingerprint (see 20260608020000_dedup_identical_emails.sql),
-- so the *same* welcome blast sent to several mailing lists hashed
-- differently and never collapsed:
--
--   1. Long per-recipient tracking URLs are soft-wrapped with `=\n`, e.g.
--        ...k=3da2ca9bd3d1de56a3a518503094=\n559e4a&se=3d...
--      The URL strip `https?://[^\s]+` halts at that embedded newline, so
--      only the head of each link was removed and the per-list tokens
--      (campaign id, recipient id, seed address) survived into the hash.
--   2. The same special character can arrive encoded (`=C2=A0`) in one
--      copy and already decoded (a literal U+00A0) in another, so even
--      after joining the soft-breaks two copies could still differ.
--
-- The hardened fingerprint normalizes both: drop the soft line-breaks so
-- wrapped URLs are contiguous, strip URLs, then drop every QP-encoded
-- byte (`=XX`) *and* every non-ASCII character so the encoded and decoded
-- forms of a special char both vanish. What remains is the ASCII body
-- text, which is more than enough to tell two campaigns apart (verified:
-- no two emails with different subjects collide under this normalization).
-- Every step is a regexp_replace that cannot fail, so it stays safe to run
-- inside the BEFORE INSERT trigger.

create or replace function public.captured_email_content_hash(
  p_subject text,
  p_plain_text text
)
returns text
language sql
immutable
as $$
  select md5(
    lower(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            -- 1. drop quoted-printable soft line-breaks ("=" before a newline)
            --    so wrapped tracking URLs become one contiguous token.
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
          -- 3. strip QP-encoded bytes (=C2=A0, =E2=80=94, ...) and any
          --    literal non-ASCII char, so encoded vs decoded specials match.
          '=[0-9A-Fa-f]{2}|[^\x20-\x7E]',
          ' ',
          'g'
        ),
        -- 4. collapse whitespace runs.
        '\s+',
        ' ',
        'g'
      )
    )
  );
$$;

comment on column public.captured_emails.content_hash is
  'Fingerprint of subject + plain text, normalized to survive quoted-printable encoding: soft line-breaks joined, URLs stripped, QP-encoded/non-ASCII bytes dropped. Identical campaign copies sent to different mailing lists hash equal even though their per-recipient tracking links differ. Maintained by the captured_emails_set_dedup trigger.';

-- Re-stamp every row with the hardened fingerprint, then rebuild the
-- duplicate groups from scratch: each group's earliest copy is canonical,
-- later copies point at it, and anything that no longer groups is unlinked.
update public.captured_emails
   set content_hash = public.captured_email_content_hash(subject, plain_text);

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
