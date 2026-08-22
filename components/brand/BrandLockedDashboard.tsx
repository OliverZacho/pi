import Link from "next/link";
import { countryFlag, countryName } from "@/lib/country";
import {
  BRAND_PREVIEW_SAMPLE,
  BRAND_PREVIEW_CALENDAR
} from "@/lib/brand-preview-sample";
import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
import BrandFollowButton from "./BrandFollowButton";
import BrandActivityCalendar from "./BrandActivityCalendar";
import BrandClockHeatmap from "./BrandClockHeatmap";
import {
  KpiGrid,
  CadenceCard,
  CategoryCard,
  PromoCard,
  EmojiCard,
  DesignCard,
  CtaCloudCard
} from "./BrandDashboard";
import { brandUrlLabel } from "@/lib/brand-url";
import type { BrandPageData } from "@/lib/brand-db";
import styles from "./brand.module.css";
import locked from "./brand-locked.module.css";

export type RelatedBrand = {
  slug: string;
  name: string;
  /** Pretty label of the market the two brands share, for the heading. */
  marketLabel: string | null;
};

export type LockedBrand = {
  name: string;
  domain: string | null;
  markets: string[];
  primaryMarketCountry: string | null;
  isGlobal: boolean;
  logoUrl: string | null;
  subscribedSince: string | null;
};

