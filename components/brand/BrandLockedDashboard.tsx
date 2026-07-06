import Link from "next/link";
import { countryFlag, countryName } from "@/lib/country";
import {
  BRAND_PREVIEW_SAMPLE,
  BRAND_PREVIEW_CALENDAR
} from "@/lib/brand-preview-sample";
import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
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
import styles from "./brand.module.css";
import locked from "./brand-locked.module.css";

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
  summary
}: {
  brand: LockedBrand;
  summary?: string | null;
}) {
  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/explore" className={styles.breadcrumbLink}>
          <span>Explore</span>
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
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

        <TrackedUpgradeLink source="brand_hero" className={locked.upgradeBtn}>
          <LockIcon />
          <span>Upgrade to unlock analytics</span>
        </TrackedUpgradeLink>
      </header>

      {/*
        One paywall, not ten. The real dashboard charts render underneath with a
        shared sample dataset, blurred, and a single unlock card floats over the
        whole region — so the page reads as the genuine product, not a stack of
        empty "subscribe to see this" tiles.
      */}
      <div className={locked.lockedRegion}>
        <div className={locked.previewClip} aria-hidden="true">
          <div className={locked.preview}>
          <KpiGrid
            totals={sample.totals}
            cadence={sample.cadence}
            promo={sample.promo}
            esp={sample.esp}
          />

          <section className={styles.recentSection}>
            <BrandActivityCalendar
              brandName={brand.name}
              calendar={BRAND_PREVIEW_CALENDAR}
            />
          </section>

          <section className={styles.recentSection}>
            <BrandClockHeatmap
              brandName={brand.name}
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
              brand={{ name: brand.name, logoUrl: brand.logoUrl }}
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
