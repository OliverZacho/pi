"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import EmailModal from "@/components/explore/EmailModal";
import type { BrandPageData } from "@/lib/brand-db";
import {
  endOfDayInZone,
  formatShortDate,
  parseDayKey
} from "@/lib/datetime";
import type { ExploreEmailCard } from "@/lib/explore-db";
import { buildOfferEpisodes, type OfferEpisode } from "@/lib/offer-episodes";
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
   * The full per-email sample (newest-first). We only read `receivedAt`,
   * `discountPercent` and the offer-window fields; the rest rides along so a
   * clicked dot can open the email modal.
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

/** An offer episode projected onto the chart's time axis. */
type Window = {
  episode: OfferEpisode;
  /** First send of the episode. */
  startT: number;
  /** End of the ORIGINAL stated deadline day. */
  deadlineT: number;
  /** End of the last extended day; null when never extended past deadline. */
  extendedT: number | null;
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
/** Thickness of a stated-window bar, centred on the offer's depth line. */
const WINDOW_BAR_H = 8;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** End-of-day instant (epoch ms) for a `YYYY-MM-DD` day key, platform zone. */
function dayEndTs(dayKey: string): number | null {
  const midday = parseDayKey(dayKey);
  if (!midday) return null;
  return endOfDayInZone(midday).getTime();
}

/**
 * "Sale history" — every discounted send as a floating dot at (send date,
 * depth), plus the offer's *stated* validity window drawn as a pill at the
 * same depth whenever an email actually named a deadline. No stems: dots sit
 * directly on their window so the offer reads as one object, and a dot
 * without a pill is exactly what it looks like — a send whose duration we
 * don't know. The rules are deliberately conservative:
 *
 *  - a dot with no bar means the email never said how long the offer runs —
 *    we don't guess, and a gap in sends is never drawn as an ending;
 *  - a short vertical tick marks the original stated deadline;
 *  - a dashed segment past the tick is the tracked "deadline extended"
 *    signal (explicit extension copy, a later stated end date, or a
 *    same-offer send after the deadline).
 *
 * Grouping of reminder emails into one offer comes from
 * `lib/offer-episodes`, shared with the promo card's deadline tiles so the
 * chart and the numbers can't disagree.
 *
 * The x-axis is labelled with the actual send dates (not generic months),
 * thinned only where labels would collide — hover always shows the exact
 * date. Clicking a dot opens the same email modal used by the recent-
 * campaigns grid.
 *
 * Hand-rolled SVG to match the other bespoke visuals on this page; all
 * geometry is linear (no trig) so server and client render byte-identical
 * markup — no hydration drift. The "today" marker is the one exception: it
 * depends on the clock, so it mounts client-side only via an effect.
 */
export default function BrandDiscountTimeline({
  brandName,
  sample,
  company = null
}: Props) {
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);
  const { savedIds, toggleSave } = useSavedEmails();
  // Clock-dependent, so set after mount: rendering it during SSR would make
  // server and client markup disagree and trip hydration.
  const [nowTs, setNowTs] = useState<number | null>(null);
  useEffect(() => {
    setNowTs(Date.now());
  }, []);

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

  const windows = useMemo<Window[]>(() => {
    const episodes = buildOfferEpisodes(
      sample.map((e) => ({
        id: e.id,
        receivedAt: e.receivedAt,
        discountPercent: e.discountPercent,
        promoCode: e.promoCode,
        offerEndsOn: e.offerEndsOn,
        offerIsExtension: e.offerIsExtension
      }))
    );
    const out: Window[] = [];
    for (const episode of episodes) {
      if (!episode.statedEndOn) continue;
      const startT = new Date(episode.firstSendAt).getTime();
      const deadlineT = dayEndTs(episode.statedEndOn);
      if (!Number.isFinite(startT) || deadlineT === null) continue;
      const extendedT =
        episode.extended && episode.extendedUntilOn
          ? dayEndTs(episode.extendedUntilOn)
          : null;
      out.push({
        episode,
        startT,
        deadlineT,
        extendedT: extendedT !== null && extendedT > deadlineT ? extendedT : null
      });
    }
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
    // The domain must also cover stated windows, which reach past the last
    // send whenever a deadline lies ahead of it.
    let maxT = points[points.length - 1].t;
    for (const w of windows) {
      maxT = Math.max(maxT, w.deadlineT, w.extendedT ?? -Infinity);
    }
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

    return { ceiling, ticks, xs, xFor, yFor, peakIdx, showDate, domainMin, domainMax };
  }, [points, windows]);

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

  const { ceiling, ticks, xs, xFor, yFor, peakIdx, showDate, domainMin, domainMax } =
    model;
  const peak = points[peakIdx];
  const clickable = company !== null;
  const hasWindows = windows.length > 0;
  const showToday =
    nowTs !== null && nowTs >= domainMin && nowTs <= domainMax;

  return (
    <div className={styles.discountTimelineWrap}>
      <svg
        className={styles.discountChart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={
          hasWindows
            ? `Discount depth and stated offer windows over time for ${brandName}`
            : `Discount depth over time for ${brandName}`
        }
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

        {/* Stated offer windows — drawn first so lollipops sit on top.
            A bar only exists where an email named a deadline; the tick is
            the original promise, the dashed tail is the tracked extension. */}
        {windows.map((w, i) => {
          const y = round(yFor(w.episode.depth));
          const x1 = round(xFor(w.startT));
          const x2 = round(xFor(w.deadlineT));
          const barW = round(Math.max(x2 - x1, 2));
          const deadlineDate = parseDayKey(w.episode.statedEndOn ?? "");
          const deadlineLabel = deadlineDate
            ? formatShortDate(deadlineDate)
            : w.episode.statedEndOn ?? "";
          return (
            <g key={`w-${w.episode.firstSendAt}-${i}`}>
              <rect
                x={x1}
                y={round(y - WINDOW_BAR_H / 2)}
                width={barW}
                height={WINDOW_BAR_H}
                rx={WINDOW_BAR_H / 2}
                className={styles.discountWindowBar}
              >
                <title>{`Offer stated valid until ${deadlineLabel}`}</title>
              </rect>
              {w.extendedT !== null ? (
                <>
                  <rect
                    x={x2}
                    y={round(y - WINDOW_BAR_H / 2)}
                    width={round(Math.max(xFor(w.extendedT) - x2, 2))}
                    height={WINDOW_BAR_H}
                    rx={WINDOW_BAR_H / 2}
                    className={styles.discountExtensionBar}
                  >
                    <title>
                      {`Extended ${
                        w.episode.extensionDays > 0
                          ? `${w.episode.extensionDays} day${
                              w.episode.extensionDays === 1 ? "" : "s"
                            } `
                          : ""
                      }past the stated ${deadlineLabel} deadline`}
                    </title>
                  </rect>
                  {w.episode.extensionDays > 0 ? (
                    <text
                      x={round((x2 + xFor(w.extendedT)) / 2)}
                      y={round(y - 9)}
                      className={styles.discountExtensionLabel}
                      textAnchor="middle"
                    >
                      {`+${w.episode.extensionDays}d`}
                    </text>
                  ) : null}
                </>
              ) : null}
              <line
                x1={x2}
                x2={x2}
                y1={round(y - 9)}
                y2={round(y + 9)}
                className={styles.discountDeadlineTick}
              >
                <title>{`Stated deadline ${deadlineLabel}`}</title>
              </line>
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

        {/* One floating dot per discounted send, clickable to open the email */}
        {points.map((p, i) => {
          const px = xs[i];
          const py = round(yFor(p.depth));
          const ratio = Math.min(p.depth, ceiling) / ceiling;
          const r = round(3.4 + ratio * 1.2);
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
              {isPeak ? (
                <circle
                  cx={px}
                  cy={py}
                  r={r + 3}
                  className={styles.discountPeakRing}
                />
              ) : null}
              <circle cx={px} cy={py} r={r} className={styles.discountDot} />
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

        {/* Today marker — client-only (see component docblock) */}
        {showToday ? (
          <g>
            <line
              x1={round(xFor(nowTs))}
              x2={round(xFor(nowTs))}
              y1={PAD.top}
              y2={BASELINE_Y}
              className={styles.discountTodayLine}
            />
            <text
              x={round(xFor(nowTs))}
              y={PAD.top + 2}
              className={styles.discountTodayLabel}
              textAnchor={xFor(nowTs) > WIDTH - PAD.right - 34 ? "end" : "start"}
              dominantBaseline="hanging"
              dx={xFor(nowTs) > WIDTH - PAD.right - 34 ? -4 : 4}
            >
              today
            </text>
          </g>
        ) : null}
      </svg>

      {hasWindows ? (
        <div className={styles.discountLegend} aria-hidden="true">
          <span className={styles.discountLegendItem}>
            <span className={styles.discountLegendDot} />
            Discount email
          </span>
          <span className={styles.discountLegendItem}>
            <span className={styles.discountLegendBar} />
            Stated offer window
          </span>
          <span className={styles.discountLegendItem}>
            <span className={styles.discountLegendTick} />
            Deadline
          </span>
          <span className={styles.discountLegendItem}>
            <span className={styles.discountLegendExt} />
            Extended
          </span>
        </div>
      ) : null}

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
