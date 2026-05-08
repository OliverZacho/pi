-- Run the company_email_stats view with the querying user's privileges so
-- existing RLS on captured_emails (admins only) applies through the view
-- instead of the view creator's permissions. Resolves the
-- security_definer_view advisor warning.
alter view public.company_email_stats set (security_invoker = true);
