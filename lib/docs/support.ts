/**
 * Support contact addresses, in one place so the Help page and the
 * `/api/contact` handler stay in sync. Override per-environment with the
 * matching env vars when the real inboxes are set up.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@pirol.app";
export const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL ?? "sales@pirol.app";

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
