"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrandPageData } from "@/lib/brand-db";
import { getCompareColor } from "./compareColors";
import styles from "./compare.module.css";
import v2 from "./compare-v2.module.css";

type Props = {
  brands: BrandPageData[];
};

type KpiDefinition = {
  id: string;
  label: string;
  aggregate: (brands: BrandPageData[]) => {
    display: string;
    sublabel: string;
  };
  perBrand: (brand: BrandPageData) => {
    display: string;
    sublabel?: string;
    numeric: number | null;
  };
  rank?: "high" | "low" | "none";
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
export default function KpiTiles({ brands }: Props) {
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
        aggregate: (bs) => {
          let weighted = 0;
          let weightSum = 0;
          let simpleSum = 0;
          let simpleCount = 0;
          for (const b of bs) {
            if (b.cadence.avgDaysBetween === null) continue;
            simpleSum += b.cadence.avgDaysBetween;
            simpleCount += 1;
            const weight = Math.max(1, b.totals.emailCount);
            weighted += b.cadence.avgDaysBetween * weight;
            weightSum += weight;
          }
          if (simpleCount === 0) {
            return { display: "—", sublabel: "not enough sends yet" };
          }
          const value =
            weightSum > 0 ? weighted / weightSum : simpleSum / simpleCount;
          return {
            display: formatCadenceDays(value),
            sublabel: "weighted by send volume"
          };
        },
        perBrand: (b) => ({
          display:
            b.cadence.avgDaysBetween !== null
              ? formatCadenceDays(b.cadence.avgDaysBetween)
              : "—",
          sublabel: b.cadence.typicalDay
            ? `Mostly ${b.cadence.typicalDay.label}s`
            : undefined,
          numeric: b.cadence.avgDaysBetween
        })
      },
      {
        id: "promo-share",
        label: "Promo share",
        rank: "high",
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
      }
    ],
    []
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
      const drill = definition.perBrand(brand);
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
