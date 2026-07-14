-- Pirol — signup probe diagnostics.
--
-- A probe is a unique @pirol.app address minted for ONE specific signup
-- surface on a brand's site (their en/sign-up page, a popup, the footer
-- form, ...). We subscribe with it manually, then the Admin → Probes tab
-- reads whatever landed at that address straight out of captured_emails
-- (matched by recipient_email at query time — no ingest changes) and
-- classifies each mail as welcome / campaign / repeat welcome. That tells
-- us which of a brand's signup forms actually put subscribers on the
-- campaign list and which only fire a welcome automation.
--
-- Quarantine: probe addresses are never added to company_inboxes, so
-- their mail stores with company_id/inbox_id = null and can never leak
-- into the public catalogue, brand pages, or Compare.
--
-- RLS mirrors support_emails: service_role full access, authenticated
-- admins (rows in public.admin_users) read/manage from the dashboard.

create table if not exists public.signup_probes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  address text not null,
  note text not null default '',
  surface_type text not null default 'other'
    check (surface_type in ('standalone_page', 'popup', 'footer_form', 'other')),
  created_at timestamptz not null default now()
);

create unique index if not exists signup_probes_address_unique
  on public.signup_probes (lower(address));

create index if not exists signup_probes_company_id_idx
  on public.signup_probes (company_id);

-- The Probes board looks captured mail up by the address it was sent to.
create index if not exists captured_emails_recipient_email_idx
  on public.captured_emails (recipient_email);

alter table public.signup_probes enable row level security;

drop policy if exists signup_probes_service_role_all on public.signup_probes;
create policy signup_probes_service_role_all
  on public.signup_probes
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists signup_probes_admin_all on public.signup_probes;
create policy signup_probes_admin_all
  on public.signup_probes
  for all
  to authenticated
  using (
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

grant select, insert, update, delete on public.signup_probes to authenticated;
