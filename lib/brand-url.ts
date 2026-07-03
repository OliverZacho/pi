/**
 * The `companies.domain` field is inconsistent: some rows store a bare host
 * ("exercere.dk"), others a full URL ("https://www.exercere.dk/", sometimes
 * with a path). These helpers normalize both the link target and the label so
 * we never produce a doubled protocol like "https://https://exercere.dk/".
 */

/** Build a safe, clickable href from a stored domain value. */
export function brandUrlHref(domain: string): string {
  const raw = domain.trim();
  return raw.includes("://") ? raw : `https://${raw}`;
}

/** A clean, human-friendly label: host + path, without protocol/www/trailing slash. */
export function brandUrlLabel(domain: string): string {
  const raw = domain.trim();
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${host}${path}`;
  } catch {
    // Fall back to a light cleanup if the value isn't a parseable URL.
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/$/, "");
  }
}
