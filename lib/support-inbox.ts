import type { Resend } from "resend";
import { SUPPORT_EMAIL, SUPPORT_INBOX_ADDRESSES } from "./docs/support";
import { getSupabaseAdmin } from "./supabase-admin";
import type { Json } from "@/types/supabase";

/**
 * Inbound support inbox.
 *
 * Mail addressed to support@pirol.app rides the same Resend inbound webhook as
 * brand newsletters. The ingest processor calls {@link isSupportRecipient} on
 * each claimed event and, when it matches, routes the message through
 * {@link ingestSupportEmail} into `support_emails` — skipping the LLM
 * classification / logo / vision pipeline that only makes sense for captured
 * marketing mail.
 */

/** Private bucket holding downloaded attachment bytes (see the migration). */
export const SUPPORT_ATTACHMENT_BUCKET = "support-attachments";

/** Skip anything above the bucket's 25 MB object cap. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type ResendInboundEvent = {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    created_at?: string;
    from: string;
    to?: string[];
    bcc?: string[];
    cc?: string[];
    subject: string;
    message_id?: string;
  };
};

const SUPPORT_ADDRESS_SET = new Set(SUPPORT_INBOX_ADDRESSES);

/** Extracts the bare lowercase email from a `Name <email@host>` or raw form. */
export function normalizeAddress(value: string): string {
  const angle = value.match(/<([^>]+)>/);
  return (angle ? angle[1] : value).trim().toLowerCase();
}

/** Splits a `From` header into an optional display name and the address. */
export function parseFromHeader(value: string): {
  name: string | null;
  address: string;
} {
  const angle = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim();
    return { name: name.length > 0 ? name : null, address: angle[2].trim().toLowerCase() };
  }
  return { name: null, address: value.trim().toLowerCase() };
}

/** True when any recipient (to/cc/bcc) is one of the support inbox addresses. */
export function isSupportRecipient(recipients: readonly string[]): boolean {
  return recipients.some((recipient) =>
    SUPPORT_ADDRESS_SET.has(normalizeAddress(recipient))
  );
}

/** All recipient candidates carried on the inbound webhook payload. */
export function recipientsFromEvent(event: ResendInboundEvent): string[] {
  return [
    ...(event.data.to ?? []),
    ...(event.data.cc ?? []),
    ...(event.data.bcc ?? [])
  ];
}

/**
 * Fetches the full message body from Resend and stores it in `support_emails`.
 * Deduplicates on the Resend message id so a webhook replay is idempotent.
 */
export async function ingestSupportEmail(
  resend: Resend,
  event: ResendInboundEvent
): Promise<{ id: string; deduplicated: boolean }> {
  const { data: full, error: fetchError } = await resend.emails.receiving.get(
    event.data.email_id
  );

  if (fetchError || !full) {
    throw new Error(
      `fetch_support_email: ${fetchError?.message ?? "no body returned"}`
    );
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("support_emails")
    .select("id")
    .eq("resend_message_id", full.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(`support_dedup_lookup: ${existingError.message}`);
  }
  if (existing?.id) {
    return { id: existing.id, deduplicated: true };
  }

  const { name, address } = parseFromHeader(full.from);
  const recipients = [...(full.to ?? []), ...recipientsFromEvent(event)];
  const supportRecipient = recipients.find((recipient) =>
    SUPPORT_ADDRESS_SET.has(normalizeAddress(recipient))
  );
  const toAddress = normalizeAddress(supportRecipient ?? SUPPORT_EMAIL);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("support_emails")
    .insert({
      resend_message_id: full.id,
      from_address: address,
      from_name: name,
      to_address: toAddress,
      subject: full.subject ?? "(no subject)",
      plain_text: full.text ?? null,
      html: full.html ?? null,
      received_at:
        full.created_at ?? event.data.created_at ?? event.created_at,
      raw_payload: { event, full } as unknown as Json
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(`store_support_email: ${insertError?.message ?? "no row"}`);
  }

  await ingestSupportAttachments(resend, inserted.id, full.id, full.attachments ?? []);

  return { id: inserted.id, deduplicated: false };
}

type InboundAttachmentMeta = {
  id: string;
  filename: string | null;
  size: number;
  content_type: string;
  content_id: string | null;
  content_disposition: string | null;
};

/** Storage-safe object name: keep letters/digits/dot/dash, cap the length. */
function safeFilename(value: string | null): string {
  const cleaned = (value ?? "attachment")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : "attachment";
}

/**
 * Copies each attachment out of Resend into the private
 * `support-attachments` bucket and records it in `support_email_attachments`.
 *
 * Resend's download URLs are short-lived, so this runs at ingest time — the
 * storage copy is what the admin UI serves later. Best-effort per attachment:
 * a failed download logs and moves on rather than failing the whole message
 * (the webhook would otherwise retry and duplicate nothing but still mark the
 * event failed).
 */
async function ingestSupportAttachments(
  resend: Resend,
  supportEmailId: string,
  resendEmailId: string,
  attachments: readonly InboundAttachmentMeta[]
): Promise<void> {
  if (attachments.length === 0) {
    return;
  }
  const supabaseAdmin = getSupabaseAdmin();

  for (const attachment of attachments) {
    try {
      if (attachment.size > MAX_ATTACHMENT_BYTES) {
        console.warn("Skipping oversized support attachment", {
          supportEmailId,
          attachmentId: attachment.id,
          size: attachment.size
        });
        continue;
      }

      const { data: signed, error: signedError } =
        await resend.emails.receiving.attachments.get({
          emailId: resendEmailId,
          id: attachment.id
        });
      if (signedError || !signed?.download_url) {
        throw new Error(signedError?.message ?? "no download_url");
      }

      const response = await fetch(signed.download_url);
      if (!response.ok) {
        throw new Error(`download failed: HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());

      const contentType = attachment.content_type || "application/octet-stream";
      const storagePath = `${supportEmailId}/${attachment.id}/${safeFilename(
        attachment.filename
      )}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(SUPPORT_ATTACHMENT_BUCKET)
        .upload(storagePath, bytes, { contentType, upsert: true });
      if (uploadError) {
        throw new Error(`upload failed: ${uploadError.message}`);
      }

      const { error: rowError } = await supabaseAdmin
        .from("support_email_attachments")
        .insert({
          support_email_id: supportEmailId,
          resend_attachment_id: attachment.id,
          filename: attachment.filename,
          content_type: contentType,
          size_bytes: bytes.byteLength,
          content_id: attachment.content_id,
          is_inline: attachment.content_disposition === "inline",
          storage_path: storagePath
        });
      if (rowError) {
        throw new Error(`row insert failed: ${rowError.message}`);
      }
    } catch (error) {
      console.error("Support attachment ingest failed", {
        supportEmailId,
        resendEmailId,
        attachmentId: attachment.id,
        filename: attachment.filename,
        error
      });
    }
  }
}
