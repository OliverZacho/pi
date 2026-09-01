import { normalizeHost } from "./logo-dev";

/**
 * Server-side client for the Logo.dev Brand Search API, used by the
 * onboarding typeahead to resolve brands we don't track yet into a
 * canonical `{name, domain}` pair (and, via `logoDevUrl(domain)`, a logo).
 *
 * Unlike the CDN token this endpoint authenticates with the SECRET key
 * (`LOGO_DEV_SECRET_KEY`), so calls must never leave the server. Search is
 * a nice-to-have on top of the tracked-brand results: any failure — missing
 * key, timeout, non-OK response, malformed body — degrades to an empty
 * list so the typeahead falls back to tracked-only instead of erroring.
 */
export type LogoDevBrand = {
  name: string;
  domain: string;
};

const SEARCH_TIMEOUT_MS = 2500;

export async function searchLogoDevBrands(query: string): Promise<LogoDevBrand[]> {
  const key = process.env.LOGO_DEV_SECRET_KEY;
  const q = query.trim();
  if (!key || !q) return [];

  try {
    const res = await fetch(
      `https://api.logo.dev/search?q=${encodeURIComponent(q)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        cache: "no-store"
      }
    );
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return [];
    const items: LogoDevBrand[] = [];
    for (const entry of body) {
      if (typeof entry !== "object" || entry === null) continue;
      const { name, domain } = entry as { name?: unknown; domain?: unknown };
      if (typeof name !== "string" || typeof domain !== "string") continue;
      const host = normalizeHost(domain);
      if (!name.trim() || !host) continue;
      items.push({ name: name.trim(), domain: host });
    }
    return items;
  } catch {
    return [];
  }
}

/** Default cap on requestable Logo.dev rows shown in the typeahead. */
export const MAX_UNTRACKED_RESULTS = 3;

/**
 * Lowercases and strips everything but letters and digits so "Wal-Mart",
 * "wal-mart.com" and "Walmart" all compare as "walmart".
 */
function comparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Logo.dev ranks by popularity rather than relevance, so a query like
 * "Walmart" comes back with LinkedIn in the mix. Keep a row only when the
 * query and the brand (name or registrable host) overlap textually.
 */
function isRelevant(query: string, item: LogoDevBrand): boolean {
  const q = comparable(query);
  if (!q) return true;
  const name = comparable(item.name);
  const host = comparable(item.domain.split(".").slice(0, -1).join("."));
  return (
    name.includes(q) ||
    host.includes(q) ||
    (name.length >= 3 && q.includes(name)) ||
    (host.length >= 3 && q.includes(host))
  );
}

/**
 * Drops Logo.dev results that duplicate a tracked brand (same registrable
 * host) — those should surface as the followable tracked row, not as a
 * request — filters out hits unrelated to the query, dedupes the remainder
 * by host, and caps the list at `limit`, keeping Logo.dev's own order.
 */
export function mergeBrandSearchResults(
  trackedDomains: Array<string | null | undefined>,
  logoDevItems: LogoDevBrand[],
  options: { query?: string; limit?: number } = {}
): LogoDevBrand[] {
  const { query = "", limit = MAX_UNTRACKED_RESULTS } = options;
  const seen = new Set<string>();
  for (const domain of trackedDomains) {
    if (!domain) continue;
    const host = normalizeHost(domain);
    if (host) seen.add(host);
  }
  const merged: LogoDevBrand[] = [];
  for (const item of logoDevItems) {
    if (merged.length >= limit) break;
    const host = normalizeHost(item.domain);
    if (!host || seen.has(host)) continue;
    const candidate = { name: item.name, domain: host };
    if (!isRelevant(query, candidate)) continue;
    seen.add(host);
    merged.push(candidate);
  }
  return merged;
}
