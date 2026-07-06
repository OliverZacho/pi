/**
 * Logo.dev is the primary source for brand logos.
 *
 * The email-extraction pipeline produced too many wrong picks, so its
 * output is no longer trusted for display: a captured logo is only shown
 * when an admin manually selected it (`companies.logo_source = 'manual'`)
 * or when a Logo.dev URL can't be built at all (missing token or domain).
 * The admin logo tooling still reads the raw pipeline output directly.
 *
 * The publishable token is safe to expose in URLs. The free plan caps at
 * 500k CDN requests/month and requires the visible "Logos provided by
 * Logo.dev" link (marketing site footer). Unknown domains get Logo.dev's
 * generated monogram, so the URL always renders an image.
 */
export function resolveBrandLogo(
  storedUrl: string | null,
  source: string | null | undefined,
  domain: string | null | undefined
): string | null {
  if (source === "manual" && storedUrl) return storedUrl;
  return logoDevUrl(domain) ?? storedUrl;
}

function logoDevUrl(domain: string | null | undefined): string | null {
  const token = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;
  const host = domain ? normalizeHost(domain) : null;
  if (!token || !host) return null;
  return `https://img.logo.dev/${encodeURIComponent(host)}?token=${token}&size=128&retina=true&format=webp`;
}

/**
 * `companies.domain` mixes full URLs ("https://www.specta.dk/") with bare
 * hostnames ("specta.dk"), so reduce either form to the registrable host
 * Logo.dev expects.
 */
function normalizeHost(domain: string): string | null {
  const raw = domain.trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
