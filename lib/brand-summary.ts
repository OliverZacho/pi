/**
 * Natural-language brand summaries.
 *
 * Turns the numbers we already compute for a brand (cadence, campaign mix,
 * discounting) into a couple of plain-English sentences. The point is SEO +
 * conversion on the *public* brand page: a marketer Googling "how often does
 * <brand> send emails" lands on a page whose first paragraph answers exactly
 * that — proving the product knows the brand, with the deeper analytics gated
 * behind the paywall.
 *
 * `buildBrandSummary` is intentionally pure (no DB, no env) so it can be unit
 * reasoned-about and driven from either the slim crawl-surface loader
 * (`getBrandSummary` in brand-db) or the full `BrandPageData`. The text is
 * rendered *visibly* on the page — never hidden/meta-only — so it's honest
 * crawlable content, not cloaking.
 */

/** The minimal set of facts the prose needs. Derivable from BrandPageData. */
export type BrandSummaryFacts = {
  name: string;
  /** True total tracked for the brand (survives the stats row cap). */
  emailCount: number;
  /** Mean days between *campaign* sends; null when too few to tell. */
  avgDaysBetween: number | null;
  /** Most common send weekday + its share (0–1), or null. */
  typicalDay: { label: string; share: number } | null;
  /** Top campaign categories, already filtered + sorted desc; we use ≤2. */
  topCategories: { label: string; count: number }[];
  /** Steepest discount % seen, and the ISO date of that send. */
  maxDiscount: number | null;
  maxDiscountAt: string | null;
};

export type BrandSummary = {
  /** Full visible paragraph for the page body. */
  paragraph: string;
  /** Trimmed (~160 char) variant for the `<meta name="description">`. */
  metaDescription: string;
};

/** "twice a week" reads better than "2 times a week"; numbers above that don't. */
function timesPhrase(n: number, unit: "week" | "month"): string {
  if (n <= 1) return `about once a ${unit}`;
  if (n === 2) return `about twice a ${unit}`;
  return `about ${n} times a ${unit}`;
}

/**
 * Maps an average gap (in days) between sends to a human cadence phrase.
 * Returns null when we don't have a usable average.
 */
function describeFrequency(avgDays: number | null): string | null {
  if (avgDays === null || !Number.isFinite(avgDays) || avgDays <= 0) return null;
  if (avgDays <= 1.5) return "every day";
  const perWeek = 7 / avgDays;
  if (perWeek >= 1.5) return timesPhrase(Math.round(perWeek), "week");
  if (avgDays <= 10) return "about once a week";
  const perMonth = 30 / avgDays;
  if (perMonth >= 1.5) return timesPhrase(Math.round(perMonth), "month");
  if (avgDays <= 45) return "about once a month";
  return "occasionally";
}

/** "promotional", "promotional and product", … from ≤2 category labels. */
function describeMix(categories: { label: string }[]): string | null {
  const labels = categories
    .slice(0, 2)
    .map((c) => c.label.trim().toLowerCase())
    .filter(Boolean);
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return `${labels[0]} and ${labels[1]}`;
}

/** Stable English month name for the discount "when" clause. */
function monthName(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long" });
}

/** Word-boundary clamp with an ellipsis, for the meta description. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s.,;:—-]+$/, "")}…`;
}

/**
 * Builds the visible summary + meta description for a brand. Returns null when
 * there isn't enough signal to say anything useful (no emails, or neither a
 * cadence nor a campaign mix) — better to render nothing than a thin,
 * boilerplate page that hurts more than it helps.
 */
export function buildBrandSummary(facts: BrandSummaryFacts): BrandSummary | null {
  const { name, emailCount } = facts;
  if (emailCount <= 0) return null;

  const freq = describeFrequency(facts.avgDaysBetween);
  const mix = describeMix(facts.topCategories);
  if (!freq && !mix) return null;

  const dayClause =
    freq && facts.typicalDay && facts.typicalDay.share >= 0.3
      ? `, usually on ${facts.typicalDay.label}s`
      : "";

  // --- Page paragraph ---
  // Lead with the brand name (keyword-rich, and the natural subject the
  // discount sentence then refers back to). We deliberately don't state how
  // many emails we've tracked — that exposes our coverage and isn't what a
  // marketer is searching for.
  const sentences: string[] = [];

  if (freq) {
    sentences.push(
      `${name} sends ${freq}${dayClause}${mix ? `, mostly ${mix} emails` : ""}.`
    );
  } else if (mix) {
    sentences.push(`${name}'s emails are mostly ${mix}.`);
  }

  if (facts.maxDiscount !== null && facts.maxDiscount > 0) {
    const month = monthName(facts.maxDiscountAt);
    sentences.push(
      `Their biggest discount was ${Math.round(
        facts.maxDiscount
      )}% off${month ? `, in ${month}` : ""}.`
    );
  }

  const paragraph = sentences.join(" ");

  // --- Meta description (compact, keyword-led, ~160 chars) ---
  const metaParts: string[] = [`${name} email marketing`];
  if (freq) metaParts.push(`sends ${freq}`);
  if (mix) metaParts.push(`mostly ${mix}`);
  if (facts.maxDiscount !== null && facts.maxDiscount > 0) {
    metaParts.push(`up to ${Math.round(facts.maxDiscount)}% off`);
  }
  const metaDescription = clamp(`${metaParts.join(" — ")}.`, 160);

  return { paragraph, metaDescription };
}
