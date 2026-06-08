"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmailModal from "@/components/explore/EmailModal";
import type { BrandPageData } from "@/lib/brand-db";
import { formatShortDate, parseDayKey } from "@/lib/datetime";
import type { ExploreEmailCard } from "@/lib/explore-db";
import {
  analyzeSeasonalRunup,
  countEventMentions,
  SEASONAL_EVENTS,
  type SeasonalRunup
} from "@/lib/seasonal-events";
import styles from "./brand.module.css";

type SeasonalSample = BrandPageData["seasonalSample"];

type BrandIdentity = {
  id: string;
  name: string;
  domain: string | null;
  markets: string[];
  logoUrl: string | null;
};

type Props = {
  brand: BrandIdentity;
  /** Lightweight per-email rows for the brand's stats sample. */
  sample: SeasonalSample;
};

/**
 * "Event run-up" — the seasonal-timing card.
 *
 * Most brands send only a handful of emails — often just one or two —
 * about any given occasion, so the visual is built for sparse data: a
 * slim countdown lane where every matching email is a single marker
 * pinned by how many days before the event it landed. One email reads as
 * cleanly as a dozen, and clicking a marker opens that email in the same
 * detail modal Explore uses.
 *
 * The chips double as the "day" picker (matching needs keywords as well
 * as a date). All matching + math runs client-side off the shipped
 * sample, so flipping occasions re-renders with no round trip.
 */
