import type { BrandPageData } from "@/lib/brand-db";
import { detectBrandChanges, type BrandChange } from "@/lib/comparison-changes";
import type { DigestCadence } from "@/lib/notification-prefs";

/**
 * Turns a user's followed-brand page data into the editorial digest
 * model: a synthesized headline, a short "worth a look" pick list, and a
 * "everything else" tail of brand counts.
 *
 * Pure and deterministic — it takes already-assembled `BrandPageData`
 * (built once per brand and shared across users by the job) plus an
 * explicit window, and reads no clock of its own. The headline reuses
 * the same `detectBrandChanges` signals the Comparisons "what's new"
 * feed runs on, so the digest and the in-app feed never disagree.
 */

export type DigestPickKind = "launch" | "sale" | "general";

export type DigestPick = {
  brandName: string;
  subject: string;
  /** Three-letter weekday of receipt, e.g. "Wed". */
  day: string;
  /** Why it was surfaced — null means the subject stands on its own. */
  why: string | null;
  kind: DigestPickKind;
};

export type DigestTailEntry = { brandName: string; count: number };

export type DigestModel = {
  cadence: DigestCadence;
  windowStart: string;
  windowEnd: string;
  /** New emails across all followed brands in the window. */
  emailCount: number;
  /** Distinct brands that sent at least once in the window. */
  brandCount: number;
  /** One or two ready-to-render sentences; empty on a quiet window. */
  headline: string[];
  picks: DigestPick[];
  tail: DigestTailEntry[];
  /** True when no signal fired — the email falls back to plain stats. */
  nothingUnusual: boolean;
};

type WindowEmail = BrandPageData["seasonalSample"][number];

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

/** Max emails surfaced in "worth a look". Hard cap — the tail absorbs volume. */
const MAX_PICKS = 2;
/** Max brands listed in the "everything else" tail. */
const MAX_TAIL = 6;
/** Sentences in the synthesized headline. */
const MAX_HEADLINE = 2;

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
}

function weekday(iso: string): string {
  const t = ms(iso);
  return Number.isNaN(t) ? "" : DOW[new Date(t).getUTCDay()];
}

/** Picking weight by category; <= 0 is never surfaced. */
function categoryBase(category: string | null): number {
  switch (category) {
    case "product_launch":
      return 5;
    case "seasonal":
      return 4;
    case "sale":
      return 3;
    case "event":
    case "partnership":
      return 2;
    case "company_news":
    case "content":
    case "products":
      return 1;
    default:
      // welcome, loyalty, survey, education, other — never a "pick".
      return 0;
  }
}

function pickKind(email: WindowEmail): DigestPickKind {
  if (email.category === "product_launch" || email.category === "seasonal") {
    return "launch";
  }
  if (
    email.category === "sale" ||
    (email.discountPercent !== null && email.discountPercent > 0)
  ) {
    return "sale";
  }
  return "general";
}

/**
 * Most recent email strictly older than `email` whose category matches,
 * within the brand's captured sample (which is newest-first). Used to
 * date "first launch in N weeks" / dry-spell framing honestly against
 * real history rather than guessing.
 */
function priorOfCategory(
  sample: WindowEmail[],
  email: WindowEmail,
  category: string
): WindowEmail | null {
  const at = ms(email.receivedAt);
  for (const candidate of sample) {
    if (candidate.id === email.id) continue;
    if (candidate.category !== category) continue;
    const t = ms(candidate.receivedAt);
    if (!Number.isNaN(t) && t < at) return candidate;
  }
  return null;
}

function priorDiscount(
  sample: WindowEmail[],
  email: WindowEmail
): WindowEmail | null {
  const at = ms(email.receivedAt);
  for (const candidate of sample) {
    if (candidate.id === email.id) continue;
    if (candidate.discountPercent === null || candidate.discountPercent <= 0) {
      continue;
    }
    const t = ms(candidate.receivedAt);
    if (!Number.isNaN(t) && t < at) return candidate;
  }
  return null;
}

