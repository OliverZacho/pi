-- ============================================================
-- Let the public "Request a brand" form record the canonical domain.
--
-- The form now offers Logo.dev Brand Search suggestions while the visitor
-- types; picking one yields a normalized registrable host. Persist it in
-- `brand_requests.domain` (added by the onboarding migration) so the
-- /following "Requested" card and the admin queue get a real logo and the
-- per-user pending dedupe applies to form requests too.
--
-- Adds an optional `p_domain` parameter. Callers still on the 3-arg shape
-- (named params, no domain) keep working via the default.
-- ============================================================

drop function if exists public.record_brand_request(text, text, text);

create function public.record_brand_request(
  p_company_name text,
  p_website text,
  p_client_key text default null,
  p_domain text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := btrim(p_company_name);
  v_website text := btrim(p_website);
  v_domain text := nullif(lower(btrim(p_domain)), '');
begin
  if v_company is null or length(v_company) = 0
     or v_website is null or length(v_website) = 0 then
    raise exception 'company name and website are required' using errcode = '22023';
  end if;
  if length(v_company) > 200 or length(v_website) > 200
     or (v_domain is not null and length(v_domain) > 200) then
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

  begin
    insert into public.brand_requests (company_name, website, domain, requested_by)
    values (v_company, v_website, v_domain, auth.uid());
  exception when unique_violation then
    -- brand_requests_pending_user_domain_uidx: this user already has a
    -- pending request for the same domain. Treat the resubmit as a no-op.
    null;
  end;

  return 'ok';
end;
$$;

revoke all on function public.record_brand_request(text, text, text, text) from public;
grant execute on function public.record_brand_request(text, text, text, text)
  to anon, authenticated, service_role;
