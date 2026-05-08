-- Pirol email enrichment migration.
-- Adds per-email signals derived from deterministic extraction (ESP, dark mode,
-- GIF flag, preheader, link metadata) and from the LLM (discount, promo code,
-- primary CTA). Adds an optional email_products table for the vision pass.

-- ---------------------------------------------------------------------------
-- captured_emails: new enrichment columns.
-- ---------------------------------------------------------------------------
alter table public.captured_emails
  add column if not exists esp_provider text,
  add column if not exists esp_confidence numeric(4, 3),
  add column if not exists esp_signals jsonb,
  add column if not exists preheader text,
  add column if not exists has_gif boolean not null default false,
  add column if not exists has_dark_mode boolean not null default false,
  add column if not exists discount_percent numeric(5, 2),
  add column if not exists discount_amount numeric(10, 2),
  add column if not exists currency text,
  add column if not exists promo_code text,
  add column if not exists primary_cta_text text,
  add column if not exists primary_cta_url text,
  add column if not exists auth_results jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.captured_emails
  add constraint captured_emails_esp_confidence_range
    check (esp_confidence is null or (esp_confidence >= 0 and esp_confidence <= 1));

alter table public.captured_emails
  add constraint captured_emails_discount_percent_range
    check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100));

alter table public.captured_emails
  add constraint captured_emails_currency_format
    check (currency is null or currency ~ '^[A-Za-z]{3}$');

create index if not exists captured_emails_esp_provider_idx
  on public.captured_emails (esp_provider)
  where esp_provider is not null;

create index if not exists captured_emails_discount_percent_idx
  on public.captured_emails (received_at desc)
  where discount_percent is not null;

create index if not exists captured_emails_has_gif_idx
  on public.captured_emails (has_gif)
  where has_gif = true;

create index if not exists captured_emails_has_dark_mode_idx
  on public.captured_emails (has_dark_mode)
  where has_dark_mode = true;

create index if not exists captured_emails_promo_code_idx
  on public.captured_emails (promo_code)
  where promo_code is not null;

-- ---------------------------------------------------------------------------
-- email_products: optional structured products extracted via vision LLM.
-- One captured email can yield zero or many product rows.
-- ---------------------------------------------------------------------------
create table if not exists public.email_products (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.captured_emails(id) on delete cascade,
  name text,
  price numeric(10, 2),
  currency text,
  discount_percent numeric(5, 2),
  image_storage_path text,
  source_url text,
  bbox jsonb,
  extracted_at timestamptz not null default now()
);

create index if not exists email_products_email_id_idx
  on public.email_products (email_id);

alter table public.email_products enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'email_products' and policyname = 'service_role_full_access_email_products'
  ) then
    create policy service_role_full_access_email_products
    on public.email_products
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

drop policy if exists email_products_admin_all on public.email_products;
create policy email_products_admin_all
on public.email_products
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

grant select, insert, update, delete on public.email_products to authenticated;
