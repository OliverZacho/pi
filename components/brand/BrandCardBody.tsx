import { countryFlag, countryName } from "@/lib/country";
import { formatMonthYear } from "@/lib/datetime";
import styles from "./brands-explore.module.css";

/**
 * Minimum brand shape the grid card renders. Shared by the Brands
 * explorer (`BrandsExploreClient`) and the Following grid so both pages
 * show an identical card. Producers populate the analytical fields from
 * `computeBrandAggregates` + `company_email_stats`.
 */
export type BrandCardBrand = {
  name: string;
  logoUrl: string | null;
  primaryMarketCountry: string | null;
  isGlobal: boolean;
  markets: string[];
  /** Mean days between sends; `null` with fewer than two captured emails. */
  avgDaysBetween: number | null;
  /** ISO timestamp of the most recent send; `null` when none captured. */
  lastEmailAt: string | null;
  /** ISO timestamp of when we first started tracking the brand. */
  subscribedSince: string;
};

/**
 * The inner card content: a left-aligned identity header, a two-up stat
 * strip (send frequency + last send), and a tracked-since footer. The
 * card chrome (link / select button / hover checkbox) lives in the
 * page-level wrappers; this component is purely presentational.
 */
export function BrandCardBody({ brand }: { brand: BrandCardBrand }) {
  return (
    <>
      <div className={styles.cardHead}>
        <span className={styles.cardAvatar} aria-hidden="true">
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt=""
              className={styles.cardAvatarLogo}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className={styles.cardAvatarMonogram}>
              {brand.name.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <div className={styles.cardHeadText}>
          <span className={styles.cardName}>
            {brand.name}
            {brand.primaryMarketCountry ? (
              <span
                aria-hidden="true"
                title={countryName(brand.primaryMarketCountry)}
                style={{ marginLeft: "0.35rem" }}
              >
                {countryFlag(brand.primaryMarketCountry)}
              </span>
            ) : null}
            {brand.isGlobal ? (
              <span title="Global brand" style={{ marginLeft: "0.25rem" }}>
                🌍
              </span>
            ) : null}
          </span>
          {brand.markets.length > 0 ? (
            <span className={styles.cardSub}>
              {brand.markets.map(formatMarketLabel).join(" · ")}
            </span>
          ) : null}
        </div>
      </div>

      <div className={styles.cardStats}>
        <div className={styles.cardStat}>
          <span className={styles.cardStatLabel}>Sends</span>
          <span className={styles.cardStatValue}>
            {brand.avgDaysBetween !== null
              ? formatCadence(brand.avgDaysBetween)
              : "—"}
          </span>
        </div>
        <div className={styles.cardStat}>
          <span className={styles.cardStatLabel}>Last send</span>
          <span className={styles.cardStatValue}>
            {brand.lastEmailAt ? (
              <>
                {isRecentlyActive(brand.lastEmailAt) ? (
                  <span className={styles.cardDot} aria-hidden="true" />
                ) : null}
                {formatLastSend(brand.lastEmailAt)}
              </>
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      <div className={styles.cardFoot}>
        <RadarIcon />
        Tracked since {formatMonthYear(brand.subscribedSince)}
      </div>
    </>
  );
}

function formatMarketLabel(market: string): string {
  const trimmed = market.trim();
  if (!trimmed) return market;
  return trimmed
    .split(/[\s_-]+/)
    .map((word) =>
      word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)
    )
    .join(" ");
}

/** 1 decimal place, with a trailing `.0` dropped (`3.0` → `3`). */
function trimDecimal(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/**
 * Human send-frequency from the mean days-between-sends. Per-week is the
 * canonical unit because it stays comparable across brands and reads
 * naturally for the common range; the extremes switch phrasing so we
 * never show "21 / wk" or "0.3 / wk".
 */
export function formatCadence(avgDaysBetween: number): string {
  if (avgDaysBetween <= 0) return "—";
  if (avgDaysBetween < 0.85) {
    return `${trimDecimal(1 / avgDaysBetween)} / day`;
  }
  const perWeek = 7 / avgDaysBetween;
  if (perWeek >= 0.95) {
    return `${trimDecimal(perWeek)} / wk`;
  }
  const weeks = Math.round(avgDaysBetween / 7);
  if (weeks <= 1) return "~Weekly";
  if (weeks <= 3) return `Every ${weeks} wks`;
  const months = Math.round(avgDaysBetween / 30);
  if (months <= 1) return "Monthly";
  return `Every ${months} mo`;
}

/** Compact "time since" for the last-send stat (`3h ago`, `2d ago`). */
function formatLastSend(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const diff = Date.now() - ms;
  if (diff < 3_600_000) return "just now";
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  if (diff < 31_536_000_000) return `${Math.floor(diff / 2_592_000_000)}mo ago`;
  return `${Math.floor(diff / 31_536_000_000)}y ago`;
}

/** Whether the brand's last send is recent enough to read as "active". */
function isRecentlyActive(iso: string): boolean {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms <= 14 * 86_400_000;
}

function RadarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19.07 4.93A10 10 0 1 0 22 12" />
      <path d="M15.54 8.46A5 5 0 1 0 17 12" />
      <line x1="12" y1="12" x2="22" y2="2" />
    </svg>
  );
}
