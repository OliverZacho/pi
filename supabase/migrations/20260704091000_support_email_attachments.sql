-- Pirol — attachments on inbound support mail.
--
-- Inbound support messages can carry pictures / PDFs. The ingest processor
-- (lib/support-inbox.ts) downloads each attachment from Resend's short-lived
-- signed URL right after storing the message, uploads the bytes to the
-- private `support-attachments` bucket, and records a row here. The Admin →
-- Support tab lists them and serves the bytes through an admin-gated API
-- route (/api/admin/support/:id/attachments/:attachmentId) — Resend's own
-- URLs expire, so the copy in storage is the durable one.
--
-- RLS mirrors support_emails: service_role full access (ingest + serving
-- route), authenticated admins may read from the dashboard.

create table if not exists public.support_email_attachments (
  id uuid primary key default gen_random_uuid(),
  support_email_id uuid not null
    references public.support_emails(id) on delete cascade,
  resend_attachment_id text not null,
  filename text,
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  content_id text,
  is_inline boolean not null default false,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists support_email_attachments_resend_unique
  on public.support_email_attachments (support_email_id, resend_attachment_id);

create index if not exists support_email_attachments_email_idx
  on public.support_email_attachments (support_email_id, created_at);

alter table public.support_email_attachments enable row level security;

drop policy if exists support_attachments_service_role_all
  on public.support_email_attachments;
create policy support_attachments_service_role_all
  on public.support_email_attachments
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists support_attachments_admin_read
  on public.support_email_attachments;
create policy support_attachments_admin_read
  on public.support_email_attachments
  for select
  to authenticated
  using (
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

grant select on public.support_email_attachments to authenticated;

-- Private bucket for the attachment bytes (25 MB per-object cap, matching
-- the ingest-side skip threshold).
insert into storage.buckets (id, name, public, file_size_limit)
values ('support-attachments', 'support-attachments', false, 26214400)
on conflict (id) do nothing;
