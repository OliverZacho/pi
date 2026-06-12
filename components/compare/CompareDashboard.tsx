import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { BrandPageData } from "@/lib/brand-db";
import type { ExploreEmailCard } from "@/lib/explore-db";
import {
  buildComparisonInsights,
  QUIET_ZONE_DAYPARTS,
  QUIET_ZONE_DAYS,
  type ContentMixInsight,
  type DiscountTrendInsight,
  type OccasionInsight,
  type QuietZonesInsight,
  type RhythmInsight
} from "@/lib/comparison-insights";
import {
  detectGroupChanges,
  type BrandChange
} from "@/lib/comparison-changes";
import { colorForCategory } from "@/lib/category-colors";
import {
  defaultCompareSectionPrefs,
  type CompareSectionId,
  type CompareSectionPrefs
} from "@/lib/comparison-sections";
import { countryFlag, countryName } from "@/lib/country";
import { formatHourOfDay } from "@/lib/datetime";
import BrandRecentEmails from "@/components/brand/BrandRecentEmails";
import KpiTiles from "./KpiTiles";
import CadenceStack from "./CadenceStack";
import CompareSectionRail from "./CompareSectionRail";
import FingerprintSubject from "./FingerprintSubject";
import InboxForecast from "./InboxForecast";
import { COMPARE_AGGREGATE_COLOR, getCompareColor } from "./compareColors";
import styles from "./compare.module.css";
import v2 from "./compare-v2.module.css";

type Props = {
  brands: BrandPageData[];
  /** Optional list of brand ids the caller requested but couldn't load. */
  missingIds?: string[];
  /**
   * The viewer's saved section layout (order + hidden), resolved by the
   * page from `user_prefs` so the dashboard renders in the saved shape
   * on first paint. Defaults to the standard layout.
   */
  sectionPrefs?: CompareSectionPrefs;
};

/**
 * Multi-brand comparison dashboard.
 *
 * Receives N `BrandPageData` payloads (one per selected brand, produced
 * by `getCompetitorComparison`). Organised around the questions a
 * marketer asks about a group, and every section leads with a
 * rule-generated takeaway sentence (see `lib/comparison-insights.ts`)
 * with the chart below as evidence:
 *
 *   1. KPI tiles    — aggregate snapshot; click for per-brand drill-down
 *   2. Rhythm       — send-rate league table, cadence chart, forecast,
 *                     24h send-time heatmap
 *   3. Promo        — per-brand discount aggressiveness blocks
 *   4. Occasions    — seasonal-event matrix with per-brand lead times
 *   5. Voice        — per-brand creative fingerprint (palette, fonts,
 *                     subject habits, emoji, CTAs)
 *   6. Content mix  — stacked category-share bars
 *   7. Recent       — merged chronological feed
 *
 * The KPI tile and cadence sections are client islands because they
 * own interactive UI (modal + lookback selector + hover tooltip);
 * everything else stays server-rendered so the page hits the wire
 * fully hydrated on first paint.
 */
