/**
 * Detection of dedicated open-tracking pixels in captured emails.
 *
 * An open pixel is a tiny (usually 1x1, usually invisible) remote image
 * whose URL is unique per recipient; the ESP logs the HTTP request the
 * moment the mail client renders it, which is how "opens" are measured.
 * Since the 2026 CNIL / Garante rulings these pixels require explicit
 * consent in France and Italy (see /learn/email-tracking-links), which
 * is why both the brand dashboard and the Your-brand tab surface them.
 *
 * Detection is URL-pattern based over `remote_image_urls` and
 * deliberately conservative: every pattern below was validated against
 * the live catalogue (July 2026 audit — the generic subdomain rule
 * produced zero false positives across all stored remote image URLs).
 * A miss just means a pixel goes uncounted; a false positive would put
 * a wrong compliance warning on a brand page, which is the worse error.
 */

/** Patterns whose match identifies the tracking provider by name. */
const PROVIDER_PATTERNS: { provider: string; pattern: RegExp }[] = [
  // Klaviyo open endpoint: ctrk.klclick.com/o/…, ctrk.klclick1.com/o/…
  { provider: "Klaviyo", pattern: /klclick\d*\.com\/o([/?#]|$)/i },
  // Salesforce Marketing Cloud: click.<domain>/open.aspx?…
  { provider: "Salesforce Marketing Cloud", pattern: /\/open\.aspx/i },
  // SendGrid: u123.ct.sendgrid.net/wf/open?upn=… and branded url1234.<domain>/wf/…
  {
    provider: "SendGrid",
    pattern: /\/wf\/open|^https?:\/\/url\d+\.[^/]+\/wf([/?#]|$)/i
  },
  { provider: "APSIS", pattern: /apsis\.one\/pixel\.gif/i },
  { provider: "Heyloyalty", pattern: /heyloyalty\.com\/track/i },
  { provider: "Mailchimp", pattern: /list-manage\.com\/track\/open/i }
];

/**
 * Generic open endpoints (`/o`, `/mo`, `/open` as the first path
 * segment) on the sender/tracking subdomains ESPs put their branded
 * tracking CNAMEs on. Catalogue examples: newsletter.agentprovocateur.com/o,
 * link.e.arket.com/mo, tr.aonetrk.com/open, trk.phlur.com/o.
 */
const GENERIC_PATTERN =
  /^https?:\/\/(trk|ctrk|track|click|link\d*|email|newsletter|mail|tr|url\d+)\.[^/]+\/(o|mo|open)([/?#]|$)/i;

/** Generic `/track/open` path on any host (Mailchimp-style clones). */
const GENERIC_OPEN_PATH = /\/track\/open/i;

export type OpenPixelDetection = {
  /** Recognized provider name, or null for a generic/unattributed pixel. */
  provider: string | null;
};

/**
 * Scans one email's remote image URLs for a dedicated open-tracking
 * pixel. Returns the first provider-attributed match, then falls back
 * to the generic patterns, then null.
 */
export function detectOpenPixel(
  urls: readonly string[]
): OpenPixelDetection | null {
  for (const url of urls) {
    for (const { provider, pattern } of PROVIDER_PATTERNS) {
      if (pattern.test(url)) return { provider };
    }
  }
  for (const url of urls) {
    if (GENERIC_PATTERN.test(url) || GENERIC_OPEN_PATH.test(url)) {
      return { provider: null };
    }
  }
  return null;
}
