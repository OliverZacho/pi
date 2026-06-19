"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrandPageData } from "@/lib/brand-db";
import { weeklySendRate } from "@/lib/comparison-insights";
import { getCompareColor } from "./compareColors";
import styles from "./compare.module.css";
import v2 from "./compare-v2.module.css";

type Props = {
  brands: BrandPageData[];
  /** Aligned with `brands` — share of subjects with urgency language. */
  urgencyShares?: number[];
  /** Aligned with `brands` — share of campaigns that get a follow-up. */
  reminderShares?: number[];
};

type KpiDefinition = {
  id: string;
  label: string;
  /** Optional plain-language explainer shown in the drill-down modal. */
  description?: string;
  aggregate: (brands: BrandPageData[]) => {
    display: string;
    sublabel: string;
  };
  perBrand: (brand: BrandPageData, index: number) => {
    display: string;
    sublabel?: string;
    numeric: number | null;
  };
  rank?: "high" | "low" | "none";
  /**
   * Adds a compact dot-strip figure to the drill-down modal — every
   * brand as a dot on one track. "share" scales 0 → group max;
   * "range" scales group min → max. Omit for non-positional metrics
   * (e.g. the ESP tile).
   */
  strip?: "share" | "range";
};

/**
 * Aggregate KPI tiles for the comparison dashboard.
 *
 * Six tiles, each showing a cohort rollup (sum / weighted mean /
 * modal value). Clicking a tile opens a modal with the per-brand
 * breakdown sorted by the appropriate direction.
 *
 * Layout uses the fresh `compare-v2.module.css` module so Turbopack
 * picks up the new class map without the stale-cache issues that
 * plagued the original CSS file.
 */
/**
 * Average gap between sends over the last 12 weeks, derived as the
 * reciprocal of the same windowed send rate the "Who sends the most"
 * league uses (`weeklySendRate`). Deriving it from that one number —
 * rather than computing a second windowed gap — guarantees the cadence
 * tile and the rhythm chart rank brands identically and never seem to
 * contradict each other. Returns null when there were no sends in the
 * window (rate 0 → infinite gap).
 */
function recentCadenceDays(brand: BrandPageData): number | null {
  const perWeek = weeklySendRate(brand);
  return perWeek > 0 ? 7 / perWeek : null;
}

