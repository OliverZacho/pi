/**
 * Classifies where a brand's primary CTAs point — the difference
 * between "Shop now → /products/x" and "Read more → /journal/y" is a
 * strategy signal the comparison dashboard surfaces per brand.
 *
 * Path-pattern heuristics tuned for the e-commerce platforms our
 * tracked brands actually run (Shopify-style /products/ + /collections/,
 * generic /p/ + /c/ shorteners, common editorial prefixes). Anything
 * unrecognised lands in "other" rather than guessing.
 */

export const CTA_DESTINATION_KINDS = [
  "product",
  "collection",
  "homepage",
  "editorial",
  "other"
] as const;

export type CtaDestinationKind = (typeof CTA_DESTINATION_KINDS)[number];

export const CTA_DESTINATION_LABELS: Record<CtaDestinationKind, string> = {
  product: "Products",
  collection: "Collections",
  homepage: "Homepage",
  editorial: "Editorial",
  other: "Other"
};

const PRODUCT_PATTERNS = [
  /\/products?\//,
  /\/p\//,
  /\/dp\//,
  /\/item\//,
  /\/produkt(?:er)?\//
];

const COLLECTION_PATTERNS = [
  /\/collections?\//,
  /\/category\//,
  /\/categories\//,
  /\/c\//,
  /\/shop\//,
  /\/kategori(?:er)?\//
];

const EDITORIAL_PATTERNS = [
  /\/blog(?:s)?\//,
  /\/journal\//,
  /\/stories\//,
  /\/story\//,
  /\/news\//,
  /\/magazine\//,
  /\/guides?\//,
  /\/editorial\//,
  /\/artikler?\//
];

/**
 * Classifies a raw CTA href. Returns `null` for unusable values
 * (empty, mailto:, unparseable) so callers can skip them rather than
 * pollute the "other" bucket with garbage.
 */
export function classifyCtaDestination(
  url: string | null | undefined
): CtaDestinationKind | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  if (/^(mailto|tel|sms):/i.test(raw)) return null;

  let path: string;
  try {
    // Relative hrefs are valid in email HTML; give them a dummy base.
    path = new URL(raw, "https://example.invalid").pathname.toLowerCase();
  } catch {
    return null;
  }

  // Tracking redirectors (klaviyo/mailchimp click domains) bury the
  // real destination in an opaque token — nothing to classify.
  if (/^\/(ls\/click|cl[0-9]|track|e\/er|u\/)/.test(path)) return "other";

  const normalized = path.endsWith("/") ? path : `${path}/`;

  if (normalized === "/") return "homepage";
  for (const pattern of PRODUCT_PATTERNS) {
    if (pattern.test(normalized)) return "product";
  }
  for (const pattern of COLLECTION_PATTERNS) {
    if (pattern.test(normalized)) return "collection";
  }
  for (const pattern of EDITORIAL_PATTERNS) {
    if (pattern.test(normalized)) return "editorial";
  }
  return "other";
}
