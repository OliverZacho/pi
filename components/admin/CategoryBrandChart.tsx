"use client";

import { useMemo, useState } from "react";
import type { CompanySubscription } from "@/lib/admin-types";
import { countryFlag, countryName } from "@/lib/country";

// SVG canvas geometry. The chart scales to its container via width:100% on the
// <svg> + this fixed viewBox, so coordinate math stays in these units.
const W = 760;
const H = 320;
const M = { top: 16, right: 12, bottom: 72, left: 40 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

// Sentinel keys for brands that carry no category tag / no resolved country.
const UNCATEGORIZED = "__uncategorized__";
const UNKNOWN_COUNTRY = "__unknown__";

// A categorical palette assigned to countries in descending-frequency order so
// the most common markets get the most distinct hues. Unknown gets the muted
// grey below and is always stacked last.
const COUNTRY_PALETTE = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#db2777",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#65a30d",
  "#c026d3",
  "#0d9488",
  "#ea580c",
  "#4f46e5"
];
const UNKNOWN_COLOR = "#cbd5e1";
// Single-series colour used when the chart is not stacked.
const TOTAL_COLOR = "#2563eb";

type CategoryDatum = {
  /** Raw category tag, or the {@link UNCATEGORIZED} sentinel. */
  key: string;
  label: string;
  total: number;
  /** Brand count per country key (ISO alpha-2 or {@link UNKNOWN_COUNTRY}). */
  byCountry: Map<string, number>;
};

type CountryDatum = {
  key: string;
  label: string;
  color: string;
  total: number;
};

