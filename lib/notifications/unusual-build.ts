import type { BrandPageData } from "@/lib/brand-db";
import { detectBrandChanges } from "@/lib/comparison-changes";
import type { DigestCadence } from "@/lib/notification-prefs";

/**
 * "Unusual sending activity" reuses the same brand-vs-baseline detectors
 * as the Comparisons "what's new" feed, narrowed to the two that describe
 * *sending* behaviour: a pace spike (ramping up) and a gone-quiet spell.
 * The discount-oriented `first_sale` signal is deliberately excluded — it
 * belongs to the deals/digest surface, not this one.
 *
 * Pure and deterministic: it reads already-assembled `BrandPageData` and
 * reports every current signal. De-duplication against prior alerts
 * happens in the job layer.
 */

export type UnusualSignalKind = "pace_spike" | "gone_quiet";

export type UnusualSignal = {
  companyId: string;
  brandName: string;
  kind: UnusualSignalKind;
  /** Ready-to-render sentence, from the shared detector. */
  message: string;
  /** Higher = more remarkable; used to order the email. */
  severity: number;
};

export type UnusualActivityModel = {
  cadence: DigestCadence;
  ramping: UnusualSignal[];
  quiet: UnusualSignal[];
  /** Distinct brands across both lists. */
  brandCount: number;
};

/** Every current pace-spike / gone-quiet signal, most remarkable first. */
export function detectUnusualSignals(brands: BrandPageData[]): UnusualSignal[] {
  const out: UnusualSignal[] = [];
  brands.forEach((brand, index) => {
    for (const change of detectBrandChanges(brand, index)) {
      if (change.kind === "pace_spike" || change.kind === "gone_quiet") {
        out.push({
          companyId: change.brandId,
          brandName: change.brandName,
          kind: change.kind,
          message: change.message,
          severity: change.severity
        });
      }
    }
  });
  return out.sort((a, b) => b.severity - a.severity);
}

/** Groups already-deduped signals into the email's two sections. */
export function buildUnusualModel(
  cadence: DigestCadence,
  signals: UnusualSignal[]
): UnusualActivityModel {
  const ramping = signals.filter((s) => s.kind === "pace_spike");
  const quiet = signals.filter((s) => s.kind === "gone_quiet");
  const brandCount = new Set(signals.map((s) => s.companyId)).size;
  return { cadence, ramping, quiet, brandCount };
}
