"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BrandPageData } from "@/lib/brand-db";
import { COMPARE_AGGREGATE_COLOR, getCompareColor } from "./compareColors";
import styles from "./compare.module.css";
import v2 from "./compare-v2.module.css";

type Props = {
  brands: BrandPageData[];
};

type LookbackId = "1w" | "1m" | "6m" | "12m";

const LOOKBACKS: { id: LookbackId; label: string; days: number }[] = [
  { id: "1w", label: "1 week", days: 7 },
  { id: "1m", label: "1 month", days: 30 },
  { id: "6m", label: "6 months", days: 180 },
  { id: "12m", label: "12 months", days: 365 }
];

type Bucket = {
  label: string;
  tooltipLabel: string;
  counts: number[];
  total: number;
};

/**
 * Stacked-bar "send frequency" panel for the comparison dashboard.
 *
 * - Each bar is a single day (1w / 1m) or week (6m / 12m).
 * - Bar height encodes the cohort-wide send total for that bucket.
 * - Brand contributions are stacked inside each bar using the compare
 *   palette so colours stay distinguishable across the full cohort.
 * - Hover or focus a column to surface the per-brand breakdown in
 *   the tooltip; click toggles it sticky so users can read it.
 * - Upper-right tablist switches the lookback window.
 *
 * Layout uses `compare-v2.module.css` (new module) for stability —
 * Turbopack was dropping incremental updates to the original CSS
 * module mid-session, so the chart wouldn't get its height/flex.
 */
