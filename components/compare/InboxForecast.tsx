"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { BrandPageData } from "@/lib/brand-db";
import {
  computeCohortForecast,
  type ForecastDay,
  type ForecastDayBand,
  type ForecastHorizon
} from "@/lib/forecast";
import { COMPARE_AGGREGATE_COLOR } from "./compareColors";
import styles from "./compare.module.css";
import v2 from "./compare-v2.module.css";
import fc from "./compare-forecast.module.css";

type Props = {
  brands: BrandPageData[];
};

const HORIZONS: { id: ForecastHorizon; label: string }[] = [
  { id: 7, label: "Next 7 days" },
  { id: 14, label: "Next 14 days" }
];

const BAND_COPY: Record<ForecastDayBand, { label: string; tone: string }> = {
  quiet: { label: "Quiet", tone: "Good day to send" },
  normal: { label: "Normal", tone: "Average noise from this group" },
  busy: { label: "Busy", tone: "Cluttered inbox risk" }
};

/**
 * "Predicted inbox crowding" panel.
 *
 * Renders a forward-looking bar strip showing how active the rest of
 * the cohort is expected to be over the next 7 or 14 days, so the
 * user can pick a quiet day to send into.
 *
 * The numbers come from {@link computeCohortForecast} — a transparent
 * day-of-week seasonal model with exponential time decay.
 *
 * Importantly, we deliberately *do not* surface the per-brand
 * contributions on the chart or in the tooltip, even though the
 * model produces them. Showing "we expect Acme to send 0.8 on Tue"
 * invites users to test the prediction brand-by-brand, which turns
 * every miss into a visible failure ("we said Acme would send and
 * they didn't"). The cohort-level aggregate is the only number with
 * enough signal to be defensible; collapsing the bars to a single
 * neutral fill mirrors that confidence story.
 *
 * Styling note: the forecast-specific classes live in their own
 * `compare-forecast.module.css` for the same Turbopack stale-cache
 * reason `compare-v2.module.css` exists (see that file's header).
 */
