import type { CSSProperties } from "react";
import Link from "next/link";
import type { BrandPageData } from "@/lib/brand-db";
import type { CompetitorSetSummary } from "@/lib/competitor-db";
import { countryFlag, countryName } from "@/lib/country";
import {
  formatMonthYear as formatMonthYearZoned,
  formatRelativeDate as formatRelativeDateZoned,
  formatShortDate as formatShortDateZoned
} from "@/lib/datetime";
import BrandActivityCalendar from "./BrandActivityCalendar";
import BrandClockHeatmap from "./BrandClockHeatmap";
import BrandCtaCloud from "./BrandCtaCloud";
import BrandHeroActions from "./BrandHeroActions";
import BrandRecentEmails from "./BrandRecentEmails";
import styles from "./brand.module.css";

type Props = {
  data: BrandPageData;
  /**
   * Whether the current user follows this brand. Drives the initial
   * state of the Follow toggle in the hero strip.
   */
  isFollowing: boolean;
  /**
   * The current user's competitor groups, used to seed the "Add to
   * group" popover. Empty array if the user hasn't created any yet.
   */
  groups: CompetitorSetSummary[];
  /**
   * Subset of `groups` ids that already contain this brand, so the
   * popover can pre-check the right rows the moment it opens.
   */
  groupMembershipIds: string[];
};

/**
 * Modern SaaS dashboard for a single brand. Composed entirely of static
 * server-rendered tiles and SVG charts, with a single client island
 * (`<BrandRecentEmails />`) at the bottom so the recent-campaign grid
 * can open the existing email modal.
 *
 * Section order is intentional and follows the questions an operator
 * actually asks while researching a competitor:
 *   1. Who is this brand?                   (hero strip)
 *   2. How active are they?                 (KPI tiles)
 *   3. When and how often do they send?     (cadence chart + send time)
 *   4. What do they send?                   (category mix)
 *   5. How aggressively do they discount?   (promo card)
 *   6. What does their email look like?     (design DNA)
 *   7. Show me their recent work            (recent emails grid)
 */
export default function BrandDashboard({
  data,
  isFollowing,
  groups,
  groupMembershipIds
}: Props) {
  const {
    brand,
    totals,
    cadence,
    promo,
    emojis,
    categories,
    esp,
    design,
    subjects,
    ctas,
    calendar
  } = data;

  // Wire the auto-picked brand accent into a small set of CSS custom
  // properties on the dashboard root. Every tinted element below reads
  // these via `var(--brand-accent, …)` so the page silently re-skins
  // itself per brand without any per-element prop drilling.
  const accentStyle = {
    "--brand-accent": brand.accent.base,
    "--brand-accent-fg": brand.accent.foreground,
    "--brand-accent-soft": brand.accent.soft
  } as CSSProperties;

  return (
    <main className={styles.main} style={accentStyle}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/explore" className={styles.breadcrumbLink}>
          <ChevronLeftIcon />
          <span>Explore</span>
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <Link href="/brands" className={styles.breadcrumbLink}>
          <span>Brands</span>
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{brand.name}</span>
      </nav>

      <Hero
        brand={brand}
        subscribedSince={brand.subscribedSince}
        isFollowing={isFollowing}
        groups={groups}
        groupMembershipIds={groupMembershipIds}
      />

      <KpiGrid
        totals={totals}
        cadence={cadence}
        promo={promo}
        esp={esp}
      />

      {totals.sampleSize === 0 ? (
        <div className={styles.emptyState}>
          <strong>No emails captured yet</strong>
          Once {brand.name} sends a newsletter to the subscription inbox we
          set up for them, their campaigns will appear here with full
          analytics.
        </div>
      ) : (
        <>
          <section className={styles.recentSection}>
            <BrandActivityCalendar
              brandName={brand.name}
              calendar={calendar}
            />
          </section>

          <section className={styles.recentSection}>
            <BrandClockHeatmap
              brandName={brand.name}
              hourly={cadence.hourly}
            />
          </section>

          <section className={styles.sectionGrid}>
            <CadenceCard cadence={cadence} totals={totals} />
            <CategoryCard categories={categories} sample={totals.sampleSize} />
          </section>

          <section className={styles.recentSection}>
            <DesignCard design={design} subjects={subjects} />
          </section>

          <section className={styles.sectionGrid}>
            <PromoCard promo={promo} sample={totals.sampleSize} />
            <EmojiCard emojis={emojis} sample={totals.sampleSize} />
          </section>

          <section className={styles.recentSection}>
            <CtaCloudCard ctas={ctas} sample={totals.sampleSize} />
          </section>

          <section className={styles.recentSection}>
            <header className={styles.recentHeader}>
              <div className={styles.recentTitleGroup}>
                <h2>Recent campaigns</h2>
                <p>
                  The latest {data.recentEmails.length} emails captured for{" "}
                  {brand.name}.
                </p>
              </div>
            </header>
            {data.recentEmails.length === 0 ? (
              <div className={styles.recentEmpty}>
                No emails to show yet.
              </div>
            ) : (
              <BrandRecentEmails emails={data.recentEmails} />
            )}
          </section>
        </>
      )}
    </main>
  );
}

