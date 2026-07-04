-- ---------------------------------------------------------------------------
-- brand_send_stats: per-brand ESP + cadence aggregates, computed in the DB.
--
-- Replaces the app-side pass that pulled up to 20k captured-email rows into
-- the serverless function on every /brands list + facets request just to
-- derive each brand's modal ESP and mean days between sends. One row per
-- brand crosses the wire instead.
--
-- The mean of consecutive send gaps telescopes to
-- (max(received_at) - min(received_at)) / (count - 1), so no window
-- functions are needed. Unlike the old capped scan this aggregates the
-- brand's full history, which is the more honest cadence anyway.
--
-- security_invoker so the caller's RLS on captured_emails applies: entitled
-- subscribers and admins see stats, everyone else sees nothing — exactly the
-- visibility the old direct query had. mode() ignores NULL esp_provider rows.
-- ---------------------------------------------------------------------------
create or replace view public.brand_send_stats
with (security_invoker = true) as
select
  company_id,
  count(*)::int as email_count,
  mode() within group (order by esp_provider) as primary_esp,
  case
    when count(*) >= 2 then
      (extract(epoch from (max(received_at) - min(received_at)))
        / 86400.0 / (count(*) - 1))::double precision
  end as avg_days_between
from public.captured_emails
where company_id is not null
group by company_id;

grant select on public.brand_send_stats to authenticated;
grant select on public.brand_send_stats to service_role;
