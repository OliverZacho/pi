-- ============================================================
-- Least-privilege write paths for the public "request a feature" and
-- "request a brand" forms.
--
-- The /api/feature-requests and /api/brand-requests routes are unauthenticated
-- and internet-facing (the brand form is open to logged-out visitors), so we
-- don't want them holding the service-role key. These SECURITY DEFINER
-- functions become the *only* write path: RLS on both tables stays fully
-- locked, each function can only insert into its one table, it validates the
-- payload in the database (defence in depth), and it stamps the caller's own
-- auth.uid() (null for logged-out visitors) rather than trusting a client-
-- supplied id.
--
-- Mirrors the record_upgrade_click pattern already used in this schema, and is
-- granted to anon/authenticated so the public forms can write through the
-- ordinary cookie-scoped client — no service role in the request path.
-- ============================================================

-- "Request a feature" (account menu). Stamps the caller's id, and looks the
-- caller's email up server-side so the route never has to pass it.
create or replace function public.record_feature_request(
  p_message text
)
returns void
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
  -- Matches MAX_FEATURE_REQUEST_MESSAGE in lib/feature-requests-db.ts.
  if length(v_message) > 2000 then
    raise exception 'feature request message too long' using errcode = '22023';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.feature_requests (message, requested_by, requester_email)
  values (v_message, auth.uid(), v_email);
end;
$$;

revoke all on function public.record_feature_request(text) from public;
grant execute on function public.record_feature_request(text)
  to anon, authenticated, service_role;

-- "Request a brand" (Explore filter empty state + Brands page). Open to
-- logged-out visitors; stamps the caller's id when there is one.
create or replace function public.record_brand_request(
  p_company_name text,
  p_website text
)
returns void
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
  -- Matches MAX_BRAND_REQUEST_FIELD in lib/brand-requests-db.ts.
  if length(v_company) > 200 or length(v_website) > 200 then
    raise exception 'brand request field too long' using errcode = '22023';
  end if;

  insert into public.brand_requests (company_name, website, requested_by)
  values (v_company, v_website, auth.uid());
end;
$$;

revoke all on function public.record_brand_request(text, text) from public;
grant execute on function public.record_brand_request(text, text)
  to anon, authenticated, service_role;
