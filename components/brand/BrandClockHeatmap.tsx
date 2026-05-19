"use client";

import { useMemo } from "react";
import { getActiveTimeZone, getZoneAbbreviation } from "@/lib/datetime";
import styles from "./brand.module.css";

type Props = {
  brandName: string;
  /**
   * Length-24 array of send counts indexed by hour-of-day in the
   * platform time zone (Europe/Copenhagen).
   */
  hourly: number[];
};

/**
 * Two side-by-side analog clock faces (AM and PM) where each hour
 * wedge is shaded by how often the brand sends in that hour. Heavy
 * shade = busy hour, near-transparent = quiet hour. Reads as a
 * polar histogram, but presented as something everyone already
 * understands: a clock.
 *
 * We render with SVG annular sectors so the centre stays clean for
 * the "AM" / "PM" label, and we let the browser surface native
 * `<title>` tooltips on hover — keeping the markup small and a11y
 * narration ("3 PM: 12 emails, 18%") for free.
 */
export default function BrandClockHeatmap({ brandName, hourly }: Props) {
  // Derived once per render. The abbreviation switches between "CEST"
  // (summer) and "CET" (winter) automatically, so the copy stays
  // accurate without a year-round caveat.
  const zoneAbbr = useMemo(
    () => getZoneAbbreviation(new Date(), getActiveTimeZone()),
    []
  );

  const totalSends = useMemo(
    () => hourly.reduce((acc, count) => acc + count, 0),
    [hourly]
  );
  // Floor the divisor at 1 so a fresh brand with no sends never
  // divides by zero downstream when we compute intensity ratios.
  const max = useMemo(
    () => Math.max(1, ...hourly),
    [hourly]
  );

  const peakHour = useMemo(() => {
    if (totalSends === 0) return null;
    let best = 0;
    for (let i = 1; i < hourly.length; i++) {
      if (hourly[i] > hourly[best]) best = i;
    }
    return best;
  }, [hourly, totalSends]);

  const quietestHour = useMemo(() => {
    const active = hourly
      .map((count, i) => ({ count, i }))
      .filter((entry) => entry.count > 0);
    if (active.length === 0) return null;
    let best = active[0];
    for (const entry of active) {
      if (entry.count < best.count) best = entry;
    }
    return best.i;
  }, [hourly]);

  const activeHours = useMemo(
    () => hourly.filter((count) => count > 0).length,
    [hourly]
  );

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardEyebrow}>Time of day</span>
          <h2 className={styles.cardTitle}>Send hours</h2>
          <p className={styles.cardSub}>
            When during the day {brandName} hits inboxes. Darker
            wedges represent hours with more sends; lighter wedges
            are quieter. All times shown in {zoneAbbr}.
          </p>
        </div>
      </div>

      <div className={styles.clockPair}>
        <ClockFace
          label="AM"
          hourlyForClock={hourly.slice(0, 12)}
          hourOffset={0}
          max={max}
          totalSends={totalSends}
        />
        <ClockFace
          label="PM"
          hourlyForClock={hourly.slice(12, 24)}
          hourOffset={12}
          max={max}
          totalSends={totalSends}
        />
      </div>

      <div className={styles.statStrip}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockLabel}>Peak hour</span>
          <span className={styles.statBlockValue}>
            {peakHour !== null ? formatHour(peakHour) : "—"}
          </span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockLabel}>Quietest send</span>
          <span className={styles.statBlockValue}>
            {quietestHour !== null ? formatHour(quietestHour) : "—"}
          </span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockLabel}>Active hours</span>
          <span className={styles.statBlockValue}>{activeHours} / 24</span>
        </div>
      </div>
    </article>
  );
}

/* -----------------------------------------------------------------
   Clock face
   ----------------------------------------------------------------- */

type ClockFaceProps = {
  label: "AM" | "PM";
  hourlyForClock: number[];
  hourOffset: 0 | 12;
  max: number;
  totalSends: number;
};

const CX = 100;
const CY = 100;
const R_OUTER = 86;
const R_INNER = 42;
const LABEL_RADIUS = 99;

const CARDINAL_LABELS: Array<{ pos: number; label: string }> = [
  { pos: 0, label: "12" },
  { pos: 3, label: "3" },
  { pos: 6, label: "6" },
  { pos: 9, label: "9" }
];

const MINOR_POSITIONS = [1, 2, 4, 5, 7, 8, 10, 11];

function ClockFace({
  label,
  hourlyForClock,
  hourOffset,
  max,
  totalSends
}: ClockFaceProps) {
  return (
    <div className={styles.clockWrap}>
      <svg
        viewBox="0 0 200 200"
        className={styles.clockSvg}
        role="img"
        aria-label={`${label} send hours`}
      >
        <circle
          cx={CX}
          cy={CY}
          r={R_OUTER}
          className={styles.clockRing}
        />

        {hourlyForClock.map((count, i) => {
          const hour = hourOffset + i;
          const a1 = (i - 0.5) * 30;
          const a2 = (i + 0.5) * 30;
          // 0 sends -> nearly invisible. >0 sends -> 18% to 100%
          // opacity in proportion to peak hour. The 18% floor keeps
          // every active hour visible even when one hour dominates.
          const intensity = count / max;
          const opacity =
            count === 0 ? 0.05 : 0.18 + intensity * 0.82;
          const d = annularPath(CX, CY, R_INNER, R_OUTER, a1, a2);
          return (
            <path
              key={i}
              d={d}
              className={styles.clockWedge}
              fillOpacity={opacity}
            >
              <title>
                {`${formatHour(hour)}: ${count} email${
                  count === 1 ? "" : "s"
                }${
                  totalSends > 0
                    ? ` (${Math.round((count / totalSends) * 100)}%)`
                    : ""
                }`}
              </title>
            </path>
          );
        })}

        {MINOR_POSITIONS.map((pos) => {
          const angle = pos * 30;
          const inner = polar(CX, CY, R_OUTER - 4, angle);
          const outer = polar(CX, CY, R_OUTER - 1, angle);
          return (
            <line
              key={pos}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              className={styles.clockTick}
            />
          );
        })}

        {CARDINAL_LABELS.map(({ pos, label: hourLabel }) => {
          const angle = pos * 30;
          const point = polar(CX, CY, LABEL_RADIUS, angle);
          return (
            <text
              key={pos}
              x={point.x}
              y={point.y}
              className={styles.clockHourLabel}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {hourLabel}
            </text>
          );
        })}

        <circle
          cx={CX}
          cy={CY}
          r={R_INNER - 3}
          className={styles.clockHub}
        />

        <text
          x={CX}
          y={CY}
          className={styles.clockCenterLabel}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {label}
        </text>
      </svg>
    </div>
  );
}

/* -----------------------------------------------------------------
   Geometry helpers
   ----------------------------------------------------------------- */

function polar(cx: number, cy: number, r: number, clockDeg: number) {
  // Clock degrees: 0 = top, 90 = right, 180 = bottom, 270 = left.
  // SVG/math: 0 = right, 90 = down. Subtract 90° to convert.
  const rad = ((clockDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}

function annularPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  a1Deg: number,
  a2Deg: number
): string {
  const outerStart = polar(cx, cy, rOuter, a1Deg);
  const outerEnd = polar(cx, cy, rOuter, a2Deg);
  const innerStart = polar(cx, cy, rInner, a1Deg);
  const innerEnd = polar(cx, cy, rInner, a2Deg);

  // Each wedge is 30° wide so the short-arc flag is always 0.
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${rInner} ${rInner} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    "Z"
  ].join(" ");
}

function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h12} ${ampm}`;
}