export default function CompareDashboard({
  brands,
  missingIds,
  sectionPrefs
}: Props) {
  if (brands.length === 0) {
    return (
      <section className={styles.section}>
        <p className={styles.empty}>
          Pick at least one brand from the picker above to see a comparison.
        </p>
      </section>
    );
  }

  const insights = buildComparisonInsights(brands);
  const changes = detectGroupChanges(brands);

  // One entry per section that has something to show for this cohort —
  // data-empty sections (occasions with no events, mix with no
  // categories, a week with no changes) are omitted entirely so the
  // rail never offers a collapsed bar for content that wouldn't render
  // anyway.
  const sections: { id: CompareSectionId; content: ReactNode }[] = [
    ...(changes.length > 0
      ? [
          {
            id: "whats-new" as const,
            content: <WhatsNewSection changes={changes} />
          }
        ]
      : []),
    {
      id: "kpis",
      content: (
        <KpiTiles
          brands={brands}
          urgencyShares={insights.urgencyShares}
          reminderShares={insights.reminderShares}
        />
      )
    },
    {
      id: "rhythm",
      content: <RhythmLeague brands={brands} insight={insights.rhythm} />
    },
    { id: "cadence", content: <CadenceStack brands={brands} /> },
    { id: "forecast", content: <InboxForecast brands={brands} /> },
    {
      id: "send-times",
      content: (
        <SendTimeStrips brands={brands} takeaway={insights.timingTakeaway} />
      )
    },
    ...(insights.quietZones.totalSends > 0
      ? [
          {
            id: "quiet-zones" as const,
            content: <QuietZonesSection insight={insights.quietZones} />
          }
        ]
      : []),
    {
      id: "promo",
      content: (
        <PromoBlocks
          brands={brands}
          takeaway={insights.promoTakeaway}
          trend={insights.discountTrend}
        />
      )
    },
    ...(insights.occasions.rows.length > 0
      ? [
          {
            id: "occasions" as const,
            content: (
              <OccasionMatrix brands={brands} insight={insights.occasions} />
            )
          }
        ]
      : []),
    {
      id: "fingerprint",
      content: (
        <FingerprintGrid brands={brands} takeaway={insights.voiceTakeaway} />
      )
    },
    ...(insights.mix.rows.some((row) => row.segments.length > 0)
      ? [
          {
            id: "content-mix" as const,
            content: <ContentMixSection insight={insights.mix} />
          }
        ]
      : []),
    { id: "recent", content: <RecentCampaigns brands={brands} /> }
  ];

  return (
    <>
      {missingIds && missingIds.length > 0 ? (
        <p className={styles.missingNote}>
          {missingIds.length} brand{missingIds.length === 1 ? "" : "s"} couldn't
          be loaded (possibly removed) and were skipped.
        </p>
      ) : null}

      <RegionNote brands={brands} />

      <CompareSectionRail
        sections={sections}
        initialPrefs={sectionPrefs ?? defaultCompareSectionPrefs()}
      />
    </>
  );
}

/* -----------------------------------------------------------------
   Takeaway line
   ----------------------------------------------------------------- */

/**
 * The one-sentence answer that leads a section. Rendered only when the
 * generator found something worth claiming — sections degrade to plain
 * chart + sub-line rather than show a hollow sentence.
 */
function Takeaway({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className={styles.takeaway}>
      <span className={styles.takeawayIcon} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v3M18.4 5.6l-2.1 2.1M21 12h-3M18.4 18.4l-2.1-2.1M12 18v3M7.8 16.3l-2.2 2.1M6 12H3M7.8 7.7 5.6 5.6" />
        </svg>
      </span>
      <span>{text}</span>
    </p>
  );
}

/* -----------------------------------------------------------------
   What's new — per-brand baseline changes
   ----------------------------------------------------------------- */

/**
 * The headline strip: each card is one detected change (pace spike,
 * unusual silence, first discount in months) measured against the
 * brand's own baseline. Rendered only when something actually changed;
 * a quiet week means the section simply isn't there.
 */
