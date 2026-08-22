-- Normalized search document for captured emails.
--
-- Smart-collection and Explore search previously matched multi-word terms
-- with a `~*` regex across subject/preheader/primary_cta_text/plain_text so
-- that typographic separators (U+00A0, U+202F, curly apostrophes) wouldn't
-- hide matches. The trigram recheck of that regex over full email bodies
-- costs ~1s per term (vs ~90ms for ilike) and pushed rule evaluation past
-- the authenticated role's 8s statement timeout, 500-ing collection pages.
--
-- Instead we normalize once at write time into `search_text`: the four
-- searched columns concatenated, zero-width/invisible characters stripped,
-- and every run of whitespace-or-apostrophe characters collapsed to a
-- single space. Every search is then a single cheap `ilike` against this
-- one column. Displayed columns keep their original typography.
--
-- Prod backfill of existing rows was run separately in small batches (one
-- bulk UPDATE would balloon WAL; see the 2026-07-06 disk autoscale). On a
-- fresh database the trigger keeps the column populated from the start.

alter table public.captured_emails
  add column if not exists search_text text;

-- Mirrors SEPARATOR_RUN / STRIP_CHARS in lib/search-term.ts; the two must
-- stay in lockstep or queries and stored text will disagree.
create or replace function public.email_search_text(
  subject text,
  preheader text,
  primary_cta_text text,
  plain_text text
) returns text
language sql
immutable
set search_path = ''
as $fn$
  select trim(
    regexp_replace(
      regexp_replace(
        coalesce(subject, '') || ' ' || coalesce(preheader, '') || ' '
          || coalesce(primary_cta_text, '') || ' ' || coalesce(plain_text, ''),
        -- zero-width space/non-joiner/joiner, BOM, soft hyphen: invisible
        -- characters brands embed inside words; remove so the word matches.
        '[' || chr(8203) || chr(8204) || chr(8205) || chr(65279) || chr(173) || ']',
        '',
        'g'
      ),
      -- [[:space:]] covers the Unicode space separators (incl. U+00A0 and
      -- U+202F under this database's collation); the rest are apostrophes.
      '[[:space:]''‘’ʼ´`]+',
      ' ',
      'g'
    )
  )
$fn$;

create or replace function public.captured_emails_set_search_text()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.search_text := public.email_search_text(
    new.subject, new.preheader, new.primary_cta_text, new.plain_text
  );
  return new;
end
$fn$;

drop trigger if exists captured_emails_search_text_trg on public.captured_emails;
create trigger captured_emails_search_text_trg
  before insert or update of subject, preheader, primary_cta_text, plain_text
  on public.captured_emails
  for each row
  execute function public.captured_emails_set_search_text();

create index if not exists captured_emails_search_text_trgm_idx
  on public.captured_emails
  using gin (search_text gin_trgm_ops);
