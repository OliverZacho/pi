"use client";

import { useCallback, useMemo, useState } from "react";
import EmailModal from "@/components/explore/EmailModal";
import type { BrandPageData } from "@/lib/brand-db";
import { formatShortDate } from "@/lib/datetime";
import type { ExploreEmailCard } from "@/lib/explore-db";
import { useSavedEmails } from "./useSavedEmails";
import styles from "./brand.module.css";

/** Brand metadata needed to build a full email card for the modal. */
export type DiscountTimelineCompany = {
  id: string;
  slug: string | null;
  name: string;
  domain: string | null;
  markets: string[];
  logoUrl: string | null;
};

type Props = {
  brandName: string;
  /**
   * The full per-email sample (newest-first). We only read `receivedAt` and
   * `discountPercent`; the rest rides along so a clicked dot can open the
   * email modal.
   */
  sample: BrandPageData["seasonalSample"];
  /**
   * Brand-level fields merged into each email so a clicked dot can open the
   * shared `EmailModal`. When `null`, dots render but aren't clickable.
   */
  company?: DiscountTimelineCompany | null;
};

type SeasonalEmail = BrandPageData["seasonalSample"][number];

type Point = {
  /** Epoch ms of the send, used for x positioning. */
  t: number;
  /** Discount depth, in whole percent. */
  depth: number;
  receivedAt: string;
  subject: string;
  email: SeasonalEmail;
};

const WIDTH = 640;
const HEIGHT = 162;
// Minimal top padding: the ceiling gridline (e.g. 30%) sits right at the top of
// the plot with no empty band above it, so it never reads like a higher line.
const PAD = { top: 8, bottom: 46, left: 34, right: 12 };
const INNER_W = WIDTH - PAD.left - PAD.right;
const INNER_H = HEIGHT - PAD.top - PAD.bottom;
const BASELINE_Y = PAD.top + INNER_H;
/** Pad the time domain so edge stems aren't flush against the y-axis / right edge. */
const DOMAIN_PAD_MS = 3 * 24 * 60 * 60 * 1000;
/** Min horizontal gap (viewBox units) between two rendered date labels. */
const MIN_LABEL_GAP = 30;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * "Sale history" — a lollipop timeline of every discounted send, embedded
 * inside the Discount-activity card. Each dot sits at the date it landed (x)
 * and the depth of its discount (y), so the eye reads two things at once:
 * *when* a brand runs sales (clusters of stems = a sale period) and *how
 * deep* those sales go (taller, darker dots).
 *
 * The x-axis is labelled with the actual send dates (not generic months),
 * thinned only where labels would collide — hover always shows the exact
 * date. Clicking a dot opens the same email modal used by the recent-
 * campaigns grid.
 *
 * Deliberately plots real individual sends rather than a smoothed line — the
 * clustering is the signal. Hand-rolled SVG to match the other bespoke
 * visuals on this page; all geometry is linear (no trig) so server and
 * client render byte-identical markup — no hydration drift.
 */