/* -----------------------------------------------------------------
   Hero
   ----------------------------------------------------------------- */

function Hero({
  brand,
  subscribedSince,
  isFollowing,
  groups,
  groupMembershipIds
}: {
  brand: BrandPageData["brand"];
  subscribedSince: string;
  isFollowing: boolean;
  groups: CompetitorSetSummary[];
  groupMembershipIds: string[];
}) {
  return (
    <header className={styles.hero}>
      <div className={styles.heroIdentity}>
        <BrandAvatar name={brand.name} logoUrl={brand.logoUrl} />
        <div className={styles.heroText}>
          <h1 className={styles.heroName}>{brand.name}</h1>
          <div className={styles.heroMeta}>
            {brand.domain ? (
              <a
                href={`https://${brand.domain}`}
                target="_blank"
                rel="noreferrer"
                className={styles.heroDomain}
              >
                {brand.domain}
              </a>
            ) : null}
            {brand.markets.length > 0 ? (
              <>
                <span className={styles.heroDot} aria-hidden="true" />
                {brand.markets.map((label) => (
                  <span key={label} className={styles.heroPill}>
                    {label}
                  </span>
                ))}
              </>
            ) : null}
            {brand.primaryMarketCountry ? (
              <>
                <span className={styles.heroDot} aria-hidden="true" />
                <span
                  className={styles.heroPill}
                  title={
                    brand.marketConfidence !== null
                      ? `Primary market — ${Math.round(
                          brand.marketConfidence * 100
                        )}% of recent emails`
                      : "Primary market"
                  }
                >
                  {countryFlag(brand.primaryMarketCountry)}{" "}
                  {countryName(brand.primaryMarketCountry)}
                </span>
              </>
            ) : null}
            <span className={styles.heroDot} aria-hidden="true" />
            <span>Tracked since {formatMonthYear(subscribedSince)}</span>
          </div>
        </div>
      </div>
      <BrandHeroActions
        brandId={brand.id}
        brandName={brand.name}
        initialFollowing={isFollowing}
        initialGroups={groups}
        initialMembershipIds={groupMembershipIds}
      />
    </header>
  );
}

