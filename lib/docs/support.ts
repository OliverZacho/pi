/**
 * Support contact addresses, in one place so the Help page and the
 * `/api/contact` handler stay in sync. Override per-environment with the
 * matching env vars when the real inboxes are set up.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@pirol.app";
export const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL ?? "sales@pirol.app";

/**
 * Dedicated legal/compliance inboxes referenced from the policy pages
 * (/privacy, /terms, /takedown). Mail to any of them is routed into the same
 * Admin → Support tab as support@ (see {@link SUPPORT_INBOX_ADDRESSES}).
 */
export const PRIVACY_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? "privacy@pirol.app";
export const LEGAL_EMAIL = process.env.NEXT_PUBLIC_LEGAL_EMAIL ?? "legal@pirol.app";
export const TAKEDOWN_EMAIL = process.env.NEXT_PUBLIC_TAKEDOWN_EMAIL ?? "takedown@pirol.app";

/**
 * The address contact-form submissions are delivered to. Defaults to the
 * public support inbox but can point at a shared/helpdesk address instead.
 */
export const CONTACT_INBOX = process.env.CONTACT_INBOX ?? SUPPORT_EMAIL;

/**
 * Verified Resend sender. Resend requires the `from` domain to be verified,
 * so this is configured separately from the inbox we deliver to.
 */
export const CONTACT_FROM = process.env.CONTACT_FROM ?? "Pirol <onboarding@resend.dev>";

/**
 * `from` address used when an admin replies to a support message out of the
 * Admin → Support tab. Defaults to the shared contact sender; override with a
 * verified `Pirol Support <support@pirol.app>` once the domain is set up.
 */
export const SUPPORT_FROM = process.env.SUPPORT_FROM ?? CONTACT_FROM;

/**
 * Inbound recipients that route a captured email into the support inbox rather
 * than the newsletter pipeline. Includes the public support address plus the
 * dedicated legal inboxes (privacy@/legal@/takedown@), so policy-page mail lands
 * in the Admin → Support tab too. `SUPPORT_INBOX_EXTRA` (comma-separated) can add
 * further aliases like `help@` or `hello@` without a code change.
 */
export const SUPPORT_INBOX_ADDRESSES: readonly string[] = [
  SUPPORT_EMAIL,
  PRIVACY_EMAIL,
  LEGAL_EMAIL,
  TAKEDOWN_EMAIL,
  ...(process.env.SUPPORT_INBOX_EXTRA ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
].map((address) => address.toLowerCase());

/** Display name to send a reply from, per dedicated legal inbox. */
const LEGAL_INBOX_SENDERS: Record<string, string> = {
  [PRIVACY_EMAIL.toLowerCase()]: "Pirol Privacy",
  [LEGAL_EMAIL.toLowerCase()]: "Pirol Legal",
  [TAKEDOWN_EMAIL.toLowerCase()]: "Pirol Takedown"
};

/**
 * Resolves the `from` identity for an admin reply, based on which inbox the
 * message was sent to. Replies to a legal inbox (privacy@/legal@/takedown@) go
 * out from that same address so the thread stays consistent — but only once the
 * sending domain is verified in Resend; until then (e.g. the resend.dev
 * fallback) everything sends from {@link SUPPORT_FROM}, the one allowed sender.
 */
export function replyFromForInbox(toAddress: string | null | undefined): string {
  const normalized = (toAddress ?? "").trim().toLowerCase();
  const domainVerified = /@pirol\.app>?\s*$/.test(SUPPORT_FROM);
  const name = LEGAL_INBOX_SENDERS[normalized];
  return domainVerified && name ? `${name} <${normalized}>` : SUPPORT_FROM;
}
