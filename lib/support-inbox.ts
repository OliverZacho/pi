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

  return { id: inserted.id, deduplicated: false };
}