export default function BrandSeasonalRunup({ brand, sample }: Props) {
  // Per-event mention counts drive the chip badges and the default
  // selection — we open on whichever occasion the brand talks about most.
  const mentionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of SEASONAL_EVENTS) {
      counts.set(event.id, countEventMentions(sample, event));
    }
    return counts;
  }, [sample]);

  // Most-mentioned events first so the relevant occasions lead; ties keep
  // calendar order. Zero-mention events still render (dimmed) so the user
  // can confirm "nope, they never touch Halloween".
  const orderedEvents = useMemo(() => {
    return SEASONAL_EVENTS.map((event, index) => ({ event, index }))
      .sort((a, b) => {
        const diff =
          (mentionCounts.get(b.event.id) ?? 0) - (mentionCounts.get(a.event.id) ?? 0);
        return diff !== 0 ? diff : a.index - b.index;
      })
      .map((entry) => entry.event);
  }, [mentionCounts]);

  // Default to whichever occasion the brand mentions most. The event set
  // is constant, so the selection can never become invalid.
  const [selectedId, setSelectedId] = useState(() => orderedEvents[0]?.id ?? "");

  const selectedEvent =
    SEASONAL_EVENTS.find((event) => event.id === selectedId) ?? SEASONAL_EVENTS[0];

  // Full (all-years) analysis powers the year list; the selector then
  // optionally narrows the displayed view to one occurrence.
  const fullAnalysis = useMemo(
    () => analyzeSeasonalRunup(sample, selectedEvent),
    [sample, selectedEvent]
  );
  const years = useMemo(
    () => fullAnalysis.perOccurrence.map((o) => o.year),
    [fullAnalysis]
  );

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  // Always view a single occurrence; default to the most recent year and
  // fall back to it when switching to an occasion that lacks the picked
  // year — derived rather than corrected in an effect.
  const effectiveYear =
    selectedYear !== null && years.includes(selectedYear)
      ? selectedYear
      : years[0] ?? null;

  const analysis = useMemo(
    () =>
      effectiveYear === null
        ? fullAnalysis
        : analyzeSeasonalRunup(sample, selectedEvent, { year: effectiveYear }),
    [fullAnalysis, sample, selectedEvent, effectiveYear]
  );

  // Label the flag with the most recent matched occurrence's date —
  // derived purely from the data (not "now"), so server and client HTML
  // stay identical with no hydration churn.
  const refYear = analysis.perOccurrence[0]?.year ?? null;
  const refDateLabel = useMemo(() => {
    if (refYear === null) return null;
    const { month, day } = selectedEvent.dateForYear(refYear);
    const key = `${refYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const instant = parseDayKey(key);
    return instant ? formatShortDate(instant) : null;
  }, [refYear, selectedEvent]);

  // The closest send to the day (smallest days-before) — the final push.
  const closestDays =
    analysis.emails.length > 0
      ? Math.min(...analysis.emails.map((email) => email.daysBefore))
      : null;

  // ---- Email modal (reuses the Explore detail viewer) ----
  const cardById = useMemo(() => {
    const map = new Map<string, ExploreEmailCard>();
    for (const row of sample) {
      map.set(row.id, {
        id: row.id,
        subject: row.subject,
        preheader: row.preheader,
        companyId: brand.id,
        companyName: brand.name,
        companyDomain: brand.domain,
        companyMarkets: brand.markets,
        companyLogoUrl: brand.logoUrl,
        receivedAt: row.receivedAt,
        category: row.category,
        hasGif: row.hasGif,
        hasDarkMode: row.hasDarkMode,
        discountPercent: row.discountPercent,
        promoCode: row.promoCode
      });
    }
    return map;
  }, [sample, brand]);

  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());

  // Pull the user's saved-id set once so the modal's bookmark renders in
  // the right state — same best-effort pattern as the recent-emails grid.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/explore/saved?ids=1", { credentials: "include" })
      .then(async (res) => (res.ok ? ((await res.json()) as { ids: string[] }).ids : null))
      .then((ids) => {
        if (!cancelled && ids) setSavedIds(new Set(ids));
      })
      .catch(() => {
        /* cards default to unsaved if this fails */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleSave = useCallback(
    async (email: ExploreEmailCard, next: boolean) => {
      setSavedIds((current) => {
        const updated = new Set(current);
        if (next) updated.add(email.id);
        else updated.delete(email.id);
        return updated;
      });
      try {
        const res = await fetch(`/api/explore/saved/${email.id}`, {
          method: next ? "PUT" : "DELETE",
          credentials: "include"
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
      } catch {
        setSavedIds((current) => {
          const updated = new Set(current);
          if (next) updated.delete(email.id);
          else updated.add(email.id);
          return updated;
        });
      }
    },
    []
  );

  const openById = useCallback(
    (id: string) => {
      const card = cardById.get(id);
      if (card) setOpenEmail(card);
    },
    [cardById]
  );

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardEyebrow}>Seasonal</span>
          <h2 className={styles.cardTitle}>Event run-up</h2>
          <p className={styles.cardSub}>
            Pick an occasion to see how far ahead {brand.name} starts emailing
            about it — and how many emails it sends in the lead-up. Click any
            marker to open the email.
          </p>
        </div>
        {years.length > 0 ? (
          <label className={styles.seasonalYear}>
            <span className={styles.seasonalYearLabel}>Year</span>
            <select
              className={styles.seasonalYearSelect}
              value={effectiveYear === null ? "" : String(effectiveYear)}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              aria-label="Filter run-up by year"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div
        className={styles.seasonalPicker}
        role="tablist"
        aria-label="Seasonal occasions"
      >
        {orderedEvents.map((event) => {
          const mentions = mentionCounts.get(event.id) ?? 0;
          const active = event.id === selectedEvent.id;
          return (
            <button
              key={event.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.seasonalChip}${
                active ? ` ${styles.seasonalChipActive}` : ""
              }${mentions === 0 ? ` ${styles.seasonalChipDim}` : ""}`}
              onClick={() => setSelectedId(event.id)}
            >
              <span className={styles.seasonalChipEmoji} aria-hidden="true">
                {event.emoji}
              </span>
              <span>{event.label}</span>
              {mentions > 0 ? (
                <span className={styles.seasonalChipCount}>{mentions}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {analysis.matchedCount === 0 ? (
        <div className={styles.seasonalEmpty}>
          <span className={styles.seasonalEmptyEmoji} aria-hidden="true">
            {selectedEvent.emoji}
          </span>
          <div>
            <strong>No {selectedEvent.label} emails spotted</strong>
            <p>
              Nothing in {brand.name}&apos;s last {sample.length} captured emails
              mentions {selectedEvent.label}. Try another occasion above.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.seasonalStats}>
            <div className={styles.seasonalStat}>
              <span className={styles.seasonalStatValue}>
                {formatLead(analysis.earliestLeadDays)}
              </span>
              <span className={styles.seasonalStatLabel}>head start</span>
            </div>
            <div className={styles.seasonalStatDivider} aria-hidden="true" />
            <div className={styles.seasonalStat}>
              <span className={styles.seasonalStatValue}>
                {analysis.matchedCount}
              </span>
              <span className={styles.seasonalStatLabel}>
                {analysis.matchedCount === 1 ? "email about it" : "emails about it"}
              </span>
            </div>
            <div className={styles.seasonalStatDivider} aria-hidden="true" />
            <div className={styles.seasonalStat}>
              <span className={styles.seasonalStatValue}>
                {formatLead(closestDays)}
              </span>
              <span className={styles.seasonalStatLabel}>last email</span>
            </div>
          </div>

          <RunupTimeline
            analysis={analysis}
            eventEmoji={selectedEvent.emoji}
            onOpen={openById}
          />

          <p className={styles.seasonalCaption}>
            Each marker is one email — click to open it; the flag marks{" "}
            {selectedEvent.label}
            {refDateLabel ? ` (${refDateLabel})` : ""}.
          </p>
        </>
      )}

      {openEmail ? (
        <EmailModal
          email={openEmail}
          onClose={() => setOpenEmail(null)}
          isSaved={savedIds.has(openEmail.id)}
          onToggleSave={handleToggleSave}
        />
      ) : null}
    </article>
  );
}

/* -----------------------------------------------------------------
   Countdown timeline (hand-rolled SVG, matching the dashboard's other
   bespoke charts). Built for sparse data: every email is a single
   clickable marker on a countdown lane, so one email reads as clearly
   as a dozen.

   The SVG is sized in real pixels off the measured container width and
   a fixed short height — using viewBox scaling here would stretch the
   lane to absurd heights on wide cards.
   ----------------------------------------------------------------- */