function explainSale(sample: WindowEmail[], email: WindowEmail): string | null {
  const pct =
    email.discountPercent !== null && email.discountPercent > 0
      ? Math.round(email.discountPercent)
      : null;
  const prior = priorDiscount(sample, email);
  if (prior) {
    const gapDays = (ms(email.receivedAt) - ms(prior.receivedAt)) / DAY_MS;
    if (gapDays >= 60) {
      const months = Math.max(2, Math.round(gapDays / 30));
      return `First discount in about ${months} months.`;
    }
    if (pct !== null && (prior.discountPercent ?? 0) < email.discountPercent!) {
      return `Their steepest discount in a while, ${pct}% off.`;
    }
  }
  return pct !== null ? `${pct}% off.` : null;
}

function explainLaunch(
  sample: WindowEmail[],
  email: WindowEmail
): string | null {
  if (email.category === "seasonal") {
    return "Seasonal campaign kicking off.";
  }
  const prior = priorOfCategory(sample, email, "product_launch");
  if (prior) {
    const gapDays = (ms(email.receivedAt) - ms(prior.receivedAt)) / DAY_MS;
    if (gapDays >= 21) {
      const weeks = Math.round(gapDays / 7);
      return `First product launch in ${weeks} weeks.`;
    }
  }
  return "New product launch.";
}

type ScoredPick = {
  brandName: string;
  email: WindowEmail;
  score: number;
  pick: DigestPick;
};

export function buildDigestModel(input: {
  cadence: DigestCadence;
  windowStart: Date;
  windowEnd: Date;
  brands: BrandPageData[];
}): DigestModel {
  const { cadence, windowStart, windowEnd, brands } = input;
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  let emailCount = 0;
  let brandCount = 0;
  const tail: DigestTailEntry[] = [];
  const scored: ScoredPick[] = [];
  const allChanges: BrandChange[] = [];

  brands.forEach((brand, index) => {
    const changes = detectBrandChanges(brand, index);
    allChanges.push(...changes);
    const hasFirstSale = changes.some((c) => c.kind === "first_sale");
    const hasSpike = changes.some((c) => c.kind === "pace_spike");

    const windowEmails = brand.seasonalSample.filter((email) => {
      const t = ms(email.receivedAt);
      return !Number.isNaN(t) && t > startMs && t <= endMs;
    });
    if (windowEmails.length === 0) return;

    emailCount += windowEmails.length;
    brandCount += 1;
    tail.push({ brandName: brand.brand.name, count: windowEmails.length });

    for (const email of windowEmails) {
      const base = categoryBase(email.category);
      if (base <= 0) continue;
      const kind = pickKind(email);
      let score = base;
      if (kind === "sale" && email.discountPercent) {
        score += email.discountPercent / 20;
      }
      if (hasFirstSale && kind === "sale") score += 3;
      if (hasSpike) score += 1;

      const why =
        kind === "sale"
          ? explainSale(brand.seasonalSample, email)
          : kind === "launch"
            ? explainLaunch(brand.seasonalSample, email)
            : null;

      scored.push({
        brandName: brand.brand.name,
        email,
        score,
        pick: {
          brandName: brand.brand.name,
          subject: email.subject,
          day: weekday(email.receivedAt),
          why,
          kind
        }
      });
    }
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return ms(b.email.receivedAt) - ms(a.email.receivedAt);
  });
  // At most one pick per brand: a single noisy brand, or a multi-list
  // resend of the same campaign, shouldn't take every "worth a look" slot.
  const picks: DigestPick[] = [];
  const pickedFromBrand = new Set<string>();
  for (const candidate of scored) {
    if (pickedFromBrand.has(candidate.brandName)) continue;
    pickedFromBrand.add(candidate.brandName);
    picks.push(candidate.pick);
    if (picks.length >= MAX_PICKS) break;
  }

  const pickedBrands = new Set(picks.map((p) => p.brandName));
  const tailEntries = tail
    .filter((entry) => !pickedBrands.has(entry.brandName))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TAIL);

  allChanges.sort((a, b) => b.severity - a.severity);
  const headline = allChanges.slice(0, MAX_HEADLINE).map((c) => c.message);

  return {
    cadence,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    emailCount,
    brandCount,
    headline,
    picks,
    tail: tailEntries,
    nothingUnusual: headline.length === 0
  };
}
