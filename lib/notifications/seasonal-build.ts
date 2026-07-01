import type { BrandPageData } from "@/lib/brand-db";
import type { DigestCadence } from "@/lib/notification-prefs";
import {
  SEASONAL_EVENTS,
  buildEventMatcher,
  upcomingOccurrence
} from "@/lib/seasonal-events";

/**
 * "Seasonal run-up" detection. The existing `analyzeSeasonalRunup` looks
 * *backwards* (how a brand historically builds up to an event); a
 * notification needs the forward view: has a followed brand *started*
 * teasing an *upcoming* event.
 *
 * For each brand and each event whose next occurrence is within the
 * run-up window, we check whether the brand has already sent a
 * keyword-matching email tied to that upcoming occurrence. Alerting is
 * deduped once per (brand, event, year) via the fingerprint, so a
 * multi-week run-up produces a single "they've started" alert.
 *
 * Pure and deterministic: reads assembled `BrandPageData` plus an
 * explicit `now`; dedup against prior alerts happens in the job layer.
 */

export type SeasonalSignal = {
  companyId: string;
  brandName: string;
  eventId: string;
  eventLabel: string;
  eventYear: number;
  /** YYYY-MM-DD of the upcoming occurrence. */
  eventDate: string;
  /** Calendar days until the event (>= 0). */
  daysUntil: number;
  message: string;
  /** `seasonal:<eventId>:<eventYear>` — the once-per-occurrence dedup key. */
  fingerprint: string;
};

export type SeasonalModel = {
  cadence: DigestCadence;
  signals: SeasonalSignal[];
  brandCount: number;
};

const DAY_MS = 86_400_000;
/**
 * How far ahead an event can be and still count as an active run-up.
 * Matches the analysis window so we alert as soon as the first teaser
 * lands, even for early "gift guide" campaigns.
 */
const LEAD_WINDOW_DAYS = 120;

function leadPhrase(daysUntil: number): string {
  if (daysUntil <= 3) return "just days away";
  const weeks = Math.round(daysUntil / 7);
  if (weeks <= 1) return "about a week out";
  return `about ${weeks} weeks out`;
}

/** Every followed brand that has started a run-up to an upcoming event. */
export function detectSeasonalSignals(
  brands: BrandPageData[],
  now: Date
): SeasonalSignal[] {
  const nowMs = now.getTime();
  const out: SeasonalSignal[] = [];

  for (const brand of brands) {
    for (const event of SEASONAL_EVENTS) {
      const eventDate = upcomingOccurrence(event, now);
      const eventMs = Date.parse(`${eventDate}T00:00:00Z`);
      if (Number.isNaN(eventMs)) continue;

      const daysUntil = Math.round((eventMs - nowMs) / DAY_MS);
      if (daysUntil < 0 || daysUntil > LEAD_WINDOW_DAYS) continue;

      // Mentions tied to THIS upcoming occurrence: matched and received
      // within the run-up window (never last year's leftovers, since the
      // window starts at most LEAD_WINDOW_DAYS ago).
      const matches = buildEventMatcher(event.keywords);
      const windowStartMs = eventMs - LEAD_WINDOW_DAYS * DAY_MS;
      const started = brand.seasonalSample.some((email) => {
        const t = Date.parse(email.receivedAt);
        if (Number.isNaN(t) || t < windowStartMs || t > nowMs) return false;
        return matches(`${email.subject ?? ""} ${email.preheader ?? ""}`);
      });
      if (!started) continue;

      const eventYear = Number(eventDate.slice(0, 4));
      out.push({
        companyId: brand.brand.id,
        brandName: brand.brand.name,
        eventId: event.id,
        eventLabel: event.label,
        eventYear,
        eventDate,
        daysUntil,
        message: `${brand.brand.name} has started its ${event.label} run-up, ${leadPhrase(
          daysUntil
        )}.`,
        fingerprint: `seasonal:${event.id}:${eventYear}`
      });
    }
  }

  // Soonest event first.
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

export function buildSeasonalModel(
  cadence: DigestCadence,
  signals: SeasonalSignal[]
): SeasonalModel {
  const brandCount = new Set(signals.map((s) => s.companyId)).size;
  return { cadence, signals, brandCount };
}