const TIMELINE_HEIGHT = 124;

function RunupTimeline({
  analysis,
  eventEmoji,
  onOpen
}: {
  analysis: SeasonalRunup;
  eventEmoji: string;
  onOpen: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const update = () => setWidth(node.clientWidth || 720);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const height = TIMELINE_HEIGHT;
  const pad = { right: 44, left: 16 };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const trackY = 84;
  const eventX = pad.left + plotW; // day 0 sits at the right edge of the lane

  const maxDays = analysis.maxWeeks * 7;
  const xForDays = (days: number) => pad.left + plotW * (1 - days / maxDays);

  // Place markers left (earliest) to right (event). When two would
  // overlap, dodge the later one up a lane and draw a stem — keeps a
  // tight cluster near the day readable instead of a single blob.
  const showLabels = analysis.emails.length <= 7;
  const minGap = showLabels ? 64 : 18;
  const ordered = [...analysis.emails].sort((a, b) => b.daysBefore - a.daysBefore);
  const laneLastX: number[] = [];
  const markers = ordered.map((email) => {
    // Keep markers out of the event flag's column at the far right, so a
    // day-of send never piles onto the emoji.
    const x = Math.min(xForDays(email.daysBefore), eventX - 26);
    let lane = 0;
    while (lane < 3 && laneLastX[lane] !== undefined && x - laneLastX[lane] < minGap) {
      lane += 1;
    }
    laneLastX[lane] = x;
    return { email, x, lane };
  });
  const laneY = (lane: number) => trackY - 20 - lane * 20;

  const labelStep = analysis.maxWeeks > 6 ? 2 : 1;
  const weekTicks = Array.from({ length: analysis.maxWeeks }, (_, w) => w + 1).filter(
    (w) => w % labelStep === 0
  );

  return (
    <div ref={wrapRef} className={styles.seasonalChartWrap}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={styles.seasonalChart}
        role="img"
        aria-label={`Run-up timeline: ${analysis.matchedCount} emails, starting up to ${analysis.earliestLeadDays} days before the event`}
      >
        <defs>
          <linearGradient id="seasonal-track" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" className={styles.seasonalTrackFrom} />
            <stop offset="1" className={styles.seasonalTrackTo} />
          </linearGradient>
        </defs>

        {/* Countdown lane */}
        <rect
          x={pad.left}
          y={trackY - 3}
          width={plotW}
          height={6}
          rx={3}
          fill="url(#seasonal-track)"
        />

        {/* Week ticks + labels */}
        {weekTicks.map((w) => {
          const x = xForDays(w * 7);
          return (
            <g key={`tick-${w}`}>
              <line
                x1={x}
                x2={x}
                y1={trackY - 5}
                y2={trackY + 5}
                className={styles.seasonalTick}
              />
              <text
                x={x}
                y={trackY + 22}
                textAnchor="middle"
                className={styles.seasonalAxisLabel}
              >
                {`${w}w`}
              </text>
            </g>
          );
        })}

        {/* Email markers (clickable) */}
        {markers.map(({ email, x, lane }, idx) => {
          const y = laneY(lane);
          const label = `${formatShortDate(email.receivedAt)} — ${
            email.daysBefore
          } day${email.daysBefore === 1 ? "" : "s"} before · ${
            email.subject || "(no subject)"
          }`;
          return (
            <g
              key={`${email.id}-${idx}`}
              className={styles.seasonalMarker}
              role="button"
              tabIndex={0}
              aria-label={`Open email: ${label}`}
              onClick={() => onOpen(email.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(email.id);
                }
              }}
            >
              <title>{label}</title>
              {lane > 0 ? (
                <line
                  x1={x}
                  x2={x}
                  y1={trackY}
                  y2={y + 6}
                  className={styles.seasonalStem}
                />
              ) : null}
              {/* Invisible, generous hit target */}
              <circle cx={x} cy={y} r={13} fill="transparent" />
              <circle cx={x} cy={y} r={5} className={styles.seasonalDot} />
              {showLabels ? (
                <text
                  x={x}
                  y={y - 11}
                  textAnchor="middle"
                  className={styles.seasonalDotLabel}
                >
                  {formatShortDate(email.receivedAt)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Event flag at day zero — a clean terminus for the lane */}
        <text
          x={eventX}
          y={trackY - 13}
          textAnchor="middle"
          className={styles.seasonalEventFlag}
        >
          {eventEmoji}
        </text>
        <text
          x={eventX}
          y={trackY + 22}
          textAnchor="middle"
          className={styles.seasonalEventLabel}
        >
          Day
        </text>
      </svg>
    </div>
  );
}

/* -----------------------------------------------------------------
   Formatting helpers
   ----------------------------------------------------------------- */

function formatLead(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "Day of";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.round(days / 7);
  return `${weeks} weeks`;
}
