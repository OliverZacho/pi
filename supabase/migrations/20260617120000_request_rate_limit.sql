-- ============================================================
-- Coarse, bot-targeted rate limiting for the public request forms.
--
-- The /api/feature-requests and /api/brand-requests routes are unauthenticated
-- and internet-facing. The SECURITY DEFINER write functions are now extended
-- with a fixed-window counter keyed on a hashed client id (sha256 of the
-- caller's IP, computed in the route). The window is generous enough that a
-- human never hits it but low enough to blunt scripted spam. Callers that
-- supply no key (e.g. a direct PostgREST call) share a single "noip" bucket,
-- so they're collectively bounded rather than unlimited.
-- ============================================================

create table if not exists public.rate_limit_counters (
  bucket text primary key,
  count integer not null default 0,
  expires_at timestamptz not null
);

-- Only the SECURITY DEFINER functions (running as the table owner) touch this
-- table; anon/authenticated get no direct access.
alter table public.rate_limit_counters enable row level security;

-- Atomically bump a fixed-window counter and report whether the caller is
-- still under the limit. Resets the window once it has expired.
create or replace function public.bump_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limit_counters (bucket, count, expires_at)
  values (p_bucket, 1, now() + p_window)
  on conflict (bucket) do update
    set count = case
          when rate_limit_counters.expires_at < now() then 1
          else rate_limit_counters.count + 1
        end,
        expires_at = case
          when rate_limit_counters.expires_at < now() then now() + p_window
          else rate_limit_counters.expires_at
        end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.bump_rate_limit(text, integer, interval) from public;

-- Replace the request writers with rate-limited variants. The added p_client_key
-- parameter changes the signature, so drop the old ones first (create-or-replace
-- can't alter the argument list). Both now return 'ok' | 'rate_limited' so the
-- route can answer 429 without relying on exception parsing.

drop function if exists public.record_feature_request(text);

create function public.record_feature_request(
  p_message text,
  p_client_key text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message text := btrim(p_message);
  v_email text;
begin
  if v_message is null or length(v_message) = 0 then
    raise exception 'feature request message is required' using errcode = '22023';
  end if;
  if length(v_message) > 2000 then
    raise exception 'feature request message too long' using errcode = '22023';
  end if;

  -- Bot throttle: at most 8 submissions per client per 10 minutes.
  if not public.bump_rate_limit(
    'feature_request:' || coalesce(p_client_key, 'noip'),
    8,
    interval '10 minutes'
  ) then
    return 'rate_limited';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.feature_requests (message, requested_by, requester_email)
  values (v_message, auth.uid(), v_email);

  return 'ok';
end;
$$;

revoke all on function public.record_feature_request(text, text) from public;
grant execute on function public.record_feature_request(text, text)
  to anon, authenticated, service_role;

drop function if exists public.record_brand_request(text, text);

create function public.record_brand_request(
  p_company_name text,
  p_website text,
  p_client_key text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := btrim(p_company_name);
  v_website text := btrim(p_website);
begin
  if v_company is null or length(v_company) = 0
     or v_website is null or length(v_website) = 0 then
    raise exception 'company name and website are required' using errcode = '22023';
  end if;
  if length(v_company) > 200 or length(v_website) > 200 then
    raise exception 'brand request field too long' using errcode = '22023';
  end if;

  -- Bot throttle: at most 8 submissions per client per 10 minutes.
  if not public.bump_rate_limit(
    'brand_request:' || coalesce(p_client_key, 'noip'),
    8,
    interval '10 minutes'
  ) then
    return 'rate_limited';
  end if;

  insert into public.brand_requests (company_name, website, requested_by)
  values (v_company, v_website, auth.uid());

  return 'ok';
end;
$$;

revoke all on function public.record_brand_request(text, text, text) from public;
grant execute on function public.record_brand_request(text, text, text)
  to anon, authenticated, service_role;
