import type { CSSProperties } from "react";
import type { BrandPageData } from "@/lib/brand-db";
import type { ExploreEmailCard } from "@/lib/explore-db";
import { formatHourOfDay } from "@/lib/datetime";
import BrandRecentEmails from "@/components/brand/BrandRecentEmails";
import KpiTiles from "./KpiTiles";
import CadenceStack from "./CadenceStack";
import InboxForecast from "./InboxForecast";
import { COMPARE_AGGREGATE_COLOR, getCompareColor } from "./compareColors";
import styles from "./compare.module.css";
import v2 from "./compare-v2.module.css";

type Props = {
  brands: BrandPageData[];
  /** Optional list of brand ids the caller requested but couldn't load. */
  missingIds?: string[];
};

/**
 * Multi-brand comparison dashboard.
 *
 * Receives N `BrandPageData` payloads (one per selected brand, produced
 * by `getCompetitorComparison`) and renders the analytics that matter
 * most when sizing up a competitor cohort:
 *   1. KPI tiles  — aggregate snapshot; click for per-brand drill-down
 *   2. Cadence    — stacked aggregate bar chart with lookback selector
 *   3. Forecast   — 7 / 14-day prediction of cohort inbox crowding
 *   4. Send-time  — 24h heatmap with an aggregated row + per-brand rows
 *   5. Promo      — per-brand promo aggressiveness blocks
 *   6. Design DNA — per-brand palettes / fonts / flags
 *   7. Subjects   — per-brand subject samples
 *   8. CTA voice  — per-brand mini tag-cloud
 *   9. Recent     — merged chronological feed
 *
 * The KPI tile and cadence sections are client islands because they
 * own interactive UI (modal + lookback selector + hover tooltip);
 * everything else stays server-rendered so the page hits the wire
 * fully hydrated on first paint.
 */
export default function CompareDashboard({ brands, missingIds }: Props) {
  if (brands.length === 0) {
    return (
      <section className={styles.section}>
        <p className={styles.empty}>
          Pick at least one brand from the picker above to see a comparison.
        </p>
      </section>
    );
  }

  return (
    <>
      {missingIds && missingIds.length > 0 ? (
        <p className={styles.missingNote}>
          {missingIds.length} brand{missingIds.length === 1 ? "" : "s"} couldn't
          be loaded (possibly removed) and were skipped.
        </p>
      ) : null}

      <KpiTiles brands={brands} />
      <CadenceStack brands={brands} />
      <InboxForecast brands={brands} />
      <SendTimeStrips brands={brands} />
      <PromoBlocks brands={brands} />
      <DesignDna brands={brands} />
      <SubjectGrid brands={brands} />
      <CtaGrid brands={brands} />
      <RecentCampaigns brands={brands} />
    </>
  );
}

/* -----------------------------------------------------------------
   Send-time strips
   ----------------------------------------------------------------- */

