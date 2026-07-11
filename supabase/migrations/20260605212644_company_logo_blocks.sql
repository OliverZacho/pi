-- Pirol per-company logo block-list.
-- Lets an admin exclude specific mirrored images (QR codes, near-white logos,
-- non-logo art) from the automatic logo picker for a given company. Storage
-- paths are content-addressed by SHA-1 (see lib/storage.ts mirrorRemoteImages),
-- so a block row pins to exact image bytes — scoped per company because a QR
-- code or hero image is brand-specific.

create table if not exists public.company_logo_blocks (
  company_id uuid not null references public.companies(id) on delete cascade,
  storage_path text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (company_id, storage_path)
);

create index if not exists company_logo_blocks_company_idx
  on public.company_logo_blocks (company_id);

alter table public.company_logo_blocks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_logo_blocks'
      and policyname = 'service_role_full_access_company_logo_blocks'
  ) then
    create policy service_role_full_access_company_logo_blocks
    on public.company_logo_blocks
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

drop policy if exists company_logo_blocks_admin_all on public.company_logo_blocks;
create policy company_logo_blocks_admin_all
on public.company_logo_blocks
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

grant select, insert, delete on public.company_logo_blocks to authenticated;
