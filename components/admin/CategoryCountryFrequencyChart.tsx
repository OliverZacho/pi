"use client";

import { useMemo, useState } from "react";
import type { CategoryCountryFrequencyPoint } from "@/lib/admin-types";
import { countryFlag, countryName } from "@/lib/country";

// SVG canvas geometry. The chart scales to its container via width:100% on the
// <svg> + this fixed viewBox, so coordinate math stays in these units.
const W = 760;
const H = 320;
const M = { top: 16, right: 12, bottom: 72, left: 40 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

const UNCATEGORIZED = "__uncategorized__";
const UNKNOWN_COUNTRY = "__unknown__";

const BAR_COLOR = "#0891b2";

type Metric = "emailsPerWeek" | "daysBetween";

function formatCategoryLabel(category: string): string {
  if (category === UNCATEGORIZED) return "Uncategorized";
  return category
    .split("_")
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function countryLabel(code: string): string {
  return code === UNKNOWN_COUNTRY ? "Unknown" : countryName(code);
}

function countryShortLabel(code: string): string {
  return code === UNKNOWN_COUNTRY ? "Unknown" : `${countryFlag(code)} ${code}`;
}

function formatRate(value: number): string {
  return value.toFixed(value >= 10 ? 0 : 1);
}

/**
 * Interactive cadence comparison: pick a category, then see the average send
 * frequency for each country inside it (e.g. home & living brands in Sweden vs
 * Denmark). Only brands with 5+ captured emails feed the averages. Toggle the
 * metric between "emails per week" and "days between sends"; hover a bar to
 * read both plus the brand count. Bars are ordered most-frequent first.
 */
export default function CategoryCountryFrequencyChart({
  data
}: {
  data: CategoryCountryFrequencyPoint[];
}) {
  const [metric, setMetric] = useState<Metric>("emailsPerWeek");
  const [hover, setHover] = useState<number | null>(null);

  // Categories that have any country breakdown, sorted by how many countries
  // they span (most comparable first) then total brands — so the default pick
  // is one where there's actually something to compare.
  const categories = useMemo(() => {
    const byCategory = new Map<string, { countries: number; brands: number }>();
    for (const point of data) {
      const entry = byCategory.get(point.category) ?? { countries: 0, brands: 0 };
      entry.countries += 1;
      entry.brands += point.brands;
      byCategory.set(point.category, entry);
    }
    return Array.from(byCategory.entries())
      .map(([key, stats]) => ({ key, ...stats }))
      .sort((a, b) => {
        if (b.countries !== a.countries) return b.countries - a.countries;
        if (b.brands !== a.brands) return b.brands - a.brands;
        return formatCategoryLabel(a.key).localeCompare(formatCategoryLabel(b.key));
      });
  }, [data]);

  const [selected, setSelected] = useState<string | null>(null);
  // Fall back to the top category until the operator picks one, and recover if
  // the selected category drops out of a refreshed dataset.
  const activeCategory =
    selected && categories.some((c) => c.key === selected)
      ? selected
      : categories[0]?.key ?? null;

  const points = useMemo(() => {
    if (!activeCategory) return [];
    return data
      .filter((point) => point.category === activeCategory)
      .sort((a, b) => {
        if (b.emailsPerWeek !== a.emailsPerWeek) return b.emailsPerWeek - a.emailsPerWeek;
        return countryLabel(a.country).localeCompare(countryLabel(b.country));
      });
  }, [data, activeCategory]);

  const n = points.length;
  const values = useMemo(() => points.map((p) => p[metric]), [points, metric]);
  const axis = useMemo(() => axisScale(Math.max(...values, 0)), [values]);

  if (categories.length === 0) {
    return (
      <p className="muted">
        No cadence yet — countries appear here once tagged brands have sent 5+ emails.
      </p>
    );
  }

  const band = PLOT_W / Math.max(n, 1);
  const barW = Math.min(band * 0.62, 52);
  const xCenter = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + PLOT_H - (v / axis.max) * PLOT_H;
  const rotateLabels = n > 6;

  const hovered = hover === null ? null : points[hover];
  const hoverPct = hover === null ? 0 : (xCenter(hover) / W) * 100;
  const showDays = metric === "daysBetween";

  return (
    <div className="growth-chart">
      <div className="cat-chart-controls">
        <label className="cat-chart-select">
          <span>Category</span>
          <select
            value={activeCategory ?? ""}
            onChange={(event) => {
              setSelected(event.target.value);
              setHover(null);
            }}
          >
            {categories.map((cat) => (
              <option key={cat.key} value={cat.key}>
                {formatCategoryLabel(cat.key)} ({cat.countries}{" "}
                {cat.countries === 1 ? "country" : "countries"})
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={`cat-chart-toggle${showDays ? " is-on" : ""}`}
          onClick={() => setMetric((m) => (m === "emailsPerWeek" ? "daysBetween" : "emailsPerWeek"))}
          aria-pressed={showDays}
        >
          <span className="cat-chart-toggle-track" aria-hidden="true">
            <span className="cat-chart-toggle-thumb" />
          </span>
          {showDays ? "Days between sends" : "Emails per week"}
        </button>
      </div>

      <div className="growth-chart-canvas">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Average send frequency per country">
          {/* Horizontal gridlines + y-axis ticks. */}
          {axis.ticks.map((tick) => {
            const yy = y(tick);
            return (
              <g key={`grid-${tick}`}>
                <line x1={M.left} x2={W - M.right} y1={yy} y2={yy} className="growth-gridline" />
                <text x={M.left - 8} y={yy + 3} className="growth-axis-label" textAnchor="end">
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Bars. */}
          {points.map((point, i) => {
            const cx = xCenter(i);
            const x0 = cx - barW / 2;
            const isHover = hover === i;
            const yTop = y(point[metric]);
            return (
              <g
                key={point.country}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              >
                {/* Full-band hover target so the gaps between bars respond too. */}
                <rect x={M.left + band * i} y={M.top} width={band} height={PLOT_H} fill="transparent" />
                <rect
                  x={x0}
                  y={yTop}
                  width={barW}
                  height={Math.max(M.top + PLOT_H - yTop, 0)}
                  fill={BAR_COLOR}
                  className="cat-chart-bar"
                  style={{ opacity: hover === null || isHover ? 1 : 0.55 }}
                />
              </g>
            );
          })}

          {/* X-axis country labels. */}
          {points.map((point, i) => {
            const cx = xCenter(i);
            const yy = H - M.bottom + 16;
            return (
              <text
                key={`xlabel-${point.country}`}
                x={cx}
                y={yy}
                className="growth-axis-label"
                textAnchor={rotateLabels ? "end" : "middle"}
                transform={rotateLabels ? `rotate(-35 ${cx} ${yy})` : undefined}
              >
                {countryShortLabel(point.country)}
              </text>
            );
          })}
        </svg>

        {hovered ? (
          <div className="growth-tooltip" style={{ left: `${hoverPct}%` }} role="status">
            <div className="growth-tooltip-day">{countryLabel(hovered.country)}</div>
            <div className="growth-tooltip-row">
              <span className="growth-legend-swatch" style={{ background: BAR_COLOR }} />
              {formatRate(hovered.emailsPerWeek)} emails/week
            </div>
            <div className="growth-tooltip-row">
              every {formatRate(hovered.daysBetween)} day{hovered.daysBetween >= 1.5 ? "s" : ""}
            </div>
            <div className="growth-tooltip-row cat-chart-tooltip-total">
              {hovered.brands} brand{hovered.brands === 1 ? "" : "s"}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Builds a 0..niceMax tick scale with round steps for the y-axis. */
function axisScale(max: number): { max: number; ticks: number[] } {
  if (max <= 0) return { max: 1, ticks: [0, 1] };
  const step = niceStep(max / 4);
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + step / 1000; v += step) {
    ticks.push(Math.round(v));
  }
  return { max: niceMax, ticks };
}

/** Rounds a raw step up to a "nice" 1/2/2.5/5/10 × 10ⁿ value for clean labels. */
function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  let nice: number;
  if (f <= 1) nice = 1;
  else if (f <= 2) nice = 2;
  else if (f <= 2.5) nice = 2.5;
  else if (f <= 5) nice = 5;
  else nice = 10;
  return Math.max(1, nice * base);
}
