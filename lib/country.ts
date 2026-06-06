/**
 * Tiny helpers for turning an ISO 3166-1 alpha-2 country code (as stored in
 * `captured_emails.detected_country` / `companies.primary_market_country`) into
 * something human-readable, without shipping a country table.
 *
 * The flag is derived arithmetically from the two letters (regional indicator
 * symbols), and the name comes from `Intl.DisplayNames`, which is available in
 * both Node and the browser. Anything that isn't a clean two-letter code falls
 * back to the raw input so callers never render `undefined`.
 */

function isAlpha2(code: string): code is string {
  return /^[A-Za-z]{2}$/.test(code);
}

/** Regional-indicator flag emoji for a country code, e.g. "DK" → 🇩🇰. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !isAlpha2(code)) return "";
  const cc = code.toUpperCase();
  return String.fromCodePoint(
    ...[...cc].map((ch) => 0x1f1e6 + (ch.charCodeAt(0) - 65))
  );
}

let regionNames: Intl.DisplayNames | null | undefined;
function getRegionNames(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  return regionNames;
}

/** English country name for a code, e.g. "DK" → "Denmark". Falls back to the code. */
export function countryName(code: string | null | undefined): string {
  if (!code || !isAlpha2(code)) return code ?? "";
  const cc = code.toUpperCase();
  try {
    return getRegionNames()?.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** Flag + name, e.g. "DK" → "🇩🇰 Denmark". Empty string for an empty/invalid code. */
export function countryLabel(code: string | null | undefined): string {
  if (!code || !isAlpha2(code)) return "";
  return `${countryFlag(code)} ${countryName(code)}`.trim();
}
