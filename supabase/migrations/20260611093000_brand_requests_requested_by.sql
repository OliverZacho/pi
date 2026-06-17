-- Attribute brand requests to the signed-in requester so the app can
-- notify them ("<Brand> was added to the archive") once an operator
-- fulfils the request. Logged-out submissions keep a NULL requester and
-- simply never produce a notification.

alter table public.brand_requests
  add column if not exists requested_by uuid references auth.users(id) on delete set null;

-- The sidebar notices query asks "handled requests for this user".
create index if not exists brand_requests_requested_by_status_idx
  on public.brand_requests (requested_by, status)
  where requested_by is not null;
