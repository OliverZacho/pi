import type { Resend } from "resend";
import {
  normalizeAddress,
  parseFromHeader,
  recipientsFromEvent,
  ingestSupportEmail,
  type ResendInboundEvent
} from "./support-inbox";

/**
 * Founder inbox forwarding.
 *
 * The apex MX belongs to Resend inbound (see the capture pipeline), so a
 * personal founder address cannot live at a mailbox provider — instead, mail
 * to it rides the same inbound webhook as newsletters and support, and the
 * ingest processor forwards it to the founder's personal mailbox via a Resend
 * send. Replies target the original sender through Reply-To; outbound founder
 * mail is sent separately over Resend SMTP from a mail client.
 */

/** Address customers write to; also the send-as identity in the mail client. */
export const FOUNDER_EMAIL = (
  process.env.FOUNDER_EMAIL ?? "oliver@pirol.app"
).toLowerCase();

/**
 * Personal mailbox forwards are delivered to. When unset, founder mail falls
 * back into the Admin → Support tab instead of being dropped.
 */
export const FOUNDER_FORWARD_TO = process.env.FOUNDER_FORWARD_TO ?? "";

/**
 * Verified sender the forward goes out from. The original sender's name is
 * prefixed to the display name so the personal inbox shows who really wrote.
 */
const FOUNDER_FORWARD_FROM =
  process.env.FOUNDER_FORWARD_FROM ?? "forward@pirol.app";

/** Same ceiling as the support bucket; anything above is skipped. */
const MAX_FORWARD_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** True when any recipient (to/cc/bcc) is the founder address. */
export function isFounderRecipient(recipients: readonly string[]): boolean {
  return recipients.some(
    (recipient) => normalizeAddress(recipient) === FOUNDER_EMAIL
  );
}

type ForwardableAttachment = {
  id: string;
  filename: string | null;
  size: number;
  content_type: string;
};

/**
 * Fetches the full message from Resend and re-sends it to
 * {@link FOUNDER_FORWARD_TO}, attachments included, with Reply-To pointing at
 * the original sender. Without a configured forward address the message is
 * ingested into the support inbox so it stays reachable.
 */
export async function forwardFounderEmail(
  resend: Resend,
  event: ResendInboundEvent
): Promise<{ id: string; deduplicated: boolean }> {
  if (!FOUNDER_FORWARD_TO) {
    return ingestSupportEmail(resend, event);
  }

  const { data: full, error: fetchError } = await resend.emails.receiving.get(
    event.data.email_id
  );

  if (fetchError || !full) {
    throw new Error(
      `fetch_founder_email: ${fetchError?.message ?? "no body returned"}`
    );
  }

  const { name, address } = parseFromHeader(full.from);
  const senderLabel = name ? `${name} (${address})` : address;

  const attachments = await downloadForwardAttachments(
    resend,
    full.id,
    (full.attachments ?? []) as ForwardableAttachment[]
  );

  const { data: sent, error: sendError } = await resend.emails.send({
    from: `${senderLabel} via Pirol <${normalizeAddress(FOUNDER_FORWARD_FROM)}>`,
    to: [FOUNDER_FORWARD_TO],
    replyTo: address,
    subject: full.subject ?? "(no subject)",
    html: full.html ?? undefined,
    text: full.text ?? `(no message body)`,
    attachments
  });

  if (sendError || !sent) {
    throw new Error(
      `forward_founder_email: ${sendError?.message ?? "send returned no id"}`
    );
  }

  return { id: sent.id, deduplicated: false };
}

/**
 * Pulls attachment bytes out of Resend's short-lived signed URLs so they can
 * be re-attached to the forward. Best-effort per attachment, mirroring the
 * support-inbox behavior: a failed download logs and skips rather than
 * failing the whole forward.
 */
async function downloadForwardAttachments(
  resend: Resend,
  resendEmailId: string,
  attachments: readonly ForwardableAttachment[]
): Promise<{ filename: string; content: Buffer }[]> {
  const downloaded: { filename: string; content: Buffer }[] = [];

  for (const attachment of attachments) {
    try {
      if (attachment.size > MAX_FORWARD_ATTACHMENT_BYTES) {
        console.warn("Skipping oversized founder-forward attachment", {
          resendEmailId,
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

      downloaded.push({
        filename: attachment.filename ?? "attachment",
        content: Buffer.from(await response.arrayBuffer())
      });
    } catch (error) {
      console.error("Founder-forward attachment failed", {
        resendEmailId,
        attachmentId: attachment.id,
        filename: attachment.filename,
        error
      });
    }
  }

  return downloaded;
}
