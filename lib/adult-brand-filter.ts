/**
 * Keeps adult-industry brands out of the Logo.dev typeaheads ("Request a
 * brand", onboarding). Logo.dev indexes the whole web, so a query like
 * "porn" happily returns five tube sites with logos. We track retail and
 * consumer brands; none of these belong in the catalogue, so the
 * suggestion list is the right place to stop them.
 *
 * Two lists, matched differently to keep false positives low:
 * - SUBSTRING terms are distinctive enough to match anywhere in a name or
 *   host ("pornhub", "xvideos").
 * - TOKEN terms are ordinary words that only count as a whole word, so
 *   "Essex", "Milford" and "Nudestix" stay clear.
 */
const SUBSTRING_TERMS = [
  "porn",
  "xxx",
  "hentai",
  "xvideos",
  "xhamster",
  "xnxx",
  "onlyfans",
  "fansly",
  "redtube",
  "youporn",
  "brazzers",
  "chaturbate",
  "stripchat",
  "livejasmin",
  "bangbros",
  "camsoda",
  "manyvids",
  "nsfw",
  "bdsm"
];

const TOKEN_TERMS = new Set([
  "sex",
  "erotic",
  "erotica",
  "escort",
  "escorts",
  "milf",
  "fetish",
  "nudes",
  "hookup",
  "hookups"
]);

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * True when a query, brand name or host reads as adult content. Callers
 * pass the host without its TLD so "porno.biz" is judged on "porno".
 */
export function looksAdult(value: string): boolean {
  const parts = tokens(value);
  if (parts.length === 0) return false;
  const joined = parts.join("");
  if (SUBSTRING_TERMS.some((term) => joined.includes(term))) return true;
  return parts.some((part) => TOKEN_TERMS.has(part));
}