function SendTimeStrips({ brands }: { brands: BrandPageData[] }) {
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
      <span className={styles.sectionEyebrow}>Timing</span>
      <h2 className={styles.sectionTitle}>When they send</h2>
      <p className={styles.sectionSub}>
        24-hour heatmap, one row per brand plus an aggregated cohort row
        on top. Each cell is normalised against the busiest hour in its
        row so light senders aren't drowned by louder peers.
      </p>

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
   Promo blocks
   ----------------------------------------------------------------- */

function PromoBlocks({ brands }: { brands: BrandPageData[] }) {
  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Offers</span>
      <h2 className={styles.sectionTitle}>Discount aggressiveness</h2>
      <p className={styles.sectionSub}>
        How often each brand drops a promo and the typical depth when
        they do.
      </p>

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
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
   Design DNA
   ----------------------------------------------------------------- */

function DesignDna({ brands }: { brands: BrandPageData[] }) {
  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Brand</span>
      <h2 className={styles.sectionTitle}>Design DNA</h2>
      <p className={styles.sectionSub}>
        Side-by-side palettes and typography to reveal overlaps or
        opportunities to differentiate.
      </p>

      <div className={styles.dnaGrid}>
        {brands.map((b, idx) => {
          const accentStyle = {
            ["--accent" as string]: getCompareColor(idx)
          } as CSSProperties;
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
                        title={entry.hex}
                      />
                    ))}
                  </div>
                ) : (
                  <span className={styles.empty}>No palette captured.</span>
                )}

                {b.design.fonts.length > 0 ? (
                  <div className={styles.dnaFontRow}>
                    {b.design.fonts.map((font) => (
                      <span
                        key={font.family}
                        className={styles.dnaFontPill}
                        style={{ fontFamily: `${font.family}, ui-sans-serif` }}
                      >
                        {font.family}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={styles.dnaFlags}>
                <span className={styles.dnaFlag}>
                  <span
                    className={`${styles.dnaFlagDot}${
                      b.design.gifShare > 0 ? ` ${styles.dnaFlagDot_on}` : ""
                    }`}
                  />
                  GIFs · {Math.round(b.design.gifShare * 100)}%
                </span>
                <span className={styles.dnaFlag}>
                  <span
                    className={`${styles.dnaFlagDot}${
                      b.design.darkModeShare > 0
                        ? ` ${styles.dnaFlagDot_on}`
                        : ""
                    }`}
                  />
                  Dark mode · {Math.round(b.design.darkModeShare * 100)}%
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
   Subject lines
   ----------------------------------------------------------------- */

function SubjectGrid({ brands }: { brands: BrandPageData[] }) {
  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Copy</span>
      <h2 className={styles.sectionTitle}>Recent subject lines</h2>
      <p className={styles.sectionSub}>
        A few of the latest unique subjects from each brand, side-by-side.
      </p>

      <div className={styles.subjectGrid}>
        {brands.map((b, idx) => (
          <article key={b.brand.id} className={styles.subjectCard}>
            <header className={styles.subjectCardHead}>
              <span
                className={styles.brandStripAccentDot}
                style={
                  {
                    ["--accent" as string]: getCompareColor(idx)
                  } as CSSProperties
                }
              />
              <span>{b.brand.name}</span>
            </header>
            <span className={styles.subjectCardMeta}>
              {b.subjects.avgLength !== null
                ? `Avg ${Math.round(b.subjects.avgLength)} chars`
                : "No samples yet"}
            </span>
            {b.subjects.samples.length === 0 ? (
              <span className={styles.empty}>No subjects captured yet.</span>
            ) : (
              <div className={styles.subjectList}>
                {b.subjects.samples.slice(0, 4).map((subject) => (
                  <span key={subject} className={styles.subjectItem}>
                    {subject}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
   CTA voice
   ----------------------------------------------------------------- */

function CtaGrid({ brands }: { brands: BrandPageData[] }) {
  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Voice</span>
      <h2 className={styles.sectionTitle}>Top calls to action</h2>
      <p className={styles.sectionSub}>
        The button labels each brand reaches for most. Useful for spotting
        differences in tone (urgency vs editorial vs minimalist).
      </p>

      <div className={styles.ctaGrid}>
        {brands.map((b, idx) => {
          const color = getCompareColor(idx);
          const accentStyle = {
            ["--accent" as string]: color,
            ["--accent-soft" as string]: hexToSoft(color, 0.12)
          } as CSSProperties;
          const tags = b.ctas.slice(0, 12);
          const max = tags[0]?.count ?? 1;
          return (
            <article
              key={b.brand.id}
              className={styles.ctaCard}
              style={accentStyle}
            >
              <header className={styles.ctaCardHead}>
                <span className={styles.brandStripAccentDot} />
                <span>{b.brand.name}</span>
              </header>
              <span className={styles.ctaCardMeta}>
                {tags.length === 0 ? "No CTAs captured" : `${tags.length} top labels`}
              </span>
              {tags.length === 0 ? (
                <span className={styles.empty}>—</span>
              ) : (
                <div className={styles.ctaCloud}>
                  {tags.map((entry) => {
                    // Scale font size by frequency. Range: 0.75 → 1.15 rem;
                    // matches the per-brand cloud on the single-brand page.
                    const ratio = max > 0 ? entry.count / max : 0;
                    const fontSize = (0.75 + ratio * 0.4).toFixed(2);
                    return (
                      <span
                        key={entry.text}
                        className={styles.ctaTag}
                        style={{ fontSize: `${fontSize}rem` }}
                        title={`${entry.count} use${entry.count === 1 ? "" : "s"}`}
                      >
                        {entry.text}
                      </span>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
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
 * promo / CTA cards still get a soft tinted background that matches
 * the categorical palette instead of the brand's natural accent.
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