function formatMonthYear(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

const sample = BRAND_PREVIEW_SAMPLE;

/**
 * Fictional brand name for the blurred sample region. The real brand's name
 * must never label fabricated numbers — the sample HTML is crawlable, and
 * "Every email <real brand> sent" over invented data is both dishonest and
 * near-duplicate boilerplate across all 600 brand pages. Behind the blur the
 * name is illegible anyway, so nothing changes visually.
 */
const SAMPLE_BRAND_NAME = "Fenne";

/**
 * The brand detail page as a logged-out / unpaid visitor sees it.
 *
 * It renders the *real* dashboard chart components — the same cadence chart,
 * category mix, design DNA, send calendar, etc. a paying user gets — but fed a
 * single shared sample dataset ({@link BRAND_PREVIEW_SAMPLE}) rather than the
 * brand's real numbers, which we never ship to an unpaid client. The whole
 * preview is blurred and a single unlock card floats over it, so the page looks
 * exactly like the paid product instead of an obvious placeholder.
 *
 * `summary` is the one exception: a short, data-driven paragraph rendered
 * *visibly* in the hero. It's the page's real crawlable content — what makes it
 * rank for "<brand> email frequency / newsletter strategy" — and the hook that
 * turns a researching marketer into a signup. Omitted when there isn't enough
 * signal.
 */
export default function BrandLockedDashboard({
  brand,
  summary,
  follow,
  live,
  related
}: {
  brand: LockedBrand;
  summary?: string | null;
  /**
   * Follow toggle state for signed-in free viewers — following is a
   * free feature even though the analytics stay locked. Omitted for
   * logged-out visitors, who only get the upgrade CTA.
   */
  follow?: { brandId: string; initialFollowing: boolean };
  /**
   * Real data for the teaser: every locked viewer — signed-in free
   * users, logged-out visitors, crawlers — gets the KPI tiles and the
   * send calendar with the brand's actual numbers, rendered unblurred
   * above the locked region (which then drops its sample copies of
   * both). This is the page's unique crawlable content. Absent only
   * when the data failed to load, in which case the sample copies fill
   * the layout.
   */
  live?: Pick<
    BrandPageData,
    "totals" | "cadence" | "promo" | "esp" | "calendar"
  >;
  /**
   * Same-market brands to cross-link at the bottom of the page, so brand
   * pages pass link equity to each other instead of each leaf being an
   * island only the sitemap knows about.
   */
  related?: RelatedBrand[];
}) {
  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/brands" className={styles.breadcrumbLink}>
          <span>Brands</span>
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{brand.name}</span>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroIdentity}>
          <span className={styles.heroAvatar} aria-hidden="true">
            {brand.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt=""
                className={styles.heroAvatarLogo}
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className={styles.heroAvatarMonogram}>
                {brand.name.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <div>
            <h1 className={styles.heroName}>{brand.name}</h1>
            <div className={styles.heroMeta}>
              {brand.domain ? (
                <span className={styles.heroDomain}>
                  {brandUrlLabel(brand.domain)}
                </span>
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
                  <span className={styles.heroPill}>
                    {countryFlag(brand.primaryMarketCountry)}{" "}
                    {countryName(brand.primaryMarketCountry)}
                  </span>
                </>
              ) : null}
              <span className={styles.heroDot} aria-hidden="true" />
              <span>Tracked since {formatMonthYear(brand.subscribedSince)}</span>
            </div>
            {summary ? <p className={styles.heroSummary}>{summary}</p> : null}
          </div>
        </div>

        <div className={locked.heroCtas}>
          {follow ? (
            <BrandFollowButton
              brandId={follow.brandId}
              initialFollowing={follow.initialFollowing}
            />
          ) : null}
          <TrackedUpgradeLink source="brand_hero" className={locked.upgradeBtn}>
            <LockIcon />
            <span>Upgrade to unlock analytics</span>
          </TrackedUpgradeLink>
        </div>
      </header>

      {/*
        The free teaser: signed-in free viewers get the brand's real KPI
        tiles and send calendar in the clear — enough signal to make
        following worthwhile — while everything deeper stays locked.
      */}
      {live ? (
        <>
          <KpiGrid
            totals={live.totals}
            cadence={live.cadence}
            promo={live.promo}
            esp={live.esp}
          />

          <section className={styles.recentSection}>
            <BrandActivityCalendar
              brandName={brand.name}
              calendar={live.calendar}
            />
          </section>
        </>
      ) : null}

      {/*
        One paywall, not ten. The real dashboard charts render underneath with a
        shared sample dataset, blurred, and a single unlock card floats over the
        whole region — so the page reads as the genuine product, not a stack of
        empty "subscribe to see this" tiles. When the live teaser above is
        showing, its sections drop out of the sample so nothing renders twice.
      */}
      <div className={locked.lockedRegion}>
        <div className={locked.previewClip} aria-hidden="true">
          <div className={locked.preview}>
          {live ? null : (
            <>
              <KpiGrid
                totals={sample.totals}
                cadence={sample.cadence}
                promo={sample.promo}
                esp={sample.esp}
              />

              <section className={styles.recentSection}>
                <BrandActivityCalendar
                  brandName={SAMPLE_BRAND_NAME}
                  calendar={BRAND_PREVIEW_CALENDAR}
                />
              </section>
            </>
          )}

          <section className={styles.recentSection}>
            <BrandClockHeatmap
              brandName={SAMPLE_BRAND_NAME}
              hourly={sample.cadence.hourly}
            />
          </section>

          <section className={styles.sectionGrid}>
            <CadenceCard cadence={sample.cadence} totals={sample.totals} />
            <CategoryCard
              categories={sample.categories}
              sample={sample.totals.sampleSize}
            />
          </section>

          <section className={styles.recentSection}>
            <DesignCard
              design={sample.design}
              subjects={sample.subjects}
              brand={{ name: SAMPLE_BRAND_NAME, logoUrl: null }}
            />
          </section>

          <section className={styles.sectionGrid}>
            <PromoCard promo={sample.promo} sample={sample.totals.sampleSize} />
            <EmojiCard emojis={sample.emojis} sample={sample.totals.sampleSize} />
          </section>

          <section className={styles.recentSection}>
            <CtaCloudCard ctas={sample.ctas} sample={sample.totals.sampleSize} />
          </section>
          </div>
        </div>

        <div className={locked.paywall}>
          <div className={locked.paywallCard}>
            <span className={locked.paywallBadge} aria-hidden="true">
              <SparkIcon />
            </span>
            <h2 className={locked.paywallTitle}>
              Unlock {brand.name}&rsquo;s full playbook
            </h2>
            <p className={locked.paywallText}>
              Send calendar, inbox timing, cadence, campaign mix, design DNA and
              discounting — updated every time {brand.name} sends. Plus every
              other brand in Pirol.
            </p>
            <TrackedUpgradeLink source="brand_paywall" className={locked.paywallCta}>
              <LockIcon />
              <span>Subscribe to unlock</span>
            </TrackedUpgradeLink>
            <span className={locked.paywallNote}>Full access · cancel anytime</span>
          </div>
        </div>
      </div>

      {related && related.length > 0 ? (
        <section className={locked.related} aria-label="Related brands">
          <h2 className={locked.relatedTitle}>
            {related[0].marketLabel
              ? `More ${related[0].marketLabel.toLowerCase()} brands`
              : "More brands on Pirol"}
          </h2>
          <div className={locked.relatedList}>
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/brands/${r.slug}`}
                className={locked.relatedLink}
              >
                {r.name}
              </Link>
            ))}
            <Link href="/brands" className={locked.relatedLink}>
              All brands →
            </Link>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function SparkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l2.2 4.9L19 10l-4.8 2.1L12 17l-2.2-4.9L5 10l4.8-2.1z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