function BrandAvatar({
  name,
  logoUrl
}: {
  name: string;
  logoUrl: string | null;
}) {
  if (logoUrl) {
    return (
      <span className={styles.heroAvatar} aria-hidden="true">
        <img
          src={logoUrl}
          alt=""
          className={styles.heroAvatarLogo}
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }
  return (
    <span className={styles.heroAvatar} aria-hidden="true">
      <span className={styles.heroAvatarMonogram}>
        {name.charAt(0).toUpperCase()}
      </span>
    </span>
  );
}

/* -----------------------------------------------------------------
   KPI tiles
   ----------------------------------------------------------------- */

function KpiGrid({
  totals,
  cadence,
  promo,
  esp
}: {
  totals: BrandPageData["totals"];
  cadence: BrandPageData["cadence"];
  promo: BrandPageData["promo"];
  esp: BrandPageData["esp"];
}) {
  return (
    <section className={styles.kpiGrid}>
      <KpiTile
        icon={<MailIcon />}
        label="Captured emails"
        value={formatNumber(totals.emailCount)}
        hint={
          totals.lastEmailAt
            ? `Last on ${formatRelativeDate(totals.lastEmailAt)}`
            : "No emails yet"
        }
      />
      <KpiTile
        icon={<ClockIcon />}
        label="Send cadence"
        value={
          cadence.avgDaysBetween !== null
            ? `${formatCadenceDays(cadence.avgDaysBetween)}`
            : "—"
        }
        hint={
          cadence.typicalDay && cadence.typicalDay.share >= 0.25
            ? `Most often on ${cadence.typicalDay.label}s`
            : "Across the whole week"
        }
      />
      <KpiTile
        icon={<TagIcon />}
        label="Promo activity"
        value={
          promo.discountShare > 0
            ? `${Math.round(promo.discountShare * 100)}%`
            : "0%"
        }
        hint={
          promo.avgDiscount !== null
            ? `Avg ${Math.round(promo.avgDiscount)}% off when on sale`
            : "No discount campaigns"
        }
        trendTone={promo.discountShare >= 0.4 ? "warn" : "good"}
      />
      <KpiTile
        icon={<StackIcon />}
        label="Email platform"
        value={esp.primary ? esp.primary.label : "Unknown"}
        hint={
          esp.primary
            ? `${Math.round(esp.primary.share * 100)}% of sends`
            : "ESP not detected"
        }
      />
    </section>
  );
}

function KpiTile({
  icon,
  label,
  value,
  hint,
  trendTone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  trendTone?: "good" | "warn";
}) {
  return (
    <article className={styles.kpiTile}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiIcon}>{icon}</span>
        <span className={styles.kpiLabel}>{label}</span>
      </div>
      <div className={styles.kpiValue}>{value}</div>
      <div className={styles.kpiTrend}>
        <span
          className={`${styles.kpiTrendDot}${
            trendTone ? ` ${styles[`kpiTrendDot_${trendTone}`]}` : ""
          }`}
        />
        <span className={styles.kpiHint}>{hint}</span>
      </div>
    </article>
  );
}

/* -----------------------------------------------------------------
   Cadence chart
   ----------------------------------------------------------------- */

function CadenceCard({
  cadence,
  totals
}: {
  cadence: BrandPageData["cadence"];
  totals: BrandPageData["totals"];
}) {
  const totalThisRange = cadence.weekly.reduce((acc, w) => acc + w.count, 0);
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardEyebrow}>Cadence</span>
          <h2 className={styles.cardTitle}>Send frequency</h2>
          <p className={styles.cardSub}>
            Emails per week over the last {cadence.weekly.length} weeks. Each
            bar is one calendar week, ending today.
          </p>
        </div>
      </div>

      <div className={styles.cadenceWrap}>
        <CadenceChart weekly={cadence.weekly} />
        <div className={styles.cadenceAxis}>
          <span>{formatRangeStart(cadence.weekly)}</span>
          <span>This week</span>
        </div>
      </div>

      <div className={styles.cadenceLegend}>
        <div className={styles.cadenceLegendItem}>
          <span className={styles.cadenceLegendValue}>
            {formatNumber(totalThisRange)}
          </span>
          <span className={styles.cadenceLegendLabel}>
            emails in this range
          </span>
        </div>
        <div className={styles.cadenceLegendItem}>
          <span className={styles.cadenceLegendValue}>
            {cadence.typicalDay
              ? cadence.typicalDay.label
              : "—"}
          </span>
          <span className={styles.cadenceLegendLabel}>
            most common send day
          </span>
        </div>
        <div className={styles.cadenceLegendItem}>
          <span className={styles.cadenceLegendValue}>
            {cadence.typicalHour ? cadence.typicalHour.label : "—"}
          </span>
          <span className={styles.cadenceLegendLabel}>
            most common send time
          </span>
        </div>
        <div className={styles.cadenceLegendItem}>
          <span className={styles.cadenceLegendValue}>
            {totals.firstEmailAt
              ? formatRelativeDate(totals.firstEmailAt)
              : "—"}
          </span>
          <span className={styles.cadenceLegendLabel}>
            first email captured
          </span>
        </div>
      </div>
    </article>
  );
}

