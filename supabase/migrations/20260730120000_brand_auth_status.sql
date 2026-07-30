-- Per-brand email authentication posture: DMARC enforcement, BIMI, and VMC.
--
-- BIMI (Brand Indicators for Message Identification) lets a brand publish its
-- logo in a DNS TXT record at `default._bimi.<domain>`; a VMC/CMC certificate
-- (the `a=` tag) is a CA-verified trademark that earns the "verified sender"
-- checkmark in Gmail/Apple Mail. BIMI only renders when the sender's DMARC is
-- at enforcement (p=quarantine or p=reject), so all three facts are tracked
-- together. Everything here is derived from public DNS lookups against each
-- brand's real sending domain (see scripts/check-brand-auth.ts) -- no inbound
-- mail is required. This is a public trust signal, surfaced on brand pages and
-- in comparisons, so reads are open; writes go through the service role only.

create table if not exists public.brand_auth_status (
  company_id      uuid primary key references public.companies (id) on delete cascade,

  -- The From-header domain we evaluated (the dominant sender domain in the
  -- brand's captured mail, e.g. "e.arket.com"), and the domain where the
  -- effective record was actually found after walking up to the org domain
  -- (e.g. "arket.com"). These differ because BIMI usually lives at the apex.
  sender_domain   text,
  auth_domain     text,

  -- Raw DMARC facts. dmarc_policy is null when no record exists at all.
  dmarc_policy    text,        -- 'none' | 'quarantine' | 'reject' | null
  dmarc_enforced  boolean not null default false,

  -- Raw BIMI facts.
  bimi_present    boolean not null default false,   -- record with an l= logo
  bimi_logo_url   text,
  vmc_present     boolean not null default false,   -- a= authority (VMC/CMC)
  vmc_issuer      text,        -- 'digicert' | 'entrust' | other host label

  -- Derived headline bucket, for cheap filtering/aggregation:
  --   'verified'      BIMI + VMC + DMARC enforced (shows a verified mark)
  --   'bimi'          BIMI + DMARC enforced, no VMC (logo, no checkmark)
  --   'bimi_inactive' BIMI record present but DMARC not enforced -> won't render
  --   'dmarc'         DMARC enforced, no BIMI (eligible but not adopted)
  --   'none'          neither enforced DMARC nor BIMI
  auth_tier       text not null default 'none',

  checked_at      timestamptz not null default now(),
  error           text         -- populated when the DNS sweep failed for a row
);

comment on table public.brand_auth_status is
  'Per-brand email authentication posture (DMARC/BIMI/VMC) from public DNS. See scripts/check-brand-auth.ts.';

alter table public.brand_auth_status enable row level security;

-- Public read: this is non-sensitive brand metadata shown on brand pages.
drop policy if exists brand_auth_status_read on public.brand_auth_status;
create policy brand_auth_status_read
  on public.brand_auth_status
  for select
  using (true);

-- Writes are performed by the sweep script via the service-role key, which
-- bypasses RLS; no anon/authenticated write policy is granted.
