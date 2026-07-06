/**
 * Logo.dev fallback for brand logos.
 *
 * Our own email-extraction pipeline stays the primary source: when a
 * company has a `logo_storage_path` we serve that (signed URL or CDN).
 * Logo.dev only fills the gap for brands where extraction hasn't
 * produced a logo yet, keyed by the company domain.
 *
 * The publishable token is safe to expose in URLs. The free plan caps
 * at 500k CDN requests/month and requires the visible "Logos provided
 * by Logo.dev" link (site footer + app sidebar). Unknown domains get
 * Logo.dev's generated monogram, so the URL always renders an image.
 */
export function withLogoDevFallback(
  logoUrl: string | null,
  domain: string | null | undefined
): string | null {
  if (logoUrl) return logoUrl;
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