/**
 * Hand-rolled SVG bar chart. We avoid pulling in a chart library because
 * (a) every other visual on this page is also bespoke and (b) bundling
 * something like Recharts just for one sparkline doubles JS payload.
 *
 * Y axis auto-scales to the busiest week so light senders aren't
 * dwarfed by a hard-coded ceiling. Empty weeks get a thin grey bar so
 * the rhythm of "they took two weeks off" still reads visually.
 */
function CadenceChart({
  weekly
}: {
  weekly: BrandPageData["cadence"]["weekly"];
}) {
  const width = 600;
  const height = 180;
  const padding = { top: 12, bottom: 18, left: 4, right: 4 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const max = Math.max(1, ...weekly.map((w) => w.count));
  const barCount = weekly.length;
  const slot = innerWidth / barCount;
  const barWidth = Math.max(2, slot * 0.62);

  return (
    <svg
      className={styles.cadenceChart}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Email send frequency over time"
    >
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={height - padding.bottom + 4}
        y2={height - padding.bottom + 4}
        className={styles.cadenceBaseline}
      />
      {weekly.map((week, index) => {
        const cx = padding.left + slot * index + slot / 2;
        const x = cx - barWidth / 2;
        // Empty weeks render a thin baseline pip so the chart doesn't go
        // visually blank during quiet stretches.
        const ratio = week.count === 0 ? 0 : week.count / max;
        const minBarHeight = week.count === 0 ? 3 : 4;
        const barHeight = Math.max(minBarHeight, ratio * innerHeight);
        const y = padding.top + innerHeight - barHeight;
        return (
          <rect
            key={week.weekStart}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx={Math.min(2, barWidth / 2)}
            className={`${styles.cadenceBar}${
              week.count === 0 ? ` ${styles.empty}` : ""
            }`}
          >
            <title>
              {`Week of ${formatShortDate(week.weekStart)}: ${week.count} email${
                week.count === 1 ? "" : "s"
              }`}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

/* -----------------------------------------------------------------
   Categories chart
   ----------------------------------------------------------------- */

function CategoryCard({
  categories,
  sample
}: {
  categories: BrandPageData["categories"];
  sample: number;
}) {
  const max = categories[0]?.count ?? 0;
  const top = categories.slice(0, 6);
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardEyebrow}>Mix</span>
          <h2 className={styles.cardTitle}>Campaign categories</h2>
          <p className={styles.cardSub}>
            Share of {sample} recent emails by campaign type.
          </p>
        </div>
      </div>
      {top.length === 0 ? (
        <div className={styles.cardSub}>No category data yet.</div>
      ) : (
        <div className={styles.categoryList}>
          {top.map((row) => {
            const ratio = max > 0 ? row.count / max : 0;
            return (
              <div key={row.id} className={styles.categoryRow}>
                <span className={styles.categoryLabel} title={row.label}>
                  {row.label}
                </span>
                <span
                  className={styles.categoryTrack}
                  aria-hidden="true"
                  title={`${row.count} emails`}
                >
                  <span
                    className={styles.categoryFill}
                    style={{ width: `${Math.max(4, ratio * 100)}%` }}
                  />
                </span>
                <span className={styles.categoryCount}>
                  {row.count}
                  <span className={styles.kpiHint}>
                    {sample > 0
                      ? ` · ${Math.round((row.count / sample) * 100)}%`
                      : ""}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

/* -----------------------------------------------------------------
   Promo / discount card
   ----------------------------------------------------------------- */

function PromoCard({
  promo,
  sample
}: {
  promo: BrandPageData["promo"];
  sample: number;
}) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardEyebrow}>Offers</span>
          <h2 className={styles.cardTitle}>Discount activity</h2>
          <p className={styles.cardSub}>
            How aggressively this brand promotes — across {sample} recent
            sends.
          </p>
        </div>
      </div>

      <div className={styles.promoSummary}>
        <span className={styles.promoBig}>
          {promo.discountEmails > 0
            ? `${Math.round(promo.discountShare * 100)}%`
            : "0%"}
        </span>
        <span className={styles.promoLabel}>
          of recent emails carry a discount
        </span>
      </div>

      <div className={styles.statStrip}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockLabel}>Avg discount</span>
          <span className={styles.statBlockValue}>
            {promo.avgDiscount !== null
              ? `${Math.round(promo.avgDiscount)}%`
              : "—"}
          </span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockLabel}>Highest seen</span>
          <span className={styles.statBlockValue}>
            {promo.maxDiscount !== null
              ? `${Math.round(promo.maxDiscount)}%`
              : "—"}
          </span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockLabel}>Discount emails</span>
          <span className={styles.statBlockValue}>
            {formatNumber(promo.discountEmails)}
          </span>
        </div>
      </div>
    </article>
  );
}

/* -----------------------------------------------------------------
   Emoji card
   ----------------------------------------------------------------- */

/**
 * Companion to the discount card. Where promo answers "how aggressive
 * is this brand?", emoji answers "how playful is its voice?". The
 * headline percentage tracks the share of recent subject + preheader
 * combinations that contain at least one pictographic grapheme; the
 * stat strip surfaces total emojis across the sample and the avg
 * count *inside* emoji-using emails (so quiet brands don't dilute the
 * number with their no-emoji sends). The bottom strip is the brand's
 * top emojis with their absolute counts — visually mirrors the old
 * promo-codes list it replaces, but with content that doesn't go
 * stale the moment a campaign expires.
 */
function EmojiCard({
  emojis,
  sample
}: {
  emojis: BrandPageData["emojis"];
  sample: number;
}) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardEyebrow}>Voice</span>
          <h2 className={styles.cardTitle}>Emoji habits</h2>
          <p className={styles.cardSub}>
            How often this brand reaches for emojis — across {sample} recent
            subject lines and preheaders.
          </p>
        </div>
      </div>

      <div className={styles.promoSummary}>
        <span className={styles.promoBig}>
          {emojis.emailsWithEmoji > 0
            ? `${Math.round(emojis.share * 100)}%`
            : "0%"}
        </span>
        <span className={styles.promoLabel}>
          of recent emails use at least one emoji
        </span>
      </div>

      <div className={styles.statStrip}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockLabel}>Avg / email</span>
          <span className={styles.statBlockValue}>
            {emojis.avgPerEmojiEmail !== null
              ? emojis.avgPerEmojiEmail.toFixed(1)
              : "—"}
          </span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockLabel}>Total seen</span>
          <span className={styles.statBlockValue}>
            {formatNumber(emojis.totalEmojis)}
          </span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockLabel}>Unique</span>
          <span className={styles.statBlockValue}>
            {formatNumber(emojis.top.length)}
          </span>
        </div>
      </div>

      {emojis.top.length > 0 ? (
        <div className={styles.emojiList}>
          {emojis.top.map((entry) => (
            <div key={entry.emoji} className={styles.emojiRow}>
              <span className={styles.emojiGlyph} aria-hidden="true">
                {entry.emoji}
              </span>
              <span className={styles.emojiCount}>
                {entry.count} use{entry.count === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.cardSub}>
          No emojis used in recent subject lines.
        </div>
      )}
    </article>
  );
}

/* -----------------------------------------------------------------
   Design DNA card
   ----------------------------------------------------------------- */

function DesignCard({
  design,
  subjects
}: {
  design: BrandPageData["design"];
  subjects: BrandPageData["subjects"];
}) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardEyebrow}>Brand</span>
          <h2 className={styles.cardTitle}>Design DNA</h2>
          <p className={styles.cardSub}>
            Visual signals aggregated across this brand&apos;s emails.
          </p>
        </div>
      </div>

      <div className={styles.dnaGrid}>
        <div className={styles.dnaSection}>
          <span className={styles.dnaTitle}>Color palette</span>
          {design.palette.length === 0 ? (
            <div className={styles.cardSub}>No color data captured.</div>
          ) : (
            <div className={styles.paletteGrid}>
              {design.palette.slice(0, 10).map((entry) => (
                <span
                  key={entry.hex}
                  className={styles.paletteSwatch}
                  style={{ background: entry.hex }}
                  title={entry.hex}
                >
                  <span className={styles.paletteSwatchHex}>
                    {entry.hex.replace("#", "")}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className={styles.dnaSection}>
          <span className={styles.dnaTitle}>Typography</span>
          {design.fonts.length === 0 ? (
            <div className={styles.cardSub}>No font data captured.</div>
          ) : (
            <div className={styles.fontList}>
              {design.fonts.map((font) => (
                <div key={font.family} className={styles.fontRow}>
                  <span
                    className={styles.fontSample}
                    style={{ fontFamily: `${font.family}, ui-sans-serif` }}
                  >
                    Aa
                  </span>
                  <span
                    className={styles.fontName}
                    style={{ fontFamily: `${font.family}, ui-sans-serif` }}
                    title={font.family}
                  >
                    {font.family}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.flagsRow}>
        <span className={styles.flag}>
          <span
            className={`${styles.flagDot}${
              design.gifShare > 0 ? ` ${styles.flagDot_on}` : ""
            }`}
          />
          <span>Uses GIFs</span>
          <span className={styles.flagShare}>
            {Math.round(design.gifShare * 100)}%
          </span>
        </span>
        <span className={styles.flag}>
          <span
            className={`${styles.flagDot}${
              design.darkModeShare > 0 ? ` ${styles.flagDot_on}` : ""
            }`}
          />
          <span>Dark-mode aware</span>
          <span className={styles.flagShare}>
            {Math.round(design.darkModeShare * 100)}%
          </span>
        </span>
        <span className={styles.flag}>
          <span className={styles.flagDot} />
          <span>Avg subject</span>
          <span className={styles.flagShare}>
            {subjects.avgLength !== null
              ? `${Math.round(subjects.avgLength)} chars`
              : "—"}
          </span>
        </span>
      </div>

      {subjects.samples.length > 0 ? (
        <div className={styles.dnaSection}>
          <span className={styles.dnaTitle}>Recent subject lines</span>
          <div className={styles.subjectList}>
            {subjects.samples.map((subject) => (
              <div key={subject} className={styles.subjectRow}>
                <span className={styles.subjectText}>{subject}</span>
                <span className={styles.subjectMeta}>{subject.length} characters</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

/* -----------------------------------------------------------------
   CTA tag cloud
   ----------------------------------------------------------------- */

/**
 * Tag cloud of the brand's most-used primary CTA labels. Font size
 * scales linearly between the lowest and highest counts in the
 * supplied list so the visual weight tracks frequency without one
 * runaway outlier flattening everything else into 0.85rem soup.
 *
 * Each tag also gets a low-opacity accent fill keyed to the brand
 * accent so a glance at the card immediately reads as "this brand's
 * voice", not a generic widget. Hover surfaces the exact count for
 * folks who want the number behind the visual.
 */
function CtaCloudCard({
  ctas,
  sample
}: {
  ctas: BrandPageData["ctas"];
  sample: number;
}) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardEyebrow}>Voice</span>
          <h2 className={styles.cardTitle}>Most used calls to action</h2>
          <p className={styles.cardSub}>
            The button labels this brand reaches for most often, across{" "}
            {sample} recent emails. Larger words appear more frequently.
          </p>
        </div>
      </div>
      {ctas.length === 0 ? (
        <div className={styles.cardSub}>
          No CTA labels captured yet.
        </div>
      ) : (
        <BrandCtaCloud ctas={ctas} />
      )}
    </article>
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

function formatMonthYear(value: string): string {
  return formatMonthYearZoned(value, { fallback: value });
}

function formatShortDate(value: string): string {
  return formatShortDateZoned(value, { fallback: value });
}

function formatRelativeDate(value: string): string {
  return formatRelativeDateZoned(value, { fallback: value });
}

function formatRangeStart(
  weekly: BrandPageData["cadence"]["weekly"]
): string {
  const first = weekly[0]?.weekStart;
  if (!first) return "";
  return formatShortDate(first);
}

/* -----------------------------------------------------------------
   Icons (inline SVG to match the rest of the app's iconography)
   ----------------------------------------------------------------- */

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 6 9 12 15 18" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <polyline points="3 7 12 13 21 7" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function StackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
