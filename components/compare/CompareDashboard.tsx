import type { CSSProperties } from "react";
import type { BrandPageData } from "@/lib/brand-db";
import { EMAIL_CATEGORY_LABELS, type EmailCategory } from "@/lib/admin-types";
import type { ExploreEmailCard } from "@/lib/explore-db";
import { formatHourOfDay, getActiveTimeZone } from "@/lib/datetime";
import BrandRecentEmails from "@/components/brand/BrandRecentEmails";
import styles from "./compare.module.css";

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
 *   1. Brand strip — color-coded chips for each brand
 *   2. KPI matrix — captured emails, cadence, promo share, ESP, …
 *      with a subtle "leader" highlight per row
 *   3. Cadence overlay — multi-line weekly send chart
 *   4. Send-time strips — one 24-hour heatmap row per brand
 *   5. Category mix — grouped bars by category
 *   6. Promo aggressiveness — discount share + codes per brand
 *   7. Design DNA — palette + fonts + flags per brand
 *   8. Subject lines — avg length + samples per brand
 *   9. CTA voice — per-brand mini tag-cloud
 *  10. Recent campaigns — merged chronological feed
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

      <KpiMatrix brands={brands} />
      <CadenceOverlay brands={brands} />
      <SendTimeStrips brands={brands} />
      <CategoryMix brands={brands} />
      <PromoBlocks brands={brands} />
      <DesignDna brands={brands} />
      <SubjectGrid brands={brands} />
      <CtaGrid brands={brands} />
      <RecentCampaigns brands={brands} />
    </>
  );
}

/* -----------------------------------------------------------------
   KPI matrix
   ----------------------------------------------------------------- */

type KpiRow = {
  label: string;
  /** Per-brand display value + raw numeric (or null) for leader detection. */
  cells: { value: string; numeric: number | null; hint?: string }[];
  /** "high" → bigger numeric is leader; "low" → smaller numeric is leader. */
  leaderDirection?: "high" | "low";
};