export default function CadenceStack({ brands }: Props) {
  const [lookback, setLookback] = useState<LookbackId>("1m");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHoverIdx(null);
  }, [lookback, brands]);

  const meta = useMemo(
    () => LOOKBACKS.find((l) => l.id === lookback) ?? LOOKBACKS[1],
    [lookback]
  );

  const buckets = useMemo<Bucket[]>(() => {
    if (brands.length === 0) return [];
    const timelineLen = brands[0].cadence.dailyTimeline.length;
    if (timelineLen === 0) return [];

    const days = meta.days;
    const startIdx = Math.max(0, timelineLen - days);
    const slice = timelineLen - startIdx;

    if (meta.id === "1w" || meta.id === "1m") {
      const out: Bucket[] = [];
      for (let i = 0; i < slice; i++) {
        const idx = startIdx + i;
        const counts: number[] = [];
        let total = 0;
        for (const brand of brands) {
          const c = brand.cadence.dailyTimeline[idx]?.count ?? 0;
          counts.push(c);
          total += c;
        }
        const date = brands[0].cadence.dailyTimeline[idx]?.date ?? "";
        out.push({
          label: formatDayKey(date, meta.id === "1w" ? "weekday" : "short"),
          tooltipLabel: formatDayKey(date, "long"),
          counts,
          total
        });
      }
      return out;
    }

    // 6m / 12m → roll up into 7-day buckets ending today.
    const weekSpan = 7;
    const out: Bucket[] = [];
    let cursor = timelineLen - 1;
    while (cursor >= startIdx) {
      const lo = Math.max(startIdx, cursor - weekSpan + 1);
      const counts = new Array<number>(brands.length).fill(0);
      let total = 0;
      for (let i = lo; i <= cursor; i++) {
        for (let b = 0; b < brands.length; b++) {
          const c = brands[b].cadence.dailyTimeline[i]?.count ?? 0;
          counts[b] += c;
          total += c;
        }
      }
      const firstDate = brands[0].cadence.dailyTimeline[lo]?.date ?? "";
      const lastDate = brands[0].cadence.dailyTimeline[cursor]?.date ?? "";
      out.push({
        label: formatDayKey(firstDate, "short"),
        tooltipLabel:
          firstDate === lastDate
            ? formatDayKey(firstDate, "long")
            : `${formatDayKey(firstDate, "short")} – ${formatDayKey(
                lastDate,
                "short"
              )}`,
        counts,
        total
      });
      cursor = lo - 1;
    }
    return out.reverse();
  }, [brands, meta]);

  const max = useMemo(
    () => buckets.reduce((acc, b) => Math.max(acc, b.total), 0),
    [buckets]
  );

  if (brands.length === 0) return null;
  const noData = max === 0;

  return (
    <section className={styles.section}>
      <div className={v2.cadenceHead}>
        <div>
          <span className={styles.sectionEyebrow}>Cadence</span>
          <h2 className={styles.sectionTitle}>Send frequency over time</h2>
          <p className={styles.sectionSub}>
            Cohort sends per{" "}
            {meta.id === "1w" || meta.id === "1m" ? "day" : "week"}. Each bar
            is stacked by brand; hover to see who sent what.
          </p>
        </div>
        <div
          className={v2.lookback}
          role="tablist"
          aria-label="Send frequency lookback"
        >
          {LOOKBACKS.map((l) => {
            const isActive = l.id === meta.id;
            return (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`${v2.lookbackBtn} ${
                  isActive ? v2.lookbackBtnActive : ""
                }`}
                onClick={() => setLookback(l.id)}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      {noData ? (
        <p className={styles.empty}>
          No send activity captured in the selected window.
        </p>
      ) : (
        <div className={v2.stackWrap} ref={containerRef}>
          <div
            className={v2.stackChart}
            onMouseLeave={() => setHoverIdx(null)}
            role="img"
            aria-label={`Stacked send frequency for ${meta.label}`}
          >
            {buckets.map((bucket, idx) => {
              const heightRatio = max > 0 ? bucket.total / max : 0;
              return (
                <div
                  key={`${bucket.label}-${idx}`}
                  className={v2.stackColumn}
                  onMouseEnter={() => setHoverIdx(idx)}
                  onFocus={() => setHoverIdx(idx)}
                  onClick={() =>
                    setHoverIdx((current) => (current === idx ? null : idx))
                  }
                  tabIndex={0}
                  aria-label={`${bucket.tooltipLabel}: ${bucket.total} email${
                    bucket.total === 1 ? "" : "s"
                  }`}
                >
                  <div
                    className={v2.stackBar}
                    style={{
                      height: `${heightRatio * 100}%`,
                      minHeight: bucket.total > 0 ? "2px" : "0"
                    }}
                  >
                    {bucket.counts.map((count, bIdx) => {
                      if (count === 0) return null;
                      const share = bucket.total > 0 ? count / bucket.total : 0;
                      const color = getCompareColor(bIdx);
                      return (
                        <span
                          key={brands[bIdx].brand.id}
                          className={v2.stackSeg}
                          style={{
                            flexBasis: `${share * 100}%`,
                            background: color
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {hoverIdx !== null && buckets[hoverIdx] ? (
              <CadenceTooltip
                bucket={buckets[hoverIdx]}
                brands={brands}
                positionRatio={
                  buckets.length > 1 ? hoverIdx / (buckets.length - 1) : 0.5
                }
              />
            ) : null}
          </div>

          <div className={v2.stackAxis}>
            <span>{buckets[0]?.label ?? ""}</span>
            <span>{buckets[buckets.length - 1]?.label ?? ""}</span>
          </div>

          <div className={v2.legend}>
            {brands.map((b, idx) => (
              <span key={b.brand.id} className={v2.legendItem}>
                <span
                  className={v2.legendSwatch}
                  style={{ background: getCompareColor(idx) }}
                />
                <span>{b.brand.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CadenceTooltip({
  bucket,
  brands,
  positionRatio
}: {
  bucket: Bucket;
  brands: BrandPageData[];
  positionRatio: number;
}) {
  const rows = brands
    .map((brand, idx) => ({
      id: brand.brand.id,
      name: brand.brand.name,
      count: bucket.counts[idx] ?? 0,
      color: getCompareColor(idx)
    }))
    .sort((a, b) => b.count - a.count);

  // Anchor the tooltip near the active column but flip it across the
  // midpoint so it never spills past the chart edges.
  const align =
    positionRatio > 0.6 ? "right" : positionRatio < 0.4 ? "left" : "center";
  const transform =
    align === "right"
      ? "translateX(-100%)"
      : align === "left"
        ? "translateX(0%)"
        : "translateX(-50%)";

  return (
    <div
      className={v2.tooltip}
      style={{ left: `${positionRatio * 100}%`, transform }}
      role="tooltip"
    >
      <div className={v2.tooltipHead}>
        <span className={v2.tooltipDate}>{bucket.tooltipLabel}</span>
        <span className={v2.tooltipTotal}>
          {bucket.total} email{bucket.total === 1 ? "" : "s"}
          <span
            style={{
              width: "0.45rem",
              height: "0.45rem",
              borderRadius: "999px",
              background: COMPARE_AGGREGATE_COLOR,
              display: "inline-block"
            }}
            aria-hidden="true"
          />
        </span>
      </div>
      <ul className={v2.tooltipList}>
        {rows.map((row) => (
          <li key={row.id} className={v2.tooltipRow}>
            <span
              className={v2.tooltipDot}
              style={{ background: row.color }}
              aria-hidden="true"
            />
            <span className={v2.tooltipBrand}>{row.name}</span>
            <span className={v2.tooltipCount}>
              {row.count === 0 ? "—" : row.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Pinned locale + timezone so SSR and client agree (an en-GB browser
// would otherwise re-render "Apr 22" as "22 Apr" and trigger a
// hydration mismatch). The axis chrome reads fine in fixed English.
const DATE_LOCALE = "en-US";
const DATE_ZONE = "UTC";

function formatDayKey(
  iso: string,
  variant: "weekday" | "short" | "long"
): string {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  if (variant === "weekday") {
    return date.toLocaleDateString(DATE_LOCALE, {
      weekday: "short",
      day: "numeric",
      timeZone: DATE_ZONE
    });
  }
  if (variant === "short") {
    return date.toLocaleDateString(DATE_LOCALE, {
      month: "short",
      day: "numeric",
      timeZone: DATE_ZONE
    });
  }
  return date.toLocaleDateString(DATE_LOCALE, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: DATE_ZONE
  });
}
