-- Add `education` and `survey` to the captured_emails category taxonomy.
--
-- `education` captures how-to / tutorial / recipe / owner-tips / walkthrough /
-- product-academy emails whose primary value is teaching the reader a task or
-- skill. These previously fell into `content`, which diluted editorial metrics.
--
-- `survey` captures feedback requests, NPS, customer research panels,
-- beta-tester recruitment, review/rating asks, and "help us improve" emails
-- that previously landed in `other` or `content`.

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
    'transactional',
    'seasonal',
    'partnership',
    'company_news',
    'survey',
    'other'
  ));