export default function KpiTiles({
  brands,
  urgencyShares = [],
  reminderShares = []
}: Props) {
  const [active, setActive] = useState<string | null>(null);
  const close = useCallback(() => setActive(null), []);

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);

  const definitions = useMemo<KpiDefinition[]>(
    () => [
      {
        id: "captured-emails",
        label: "Captured emails",
        rank: "high",
        aggregate: (bs) => {
          const total = bs.reduce((acc, b) => acc + b.totals.emailCount, 0);
          return {
            display: formatNumber(total),
            sublabel: `across ${bs.length} brand${bs.length === 1 ? "" : "s"}`
          };
        },
        perBrand: (b) => ({
          display: formatNumber(b.totals.emailCount),
          sublabel: b.totals.lastEmailAt
            ? `Last ${formatShortDate(b.totals.lastEmailAt)}`
            : "No sends yet",
          numeric: b.totals.emailCount
        })
      },
      {
        id: "avg-cadence",
        label: "Avg cadence",
        rank: "low",
        description:
          "How often you'll typically hear from each brand right now — the " +
          "average gap between sends over the last 12 weeks. It's the flip " +
          "side of “Who sends the most” (≈ 7 ÷ emails per " +
          "week), measured over the same window, so the two always agree.",
        aggregate: (bs) => {
          let weighted = 0;
          let weightSum = 0;
          let simpleSum = 0;
          let simpleCount = 0;
          for (const b of bs) {
            const days = recentCadenceDays(b);
            if (days === null) continue;
            simpleSum += days;
            simpleCount += 1;
            const weight = Math.max(1, b.totals.emailCount);
            weighted += days * weight;
            weightSum += weight;
          }
          if (simpleCount === 0) {
            return { display: "—", sublabel: "no sends in the last 12 weeks" };
          }
          const value =
            weightSum > 0 ? weighted / weightSum : simpleSum / simpleCount;
          return {
            display: formatCadenceDays(value),
            sublabel: "last 12 weeks · weighted by send volume"
          };
        },
        perBrand: (b) => {
          const days = recentCadenceDays(b);
          // Only call out a day when one weekday is a clear plurality —
          // same 0.25 confidence gate the brand page uses. Below that the
          // sends are spread across the week, so claiming a "typical" day
          // (often a tie the picker hands to Sunday) would mislead.
          const td = b.cadence.typicalDay;
          return {
            display: days !== null ? formatCadenceDays(days) : "—",
            sublabel:
              td && td.share >= 0.25
                ? `Mostly ${td.label}s`
                : days !== null
                  ? "Across the week"
                  : undefined,
            numeric: days
          };
        }
      },
      {
        id: "promo-share",
        label: "Promo share",
        rank: "high",
        strip: "share",
        aggregate: (bs) => {
          let discounts = 0;
          let totals = 0;
          for (const b of bs) {
            discounts += b.promo.discountEmails;
            totals += b.totals.sampleSize;
          }
          if (totals === 0) {
            return { display: "—", sublabel: "no sample to score" };
          }
          return {
            display: `${Math.round((discounts / totals) * 100)}%`,
            sublabel: `${formatNumber(discounts)} of ${formatNumber(totals)} sends`
          };
        },
        perBrand: (b) => ({
          display: `${Math.round(b.promo.discountShare * 100)}%`,
          sublabel:
            b.promo.avgDiscount !== null
              ? `Avg ${Math.round(b.promo.avgDiscount)}% off`
              : "No discounts",
          numeric: b.promo.discountShare
        })
      },
      {
        id: "primary-esp",
        label: "Top ESP in cohort",
        rank: "high",
        aggregate: (bs) => {
          const counts = new Map<string, { label: string; count: number }>();
          for (const b of bs) {
            if (!b.esp.primary) continue;
            const cur = counts.get(b.esp.primary.id);
            if (cur) cur.count += 1;
            else
              counts.set(b.esp.primary.id, {
                label: b.esp.primary.label,
                count: 1
              });
          }
          if (counts.size === 0) {
            return { display: "—", sublabel: "no ESP detected" };
          }
          let topLabel = "";
          let topCount = 0;
          for (const v of counts.values()) {
            if (v.count > topCount) {
              topLabel = v.label;
              topCount = v.count;
            }
          }
          return {
            display: topLabel,
            sublabel: `used by ${topCount} of ${bs.length} brand${
              bs.length === 1 ? "" : "s"
            }`
          };
        },
        perBrand: (b) => ({
          display: b.esp.primary ? b.esp.primary.label : "—",
          sublabel: b.esp.primary
            ? `${Math.round(b.esp.primary.share * 100)}% of sends`
            : "Not detected",
          numeric: b.esp.primary ? b.esp.primary.share : null
        })
      },
      {
        id: "subject-length",
        label: "Avg subject length",
        rank: "low",
        strip: "range",
        aggregate: (bs) => {
          let weighted = 0;
          let weightSum = 0;
          for (const b of bs) {
            if (b.subjects.avgLength === null) continue;
            const w = Math.max(1, b.totals.sampleSize);
            weighted += b.subjects.avgLength * w;
            weightSum += w;
          }
          if (weightSum === 0) {
            return { display: "—", sublabel: "no subjects captured" };
          }
          return {
            display: `${Math.round(weighted / weightSum)} chars`,
            sublabel: "weighted by sample size"
          };
        },
        perBrand: (b) => ({
          display:
            b.subjects.avgLength !== null
              ? `${Math.round(b.subjects.avgLength)} chars`
              : "—",
          numeric: b.subjects.avgLength
        })
      },
      {
        id: "design-flags",
        label: "Design adoption",
        rank: "high",
        aggregate: (bs) => {
          let gifSum = 0;
          let darkSum = 0;
          let count = 0;
          for (const b of bs) {
            gifSum += b.design.gifShare;
            darkSum += b.design.darkModeShare;
            count += 1;
          }
          if (count === 0) {
            return { display: "—", sublabel: "no design data" };
          }
          return {
            display: `${Math.round((gifSum / count) * 100)}% GIF · ${Math.round(
              (darkSum / count) * 100
            )}% dark`,
            sublabel: "cohort-wide adoption rate"
          };
        },
        perBrand: (b) => ({
          display: `${Math.round(b.design.gifShare * 100)}% / ${Math.round(
            b.design.darkModeShare * 100
          )}%`,
          sublabel: "GIF / dark-mode share",
          numeric: b.design.gifShare + b.design.darkModeShare
        })
      },
      {
        id: "emoji-use",
        label: "Emoji use",
        rank: "high",
        strip: "share",
        aggregate: (bs) => {
          let withEmoji = 0;
          let sample = 0;
          for (const b of bs) {
            withEmoji += b.emojis.emailsWithEmoji;
            sample += b.totals.sampleSize;
          }
          if (sample === 0) {
            return { display: "—", sublabel: "no sample to score" };
          }
          return {
            display: `${Math.round((withEmoji / sample) * 100)}%`,
            sublabel: "of subjects across the cohort"
          };
        },
        perBrand: (b) => ({
          display: `${Math.round(b.emojis.share * 100)}%`,
          sublabel:
            b.emojis.top.length > 0
              ? `Favours ${b.emojis.top
                  .slice(0, 3)
                  .map((e) => e.emoji)
                  .join(" ")}`
              : undefined,
          numeric: b.emojis.share
        })
      },
      {
        id: "urgency",
        label: "Urgency language",
        rank: "high",
        strip: "share",
        aggregate: (bs) => {
          let weighted = 0;
          let sample = 0;
          for (let i = 0; i < bs.length; i++) {
            const w = Math.max(1, bs[i].totals.sampleSize);
            weighted += (urgencyShares[i] ?? 0) * w;
            sample += w;
          }
          if (sample === 0) {
            return { display: "—", sublabel: "no sample to score" };
          }
          return {
            display: `${Math.round((weighted / sample) * 100)}%`,
            sublabel: `"last chance", "ends tonight", …`
          };
        },
        perBrand: (b, i) => ({
          display: `${Math.round((urgencyShares[i] ?? 0) * 100)}%`,
          sublabel: "of subjects",
          numeric: urgencyShares[i] ?? 0
        })
      },
      {
        id: "resends",
        label: "Reminder sends",
        rank: "high",
        strip: "share",
        aggregate: (bs) => {
          if (bs.length === 0 || reminderShares.length === 0) {
            return { display: "—", sublabel: "no campaigns detected" };
          }
          const avg =
            bs.reduce((sum, _, i) => sum + (reminderShares[i] ?? 0), 0) /
            bs.length;
          return {
            display: `${Math.round(avg * 100)}%`,
            sublabel: "of campaigns get a follow-up"
          };
        },
        perBrand: (b, i) => ({
          display: `${Math.round((reminderShares[i] ?? 0) * 100)}%`,
          sublabel: "of campaigns",
          numeric: reminderShares[i] ?? 0
        })
      }
    ],
    [urgencyShares, reminderShares]
  );

  const activeDef = useMemo(
    () => definitions.find((d) => d.id === active) ?? null,
    [active, definitions]
  );

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Snapshot</span>
      <h2 className={styles.sectionTitle}>KPI matrix</h2>
      <p className={styles.sectionSub}>
        Cohort-wide rollups. Tap any tile to see the per-brand breakdown.
      </p>

      <div className={v2.tilesGrid}>
        {definitions.map((def) => {
          const { display, sublabel } = def.aggregate(brands);
          return (
            <button
              key={def.id}
              type="button"
              className={v2.tile}
              onClick={() => setActive(def.id)}
              aria-haspopup="dialog"
              aria-expanded={active === def.id}
            >
              <span className={v2.tileLabel}>{def.label}</span>
              <span className={v2.tileValue}>{display}</span>
              <span className={v2.tileSub}>{sublabel}</span>
              <span className={v2.tileHint}>View per brand →</span>
            </button>
          );
        })}
      </div>

      {activeDef ? (
        <KpiModal definition={activeDef} brands={brands} onClose={close} />
      ) : null}
    </section>
  );
}

