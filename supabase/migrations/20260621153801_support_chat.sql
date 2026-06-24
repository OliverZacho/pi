-- Pirol — in-app support chat (messenger-style).
--
-- Distinct from the email-based support inbox (support_emails): this powers the
-- live chat that opens from the "Need help? → Contact support" panel for
-- logged-in users. Each user has at most one open thread (a continuous
-- conversation); messages carry a `sender` of 'user' or 'admin'. Admins triage
-- and reply from the SAME Admin → Support tab as the email inbox.
--
-- Denormalised counters on the thread (user_unread_count / admin_unread_count)
-- and last_message_* are maintained by a trigger on message insert so both the
-- user's notification dot and the admin's unread badge are a single cheap read.
--
-- RLS: a user may read/write only their own thread + its messages; authenticated
-- admins (rows in public.admin_users) and service_role may read/manage all.

create table if not exists public.support_chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  status text not null default 'open'
    check (status in ('open', 'archived')),
  last_message_at timestamptz not null default now(),
  last_message_sender text check (last_message_sender in ('user', 'admin')),
  -- Unread admin replies awaiting the user, and unread user messages awaiting an admin.
  user_unread_count integer not null default 0,
  admin_unread_count integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists support_chat_threads_user_id_unique
  on public.support_chat_threads (user_id);

create index if not exists support_chat_threads_last_message_idx
  on public.support_chat_threads (last_message_at desc);

create table if not exists public.support_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null
    references public.support_chat_threads(id) on delete cascade,
  sender text not null check (sender in ('user', 'admin')),
  body text not null,
  -- For admin messages: which admin sent it. Null for user messages.
  sent_by uuid references auth.users(id) on delete set null,
  sent_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists support_chat_messages_thread_idx
  on public.support_chat_messages (thread_id, created_at);

-- Keep the thread's denormalised activity fields in sync on every new message.
create or replace function public.support_chat_touch_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_chat_threads t
  set
    last_message_at = new.created_at,
    last_message_sender = new.sender,
    status = 'open',
    user_unread_count = case
      when new.sender = 'admin' then t.user_unread_count + 1
      else t.user_unread_count
    end,
    admin_unread_count = case
      when new.sender = 'user' then t.admin_unread_count + 1
      else t.admin_unread_count
    end
  where t.id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists support_chat_messages_touch on public.support_chat_messages;
create trigger support_chat_messages_touch
  after insert on public.support_chat_messages
  for each row execute function public.support_chat_touch_thread();

alter table public.support_chat_threads enable row level security;
alter table public.support_chat_messages enable row level security;

-- service_role: full access (reply route / counter resets via service-role client).
drop policy if exists support_chat_threads_service_role_all on public.support_chat_threads;
create policy support_chat_threads_service_role_all
  on public.support_chat_threads
  for all to service_role using (true) with check (true);

drop policy if exists support_chat_messages_service_role_all on public.support_chat_messages;
create policy support_chat_messages_service_role_all
  on public.support_chat_messages
  for all to service_role using (true) with check (true);

-- Admins: full access from the dashboard.
drop policy if exists support_chat_threads_admin_all on public.support_chat_threads;
create policy support_chat_threads_admin_all
  on public.support_chat_threads
  for all to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists support_chat_messages_admin_all on public.support_chat_messages;
create policy support_chat_messages_admin_all
  on public.support_chat_messages
  for all to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- Owner: a user may read + update (mark read) their own thread.
drop policy if exists support_chat_threads_owner_select on public.support_chat_threads;
create policy support_chat_threads_owner_select
  on public.support_chat_threads
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists support_chat_threads_owner_insert on public.support_chat_threads;
create policy support_chat_threads_owner_insert
  on public.support_chat_threads
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists support_chat_threads_owner_update on public.support_chat_threads;
create policy support_chat_threads_owner_update
  on public.support_chat_threads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Owner: a user may read messages in their own thread and post user messages.
drop policy if exists support_chat_messages_owner_select on public.support_chat_messages;
create policy support_chat_messages_owner_select
  on public.support_chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.support_chat_threads t
      where t.id = thread_id and t.user_id = auth.uid()
    )
  );

drop policy if exists support_chat_messages_owner_insert on public.support_chat_messages;
create policy support_chat_messages_owner_insert
  on public.support_chat_messages
  for insert to authenticated
  with check (
    sender = 'user'
    and exists (
      select 1 from public.support_chat_threads t
      where t.id = thread_id and t.user_id = auth.uid()
    )
  );

grant select, insert, update on public.support_chat_threads to authenticated;
grant select, insert on public.support_chat_messages to authenticated;
