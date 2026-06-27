-- Remove `transactional` from the captured_emails category taxonomy.
--
-- Pirol subscribes to brands' broadcast mailing lists but never places orders,
-- so genuine transactional mail (receipts, order confirmations, shipping
-- updates, invoices) never reaches our inboxes. In practice every row that
-- landed in `transactional` was a false positive — the rule-based classifier's
-- bare `receipt` token matched deliverability boilerplate ("to ensure receipt
-- of our emails, please add us to your address book") and overrode the LLM's
-- correct read. The category is being dropped entirely; existing rows have
-- already been re-classified into their real buckets (sale / welcome /
-- product_launch / other) before this migration runs.

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
    'education',
    'loyalty',
    'welcome',
    'seasonal',
    'partnership',
    'company_news',
    'survey',
    'other'
  ));