export default function BrandDiscountTimeline({
  brandName,
  sample,
  company = null
}: Props) {
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);
  const { savedIds, toggleSave } = useSavedEmails();

  const points = useMemo<Point[]>(() => {
    const out: Point[] = [];
    for (const e of sample) {
      const dp = e.discountPercent;
      if (dp === null || !Number.isFinite(dp) || dp <= 0) continue;
      const t = new Date(e.receivedAt).getTime();
      if (!Number.isFinite(t)) continue;
      out.push({
        t,
        depth: dp,
        receivedAt: e.receivedAt,
        subject: e.subject,
        email: e
      });
    }
    // Chronological so the x-axis reads left (oldest) to right (newest).
    out.sort((a, b) => a.t - b.t);
    return out;
  }, [sample]);

  const model = useMemo(() => {
    if (points.length === 0) return null;

    const maxDepth = Math.max(...points.map((p) => p.depth));
    // Gridlines every 10%, from 0 up to the deepest discount rounded up to
    // the next multiple of 10 (so a 55% max tops out at a clean 60% line).
    const ceiling = Math.min(100, Math.max(10, Math.ceil(maxDepth / 10) * 10));
    const ticks: number[] = [];
    for (let v = 0; v <= ceiling + 0.001; v += 10) ticks.push(v);

    const minT = points[0].t;
    const maxT = points[points.length - 1].t;
    const domainMin = minT - DOMAIN_PAD_MS;
    const domainMax = maxT + DOMAIN_PAD_MS;
    const span = domainMax - domainMin;

    const xFor = (t: number) =>
      span <= 0
        ? PAD.left + INNER_W / 2
        : PAD.left + ((t - domainMin) / span) * INNER_W;
    const yFor = (depth: number) =>
      BASELINE_Y - (Math.min(depth, ceiling) / ceiling) * INNER_H;

    // Index of the deepest discount, highlighted as the peak.
    let peakIdx = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].depth > points[peakIdx].depth) peakIdx = i;
    }

    // Decide which stems get a date label. Walk left→right and keep a label
    // only when it clears the previous one, so dense clusters thin out
    // instead of overprinting. (Tooltip + click still expose every date.)
    const xs = points.map((p) => round(xFor(p.t)));
    const showDate: boolean[] = [];
    let lastLabelX = -Infinity;
    for (const x of xs) {
      const keep = x - lastLabelX >= MIN_LABEL_GAP;
      showDate.push(keep);
      if (keep) lastLabelX = x;
    }

    return { ceiling, ticks, xs, yFor, peakIdx, showDate };
  }, [points]);

  const handleOpen = useCallback(
    (email: SeasonalEmail) => {
      if (!company) return;
      setOpenEmail({
        id: email.id,
        subject: email.subject,
        preheader: email.preheader,
        companyId: company.id,
        companySlug: company.slug,
        companyName: company.name,
        companyDomain: company.domain,
        companyMarkets: company.markets,
        companyLogoUrl: company.logoUrl,
        receivedAt: email.receivedAt,
        category: email.category,
        hasGif: email.hasGif,
        hasDarkMode: email.hasDarkMode,
        discountPercent: email.discountPercent,
        promoCode: email.promoCode
      });
    },
    [company]
  );

  if (!model) return null;

  const { ceiling, ticks, xs, yFor, peakIdx, showDate } = model;
  const peak = points[peakIdx];
  const clickable = company !== null;

  return (
    <div className={styles.discountTimelineWrap}>
      <svg
        className={styles.discountChart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Discount depth over time for ${brandName}`}
      >
        {/* Horizontal depth gridlines + y labels */}
        {ticks.map((v) => {
          const gy = round(yFor(v));
          return (
            <g key={`y-${v}`}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={gy}
                y2={gy}
                className={
                  v === 0 ? styles.discountBaseline : styles.discountGrid
                }
              />
              <text
                x={PAD.left - 6}
                y={gy}
                className={styles.discountYLabel}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {Math.round(v)}%
              </text>
            </g>
          );
        })}

        {/* Per-send axis: a tick + (collision-thinned) date under each stem */}
        {points.map((p, i) => {
          const px = xs[i];
          const labelY = BASELINE_Y + 14;
          return (
            <g key={`x-${p.receivedAt}-${i}`}>
              <line
                x1={px}
                x2={px}
                y1={BASELINE_Y}
                y2={BASELINE_Y + 4}
                className={styles.discountAxisTick}
              />
              {showDate[i] ? (
                <text
                  x={px}
                  y={labelY}
                  className={styles.discountXLabel}
                  textAnchor="end"
                  transform={`rotate(-40 ${px} ${labelY})`}
                >
                  {formatShortDate(p.receivedAt)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Lollipops: one per discounted send, clickable to open the email */}
        {points.map((p, i) => {
          const px = xs[i];
          const py = round(yFor(p.depth));
          const ratio = Math.min(p.depth, ceiling) / ceiling;
          const r = round(2.4 + ratio * 2.4);
          const opacity = round(0.4 + ratio * 0.6);
          const isPeak = i === peakIdx;
          return (
            <g
              key={`${p.receivedAt}-${i}`}
              className={clickable ? styles.discountHit : undefined}
              onClick={clickable ? () => handleOpen(p.email) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpen(p.email);
                      }
                    }
                  : undefined
              }
            >
              <line
                x1={px}
                x2={px}
                y1={BASELINE_Y}
                y2={py}
                className={styles.discountStem}
                strokeOpacity={opacity}
              />
              {isPeak ? (
                <circle
                  cx={px}
                  cy={py}
                  r={r + 2.5}
                  className={styles.discountPeakRing}
                />
              ) : null}
              <circle
                cx={px}
                cy={py}
                r={r}
                className={styles.discountDot}
                fillOpacity={opacity}
              />
              {/* Invisible, larger hit target so small dots are easy to click */}
              <circle cx={px} cy={py} r={9} className={styles.discountHitArea}>
                <title>
                  {`${formatShortDate(p.receivedAt)} · ${Math.round(
                    p.depth
                  )}% off — ${p.subject}${clickable ? " (open)" : ""}`}
                </title>
              </circle>
            </g>
          );
        })}

        {/* Peak callout */}
        <text
          x={xs[peakIdx]}
          y={round(yFor(peak.depth)) - 8}
          className={styles.discountPeakLabel}
          textAnchor="middle"
        >
          {`${Math.round(peak.depth)}%`}
        </text>
      </svg>

      {openEmail ? (
        <EmailModal
          email={openEmail}
          onClose={() => setOpenEmail(null)}
          renderUrlBase="/api/explore/emails"
          detailUrlBase="/api/public/emails"
          isSaved={savedIds.has(openEmail.id)}
          onToggleSave={toggleSave}
        />
      ) : null}
    </div>
  );
}