export default function InboxForecast({ brands }: Props) {
  const [horizon, setHorizon] = useState<ForecastHorizon>(7);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const forecast = useMemo(
    () => computeCohortForecast(brands, horizon),
    [brands, horizon]
  );

  if (brands.length === 0) return null;

  // Hide the panel entirely when the cohort doesn't have enough
  // observed weight to support a forecast.
  const insufficientSignal = forecast.totalWeight < 1;

  return (
    <section className={styles.section}>
      <div className={v2.cadenceHead}>
        <div>
          <span className={styles.sectionEyebrow}>Forecast</span>
          <h2 className={styles.sectionTitle}>Predicted inbox crowding</h2>
          <p className={styles.sectionSub}>
            Estimated cohort sends per day for the upcoming week or
            fortnight. Use the quiet days to slot your own campaign in
            without competing with everyone else.
          </p>
        </div>
        <div
          className={v2.lookback}
          role="tablist"
          aria-label="Forecast horizon"
        >
          {HORIZONS.map((h) => {
            const isActive = h.id === horizon;
            return (
              <button
                key={h.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`${v2.lookbackBtn} ${
                  isActive ? v2.lookbackBtnActive : ""
                }`}
                onClick={() => setHorizon(h.id)}
              >
                {h.label}
              </button>
            );
          })}
        </div>
      </div>

      {insufficientSignal ? (
        <p className={styles.empty}>
          Not enough captured sends in this cohort to forecast yet.
          Track these brands for a couple of weeks and the prediction
          will fill in.
        </p>
      ) : (
        <>
          <ForecastCallouts forecast={forecast} />

          <div className={fc.strip}>
            {forecast.days.map((day, idx) => {
              const heightRatio =
                forecast.max > 0 ? day.expected / forecast.max : 0;
              const bandClass =
                day.band === "quiet"
                  ? fc.band_quiet
                  : day.band === "busy"
                    ? fc.band_busy
                    : "";
              return (
                <button
                  key={day.date}
                  type="button"
                  className={`${fc.column} ${bandClass}`}
                  onMouseEnter={() => setHoverIdx(idx)}
                  onMouseLeave={() => setHoverIdx(null)}
                  onFocus={() => setHoverIdx(idx)}
                  onBlur={() => setHoverIdx(null)}
                  aria-label={`${formatLongDay(day.date)}: ${
                    day.expected.toFixed(1)
                  } expected email${day.expected === 1 ? "" : "s"} · ${
                    BAND_COPY[day.band].label
                  }`}
                >
                  <span className={fc.barTrack}>
                    <span
                      className={fc.bar}
                      style={{
                        height: `${Math.max(heightRatio * 100, day.expected > 0 ? 6 : 0)}%`,
                        // Single neutral fill — see component header for
                        // why we don't break the bar out by brand.
                        background:
                          day.expected > 0 ? COMPARE_AGGREGATE_COLOR : undefined
                      }}
                    />
                  </span>
                  <span className={fc.day}>{formatWeekdayShort(day.date)}</span>
                  <span className={fc.date}>{formatDayMonth(day.date)}</span>
                  {hoverIdx === idx ? (
                    <ForecastTooltip
                      day={day}
                      positionRatio={
                        forecast.days.length > 1
                          ? idx / (forecast.days.length - 1)
                          : 0.5
                      }
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          <p className={fc.footnote}>
            Predictions blend each brand's day-of-week rhythm over the
            last few months and weight recent sends more heavily.
            Treat this as a planning hint — actual sends can shift
            around promos and holidays.
          </p>
        </>
      )}
    </section>
  );
}

function ForecastCallouts({
  forecast
}: {
  forecast: ReturnType<typeof computeCohortForecast>;
}) {
  const { quietest, busiest } = forecast;
  if (!quietest && !busiest) return null;

  return (
    <div className={fc.callouts}>
      {quietest ? (
        <CalloutCard variant="quiet" title="Quietest day" day={quietest} />
      ) : null}
      {busiest ? (
        <CalloutCard variant="busy" title="Busiest day" day={busiest} />
      ) : null}
    </div>
  );
}

function CalloutCard({
  variant,
  title,
  day
}: {
  variant: "quiet" | "busy";
  title: string;
  day: ForecastDay;
}) {
  const variantClass = variant === "quiet" ? fc.callout_quiet : fc.callout_busy;
  return (
    <div className={`${fc.callout} ${variantClass}`}>
      <span className={fc.calloutLabel}>{title}</span>
      <span className={fc.calloutDay}>{formatLongDay(day.date)}</span>
      <span className={fc.calloutMeta}>
        ~{day.expected.toFixed(1)} cohort email{day.expected === 1 ? "" : "s"}
        {" · "}
        in {day.daysAhead} day{day.daysAhead === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function ForecastTooltip({
  day,
  positionRatio
}: {
  day: ForecastDay;
  positionRatio: number;
}) {
  // Same anchoring rule as the cadence tooltip — flip across the chart
  // midpoint so the tooltip never spills past the edge of the strip.
  const align =
    positionRatio > 0.6 ? "right" : positionRatio < 0.4 ? "left" : "center";
  const transform =
    align === "right"
      ? "translateX(-100%)"
      : align === "left"
        ? "translateX(0%)"
        : "translateX(-50%)";

  const bandCopy = BAND_COPY[day.band];
  const dotClass =
    day.band === "quiet"
      ? fc.bandDot_quiet
      : day.band === "busy"
        ? fc.bandDot_busy
        : fc.bandDot_normal;

  return (
    <div
      className={v2.tooltip}
      style={
        {
          left: `${positionRatio * 100}%`,
          transform,
          bottom: "calc(100% + 0.5rem)"
        } as CSSProperties
      }
      role="tooltip"
    >
      <div className={v2.tooltipHead}>
        <span className={v2.tooltipDate}>{formatLongDay(day.date)}</span>
        <span className={v2.tooltipTotal}>
          ~{day.expected.toFixed(1)} email{day.expected === 1 ? "" : "s"}
        </span>
      </div>
      <div className={fc.tooltipBand}>
        <span className={`${fc.bandDot} ${dotClass}`} />
        {bandCopy.label} · {bandCopy.tone}
      </div>
    </div>
  );
}

// Pinned locale + timezone for SSR/CSR parity. Matches the conventions
// already used by `CadenceStack` so date strings format identically
// across the dashboard.
const DATE_LOCALE = "en-US";
const DATE_ZONE = "UTC";

function formatLongDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(DATE_LOCALE, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: DATE_ZONE
  });
}

function formatWeekdayShort(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(DATE_LOCALE, {
    weekday: "short",
    timeZone: DATE_ZONE
  });
}

function formatDayMonth(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(DATE_LOCALE, {
    month: "short",
    day: "numeric",
    timeZone: DATE_ZONE
  });
}
