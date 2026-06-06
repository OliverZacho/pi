"use client";

import { useMemo, useState } from "react";
import type { GrowthPoint } from "@/lib/admin-types";

type SeriesKey = "emails" | "brands";

type SeriesConfig = {
  key: SeriesKey;
  label: string;
  color: string;
  /** Which y-axis this line is scaled against. */
  axis: "left" | "right";
};

const SERIES: SeriesConfig[] = [
  { key: "emails", label: "Captured emails", color: "#2563eb", axis: "left" },
  { key: "brands", label: "Subscribed brands", color: "#059669", axis: "right" }
];

// SVG canvas geometry. The chart scales to its container via width:100% on the
// <svg> + this fixed viewBox, so coordinate math stays in these units.
const W = 760;
const H = 300;
const M = { top: 16, right: 52, bottom: 34, left: 52 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/**
 * Interactive cumulative growth chart: captured emails and subscribed brands as
 * two lines on independent y-axes (their magnitudes differ a lot). Click a
 * legend entry to hide/show its line; hover to read exact values per day.
 */
export default function GrowthChart({ data }: { data: GrowthPoint[] }) {
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    emails: true,
    brands: true
  });
  const [hover, setHover] = useState<number | null>(null);

  const n = data.length;

  const axes = useMemo(() => {
    const leftMax = Math.max(...data.map((d) => d.emails), 0);
    const rightMax = Math.max(...data.map((d) => d.brands), 0);
    return {
      left: axisScale(leftMax),
      right: axisScale(rightMax)
    };
  }, [data]);

  if (n < 2) {
    return (
      <p className="muted">Not enough history yet — the chart needs at least two days of data.</p>
    );
  }

  const x = (i: number) => M.left + (i / (n - 1)) * PLOT_W;
  const yLeft = (v: number) => M.top + PLOT_H - (v / axes.left.max) * PLOT_H;
  const yRight = (v: number) => M.top + PLOT_H - (v / axes.right.max) * PLOT_H;
  const yFor = (cfg: SeriesConfig, v: number) => (cfg.axis === "left" ? yLeft(v) : yRight(v));

  const toggle = (key: SeriesKey) =>
    setVisible((current) => {
      // Keep at least one line on — toggling the last visible one off would
      // leave an empty chart, so ignore that click.
      const next = { ...current, [key]: !current[key] };
      if (!next.emails && !next.brands) return current;
      return next;
    });

  // Map a pointer position over the plot to the nearest data index.
  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, index)));
  };

  const xTickIndices = tickIndices(n, 6);
  const hovered = hover === null ? null : data[hover];
  const hoverPct = hover === null ? 0 : (x(hover) / W) * 100;

  return (
    <div className="growth-chart">
      <div className="growth-legend">
        {SERIES.map((cfg) => (
          <button
            key={cfg.key}
            type="button"
            className={`growth-legend-item${visible[cfg.key] ? "" : " is-off"}`}
            onClick={() => toggle(cfg.key)}
            aria-pressed={visible[cfg.key]}
            title={visible[cfg.key] ? `Hide ${cfg.label}` : `Show ${cfg.label}`}
          >
            <span className="growth-legend-swatch" style={{ background: cfg.color }} />
            {cfg.label}
          </button>
        ))}
      </div>

      <div className="growth-chart-canvas">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative emails and brands over time">
          {/* Horizontal gridlines + left/right axis ticks. */}
          {axes.left.ticks.map((tick) => {
            const yy = yLeft(tick);
            return (
              <g key={`grid-${tick}`}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={yy}
                  y2={yy}
                  className="growth-gridline"
                />
                <text x={M.left - 8} y={yy + 3} className="growth-axis-label" textAnchor="end">
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}
          {axes.right.ticks.map((tick) => {
            const yy = yRight(tick);
            return (
              <text
                key={`rtick-${tick}`}
                x={W - M.right + 8}
                y={yy + 3}
                className="growth-axis-label growth-axis-label-right"
                textAnchor="start"
              >
                {formatTick(tick)}
              </text>
            );
          })}

          {/* X-axis date ticks. */}
          {xTickIndices.map((i) => (
            <text
              key={`xtick-${i}`}
              x={x(i)}
              y={H - M.bottom + 18}
              className="growth-axis-label"
              textAnchor="middle"
            >
              {formatDay(data[i].day)}
            </text>
          ))}

          {/* Hover guide. */}
          {hover !== null ? (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={M.top}
              y2={M.top + PLOT_H}
              className="growth-hover-line"
            />
          ) : null}

          {/* Series lines. */}
          {SERIES.filter((cfg) => visible[cfg.key]).map((cfg) => (
            <polyline
              key={cfg.key}
              fill="none"
              stroke={cfg.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={data.map((d, i) => `${x(i)},${yFor(cfg, d[cfg.key])}`).join(" ")}
            />
          ))}

          {/* Hover dots. */}
          {hover !== null
            ? SERIES.filter((cfg) => visible[cfg.key]).map((cfg) => (
                <circle
                  key={`dot-${cfg.key}`}
                  cx={x(hover)}
                  cy={yFor(cfg, data[hover][cfg.key])}
                  r={3.5}
                  fill="#ffffff"
                  stroke={cfg.color}
                  strokeWidth={2}
                />
              ))
            : null}

          {/* Transparent capture layer for hover. */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </svg>

        {hovered ? (
          <div
            className="growth-tooltip"
            style={{ left: `${hoverPct}%` }}
            role="status"
          >
            <div className="growth-tooltip-day">{formatDayLong(hovered.day)}</div>
            {SERIES.filter((cfg) => visible[cfg.key]).map((cfg) => (
              <div key={cfg.key} className="growth-tooltip-row">
                <span className="growth-legend-swatch" style={{ background: cfg.color }} />
                {cfg.label}: <strong>{formatTick(hovered[cfg.key])}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Builds a 0..niceMax tick scale with round steps for an axis. */
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
  return nice * base;
}

/** Evenly spaced indices (always including first and last) for x-axis labels. */
function tickIndices(n: number, count: number): number[] {
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(Math.round((i / (count - 1)) * (n - 1)));
  }
  return Array.from(new Set(out));
}

function formatTick(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DAY_FORMAT_LONG = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric"
});

function parseDay(day: string): Date {
  // Treat the YYYY-MM-DD as UTC noon to avoid any timezone day-shift.
  return new Date(`${day}T12:00:00Z`);
}

function formatDay(day: string): string {
  return DAY_FORMAT.format(parseDay(day));
}

function formatDayLong(day: string): string {
  return DAY_FORMAT_LONG.format(parseDay(day));
}
