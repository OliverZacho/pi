import Link from "next/link";
import { countryFlag, countryName } from "@/lib/country";
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

/** KPI tiles + analytics sections, in the same order as the real dashboard. */
const KPIS = [
  "Captured emails",
  "Send cadence",
  "Promo activity",
  "Primary ESP"
];

const SECTIONS: { eyebrow: string; title: string; sub: string }[] = [
  { eyebrow: "Activity", title: "Send calendar", sub: "Every send, day by day." },
  { eyebrow: "Timing", title: "When they hit the inbox", sub: "Send hours across the week." },
  { eyebrow: "Seasonal", title: "Run-up to key dates", sub: "How they ramp before big moments." },
  { eyebrow: "Cadence", title: "How often they send", sub: "Frequency and rhythm over time." },
  { eyebrow: "Mix", title: "What they send", sub: "The category split of their program." },
  { eyebrow: "Design DNA", title: "How their emails look", sub: "Palette, type, GIFs and dark mode." },
  { eyebrow: "Promotions", title: "Discounting behaviour", sub: "How hard and how often they promote." },
  { eyebrow: "Voice", title: "Emoji & subject lines", sub: "Tone signals in their copy." },
  { eyebrow: "CTAs", title: "What their buttons say", sub: "The language that drives the click." },
  { eyebrow: "Campaigns", title: "Recent emails", sub: "Their latest captured sends." }
];

function formatMonthYear(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * The brand detail page as a logged-out / unpaid visitor sees it: the full
 * structure — hero, KPI tiles, every analytics section heading — is visible,
 * but each data surface is replaced by a lock placeholder with an upgrade
 * CTA. Renders from light brand identity only; no heavy analytics fetched.
 */
export default function BrandLockedDashboard({ brand }: { brand: LockedBrand }) {
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
                <span className={styles.heroDomain}>{brand.domain}</span>
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
          </div>
        </div>

        <Link href="/pricing" className={locked.upgradeBtn}>
          <LockIcon />
          <span>Upgrade to unlock analytics</span>
        </Link>
      </header>

      <div className={styles.kpiGrid}>
        {KPIS.map((label) => (
          <div key={label} className={styles.kpiTile}>
            <span className={styles.kpiLabel}>{label}</span>
            <span className={locked.kpiLocked} aria-label="Locked">
              <LockIcon />
            </span>
          </div>
        ))}
      </div>

      {SECTIONS.map((section) => (
        <section key={section.title} className={styles.recentSection}>
          <article className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <span className={styles.cardEyebrow}>{section.eyebrow}</span>
                <h2 className={styles.cardTitle}>{section.title}</h2>
                <p className={styles.cardSub}>{section.sub}</p>
              </div>
            </div>
            <div className={locked.lockedBody}>
              <span className={locked.lockedBadge} aria-hidden="true">
                <LockIcon />
              </span>
              <p className={locked.lockedText}>Subscribe to see this</p>
              <Link href="/pricing" className={locked.lockedCta}>
                View plans
              </Link>
            </div>
          </article>
        </section>
      ))}
    </main>
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
