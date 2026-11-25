-- ---------------------------------------------------------------------------
-- Refresh the /docs insight snapshot once a day instead of twice an hour.
--
-- The benchmarks it feeds (ESP share, send hour, cadence, discounts, content
-- mix) are archive-wide over ~21k emails; a day of new mail doesn't move them.
-- 04:12 UTC keeps clear of the nightly jobs at 03:17 and 03:27. The app's own
-- 30-minute cache sits on top, so figures lag new email by up to ~24.5 hours.
-- ---------------------------------------------------------------------------

select cron.alter_job(jobid, schedule := '12 4 * * *')
from cron.job
where jobname = 'pirol-docs-insight-stats';