function KpiMatrix({ brands }: { brands: BrandPageData[] }) {
  const rows: KpiRow[] = [
    {
      label: "Captured emails",
      leaderDirection: "high",
      cells: brands.map((b) => ({
        value: formatNumber(b.totals.emailCount),
        numeric: b.totals.emailCount,
        hint: b.totals.lastEmailAt
          ? `Last ${formatShortDate(b.totals.lastEmailAt)}`
          : "No sends yet"
      }))
    },
    {
      label: "Avg cadence",
      leaderDirection: "low",
      cells: brands.map((b) => ({
        value:
          b.cadence.avgDaysBetween !== null
            ? formatCadenceDays(b.cadence.avgDaysBetween)
            : "—",
        numeric: b.cadence.avgDaysBetween,
        hint: b.cadence.typicalDay
          ? `Mostly ${b.cadence.typicalDay.label}s`
          : "—"
      }))
    },
    {
      label: "Promo share",
      leaderDirection: "high",
      cells: brands.map((b) => ({
        value: `${Math.round(b.promo.discountShare * 100)}%`,
        numeric: b.promo.discountShare,
        hint:
          b.promo.avgDiscount !== null
            ? `Avg ${Math.round(b.promo.avgDiscount)}% off`
            : "No discounts"
      }))
    },
    {
      label: "Primary ESP",
      cells: brands.map((b) => ({
        value: b.esp.primary ? b.esp.primary.label : "—",
        numeric: null,
        hint: b.esp.primary
          ? `${Math.round(b.esp.primary.share * 100)}% of sends`
          : "Not detected"
      }))
    },
    {
      label: "Avg subject length",
      leaderDirection: "low",
      cells: brands.map((b) => ({
        value:
          b.subjects.avgLength !== null
            ? `${Math.round(b.subjects.avgLength)} chars`
            : "—",
        numeric: b.subjects.avgLength,
        hint: b.subjects.samples.length > 0 ? "characters" : "—"
      }))
    },
    {
      label: "GIF / dark mode share",
      cells: brands.map((b) => ({
        value: `${Math.round(b.design.gifShare * 100)}% / ${Math.round(
          b.design.darkModeShare * 100
        )}%`,
        numeric: null,
        hint: "GIFs / dark-mode aware"
      }))
    }
  ];

  // We only highlight a leader when (a) we know the direction and (b) it's
  // unambiguous (i.e. a single brand maxes/mins the value). Tied rows fall
  // back to no highlight to avoid implying a winner that doesn't exist.
  const leaderIndex = rows.map((row) => {
    if (!row.leaderDirection) return -1;
    const numerics = row.cells.map((c) => c.numeric);
    if (numerics.every((n) => n === null)) return -1;
    let bestIdx = -1;
    let bestValue: number | null = null;
    let tied = false;
    for (let i = 0; i < numerics.length; i++) {
      const n = numerics[i];
      if (n === null) continue;
      if (bestValue === null) {
        bestValue = n;
        bestIdx = i;
        continue;
      }
      if (row.leaderDirection === "high" && n > bestValue) {
        bestValue = n;
        bestIdx = i;
        tied = false;
      } else if (row.leaderDirection === "low" && n < bestValue) {
        bestValue = n;
        bestIdx = i;
        tied = false;
      } else if (n === bestValue) {
        tied = true;
      }
    }
    return tied ? -1 : bestIdx;
  });

  const colTemplate = `12rem repeat(${brands.length}, minmax(0, 1fr))`;

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Snapshot</span>
      <h2 className={styles.sectionTitle}>KPI matrix</h2>
      <p className={styles.sectionSub}>
        Quick at-a-glance comparison. The accent pill marks the leader for
        each row (where higher / lower is clearly better).
      </p>

      <div className={styles.sectionBody}>
        <div
          className={styles.kpiMatrixHead}
          style={{ gridTemplateColumns: colTemplate }}
        >
          <span className={styles.kpiMatrixHeadLabel}>Metric</span>
          {brands.map((b) => (
            <span key={b.brand.id} className={styles.kpiMatrixHeadBrand}>
              <span
                className={styles.brandStripAccentDot}
                style={{ ["--accent" as string]: b.brand.accent.base } as CSSProperties}
              />
              {b.brand.name}
            </span>
          ))}
        </div>

        {rows.map((row, rowIdx) => (
          <div
            key={row.label}
            className={styles.kpiMatrixRow}
            style={{ gridTemplateColumns: colTemplate }}
          >
            <span className={styles.kpiMatrixLabel}>{row.label}</span>
            {row.cells.map((cell, cellIdx) => {
              const isLeader = leaderIndex[rowIdx] === cellIdx;
              const accentStyle = {
                ["--accent" as string]: brands[cellIdx].brand.accent.base,
                ["--accent-soft" as string]: brands[cellIdx].brand.accent.soft
              } as CSSProperties;
              return (
                <span
                  key={brands[cellIdx].brand.id}
                  className={styles.kpiCell}
                  style={accentStyle}
                >
                  <span
                    className={
                      isLeader
                        ? styles.kpiCellLeader
                        : cell.value === "—"
                          ? styles.kpiCellMuted
                          : undefined
                    }
                  >
                    {cell.value}
                  </span>
                  {cell.hint ? (
                    <span className={styles.kpiCellHint}>{cell.hint}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
   Cadence overlay
   ----------------------------------------------------------------- */

function CadenceOverlay({ brands }: { brands: BrandPageData[] }) {
  // All brands share the same weekly window length (configured in
  // brand-db.ts). Defensive fallbacks keep this safe even if a brand
  // has no captured emails — that brand just renders as a flat zero
  // line in the chart.
  const weekCount =
    brands.find((b) => b.cadence.weekly.length > 0)?.cadence.weekly.length ??
    brands[0]?.cadence.weekly.length ??
    0;

  if (weekCount === 0) {
    return (
      <section className={styles.section}>
        <span className={styles.sectionEyebrow}>Cadence</span>
        <h2 className={styles.sectionTitle}>Send frequency over time</h2>
        <p className={styles.sectionSub}>
          No send activity captured for any selected brand yet.
        </p>
      </section>
    );
  }

  const max = Math.max(
    1,
    ...brands.flatMap((b) => b.cadence.weekly.map((w) => w.count))
  );

  const width = 900;
  const height = 240;
  const padding = { top: 18, right: 18, bottom: 24, left: 28 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // Compute X positions at the center of each week's slot so dots and
  // lines align with the implicit "bar" representing the week.
  const stepX = innerWidth / Math.max(1, weekCount - 1);

  const firstWeek = brands.find((b) => b.cadence.weekly.length > 0)
    ?.cadence.weekly[0]?.weekStart;

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Cadence</span>
      <h2 className={styles.sectionTitle}>Send frequency over time</h2>
      <p className={styles.sectionSub}>
        Emails per week for the last {weekCount} weeks. Each line is one
        brand, colored by its accent.
      </p>

      <div className={styles.sectionBody}>
        <div className={styles.cadenceChartWrap}>
          <svg
            className={styles.cadenceSvg}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Weekly email send frequency by brand"
          >
            {/* y-axis gridlines at 25/50/75/100% of max — labels skipped
                to keep the chart visually quiet; the legend below carries
                the precise numbers the user actually cares about. */}
            {[0.25, 0.5, 0.75, 1].map((tick) => {
              const y = padding.top + innerHeight - tick * innerHeight;
              return (
                <line
                  key={tick}
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                />
              );
            })}

            {brands.map((brand) => {
              if (brand.cadence.weekly.length === 0) return null;
              const points = brand.cadence.weekly.map((week, idx) => {
                const x = padding.left + stepX * idx;
                const ratio = week.count / max;
                const y = padding.top + innerHeight - ratio * innerHeight;
                return { x, y, count: week.count };
              });

              const linePath = points
                .map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
                .join(" ");

              const areaPath =
                points.length >= 2
                  ? `${linePath} L${points[points.length - 1].x.toFixed(
                      2
                    )},${padding.top + innerHeight} L${points[0].x.toFixed(2)},${
                      padding.top + innerHeight
                    } Z`
                  : null;

              const accent = brand.brand.accent.base;

              return (
                <g key={brand.brand.id}>
                  {areaPath ? (
                    <path
                      d={areaPath}
                      fill={accent}
                      fillOpacity={0.08}
                      stroke="none"
                    />
                  ) : null}
                  <path
                    d={linePath}
                    fill="none"
                    stroke={accent}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {points.map((p, idx) => (
                    <circle
                      key={`${brand.brand.id}-${idx}`}
                      cx={p.x}
                      cy={p.y}
                      r={p.count > 0 ? 2 : 1.5}
                      fill={accent}
                    >
                      <title>
                        {brand.brand.name}: {p.count} email
                        {p.count === 1 ? "" : "s"}
                      </title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>

        <div className={styles.cadenceAxis}>
          <span>{firstWeek ? formatShortDate(firstWeek) : ""}</span>
          <span>This week</span>
        </div>

        <div className={styles.legend}>
          {brands.map((b) => (
            <span key={b.brand.id} className={styles.legendItem}>
              <span
                className={styles.legendSwatch}
                style={{ ["--swatch" as string]: b.brand.accent.base } as CSSProperties}
              />
              <span>{b.brand.name}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
   Send-time strips
   ----------------------------------------------------------------- */

function SendTimeStrips({ brands }: { brands: BrandPageData[] }) {
  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Timing</span>
      <h2 className={styles.sectionTitle}>When they send</h2>
      <p className={styles.sectionSub}>
        24-hour heatmap, one row per brand. Each cell is normalised against
        that brand's busiest hour so light senders aren't drowned.
      </p>

      <div className={styles.sectionBody}>
        <div className={styles.clockGrid}>
          {brands.map((b) => {
            const max = Math.max(0, ...b.cadence.hourly);
            const accentStyle = {
              ["--accent" as string]: b.brand.accent.base,
              ["--accent-soft" as string]: b.brand.accent.soft
            } as CSSProperties;
            return (
              <div key={b.brand.id} className={styles.clockRow}>
                <span className={styles.clockRowName} style={accentStyle}>
                  <span className={styles.clockRowDot} />
                  <span className={styles.clockRowLabel}>{b.brand.name}</span>
                </span>
                <div className={styles.clockStrip}>
                  {b.cadence.hourly.map((count, hour) => {
                    const ratio = max > 0 ? count / max : 0;
                    // Even empty hours show a faint baseline so the strip
                    // reads as 24 distinct cells, but actual data is
                    // weighted by send density via per-cell opacity.
                    const opacity = ratio === 0 ? 0.08 : 0.18 + ratio * 0.82;
                    return (
                      <span
                        key={hour}
                        className={styles.clockCell}
                        style={{
                          background: b.brand.accent.base,
                          opacity
                        }}
                        title={`${formatHourOfDay(hour, {
                          case: "lower",
                          withZone: false
                        })}: ${count} email${count === 1 ? "" : "s"}`}
                      />
                    );
                  })}
                </div>
              </div>
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

/* -----------------------------------------------------------------
   Category mix
   ----------------------------------------------------------------- */

function CategoryMix({ brands }: { brands: BrandPageData[] }) {
  // Union of categories across brands, ranked by combined volume so the
  // top of the list shows the categories everyone uses.
  const combined = new Map<string, number>();
  const labelById = new Map<string, string>();
  for (const b of brands) {
    for (const row of b.categories) {
      combined.set(row.id, (combined.get(row.id) ?? 0) + row.count);
      if (!labelById.has(row.id)) labelById.set(row.id, row.label);
    }
  }
  const ranked = Array.from(combined.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);

  // For each category, compute the per-brand share so we can plot
  // comparable bars (otherwise a brand with 500 emails dwarfs every
  // category by raw count alone).
  const perBrandShare = brands.map((b) => {
    const total = b.categories.reduce((acc, row) => acc + row.count, 0);
    const map = new Map<string, { share: number; count: number }>();
    for (const row of b.categories) {
      map.set(row.id, {
        share: total > 0 ? row.count / total : 0,
        count: row.count
      });
    }
    return map;
  });

  if (ranked.length === 0) {
    return (
      <section className={styles.section}>
        <span className={styles.sectionEyebrow}>Mix</span>
        <h2 className={styles.sectionTitle}>Campaign categories</h2>
        <p className={styles.sectionSub}>
          No category data captured for these brands yet.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <span className={styles.sectionEyebrow}>Mix</span>
      <h2 className={styles.sectionTitle}>Campaign categories</h2>
      <p className={styles.sectionSub}>
        Share of each brand's recent emails by campaign type. Top 8 categories
        across the selection.
      </p>

      <div className={styles.sectionBody}>
        {ranked.map((catId) => {
          const label =
            EMAIL_CATEGORY_LABELS[catId as EmailCategory] ??
            labelById.get(catId) ??
            catId;
          return (
            <div key={catId} className={styles.categoryRow}>
              <span className={styles.categoryLabel} title={label}>
                {label}
              </span>
              <div className={styles.categoryBars}>
                {brands.map((b, idx) => {
                  const cell = perBrandShare[idx].get(catId);
                  const share = cell?.share ?? 0;
                  const count = cell?.count ?? 0;
                  return (
                    <div
                      key={b.brand.id}
                      className={styles.categoryBarRow}
                      style={
                        {
                          ["--accent" as string]: b.brand.accent.base
                        } as CSSProperties
                      }
                    >
                      <span className={styles.categoryBarBrandName}>
                        <span className={styles.categoryBarDot} />
                        <span>{b.brand.name}</span>
                      </span>
                      <span
                        className={styles.categoryBarTrack}
                        aria-hidden="true"
                      >
                        <span
                          className={styles.categoryBarFill}
                          style={{ width: `${Math.max(2, share * 100)}%` }}
                        />
                      </span>
                      <span className={styles.categoryBarCount}>
                        {Math.round(share * 100)}%
                        <span className={styles.kpiCellHint}>
                          {" "}
                          · {count}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
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
        How often each brand drops a promo, the typical depth, and the
        codes they're rotating right now.
      </p>

      <div
        className={styles.promoGrid}
        style={
          {
            gridTemplateColumns: `repeat(${Math.min(
              brands.length,
              3
            )}, minmax(0, 1fr))`
          } as CSSProperties
        }
      >
        {brands.map((b) => {
          const accentStyle = {
            ["--accent" as string]: b.brand.accent.base,
            ["--accent-soft" as string]: b.brand.accent.soft
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
                  <span className={styles.promoStatLabel}>Active codes</span>
                  <span className={styles.promoStatValue}>
                    {b.promo.promoCodes.length}
                  </span>
                </div>
              </div>
              {b.promo.promoCodes.length > 0 ? (
                <div className={styles.promoCodes}>
                  {b.promo.promoCodes.slice(0, 6).map((entry) => (
                    <span key={entry.code} className={styles.promoCode}>
                      {entry.code}
                    </span>
                  ))}
                </div>
              ) : null}
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
        {brands.map((b) => {
          const accentStyle = {
            ["--accent" as string]: b.brand.accent.base
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
        {brands.map((b) => (
          <article key={b.brand.id} className={styles.subjectCard}>
            <header className={styles.subjectCardHead}>
              <span
                className={styles.brandStripAccentDot}
                style={{ ["--accent" as string]: b.brand.accent.base } as CSSProperties}
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
        {brands.map((b) => {
          const accentStyle = {
            ["--accent" as string]: b.brand.accent.base,
            ["--accent-soft" as string]: b.brand.accent.soft
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
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: getActiveTimeZone()
  });
}