function KpiModal({
  definition,
  brands,
  onClose
}: {
  definition: KpiDefinition;
  brands: BrandPageData[];
  onClose: () => void;
}) {
  const rows = useMemo(() => {
    const mapped = brands.map((brand, idx) => {
      const drill = definition.perBrand(brand, idx);
      return {
        brand,
        color: getCompareColor(idx),
        ...drill
      };
    });
    if (definition.rank === "high") {
      mapped.sort((a, b) => {
        if (a.numeric === null && b.numeric === null) return 0;
        if (a.numeric === null) return 1;
        if (b.numeric === null) return -1;
        return b.numeric - a.numeric;
      });
    } else if (definition.rank === "low") {
      mapped.sort((a, b) => {
        if (a.numeric === null && b.numeric === null) return 0;
        if (a.numeric === null) return 1;
        if (b.numeric === null) return -1;
        return a.numeric - b.numeric;
      });
    }
    return mapped;
  }, [brands, definition]);

  const aggregate = definition.aggregate(brands);

  return (
    <div
      className={v2.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`${definition.label} — per brand`}
      onClick={onClose}
    >
      <div
        className={v2.modal}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={v2.modalHead}>
          <div>
            <span className={v2.modalEyebrow}>Per-brand breakdown</span>
            <h3 className={v2.modalTitle}>{definition.label}</h3>
            <p className={v2.modalSub}>
              Cohort rollup: <strong>{aggregate.display}</strong>{" "}
              <span className={v2.modalRowHint}>· {aggregate.sublabel}</span>
            </p>
            {definition.description ? (
              <p className={v2.modalNote}>{definition.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className={v2.modalClose}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {definition.strip ? (
          <KpiStrip mode={definition.strip} rows={rows} />
        ) : null}

        <div className={v2.modalBody}>
          {rows.map(({ brand, color, display, sublabel }) => (
            <div key={brand.brand.id} className={v2.modalRow}>
              <span className={v2.modalRowBrand}>
                <span
                  className={v2.modalRowDot}
                  style={{ background: color }}
                />
                <span className={v2.modalRowLogo} aria-hidden="true">
                  {brand.brand.logoUrl ? (
                    <img
                      src={brand.brand.logoUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    brand.brand.name.charAt(0).toUpperCase()
                  )}
                </span>
                <span className={v2.modalRowName}>{brand.brand.name}</span>
              </span>
              <span className={v2.modalRowValue}>
                {display}
                {sublabel ? (
                  <span className={v2.modalRowHint}>· {sublabel}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Dots get one of three vertical lanes so same-valued brands stay
 *  distinguishable instead of stacking into one blob. */
const STRIP_LANES = [50, 30, 70];

/**
 * Compact dot-strip figure at the top of a drill-down: every brand as
 * a dot on one track, so the spread and the outlier are visible before
 * reading the ranked rows below. "share" mode runs 0 → group max (10%
 * floor so a flat group doesn't explode tiny differences); "range"
 * runs group min → max.
 */
function KpiStrip({
  mode,
  rows
}: {
  mode: "share" | "range";
  rows: {
    brand: BrandPageData;
    color: string;
    display: string;
    numeric: number | null;
  }[];
}) {
  const withValues = rows.filter(
    (row): row is (typeof rows)[number] & { numeric: number } =>
      row.numeric !== null
  );
  if (withValues.length < 2) return null;

  const values = withValues.map((row) => row.numeric);
  const lo = mode === "share" ? 0 : Math.min(...values);
  const hi =
    mode === "share"
      ? Math.max(0.1, ...values)
      : Math.max(...values);
  const span = Math.max(hi - lo, 0.0001);

  const minRow = withValues.reduce((a, b) => (b.numeric < a.numeric ? b : a));
  const maxRow = withValues.reduce((a, b) => (b.numeric > a.numeric ? b : a));

  return (
    <div className={styles.fpStrips} style={{ margin: "0 0 0.9rem" }}>
      <span className={styles.fpStripTrack}>
        {withValues.map((row, i) => (
          <span
            key={row.brand.brand.id}
            className={styles.fpStripDot}
            style={{
              ["--accent" as string]: row.color,
              left: `${(((row.numeric - lo) / span) * 100).toFixed(2)}%`,
              top: `${STRIP_LANES[i % STRIP_LANES.length]}%`
            }}
            title={`${row.brand.brand.name}: ${row.display}`}
          />
        ))}
      </span>
      <span className={styles.fpStripScale}>
        {mode === "share"
          ? `0 – ${maxRow.display} (${maxRow.brand.brand.name})`
          : `${minRow.display} (${minRow.brand.brand.name}) – ${maxRow.display} (${maxRow.brand.brand.name})`}
      </span>
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatCadenceDays(days: number): string {
  if (days < 1) {
    const hours = days * 24;
    return `${hours.toFixed(1)}h`;
  }
  if (days < 10) {
    return `${days.toFixed(1)} days`;
  }
  return `${Math.round(days)} days`;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // Pinned locale + timezone so SSR and client agree (an en-GB
  // browser would otherwise re-render "Apr 22" as "22 Apr").
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}
