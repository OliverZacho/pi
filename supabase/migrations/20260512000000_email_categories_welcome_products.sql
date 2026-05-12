-- Add `welcome` and `products` to the captured_emails category taxonomy.
--
-- `welcome` captures the onboarding / sign-up emails (welcome to <brand>,
-- thanks for subscribing, double opt-in, getting started) that previously
-- landed in `other`, `content`, or occasionally `loyalty` via the
-- `welcome back` regex.
--
-- `products` captures emails that showcase an existing product line or
-- specific products (shop the collection, new arrivals, restock,
-- bestsellers, gift guides, lookbooks) without a discount headline and
-- without launching something new. These used to get filed under `content`
-- or `event` somewhat at random.

alter table public.captured_emails
  drop constraint if exists captured_emails_category_check;

alter table public.captured_emails
  add constraint captured_emails_category_check
  check (category in (
    'sale',
    'product_launch',
    'products',
    'event',
    'content',
    'loyalty',
    'welcome',
    'transactional',
    'seasonal',
    'partnership',
    'company_news',
    'other'
  ));
