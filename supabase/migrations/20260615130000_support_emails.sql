-- Pirol — inbound support inbox.
--
-- Mail sent to support@pirol.app arrives through the SAME Resend inbound
-- webhook as brand newsletters (app/api/webhooks/resend), but the ingest
-- processor (lib/support-inbox.ts) branches support recipients here instead
-- of running the captured_emails newsletter pipeline. Admin-only: viewable
-- and replyable from the Admin → Support tab.
--
-- RLS mirrors webhook_events: service_role has full access (used by the
-- processor + reply route via the service-role client), and authenticated
-- admins (rows in public.admin_users) may read/manage from the dashboard.

create table if not exists public.support_emails (
  id uuid primary key default gen_random_uuid(),
  resend_message_id text not null,
  from_address text not null,
  from_name text,
  to_address text not null,
  subject text not null default '(no subject)',
  plain_text text,
  html text,
  received_at timestamptz not null default now(),
  status text not null default 'unread'
    check (status in ('unread', 'read', 'archived')),
  replied_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists support_emails_resend_message_id_unique
  on public.support_emails (resend_message_id);

create index if not exists support_emails_status_received_at_idx
  on public.support_emails (status, received_at desc);

create table if not exists public.support_email_replies (
  id uuid primary key default gen_random_uuid(),
  support_email_id uuid not null
    references public.support_emails(id) on delete cascade,
  body text not null,
  sent_by uuid references auth.users(id) on delete set null,
  sent_by_email text,
  resend_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists support_email_replies_email_idx
  on public.support_email_replies (support_email_id, created_at);

alter table public.support_emails enable row level security;
alter table public.support_email_replies enable row level security;

drop policy if exists support_emails_service_role_all on public.support_emails;
create policy support_emails_service_role_all
  on public.support_emails
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists support_replies_service_role_all on public.support_email_replies;
create policy support_replies_service_role_all
  on public.support_email_replies
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists support_emails_admin_all on public.support_emails;
create policy support_emails_admin_all
  on public.support_emails
  for all
  to authenticated
  using (
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

drop policy if exists support_replies_admin_all on public.support_email_replies;
create policy support_replies_admin_all
  on public.support_email_replies
  for all
  to authenticated
  using (
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

grant select, insert, update, delete on public.support_emails to authenticated;
grant select, insert, update, delete on public.support_email_replies to authenticated;