function formatMarketLabel(market: string): string {
  if (!market) return market;
  return market
    .split("_")
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function countryKeyLabel(key: string): string {
  return key === UNKNOWN_COUNTRY ? "Unknown" : countryName(key);
}

/**
 * Interactive bar chart of how many subscribed brands fall in each category
 * (market tag). Toggle "Stack by country" to break every bar into its primary
 * markets; click a country in the legend to hide/show its segments. A brand
 * tagged with several categories is counted once in each. Brands with no tag
 * land in an "Uncategorized" bar; brands with no resolved market country stack
 * under "Unknown".
 */
export default function CategoryBrandChart({
  companies
}: {
  companies: CompanySubscription[];
}) {
  const [stacked, setStacked] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const { categories, countries } = useMemo(() => {
    const catMap = new Map<string, CategoryDatum>();
    const countryTotals = new Map<string, number>();

    for (const company of companies) {
      const tags =
        company.markets.length > 0 ? company.markets : [UNCATEGORIZED];
      const country = company.primaryMarketCountry ?? UNKNOWN_COUNTRY;
      for (const tag of tags) {
        let entry = catMap.get(tag);
        if (!entry) {
          entry = {
            key: tag,
            label: tag === UNCATEGORIZED ? "Uncategorized" : formatMarketLabel(tag),
            total: 0,
            byCountry: new Map()
          };
          catMap.set(tag, entry);
        }
        entry.total += 1;
        entry.byCountry.set(country, (entry.byCountry.get(country) ?? 0) + 1);
        countryTotals.set(country, (countryTotals.get(country) ?? 0) + 1);
      }
    }

    const categories = Array.from(catMap.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.label.localeCompare(b.label);
    });

    // Stack/colour order: most frequent country first, Unknown always last.
    const countryKeys = Array.from(countryTotals.keys()).sort((a, b) => {
      if (a === UNKNOWN_COUNTRY) return 1;
      if (b === UNKNOWN_COUNTRY) return -1;
      const diff = (countryTotals.get(b) ?? 0) - (countryTotals.get(a) ?? 0);
      if (diff !== 0) return diff;
      return countryKeyLabel(a).localeCompare(countryKeyLabel(b));
    });

    let paletteIndex = 0;
    const countries: CountryDatum[] = countryKeys.map((key) => ({
      key,
      label: countryKeyLabel(key),
      color: key === UNKNOWN_COUNTRY ? UNKNOWN_COLOR : COUNTRY_PALETTE[paletteIndex++ % COUNTRY_PALETTE.length],
      total: countryTotals.get(key) ?? 0
    }));

    return { categories, countries };
  }, [companies]);

  const n = categories.length;

  // Country segments to actually draw, honouring the legend toggles. Only
  // relevant when stacked; non-stacked draws one full-height bar per category.
  const visibleCountries = useMemo(
    () => countries.filter((c) => !hidden.has(c.key)),
    [countries, hidden]
  );

  // Per-category displayed height: full total when flat, else the sum of the
  // currently-visible country segments. Rescaling the y-axis off the displayed
  // values keeps bars readable as countries are toggled off.
  const displayedTotals = useMemo(() => {
    if (!stacked) return categories.map((c) => c.total);
    return categories.map((c) =>
      visibleCountries.reduce((sum, country) => sum + (c.byCountry.get(country.key) ?? 0), 0)
    );
  }, [categories, stacked, visibleCountries]);

  const axis = useMemo(
    () => axisScale(Math.max(...displayedTotals, 0)),
    [displayedTotals]
  );

  if (n === 0) {
    return <p className="muted">No brands yet — categories appear here once brands are tagged.</p>;
  }

  const band = PLOT_W / n;
  const barW = Math.min(band * 0.62, 52);
  const xCenter = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + PLOT_H - (v / axis.max) * PLOT_H;
  // Rotate the x labels once they would start to collide.
  const rotateLabels = n > 6;

  function toggleCountry(key: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // Keep at least one country on so the chart never empties out.
        if (current.size >= countries.length - 1) return current;
        next.add(key);
      }
      return next;
    });
  }

  const hovered = hover === null ? null : categories[hover];
  const hoverPct = hover === null ? 0 : (xCenter(hover) / W) * 100;

  return (
    <div className="growth-chart">
      <div className="cat-chart-controls">
        <button
          type="button"
          className={`cat-chart-toggle${stacked ? " is-on" : ""}`}
          onClick={() => setStacked((s) => !s)}
          aria-pressed={stacked}
        >
          <span className="cat-chart-toggle-track" aria-hidden="true">
            <span className="cat-chart-toggle-thumb" />
          </span>
          Stack by country
        </button>

        {stacked ? (
          <div className="growth-legend cat-chart-legend">
            {countries.map((country) => {
              const off = hidden.has(country.key);
              return (
                <button
                  key={country.key}
                  type="button"
                  className={`growth-legend-item${off ? " is-off" : ""}`}
                  onClick={() => toggleCountry(country.key)}
                  aria-pressed={!off}
                  title={off ? `Show ${country.label}` : `Hide ${country.label}`}
                >
                  <span className="growth-legend-swatch" style={{ background: country.color }} />
                  {country.key === UNKNOWN_COUNTRY ? "" : `${countryFlag(country.key)} `}
                  {country.label}
                  <span className="cat-chart-legend-count">{country.total}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="growth-chart-canvas">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Subscribed brands per category">
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
          {categories.map((cat, i) => {
            const cx = xCenter(i);
            const x0 = cx - barW / 2;
            const isHover = hover === i;
            const segments: { key: string; color: string; from: number; to: number }[] = [];
            if (stacked) {
              let acc = 0;
              for (const country of visibleCountries) {
                const v = cat.byCountry.get(country.key) ?? 0;
                if (v <= 0) continue;
                segments.push({ key: country.key, color: country.color, from: acc, to: acc + v });
                acc += v;
              }
            } else {
              segments.push({ key: "total", color: TOTAL_COLOR, from: 0, to: cat.total });
            }
            return (
              <g
                key={cat.key}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              >
                {/* Full-band hover target so the gaps between bars respond too. */}
                <rect x={M.left + band * i} y={M.top} width={band} height={PLOT_H} fill="transparent" />
                {segments.map((seg) => {
                  const yTop = y(seg.to);
                  const yBottom = y(seg.from);
                  return (
                    <rect
                      key={seg.key}
                      x={x0}
                      y={yTop}
                      width={barW}
                      height={Math.max(yBottom - yTop, 0)}
                      fill={seg.color}
                      className="cat-chart-bar"
                      style={{ opacity: hover === null || isHover ? 1 : 0.55 }}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* X-axis category labels. */}
          {categories.map((cat, i) => {
            const cx = xCenter(i);
            const yy = H - M.bottom + 16;
            const label = cat.label.length > 14 ? `${cat.label.slice(0, 13)}…` : cat.label;
            return (
              <text
                key={`xlabel-${cat.key}`}
                x={cx}
                y={yy}
                className="growth-axis-label"
                textAnchor={rotateLabels ? "end" : "middle"}
                transform={rotateLabels ? `rotate(-35 ${cx} ${yy})` : undefined}
              >
                {label}
              </text>
            );
          })}
        </svg>

        {hovered ? (
          <div className="growth-tooltip" style={{ left: `${hoverPct}%` }} role="status">
            <div className="growth-tooltip-day">{hovered.label}</div>
            {stacked ? (
              <>
                {visibleCountries
                  .filter((country) => (hovered.byCountry.get(country.key) ?? 0) > 0)
                  .map((country) => (
                    <div key={country.key} className="growth-tooltip-row">
                      <span className="growth-legend-swatch" style={{ background: country.color }} />
                      {country.label}: <strong>{hovered.byCountry.get(country.key)}</strong>
                    </div>
                  ))}
                <div className="growth-tooltip-row cat-chart-tooltip-total">
                  Total: <strong>{displayedTotals[hover as number]}</strong>
                </div>
              </>
            ) : (
              <div className="growth-tooltip-row">
                <strong>{hovered.total}</strong>&nbsp;brand{hovered.total === 1 ? "" : "s"}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Builds a 0..niceMax integer tick scale with round steps for the y-axis. */
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