function WhatsNewSection({ changes }: { changes: BrandChange[] }) {
  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>This week</span>
      <h2 className={styles.sectionTitle}>What&apos;s new in this group</h2>
      <p className={styles.sectionSub}>
        Changes measured against each brand&apos;s own baseline — not the
        group&apos;s.
      </p>

      <div className={styles.changeGrid}>
        {changes.map((change) => (
          <article
            key={`${change.brandId}-${change.kind}`}
            className={styles.changeCard}
            style={
              {
                ["--accent" as string]: getCompareColor(change.brandIndex)
              } as CSSProperties
            }
          >
            <span className={styles.changeIcon} aria-hidden="true">
              <ChangeKindIcon kind={change.kind} />
            </span>
            <p className={styles.changeMessage}>
              <span className={styles.brandStripAccentDot} />
              {change.message}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ChangeKindIcon({ kind }: { kind: BrandChange["kind"] }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 16,
    height: 16,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
  if (kind === "pace_spike") {
    return (
      <svg {...common}>
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="15 7 21 7 21 13" />
      </svg>
    );
  }
  if (kind === "gone_quiet") {
    return (
      <svg {...common}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24H4a1 1 0 0 0-1 1v5.59c0 .53.21 1.04.59 1.41l9.58 9.59a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z" />
      <circle cx="7.5" cy="7.5" r="0.5" />
    </svg>
  );
}

/* -----------------------------------------------------------------
   Region note
   ----------------------------------------------------------------- */

/**
 * Send time and cadence only mean the same thing within one audience: a
 * 09:00 send in Copenhagen is not a 09:00 send in New York. So we surface the
 * region scope of the cohort right above the charts — a quiet confirmation when
 * every brand shares a market, and an explicit warning when they don't, because
 * a cross-region cohort makes the "When they send" comparison misleading.
 */
function RegionNote({ brands }: { brands: BrandPageData[] }) {
  const distinct = new Set<string>();
  for (const b of brands) {
    if (b.brand.primaryMarketCountry) distinct.add(b.brand.primaryMarketCountry);
  }
  const unknownCount = brands.filter((b) => !b.brand.primaryMarketCountry).length;
  const globalCount = brands.filter((b) => b.brand.isGlobal).length;
  const globalSuffix =
    globalCount > 0
      ? ` ${globalCount} of these ${globalCount === 1 ? "is a global brand" : "are global brands"} (grouped by HQ timezone).`
      : "";
  const codes = [...distinct].sort();

  // Nothing useful to say about a single brand, or when no region is known.
  if (brands.length < 2 || codes.length === 0) return null;

  const labelFor = (cc: string) => `${countryFlag(cc)} ${countryName(cc)}`;
  const mixed = codes.length > 1;

  const baseStyle: CSSProperties = {
    display: "flex",
    gap: "0.55rem",
    alignItems: "baseline",
    padding: "0.8rem 1.05rem",
    borderRadius: "16px",
    fontSize: "0.88rem",
    lineHeight: 1.45,
    margin: "0 0 1rem",
    border: mixed
      ? "1px solid rgba(252, 211, 77, 0.6)"
      : "1px solid rgba(255, 255, 255, 0.7)",
    background: mixed ? "rgba(255, 251, 235, 0.75)" : "rgba(255, 255, 255, 0.55)",
    backdropFilter: "blur(12px) saturate(160%)",
    WebkitBackdropFilter: "blur(12px) saturate(160%)",
    boxShadow:
      "0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 30px -18px rgba(15, 23, 42, 0.22)",
    color: mixed ? "#854d0e" : "#475569"
  };

  return (
    <div style={baseStyle} role="note">
      <span aria-hidden="true">{mixed ? "⚠️" : "📍"}</span>
      <span>
        {mixed ? (
          <>
            <strong>These brands span {codes.length} regions</strong> (
            {codes.map(labelFor).join(", ")}
            {unknownCount > 0 ? `, plus ${unknownCount} unknown` : ""}). Send time
            and cadence shift with the time zone, so the timing charts below
            aren&apos;t directly comparable across regions — narrow the cohort to
            one market for a like-for-like read.{globalSuffix}
          </>
        ) : (
          <>
            Comparing within <strong>{labelFor(codes[0])}</strong>
            {unknownCount > 0
              ? ` (${unknownCount} brand${
                  unknownCount === 1 ? "" : "s"
                } of unknown region included)`
              : ""}
            . Send times and cadence are like-for-like.{globalSuffix}
          </>
        )}
      </span>
    </div>
  );
}

/* -----------------------------------------------------------------
   Rhythm — send-rate league table
   ----------------------------------------------------------------- */

function RhythmLeague({
  brands,
  insight
}: {
  brands: BrandPageData[];
  insight: RhythmInsight;
}) {
  const maxRate = Math.max(0.01, ...insight.rows.map((r) => r.perWeek));
  const avgPct = Math.min(100, (insight.groupAvgPerWeek / maxRate) * 100);

  // One faint tick per whole email/week (every 2 when the leader is a
  // heavy sender) so bar length reads as a value, not just a ranking.
  const tickStep = maxRate > 8 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = tickStep; t < maxRate; t += tickStep) {
    ticks.push((t / maxRate) * 100);
  }

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Rhythm</span>
      <h2 className={styles.sectionTitle}>Who sends the most</h2>
      <p className={styles.sectionSub}>
        Average emails per week over the last 12 weeks (or since we
        started tracking the brand, if more recent), with the trend
        against the 12 weeks before that.
      </p>
      <Takeaway text={insight.takeaway} />

      <div className={styles.sectionBody}>
        <div className={styles.leagueList}>
          {insight.rows.map((row) => {
            const color = getCompareColor(row.index);
            const widthPct = Math.max(
              row.perWeek > 0 ? 2 : 0,
              (row.perWeek / maxRate) * 100
            );
            return (
              <RhythmLeagueRow
                key={row.id}
                row={row}
                color={color}
                widthPct={widthPct}
                ticks={ticks}
                avgPct={brands.length >= 2 ? avgPct : null}
              />
            );
          })}
        </div>
        {brands.length >= 2 ? (
          <p className={styles.leagueLegend}>
            Dashed line marks the group average (
            {fmtRate(insight.groupAvgPerWeek)} emails / week); ticks every{" "}
            {tickStep === 1 ? "1" : "2"} / week.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** A pace change must move at least this fraction of the previous rate
 *  (and at least half an email/week) before the trend marker shows. */
const TREND_MIN_RELATIVE = 0.25;
const TREND_MIN_ABSOLUTE = 0.5;

function RhythmLeagueRow({
  row,
  color,
  widthPct,
  ticks,
  avgPct
}: {
  row: RhythmInsight["rows"][number];
  color: string;
  widthPct: number;
  ticks: number[];
  avgPct: number | null;
}) {
  const accentStyle = { ["--accent" as string]: color } as CSSProperties;

  let trend: { direction: "up" | "down"; from: string } | null = null;
  if (row.prevPerWeek !== null) {
    const delta = row.perWeek - row.prevPerWeek;
    const relative =
      row.prevPerWeek > 0 ? Math.abs(delta) / row.prevPerWeek : 1;
    if (
      Math.abs(delta) >= TREND_MIN_ABSOLUTE &&
      relative >= TREND_MIN_RELATIVE
    ) {
      trend = {
        direction: delta > 0 ? "up" : "down",
        from: fmtRate(row.prevPerWeek)
      };
    }
  }

  return (
    <>
      <span className={styles.leagueName} style={accentStyle}>
        <span className={styles.brandStripAccentDot} />
        <span className={styles.leagueNameLabel}>{row.name}</span>
      </span>
      <span className={styles.leagueTrack} style={accentStyle}>
        {ticks.map((left) => (
          <span
            key={left}
            className={styles.leagueTick}
            style={{ left: `${left.toFixed(2)}%` }}
            aria-hidden="true"
          />
        ))}
        <span
          className={styles.leagueFill}
          style={{ width: `${widthPct.toFixed(2)}%` }}
        />
        {avgPct !== null ? (
          <span
            className={styles.leagueAvgMark}
            style={{ left: `${avgPct.toFixed(2)}%` }}
            aria-hidden="true"
          />
        ) : null}
      </span>
      <span className={styles.leagueValue}>
        <span className={styles.leagueValueRate}>
          {fmtRate(row.perWeek)}
        </span>
        / wk
        {trend ? (
          <span
            className={`${styles.leagueTrend} ${
              trend.direction === "up"
                ? styles.leagueTrendUp
                : styles.leagueTrendDown
            }`}
            title={`Previous 12 weeks: ${trend.from} emails / week`}
          >
            {trend.direction === "up" ? "↑" : "↓"} from {trend.from}
          </span>
        ) : null}
      </span>
    </>
  );
}

function fmtRate(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/* -----------------------------------------------------------------
   Send-time strips
   ----------------------------------------------------------------- */

function SendTimeStrips({
  brands,
  takeaway
}: {
  brands: BrandPageData[];
  takeaway: string | null;
}) {
  // Aggregate every brand's hourly counts into a single cohort-wide
  // row that we render on top of the per-brand strips. Lets the user
  // scan the cohort's centre of mass in one glance before drilling
  // into individual rows.
  const aggregated = new Array(24).fill(0);
  for (const brand of brands) {
    for (let hour = 0; hour < 24; hour++) {
      aggregated[hour] += brand.cadence.hourly[hour] ?? 0;
    }
  }
  const aggregatedMax = Math.max(0, ...aggregated);

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Rhythm</span>
      <h2 className={styles.sectionTitle}>When they send</h2>
      <p className={styles.sectionSub}>
        24-hour heatmap, one row per brand plus an aggregated cohort row
        on top. Each cell is normalised against the busiest hour in its
        row so light senders aren't drowned by louder peers.
      </p>
      <Takeaway text={takeaway} />

      <div className={styles.sectionBody}>
        <div className={styles.clockGrid}>
          <HeatmapRow
            name="All brands"
            color={COMPARE_AGGREGATE_COLOR}
            counts={aggregated}
            max={aggregatedMax}
            isAggregate
          />
          {brands.map((b, idx) => {
            const max = Math.max(0, ...b.cadence.hourly);
            return (
              <HeatmapRow
                key={b.brand.id}
                name={b.brand.name}
                color={getCompareColor(idx)}
                counts={b.cadence.hourly}
                max={max}
              />
            );
          })}
        </div>

        <div className={styles.clockAxis}>
          <span>12 am</span>
          <span>6 am</span>
          <span>12 pm</span>
          <span>6 pm</span>
          <span>12 am</span>
        </div>
      </div>
    </section>
  );
}

function HeatmapRow({
  name,
  color,
  counts,
  max,
  isAggregate
}: {
  name: string;
  color: string;
  counts: number[];
  max: number;
  isAggregate?: boolean;
}) {
  const rowClassName = `${styles.clockRow}${
    isAggregate ? ` ${v2.heatmapRowAggregate}` : ""
  }`;
  return (
    <div className={rowClassName}>
      <span
        className={styles.clockRowName}
        style={{ ["--accent" as string]: color } as CSSProperties}
      >
        <span className={styles.clockRowDot} />
        <span className={styles.clockRowLabel}>{name}</span>
      </span>
      <div className={styles.clockStrip}>
        {counts.map((count, hour) => {
          const ratio = max > 0 ? count / max : 0;
          // Even empty hours show a faint baseline so the strip reads
          // as 24 distinct cells; actual data is encoded by per-cell
          // opacity so the colour stays brand-true.
          const opacity = ratio === 0 ? 0.08 : 0.22 + ratio * 0.78;
          return (
            <span
              key={hour}
              className={styles.clockCell}
              style={{
                background: color,
                opacity
              }}
              title={`${name} · ${formatHourOfDay(hour, {
                case: "lower",
                withZone: false
              })}: ${count} email${count === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
   Quiet zones
   ----------------------------------------------------------------- */

/**
 * Day × daypart grid of the whole group's recent sends. The point is
 * the gaps: a dashed cell is a slot no brand in the comparison is
 * using — free attention for whoever shows up. Night (23–06) is
 * excluded; an empty night is not a finding.
 */
function QuietZonesSection({ insight }: { insight: QuietZonesInsight }) {
  const max = Math.max(1, ...insight.grid.flat());

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Rhythm</span>
      <h2 className={styles.sectionTitle}>Quiet zones</h2>
      <p className={styles.sectionSub}>
        Where this group's recent sends land across the week (Copenhagen
        time). Dashed cells are slots nobody here is using.
      </p>
      <Takeaway text={insight.takeaway} />

      <div className={styles.sectionBody}>
        <div className={styles.qzGrid}>
          <span aria-hidden="true" />
          {QUIET_ZONE_DAYS.map((day) => (
            <span key={day} className={styles.qzHead}>
              {day.slice(0, 3)}
            </span>
          ))}
          {QUIET_ZONE_DAYPARTS.map((daypart, dpIdx) => (
            <Fragment key={daypart.id}>
              <span className={styles.qzRowLabel}>{daypart.label}</span>
              {QUIET_ZONE_DAYS.map((day, dayIdx) => {
                const count = insight.grid[dpIdx][dayIdx];
                if (count === 0) {
                  return (
                    <span
                      key={day}
                      className={`${styles.qzCell} ${styles.qzCellEmpty}`}
                      title={`${day} ${daypart.label.toLowerCase()}: open slot — no sends from this group`}
                    />
                  );
                }
                return (
                  <span
                    key={day}
                    className={styles.qzCell}
                    style={{ opacity: 0.18 + (count / max) * 0.82 }}
                    title={`${day} ${daypart.label.toLowerCase()}: ${count} send${count === 1 ? "" : "s"} across the group`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
        <p className={styles.qzLegend}>
          Based on {insight.totalSends.toLocaleString("en-US")} recent sends
          across the group. Darker = busier.
        </p>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
   Promo blocks
   ----------------------------------------------------------------- */

function PromoBlocks({
  brands,
  takeaway,
  trend
}: {
  brands: BrandPageData[];
  takeaway: string | null;
  trend: DiscountTrendInsight;
}) {
  // Shared scale so a 40%-off bar is the same height in every block.
  const trendMax = Math.max(
    1,
    ...trend.rows.flatMap((row) =>
      row.points.filter((p): p is number => p !== null)
    )
  );
  const showTrend = trend.months.length >= 2;

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Offers</span>
      <h2 className={styles.sectionTitle}>Discount aggressiveness</h2>
      <p className={styles.sectionSub}>
        How often each brand drops a promo and the typical depth when
        they do.
      </p>
      <Takeaway text={takeaway} />

      <div className={styles.promoGrid}>
        {brands.map((b, idx) => {
          const color = getCompareColor(idx);
          const accentStyle = {
            ["--accent" as string]: color,
            ["--accent-soft" as string]: hexToSoft(color, 0.12)
          } as CSSProperties;
          return (
            <article
              key={b.brand.id}
              className={styles.promoBlock}
              style={accentStyle}
            >
              <header className={styles.promoBlockHead}>
                <span className={styles.promoBlockName}>
                  <span className={styles.brandStripAccentDot} />
                  {b.brand.name}
                </span>
                <span className={styles.promoBlockShare}>
                  {Math.round(b.promo.discountShare * 100)}%
                  <span className={styles.promoBlockShareLabel}>
                    promo share
                  </span>
                </span>
              </header>
              <div className={styles.promoBlockStrip}>
                <div className={styles.promoStat}>
                  <span className={styles.promoStatLabel}>Avg discount</span>
                  <span className={styles.promoStatValue}>
                    {b.promo.avgDiscount !== null
                      ? `${Math.round(b.promo.avgDiscount)}%`
                      : "—"}
                  </span>
                </div>
                <div className={styles.promoStat}>
                  <span className={styles.promoStatLabel}>Highest seen</span>
                  <span className={styles.promoStatValue}>
                    {b.promo.maxDiscount !== null
                      ? `${Math.round(b.promo.maxDiscount)}%`
                      : "—"}
                  </span>
                </div>
                <div className={styles.promoStat}>
                  <span className={styles.promoStatLabel}>Discount emails</span>
                  <span className={styles.promoStatValue}>
                    {b.promo.discountEmails}
                  </span>
                </div>
              </div>
              {showTrend ? (
                <PromoTrendStrip
                  row={trend.rows[idx]}
                  months={trend.months}
                  max={trendMax}
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Mini month-by-month average-discount bars inside a promo block. All
 * blocks share the same month axis and scale so depth is comparable
 * across brands at a glance.
 */
function PromoTrendStrip({
  row,
  months,
  max
}: {
  row: DiscountTrendInsight["rows"][number] | undefined;
  months: string[];
  max: number;
}) {
  if (!row || row.points.every((point) => point === null)) return null;

  return (
    <div className={styles.promoTrend}>
      <div className={styles.promoTrendBars}>
        {row.points.map((point, i) => {
          if (point === null) {
            return (
              <span
                key={months[i]}
                className={`${styles.promoTrendBar} ${styles.promoTrendBarEmpty}`}
                title={`${formatMonthKey(months[i])}: no discount emails`}
              />
            );
          }
          return (
            <span
              key={months[i]}
              className={styles.promoTrendBar}
              style={{ height: `${Math.max(12, (point / max) * 100).toFixed(2)}%` }}
              title={`${formatMonthKey(months[i])}: avg ${Math.round(point)}% off`}
            />
          );
        })}
      </div>
      <div className={styles.promoTrendLabels}>
        <span>{formatMonthKey(months[0])}</span>
        <span>Avg % by month</span>
        <span>{formatMonthKey(months[months.length - 1])}</span>
      </div>
    </div>
  );
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

/** "2026-05" → "May". Years are dropped — the six-month axis never
 *  spans far enough for the short label to be ambiguous. */
function formatMonthKey(key: string): string {
  const month = Number.parseInt(key.slice(5, 7), 10);
  return MONTH_SHORT[month - 1] ?? key;
}

/* -----------------------------------------------------------------
   Occasion matrix
   ----------------------------------------------------------------- */

/**
 * Seasonal event × brand grid. Each cell shows the brand's typical lead
 * time (days between first mention and the event day) for events where
 * at least one brand in the group shows a real run-up. Cells with a
 * single stray mention render muted — one subject line is not a
 * campaign — and the whole section disappears when no event clears the
 * bar, rather than rendering an empty grid.
 */
function OccasionMatrix({
  brands,
  insight
}: {
  brands: BrandPageData[];
  insight: OccasionInsight;
}) {
  if (insight.rows.length === 0) return null;

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Occasions</span>
      <h2 className={styles.sectionTitle}>Seasonal moments they activate</h2>
      <p className={styles.sectionSub}>
        Lead time from each brand's first mention (in subject lines and
        preheaders) to the day itself. Longer lead = earlier run-up.
      </p>
      <Takeaway text={insight.takeaway} />

      <div className={`${styles.sectionBody} ${styles.occTableWrap}`}>
        <table className={styles.occTable}>
          <thead>
            <tr>
              <th scope="col">
                <span
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    overflow: "hidden",
                    clip: "rect(0 0 0 0)"
                  }}
                >
                  Event
                </span>
              </th>
              {brands.map((b, idx) => (
                <th key={b.brand.id} scope="col">
                  <span
                    className={styles.occBrandHead}
                    style={
                      {
                        ["--accent" as string]: getCompareColor(idx)
                      } as CSSProperties
                    }
                  >
                    <span className={styles.brandStripAccentDot} />
                    {b.brand.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {insight.rows.map((row) => (
              <tr key={row.eventId}>
                <th scope="row">
                  <span className={styles.occEvent}>
                    <span aria-hidden="true">{row.emoji}</span>
                    {row.label}
                  </span>
                </th>
                {row.cells.map((cell, idx) => {
                  const brandName = brands[idx]?.brand.name ?? "";
                  if (cell.count === 0 || cell.leadDays === null) {
                    return (
                      <td
                        key={brands[idx]?.brand.id ?? idx}
                        className={styles.occNone}
                        title={`${brandName}: no ${row.label} emails found`}
                      >
                        —
                      </td>
                    );
                  }
                  const faint = cell.count < 2;
                  return (
                    <td
                      key={brands[idx]?.brand.id ?? idx}
                      className={
                        faint ? styles.occLeadFaint : styles.occLead
                      }
                      title={`${brandName}: ${cell.count} ${row.label} email${
                        cell.count === 1 ? "" : "s"
                      }, first mention ~${cell.leadDays} day${
                        cell.leadDays === 1 ? "" : "s"
                      } ahead`}
                    >
                      {cell.leadDays}d
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
   Creative fingerprint (palette, fonts, latest subject)
   ----------------------------------------------------------------- */

/**
 * The brand's newest sampled email as a full ExploreEmailCard so the
 * "Latest subject" row can open it in the shared email modal. The
 * sample is newest-first; skip rows without a subject.
 */
function latestEmailCard(b: BrandPageData): ExploreEmailCard | null {
  const row = b.seasonalSample.find(
    (email) => (email.subject ?? "").trim().length > 0
  );
  if (!row) return null;
  return {
    id: row.id,
    subject: row.subject,
    preheader: row.preheader,
    companyId: b.brand.id,
    companyName: b.brand.name,
    companyDomain: b.brand.domain,
    companyMarkets: b.brand.markets,
    companyLogoUrl: b.brand.logoUrl,
    receivedAt: row.receivedAt,
    category: row.category,
    hasGif: row.hasGif,
    hasDarkMode: row.hasDarkMode,
    discountPercent: row.discountPercent,
    promoCode: row.promoCode
  };
}

/**
 * Pure identity cards — palette, fonts, and the latest subject line
 * (clickable, opens the email) — several per row so a large comparison
 * stays skimmable. The comparative copy metrics (subject length,
 * emoji, urgency, resends) live as KPI tiles with dot-strip
 * drill-downs, not here.
 */
function FingerprintGrid({
  brands,
  takeaway
}: {
  brands: BrandPageData[];
  takeaway: string | null;
}) {
  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Voice &amp; creative</span>
      <h2 className={styles.sectionTitle}>Creative fingerprint</h2>
      <p className={styles.sectionSub}>
        Each brand's look at a glance: palette, typography and the CTAs
        they reach for. Copy metrics live in the KPI matrix above.
      </p>
      <Takeaway text={takeaway} />

      <div className={styles.dnaGrid}>
        {brands.map((b, idx) => {
          const color = getCompareColor(idx);
          const accentStyle = {
            ["--accent" as string]: color
          } as CSSProperties;
          const latest = latestEmailCard(b);
          return (
            <article
              key={b.brand.id}
              className={styles.dnaCard}
              style={accentStyle}
            >
              <div className={styles.dnaCardBody}>
                <div className={styles.dnaCardHead}>
                  <span className={styles.brandStripAccentDot} />
                  <span className={styles.dnaCardName}>{b.brand.name}</span>
                </div>

                {b.design.palette.length > 0 ? (
                  <div className={styles.dnaPalette}>
                    {b.design.palette.slice(0, 8).map((entry) => (
                      <span
                        key={entry.hex}
                        className={styles.dnaSwatch}
                        style={{ background: entry.hex }}
                        data-hex={entry.hex.toLowerCase()}
                      />
                    ))}
                  </div>
                ) : null}

                {b.design.fonts.length > 0 ? (
                  <div className={styles.fpRow}>
                    <span className={styles.fpRowLabel}>Fonts</span>
                    {/* Name chips only, no font-family preview — we
                        extract the name from the email CSS but the
                        brand's licensed webfont isn't loaded here, so
                        a "preview" would silently render the
                        fallback. */}
                    <span className={styles.fpRowPills}>
                      {b.design.fonts.slice(0, 3).map((font) => (
                        <span key={font.family} className={styles.fpFontPill}>
                          {font.family}
                        </span>
                      ))}
                    </span>
                  </div>
                ) : null}

                {latest ? (
                  <div className={styles.fpLatest}>
                    <span className={styles.fpRowLabel}>Latest</span>
                    <FingerprintSubject email={latest} />
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
   Content mix
   ----------------------------------------------------------------- */

function ContentMixSection({ insight }: { insight: ContentMixInsight }) {
  const hasAnyData = insight.rows.some((row) => row.segments.length > 0);
  if (!hasAnyData) return null;

  // Build the legend from the union of segments actually shown, in
  // first-appearance order so it roughly matches the bars.
  const legend: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const row of insight.rows) {
    for (const segment of row.segments) {
      if (!seen.has(segment.id)) {
        seen.add(segment.id);
        legend.push({ id: segment.id, label: segment.label });
      }
    }
  }

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Content</span>
      <h2 className={styles.sectionTitle}>What they talk about</h2>
      <p className={styles.sectionSub}>
        Each brand's campaign mix by category, as a share of everything
        we've captured from them.
      </p>
      <Takeaway text={insight.takeaway} />

      <div className={styles.sectionBody}>
        <div className={styles.mixList}>
          {insight.rows.map((row) => (
            <MixRow key={row.id} row={row} />
          ))}
        </div>
        <div className={styles.mixLegend}>
          {legend.map((entry) => (
            <span key={entry.id} className={styles.mixLegendItem}>
              <span
                className={styles.mixLegendSwatch}
                style={{ background: colorForCategory(entry.id) }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function MixRow({
  row
}: {
  row: ContentMixInsight["rows"][number];
}) {
  const accentStyle = {
    ["--accent" as string]: getCompareColor(row.index)
  } as CSSProperties;
  return (
    <>
      <span className={styles.leagueName} style={accentStyle}>
        <span className={styles.brandStripAccentDot} />
        <span className={styles.leagueNameLabel}>{row.name}</span>
      </span>
      <span className={styles.mixBar}>
        {row.segments.map((segment) => (
          <span
            key={segment.id}
            className={styles.mixSeg}
            style={{
              width: `${segment.share * 100}%`,
              background: colorForCategory(segment.id)
            }}
            title={`${row.name}: ${segment.label} ${Math.round(
              segment.share * 100
            )}%`}
          />
        ))}
      </span>
    </>
  );
}

/* -----------------------------------------------------------------
   Recent campaigns (merged feed)
   ----------------------------------------------------------------- */

function RecentCampaigns({ brands }: { brands: BrandPageData[] }) {
  // Merge each brand's recent campaigns into a single chronological
  // feed. Caps at 24 entries so the grid stays a single screen and
  // we don't pull a wall of identical-looking transactionals.
  const merged: ExploreEmailCard[] = [];
  for (const b of brands) {
    merged.push(...b.recentEmails);
  }
  merged.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const trimmed = merged.slice(0, 24);

  return (
    <section className={styles.section}>
      <div className={styles.recentHead}>
        <div>
          <span className={styles.sectionEyebrow}>Recent</span>
          <h2 className={styles.sectionTitle}>Latest campaigns</h2>
          <p className={styles.sectionSub}>
            The newest captured emails across every brand in this comparison.
          </p>
        </div>
      </div>

      {trimmed.length === 0 ? (
        <p className={styles.empty}>No campaigns captured yet.</p>
      ) : (
        <div className={styles.sectionBody}>
          <BrandRecentEmails emails={trimmed} />
        </div>
      )}
    </section>
  );
}

/* -----------------------------------------------------------------
   Formatting helpers
   ----------------------------------------------------------------- */

/**
 * Builds a low-alpha companion colour from a hex string. Used so the
 * promo cards still get a soft tinted background that matches the
 * categorical palette instead of the brand's natural accent.
 */
function hexToSoft(hex: string, alpha: number): string {
  const match = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return `rgba(15, 23, 42, ${alpha})`;
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
