"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EMAIL_CATEGORY_LABELS, type EmailCategory } from "@/lib/admin-types";
import {
  CAMPAIGN_PHASES,
  CAMPAIGN_PHASE_LABELS,
  DISCOUNT_FIGURE_MIN_BRANDS,
  DISCOUNT_FIGURE_MIN_SHARE,
  isEligibleForEventDetection,
  isEventDetectionStale,
  type CampaignPhase,
  type CollectionEventDetection
} from "@/lib/collection-event-shared";
import { formatMonthShort, formatShortDate, parseDayKey } from "@/lib/datetime";
import type { ExploreEmailCard } from "@/lib/explore-db";
import styles from "./collections.module.css";

/**
 * Event detection banner + insights for a collection.
 *
 * Lifecycle: when the collection looks event-shaped and no fresh cached
 * detection exists, this component silently POSTs to
 * `/api/collections/[id]/event-detection`. A successful "detected"
 * result shows a confirm banner; confirming unlocks the figures below,
 * all computed client-side from the emails the page already has:
 *
 *  1. Brand run-up swimlane — who moves first, who waits for the doors.
 *  2. Volume crescendo — emails per day across the run-up.
 *  3. Campaign phase strip — the announce → remind → open arc, as
 *     labelled by the model during detection.
 *  4. Category mix per week — how invitations give way to launches.
 *  5. Discount per brand — how deep each brand cuts price. Only shown
 *     when the vast majority of emails carry a parsed % off.
 */

type Props = {
  collectionId: string;
  initialDetection: CollectionEventDetection | null;
  emails: ExploreEmailCard[];
  /**
   * Deepest discount per brand (by company name) over the trailing 12
   * months, across the whole archive. Powers the "deepest deal" diamond
   * in the discount figure. Optional — falls back to the in-collection
   * deepest when a brand has no benchmark.
   */
  brandDiscountBenchmarks?: Record<string, number>;
  /**
   * `companies.id`s the viewer follows among the brands in this
   * collection. When non-empty, the insights card offers a toggle to
   * narrow every figure and stat to just these brands.
   */
  followedCompanyIds?: string[];
  onOpenEmail: (email: ExploreEmailCard) => void;
  /**
   * True while the parent's EmailModal is open on top of us. The
   * insights pop-up ignores Escape in that case so one keypress closes
   * only the topmost layer.
   */
  emailModalOpen: boolean;
};

const PHASE_COLORS: Record<CampaignPhase, string> = {
  save_the_date: "#6366f1",
  programme: "#0ea5e9",
  reminder: "#f59e0b",
  day_of: "#10b981",
  wrap_up: "#64748b",
  other: "#cbd5e1"
};

const CATEGORY_COLORS: Record<string, string> = {
  event: "#6366f1",
  product_launch: "#0ea5e9",
  sale: "#ef4444",
  seasonal: "#f59e0b",
  products: "#14b8a6",
  content: "#10b981"
};
const CATEGORY_FALLBACK_COLOR = "#cbd5e1";

const MAX_SWIMLANE_BRANDS = 16;
const TOP_CATEGORY_COUNT = 4;

// Discount figure gating (DISCOUNT_FIGURE_MIN_SHARE / _MIN_BRANDS) lives in
// collection-event-shared so the server can run the same check before
// fetching the 12-month benchmark. This is purely a render cap.
const MAX_DISCOUNT_BRANDS = 16;

/**
 * Should this page view trigger a detection POST? Yes when the
 * collection qualifies and there's either no cached result or a stale
 * one — but never re-ask after an explicit dismissal.
 */
function needsDetectionRun(
  detection: CollectionEventDetection | null,
  emails: ExploreEmailCard[]
): boolean {
  if (emails.length === 0 || !isEligibleForEventDetection(emails)) return false;
  return (
    detection === null ||
    (detection.confirmed !== false &&
      isEventDetectionStale(detection, emails.length))
  );
}

export default function CollectionEventInsights({
  collectionId,
  initialDetection,
  emails,
  brandDiscountBenchmarks,
  followedCompanyIds,
  onOpenEmail,
  emailModalOpen
}: Props) {
  const [detection, setDetection] = useState<CollectionEventDetection | null>(
    initialDetection
  );
  // Lazily seeded so the "checking…" hint renders on the very first
  // paint, without a setState call inside the effect below.
  const [analyzing, setAnalyzing] = useState(() =>
    needsDetectionRun(initialDetection, emails)
  );
  const [responding, setResponding] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const requestedRef = useRef(false);

  // Fire the (cheap, cached) detection once per page view when the
  // collection qualifies and we either have nothing cached or the cache
  // has gone stale. Dismissals are final — never re-ask.
  useEffect(() => {
    if (requestedRef.current) return;
    if (!needsDetectionRun(detection, emails)) return;

    requestedRef.current = true;
    fetch(`/api/collections/${collectionId}/event-detection`, {
      method: "POST",
      credentials: "include"
    })
      .then(async (res) =>
        res.ok
          ? ((await res.json()) as { detection: CollectionEventDetection | null })
          : null
      )
      .then((body) => {
        if (body?.detection) setDetection(body.detection);
      })
      .catch(() => {
        /* silent — the page works fine without insights */
      })
      .finally(() => setAnalyzing(false));
  }, [collectionId, detection, emails]);

  async function respond(confirmed: boolean) {
    if (!detection || responding) return;
    setResponding(true);
    const previous = detection;
    setDetection({ ...detection, confirmed });
    if (confirmed) setPopupOpen(true);
    try {
      const res = await fetch(
        `/api/collections/${collectionId}/event-detection`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed })
        }
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
    } catch {
      setDetection(previous);
    } finally {
      setResponding(false);
    }
  }

  if (analyzing && !detection) {
    return (
      <div className={styles.insightsHint} role="status">
        <span className={styles.insightsHintSpinner} aria-hidden="true" />
        <span>Checking whether this collection revolves around an event…</span>
      </div>
    );
  }

  if (!detection || detection.status !== "detected" || !detection.event) {
    return null;
  }

  if (detection.confirmed === false) return null;

  if (detection.confirmed === null) {
    return (
      <div className={styles.insightsBanner}>
        <span className={styles.insightsBannerIcon} aria-hidden="true">
          <CalendarSparkIcon />
        </span>
        <div className={styles.insightsBannerBody}>
          <p className={styles.insightsBannerTitle}>
            Event detected in this collection
          </p>
          <p className={styles.insightsBannerText}>
            {detection.event.userMessage} Confirm to see how every brand in
            this collection times its emails around the event.
          </p>
          <div className={styles.insightsBannerActions}>
            <button
              type="button"
              className={styles.insightsButton}
              onClick={() => void respond(true)}
              disabled={responding}
            >
              Show insights
            </button>
            <button
              type="button"
              className={`${styles.insightsButton} ${styles.insightsButtonGhost}`}
              onClick={() => void respond(false)}
              disabled={responding}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  const eventDates = formatEventDates(
    detection.event.startDate,
    detection.event.endDate
  );

  return (
    <>
      <div className={styles.insightsSummaryRow}>
        <span className={styles.insightsBannerIcon} aria-hidden="true">
          <CalendarSparkIcon />
        </span>
        <p className={styles.insightsSummaryText}>
          <strong>{detection.event.name}</strong>
          {eventDates ? ` — ${eventDates}` : ""}
          {detection.event.location ? ` · ${detection.event.location}` : ""}
        </p>
        <button
          type="button"
          className={styles.insightsButton}
          onClick={() => setPopupOpen(true)}
        >
          View insights
        </button>
      </div>
      {popupOpen ? (
        <InsightsPopup
          title={`${detection.event.name} insights`}
          emailModalOpen={emailModalOpen}
          onClose={() => setPopupOpen(false)}
        >
          <EventInsightsCard
            detection={detection}
            emails={emails}
            brandDiscountBenchmarks={brandDiscountBenchmarks}
            followedCompanyIds={followedCompanyIds}
            onOpenEmail={onOpenEmail}
            inModal
          />
        </InsightsPopup>
      ) : null}
    </>
  );
}

/* -----------------------------------------------------------------
   Pop-up shell — sits below the EmailModal (z-index wise) so clicking
   a marker stacks the email viewer on top of the figures.
   ----------------------------------------------------------------- */

function InsightsPopup({
  title,
  emailModalOpen,
  onClose,
  children
}: {
  title: string;
  emailModalOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Lock body scroll while open. The EmailModal stacked on top applies
  // (and restores) its own lock, so the two compose cleanly.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !emailModalOpen) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [emailModalOpen, onClose]);

  return (
    <div
      className={styles.insightsModalBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.insightsModalDialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          type="button"
          className={styles.insightsModalClose}
          onClick={onClose}
          aria-label="Close insights"
        >
          <CloseIcon />
        </button>
        <div className={styles.insightsModalBody}>{children}</div>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
   Insights card — shared timeline model + the four figures
   ----------------------------------------------------------------- */

type TimelineEmail = {
  card: ExploreEmailCard;
  dayIdx: number;
};

type TimelineModel = {
  windowStart: string;
  totalDays: number;
  eventStartIdx: number | null;
  eventEndIdx: number | null;
  /** Every brand, earliest sender first — the figure decides how many to show. */
  brands: Array<{ name: string; items: TimelineEmail[] }>;
  dailyCounts: number[];
  maxDaily: number;
  phaseLanes: Array<{ phase: CampaignPhase; items: TimelineEmail[] }>;
  weeks: Array<{ startIdx: number; counts: Map<string, number>; total: number }>;
  topCategories: string[];
  /**
   * Per-brand discount depth, or null when discounting isn't the
   * collection's throughline (see DISCOUNT_FIGURE_MIN_SHARE). Brands are
   * sorted deepest average first.
   */
  discount: {
    /**
     * Per brand: `avg`/`max` are this collection's emails; `benchmarkMax`
     * is the brand's deepest discount over the trailing 12 months across
     * the whole archive (falls back to `max` when no benchmark exists).
     */
    brands: Array<{
      name: string;
      avg: number;
      max: number;
      count: number;
      benchmarkMax: number;
    }>;
    share: number;
    emailsWithDiscount: number;
    maxObserved: number;
  } | null;
  stats: {
    brandCount: number;
    emailCount: number;
    headStartDays: number | null;
    busiestDay: string | null;
    busiestCount: number;
  };
};

function EventInsightsCard({
  detection,
  emails,
  brandDiscountBenchmarks,
  followedCompanyIds,
  onOpenEmail,
  inModal = false
}: {
  detection: CollectionEventDetection;
  emails: ExploreEmailCard[];
  brandDiscountBenchmarks?: Record<string, number>;
  followedCompanyIds?: string[];
  onOpenEmail: (email: ExploreEmailCard) => void;
  /** Drops the glass-card chrome when rendered inside the pop-up. */
  inModal?: boolean;
}) {
  const event = detection.event!;

  // "Only brands I follow" filter. Off by default; only offered when the
  // viewer actually follows at least one brand represented here, so the
  // toggle can never blank the whole view.
  const followedSet = useMemo(
    () => new Set(followedCompanyIds ?? []),
    [followedCompanyIds]
  );
  const [followedOnly, setFollowedOnly] = useState(false);
  const followedEmailCount = useMemo(
    () =>
      followedSet.size === 0
        ? 0
        : emails.filter(
            (email) => email.companyId && followedSet.has(email.companyId)
          ).length,
    [emails, followedSet]
  );
  const canFilter = followedEmailCount > 0;
  const filterActive = followedOnly && canFilter;

  const visibleEmails = useMemo(
    () =>
      filterActive
        ? emails.filter(
            (email) => email.companyId && followedSet.has(email.companyId)
          )
        : emails,
    [filterActive, emails, followedSet]
  );

  const model = useMemo(
    () => buildTimelineModel(detection, visibleEmails, brandDiscountBenchmarks),
    [detection, visibleEmails, brandDiscountBenchmarks]
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  // Instant cursor-following tooltip — far snappier than the native <title>,
  // which the browser delays ~1s before showing.
  const [tip, setTip] = useState<{ x: number; y: number; label: string } | null>(
    null
  );
  const showTip = (label: string, x: number, y: number) =>
    setTip({ x, y, label });
  const hideTip = () => setTip(null);
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const update = () => setWidth(node.clientWidth || 720);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!model) return null;

  const eventDates = formatEventDates(event.startDate, event.endDate);

  return (
    <section
      className={`${styles.insightsCard}${inModal ? ` ${styles.insightsCardModal}` : ""}`}
      aria-label="Event insights"
    >
      <span className={styles.insightsEyebrow}>Event insights</span>
      <h2 className={styles.insightsTitle}>
        {event.name}
        {eventDates ? ` — ${eventDates}` : ""}
        {event.location ? ` · ${event.location}` : ""}
      </h2>
      <p className={styles.insightsSub}>
        How the {model.stats.brandCount}{" "}
        {filterActive ? "brands you follow" : "brands in this collection"} time
        their emails around {event.name}. Click any marker to open the email.
      </p>

      {canFilter ? (
        <div className={styles.insightsFilterRow}>
          <button
            type="button"
            role="switch"
            aria-checked={filterActive}
            className={`${styles.insightsFollowToggle}${
              filterActive ? ` ${styles.insightsFollowToggleActive}` : ""
            }`}
            onClick={() => setFollowedOnly((current) => !current)}
          >
            <span className={styles.insightsFollowToggleTrack} aria-hidden="true">
              <span className={styles.insightsFollowToggleThumb} />
            </span>
            <span>Show only brands I follow</span>
          </button>
        </div>
      ) : null}

      <div className={styles.insightsStats}>
        <div className={styles.insightsStat}>
          <span className={styles.insightsStatValue}>
            {model.stats.brandCount}
          </span>
          <span className={styles.insightsStatLabel}>brands sending</span>
        </div>
        <div className={styles.insightsStatDivider} aria-hidden="true" />
        <div className={styles.insightsStat}>
          <span className={styles.insightsStatValue}>
            {model.stats.emailCount}
          </span>
          <span className={styles.insightsStatLabel}>emails in the run-up</span>
        </div>
        <div className={styles.insightsStatDivider} aria-hidden="true" />
        <div className={styles.insightsStat}>
          <span className={styles.insightsStatValue}>
            {model.stats.headStartDays === null
              ? "—"
              : formatLead(model.stats.headStartDays)}
          </span>
          <span className={styles.insightsStatLabel}>earliest head start</span>
        </div>
        <div className={styles.insightsStatDivider} aria-hidden="true" />
        <div className={styles.insightsStat}>
          <span className={styles.insightsStatValue}>
            {model.stats.busiestDay ?? "—"}
          </span>
          <span className={styles.insightsStatLabel}>
            busiest day{model.stats.busiestCount > 0 ? ` · ${model.stats.busiestCount} emails` : ""}
          </span>
        </div>
      </div>

      <div ref={wrapRef} className={styles.insightsChartWrap}>
        <figure className={styles.insightsFigure} style={{ margin: 0 }}>
          <h3 className={styles.insightsFigureTitle}>Who moves first</h3>
          <p className={styles.insightsFigureCaption}>
            One lane per brand, earliest sender on top — each dot is one
            email.
          </p>
          <SwimlaneFigure
            model={model}
            width={width}
            onOpenEmail={onOpenEmail}
            onHover={showTip}
            onLeave={hideTip}
          />
        </figure>

        <figure className={styles.insightsFigure} style={{ marginLeft: 0, marginRight: 0 }}>
          <h3 className={styles.insightsFigureTitle}>Volume crescendo</h3>
          <p className={styles.insightsFigureCaption}>
            Emails per day across the run-up — the noise you&apos;d compete
            with on each day.
          </p>
          <CrescendoFigure model={model} width={width} />
        </figure>

        <figure className={styles.insightsFigure} style={{ marginLeft: 0, marginRight: 0 }}>
          <h3 className={styles.insightsFigureTitle}>Campaign phases</h3>
          <p className={styles.insightsFigureCaption}>
            Each email labelled by the role it plays: announce, reveal the
            programme, remind, open the doors, wrap up.
          </p>
          <PhaseStripFigure
            model={model}
            width={width}
            onOpenEmail={onOpenEmail}
            onHover={showTip}
            onLeave={hideTip}
          />
        </figure>

        <figure className={styles.insightsFigure} style={{ marginLeft: 0, marginRight: 0 }}>
          <h3 className={styles.insightsFigureTitle}>Category mix over time</h3>
          <p className={styles.insightsFigureCaption}>
            Weekly email volume split by category — watch invitations give
            way to launches as the event nears.
          </p>
          <CategoryMixFigure model={model} width={width} />
        </figure>

        {model.discount ? (
          <figure className={styles.insightsFigure} style={{ marginLeft: 0, marginRight: 0 }}>
            <h3 className={styles.insightsFigureTitle}>How much each brand discounts</h3>
            <p className={styles.insightsFigureCaption}>
              {Math.round(model.discount.share * 100)}% of these emails carry a
              price cut. Bars show each brand&apos;s average discount in this
              collection; the diamond marks its deepest deal anywhere in the
              past 12 months.
            </p>
            <DiscountFigure model={model} width={width} />
          </figure>
        ) : null}
      </div>

      {tip ? (
        <div
          className={styles.insightsTooltip}
          style={{ left: tip.x, top: tip.y }}
          role="presentation"
        >
          {tip.label}
        </div>
      ) : null}
    </section>
  );
}

/* -----------------------------------------------------------------
   Timeline model
   ----------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000;

function dayKeyOf(iso: string): string {
  return iso.slice(0, 10);
}

function dayUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

function diffDays(fromKey: string, toKey: string): number {
  return Math.round((dayUtc(toKey) - dayUtc(fromKey)) / MS_PER_DAY);
}

function addDays(key: string, days: number): string {
  return new Date(dayUtc(key) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function shortDayLabel(windowStart: string, dayIdx: number): string {
  const instant = parseDayKey(addDays(windowStart, dayIdx));
  return instant ? formatShortDate(instant) : "";
}

/** Day-of-month only ("13"), for the dense day row of the axis. */
function dayNumberLabel(windowStart: string, dayIdx: number): string {
  return String(Number(addDays(windowStart, dayIdx).slice(8, 10)));
}

/** Exported for tests — pure view-model math, no React. */
export function buildTimelineModel(
  detection: CollectionEventDetection,
  emails: ExploreEmailCard[],
  brandDiscountBenchmarks: Record<string, number> = {}
): TimelineModel | null {
  const event = detection.event;
  if (!event || emails.length === 0) return null;

  const sorted = [...emails].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt)
  );
  const firstDay = dayKeyOf(sorted[0].receivedAt);
  const lastDay = dayKeyOf(sorted[sorted.length - 1].receivedAt);
  const eventEndDate = event.endDate ?? event.startDate;

  const windowStart = firstDay;
  const windowEnd =
    eventEndDate && diffDays(windowStart, eventEndDate) > diffDays(windowStart, lastDay)
      ? eventEndDate
      : lastDay;
  const totalDays = diffDays(windowStart, windowEnd) + 1;
  if (totalDays < 1 || totalDays > 400) return null;

  const items: TimelineEmail[] = sorted.map((card) => ({
    card,
    dayIdx: diffDays(windowStart, dayKeyOf(card.receivedAt))
  }));

  const clampIdx = (idx: number) => Math.max(0, Math.min(totalDays - 1, idx));
  const eventStartIdx = event.startDate
    ? clampIdx(diffDays(windowStart, event.startDate))
    : null;
  const eventEndIdx = eventEndDate
    ? clampIdx(diffDays(windowStart, eventEndDate))
    : null;

  // Brands, earliest first sender on top; ties broken by volume.
  const brandMap = new Map<string, TimelineEmail[]>();
  for (const item of items) {
    const list = brandMap.get(item.card.companyName);
    if (list) list.push(item);
    else brandMap.set(item.card.companyName, [item]);
  }
  const brands = Array.from(brandMap.entries())
    .map(([name, list]) => ({ name, items: list }))
    .sort(
      (a, b) =>
        a.items[0].dayIdx - b.items[0].dayIdx || b.items.length - a.items.length
    );

  const dailyCounts = new Array<number>(totalDays).fill(0);
  for (const item of items) dailyCounts[item.dayIdx] += 1;
  const maxDaily = Math.max(...dailyCounts, 1);

  // Phase lanes in canonical campaign order; unlabeled emails fall into
  // "other" so every email shows up somewhere.
  const phaseMap = new Map<CampaignPhase, TimelineEmail[]>();
  for (const item of items) {
    const phase: CampaignPhase = detection.phases[item.card.id] ?? "other";
    const list = phaseMap.get(phase);
    if (list) list.push(item);
    else phaseMap.set(phase, [item]);
  }
  const phaseLanes = CAMPAIGN_PHASES.filter((phase) => phaseMap.has(phase)).map(
    (phase) => ({ phase, items: phaseMap.get(phase)! })
  );

  // Weekly category mix. Weeks are 7-day chunks from the window start —
  // good enough for "the mix shifts as the event nears" without ISO-week
  // bookkeeping.
  const weekCount = Math.ceil(totalDays / 7);
  const weeks = Array.from({ length: weekCount }, (_, i) => ({
    startIdx: i * 7,
    counts: new Map<string, number>(),
    total: 0
  }));
  const categoryTotals = new Map<string, number>();
  for (const item of items) {
    const week = weeks[Math.floor(item.dayIdx / 7)];
    week.counts.set(item.card.category, (week.counts.get(item.card.category) ?? 0) + 1);
    week.total += 1;
    categoryTotals.set(
      item.card.category,
      (categoryTotals.get(item.card.category) ?? 0) + 1
    );
  }
  const topCategories = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_CATEGORY_COUNT)
    .map(([category]) => category);

  const headStartDays =
    event.startDate !== null
      ? Math.max(0, diffDays(firstDay, event.startDate))
      : null;

  let busiestIdx = 0;
  for (let i = 1; i < totalDays; i += 1) {
    if (dailyCounts[i] > dailyCounts[busiestIdx]) busiestIdx = i;
  }

  // Per-brand discount depth. We look at the parsed `discountPercent` on
  // every email regardless of category — a "% off" in a launch or
  // seasonal email counts just as much as one in a "sale" email.
  let emailsWithDiscount = 0;
  const brandDiscountMap = new Map<string, number[]>();
  for (const item of items) {
    const pct = item.card.discountPercent;
    if (pct !== null && Number.isFinite(pct) && pct > 0) {
      emailsWithDiscount += 1;
      const list = brandDiscountMap.get(item.card.companyName);
      if (list) list.push(pct);
      else brandDiscountMap.set(item.card.companyName, [pct]);
    }
  }
  const discountShare = items.length > 0 ? emailsWithDiscount / items.length : 0;
  const discountBrands = Array.from(brandDiscountMap.entries())
    .map(([name, vals]) => {
      const max = Math.max(...vals);
      // The 12-month benchmark should never read shallower than what this
      // collection already shows, so floor it at the in-collection max.
      const benchmarkMax = Math.max(brandDiscountBenchmarks[name] ?? 0, max);
      return {
        name,
        avg: vals.reduce((sum, v) => sum + v, 0) / vals.length,
        max,
        count: vals.length,
        benchmarkMax
      };
    })
    .sort((a, b) => b.avg - a.avg || b.benchmarkMax - a.benchmarkMax);
  const discount =
    discountShare >= DISCOUNT_FIGURE_MIN_SHARE &&
    discountBrands.length >= DISCOUNT_FIGURE_MIN_BRANDS
      ? {
          brands: discountBrands,
          share: discountShare,
          emailsWithDiscount,
          // Axis must reach the deepest diamond, not just the deepest bar.
          maxObserved: Math.max(...discountBrands.map((b) => b.benchmarkMax))
        }
      : null;

  return {
    windowStart,
    totalDays,
    eventStartIdx,
    eventEndIdx,
    brands,
    dailyCounts,
    maxDaily,
    phaseLanes,
    weeks,
    topCategories,
    discount,
    stats: {
      brandCount: brandMap.size,
      emailCount: items.length,
      headStartDays,
      busiestDay:
        dailyCounts[busiestIdx] > 0
          ? shortDayLabel(windowStart, busiestIdx)
          : null,
      busiestCount: dailyCounts[busiestIdx]
    }
  };
}

/* -----------------------------------------------------------------
   Shared SVG pieces
   ----------------------------------------------------------------- */

type Scale = {
  x: (dayIdx: number) => number;
  bandX: (dayIdx: number) => number;
  padLeft: number;
  plotW: number;
};

function makeScale(model: TimelineModel, width: number, padLeft: number, padRight: number): Scale {
  const plotW = Math.max(60, width - padLeft - padRight);
  return {
    // Marker position: center of the day cell.
    x: (dayIdx) => padLeft + ((dayIdx + 0.5) / model.totalDays) * plotW,
    // Band/bar position: left edge of the day cell.
    bandX: (dayIdx) => padLeft + (dayIdx / model.totalDays) * plotW,
    padLeft,
    plotW
  };
}

/**
 * Day-number ticks at the densest spacing that keeps two-digit labels from
 * colliding — every day when there's room, every 2nd/3rd day when tighter.
 */
function dayTicks(model: TimelineModel, cellW: number): number[] {
  const stepDays = Math.max(1, Math.ceil(22 / Math.max(1, cellW)));
  const ticks: number[] = [];
  for (let idx = 0; idx < model.totalDays; idx += stepDays) {
    ticks.push(idx);
  }
  return ticks;
}

/** Contiguous calendar-month spans within the window, for the month row. */
function monthSegments(
  model: TimelineModel
): { startIdx: number; endIdx: number; key: string }[] {
  const segments: { startIdx: number; endIdx: number; key: string }[] = [];
  for (let idx = 0; idx < model.totalDays; idx += 1) {
    const key = addDays(model.windowStart, idx);
    const last = segments[segments.length - 1];
    if (last && key.slice(0, 7) === last.key.slice(0, 7)) {
      last.endIdx = idx;
    } else {
      segments.push({ startIdx: idx, endIdx: idx, key });
    }
  }
  return segments;
}

function EventBand({
  model,
  scale,
  top,
  bottom,
  showLabel
}: {
  model: TimelineModel;
  scale: Scale;
  top: number;
  bottom: number;
  showLabel?: boolean;
}) {
  if (model.eventStartIdx === null || model.eventEndIdx === null) return null;
  const x0 = scale.bandX(model.eventStartIdx);
  const x1 = scale.bandX(model.eventEndIdx + 1);
  return (
    <g aria-hidden="true">
      <rect
        x={x0}
        y={top}
        width={Math.max(2, x1 - x0)}
        height={bottom - top}
        rx={4}
        className={styles.insightsEventBand}
      />
      <line
        x1={x0}
        x2={x0}
        y1={top}
        y2={bottom}
        className={styles.insightsEventBandEdge}
      />
      {showLabel ? (
        <text
          x={(x0 + x1) / 2}
          y={top - 5}
          textAnchor="middle"
          className={styles.insightsEventBandLabel}
        >
          Event days
        </text>
      ) : null}
    </g>
  );
}

function DateAxis({
  model,
  scale,
  y
}: {
  model: TimelineModel;
  scale: Scale;
  y: number;
}) {
  const cellW = scale.plotW / model.totalDays;
  return (
    <g aria-hidden="true">
      {dayTicks(model, cellW).map((idx) => (
        <g key={idx}>
          <line
            x1={scale.x(idx)}
            x2={scale.x(idx)}
            y1={y - 4}
            y2={y}
            className={styles.insightsAxisTick}
          />
          <text
            x={scale.x(idx)}
            y={y + 12}
            textAnchor="middle"
            className={styles.insightsAxisLabel}
          >
            {dayNumberLabel(model.windowStart, idx)}
          </text>
        </g>
      ))}
      {monthSegments(model).map((seg) => {
        const left = scale.bandX(seg.startIdx);
        const right = scale.bandX(seg.endIdx + 1);
        // Skip months too narrow to label without crowding their neighbour.
        if (right - left < 26) return null;
        return (
          <text
            key={seg.startIdx}
            x={(left + right) / 2}
            y={y + 26}
            textAnchor="middle"
            className={styles.insightsAxisMonthLabel}
          >
            {formatMonthShort(parseDayKey(seg.key))}
          </text>
        );
      })}
    </g>
  );
}

function EmailMarker({
  item,
  cx,
  cy,
  color,
  onOpenEmail,
  onHover,
  onLeave
}: {
  item: TimelineEmail;
  cx: number;
  cy: number;
  color: string;
  onOpenEmail: (email: ExploreEmailCard) => void;
  onHover?: (label: string, x: number, y: number) => void;
  onLeave?: () => void;
}) {
  const label = `${formatShortDate(item.card.receivedAt)} · ${item.card.companyName} — ${item.card.subject || "(no subject)"}`;
  return (
    <g
      className={styles.insightsMarker}
      role="button"
      tabIndex={0}
      aria-label={`Open email: ${label}`}
      onClick={() => onOpenEmail(item.card)}
      onMouseEnter={(e) => onHover?.(label, e.clientX, e.clientY)}
      onMouseMove={(e) => onHover?.(label, e.clientX, e.clientY)}
      onMouseLeave={() => onLeave?.()}
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onHover?.(label, r.left + r.width / 2, r.top + r.height / 2);
      }}
      onBlur={() => onLeave?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenEmail(item.card);
        }
      }}
    >
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
      <circle cx={cx} cy={cy} r={4.5} fill={color} className={styles.insightsDot} />
    </g>
  );
}

/* -----------------------------------------------------------------
   Figure 1 — brand swimlane
   ----------------------------------------------------------------- */

const LANE_HEIGHT = 24;
const LABEL_GUTTER = 118;

function SwimlaneFigure({
  model,
  width,
  onOpenEmail,
  onHover,
  onLeave
}: {
  model: TimelineModel;
  width: number;
  onOpenEmail: (email: ExploreEmailCard) => void;
  onHover?: (label: string, x: number, y: number) => void;
  onLeave?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const scale = makeScale(model, width, LABEL_GUTTER, 12);
  const collapsible = model.brands.length > MAX_SWIMLANE_BRANDS;
  const lanes =
    collapsible && !expanded
      ? model.brands.slice(0, MAX_SWIMLANE_BRANDS)
      : model.brands;
  const hiddenBrandCount = model.brands.length - lanes.length;
  const topPad = 16;
  const lanesBottom = topPad + lanes.length * LANE_HEIGHT;
  const extraRow = collapsible ? 18 : 0;
  const height = lanesBottom + extraRow + 40;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={styles.insightsChart}
      role="img"
      aria-label={`Brand send timelines: ${model.stats.brandCount} brands across ${model.totalDays} days`}
    >
      <EventBand model={model} scale={scale} top={topPad - 8} bottom={lanesBottom} showLabel />
      {lanes.map((brand, laneIdx) => {
        const cy = topPad + laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;
        // Same-brand same-day sends would land on the same pixel — nudge
        // repeats sideways so they stay countable.
        const seenPerDay = new Map<number, number>();
        return (
          <g key={brand.name}>
            <text
              x={LABEL_GUTTER - 10}
              y={cy + 3.5}
              textAnchor="end"
              className={styles.insightsLaneLabel}
            >
              {truncateLabel(brand.name, 18)}
            </text>
            <line
              x1={LABEL_GUTTER}
              x2={LABEL_GUTTER + scale.plotW}
              y1={cy}
              y2={cy}
              className={styles.insightsLaneTrack}
            />
            {brand.items.map((item, i) => {
              const dupes = seenPerDay.get(item.dayIdx) ?? 0;
              seenPerDay.set(item.dayIdx, dupes + 1);
              return (
                <EmailMarker
                  key={`${item.card.id}-${i}`}
                  item={item}
                  cx={scale.x(item.dayIdx) + dupes * 5}
                  cy={cy}
                  color="#0f172a"
                  onOpenEmail={onOpenEmail}
                  onHover={onHover}
                  onLeave={onLeave}
                />
              );
            })}
          </g>
        );
      })}
      {collapsible ? (
        <text
          x={LABEL_GUTTER - 10}
          y={lanesBottom + 13}
          textAnchor="end"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? "Show fewer brands"
              : `Show ${hiddenBrandCount} more brands`
          }
          className={styles.insightsMoreToggle}
          onClick={() => setExpanded((current) => !current)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded((current) => !current);
            }
          }}
        >
          {expanded ? "Show fewer" : `+${hiddenBrandCount} more`}
        </text>
      ) : null}
      <DateAxis model={model} scale={scale} y={lanesBottom + extraRow + 6} />
    </svg>
  );
}

/* -----------------------------------------------------------------
   Figure 2 — volume crescendo
   ----------------------------------------------------------------- */

function CrescendoFigure({ model, width }: { model: TimelineModel; width: number }) {
  const scale = makeScale(model, width, 30, 12);
  const chartTop = 22;
  const chartBottom = 118;
  const height = chartBottom + 40;
  const barGap = 2;
  const cellW = scale.plotW / model.totalDays;
  const barW = Math.max(2, cellW - barGap);
  const yFor = (count: number) =>
    chartBottom - ((chartBottom - chartTop) * count) / model.maxDaily;
  const inEvent = (idx: number) =>
    model.eventStartIdx !== null &&
    model.eventEndIdx !== null &&
    idx >= model.eventStartIdx &&
    idx <= model.eventEndIdx;
  const showValues = cellW >= 16;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={styles.insightsChart}
      role="img"
      aria-label={`Daily email volume, peaking at ${model.maxDaily} emails in one day`}
    >
      <EventBand model={model} scale={scale} top={chartTop - 8} bottom={chartBottom} />
      <text
        x={scale.padLeft - 6}
        y={yFor(model.maxDaily) + 4}
        textAnchor="end"
        className={styles.insightsAxisLabel}
      >
        {model.maxDaily}
      </text>
      <line
        x1={scale.padLeft}
        x2={scale.padLeft + scale.plotW}
        y1={chartBottom}
        y2={chartBottom}
        className={styles.insightsAxisTick}
      />
      {model.dailyCounts.map((count, idx) => {
        if (count === 0) return null;
        const x = scale.bandX(idx) + barGap / 2;
        const y = yFor(count);
        return (
          <g key={idx}>
            <title>{`${shortDayLabel(model.windowStart, idx)} — ${count} ${count === 1 ? "email" : "emails"}`}</title>
            <rect
              x={x}
              y={y}
              width={barW}
              height={chartBottom - y}
              rx={2}
              className={inEvent(idx) ? styles.insightsBarEvent : styles.insightsBar}
            />
            {showValues ? (
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                className={styles.insightsBarValue}
              >
                {count}
              </text>
            ) : null}
          </g>
        );
      })}
      <DateAxis model={model} scale={scale} y={chartBottom + 6} />
    </svg>
  );
}

/* -----------------------------------------------------------------
   Figure 3 — campaign phase strip
   ----------------------------------------------------------------- */

function PhaseStripFigure({
  model,
  width,
  onOpenEmail,
  onHover,
  onLeave
}: {
  model: TimelineModel;
  width: number;
  onOpenEmail: (email: ExploreEmailCard) => void;
  onHover?: (label: string, x: number, y: number) => void;
  onLeave?: () => void;
}) {
  const scale = makeScale(model, width, LABEL_GUTTER + 26, 12);
  const topPad = 16;
  const laneH = 26;
  const lanesBottom = topPad + model.phaseLanes.length * laneH;
  const height = lanesBottom + 40;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={styles.insightsChart}
      role="img"
      aria-label={`Campaign phases across ${model.phaseLanes.length} stages`}
    >
      <EventBand model={model} scale={scale} top={topPad - 8} bottom={lanesBottom} showLabel />
      {model.phaseLanes.map((lane, laneIdx) => {
        const cy = topPad + laneIdx * laneH + laneH / 2;
        const color = PHASE_COLORS[lane.phase];
        const seenPerDay = new Map<number, number>();
        return (
          <g key={lane.phase}>
            <text
              x={scale.padLeft - 10}
              y={cy + 3.5}
              textAnchor="end"
              className={styles.insightsLaneLabel}
            >
              {`${CAMPAIGN_PHASE_LABELS[lane.phase]} · ${lane.items.length}`}
            </text>
            <line
              x1={scale.padLeft}
              x2={scale.padLeft + scale.plotW}
              y1={cy}
              y2={cy}
              className={styles.insightsLaneTrack}
            />
            {lane.items.map((item, i) => {
              const dupes = seenPerDay.get(item.dayIdx) ?? 0;
              seenPerDay.set(item.dayIdx, dupes + 1);
              return (
                <EmailMarker
                  key={`${item.card.id}-${i}`}
                  item={item}
                  cx={scale.x(item.dayIdx) + dupes * 5}
                  cy={cy}
                  color={color}
                  onOpenEmail={onOpenEmail}
                  onHover={onHover}
                  onLeave={onLeave}
                />
              );
            })}
          </g>
        );
      })}
      <DateAxis model={model} scale={scale} y={lanesBottom + 6} />
    </svg>
  );
}

/* -----------------------------------------------------------------
   Figure 4 — weekly category mix
   ----------------------------------------------------------------- */

function CategoryMixFigure({ model, width }: { model: TimelineModel; width: number }) {
  const scale = makeScale(model, width, 30, 12);
  const chartTop = 14;
  const chartBottom = 138;
  const height = chartBottom + 26;
  const maxWeekTotal = Math.max(...model.weeks.map((week) => week.total), 1);
  const colorFor = (category: string) =>
    model.topCategories.includes(category)
      ? CATEGORY_COLORS[category] ?? CATEGORY_FALLBACK_COLOR
      : CATEGORY_FALLBACK_COLOR;

  // Stack the top categories in a fixed order, everything else pooled
  // into one neutral "other" segment per week.
  const segmentsFor = (week: TimelineModel["weeks"][number]) => {
    const segments: Array<{ key: string; count: number; color: string }> = [];
    for (const category of model.topCategories) {
      const count = week.counts.get(category) ?? 0;
      if (count > 0) {
        segments.push({ key: category, count, color: colorFor(category) });
      }
    }
    let rest = 0;
    for (const [category, count] of week.counts) {
      if (!model.topCategories.includes(category)) rest += count;
    }
    if (rest > 0) {
      segments.push({ key: "other", count: rest, color: CATEGORY_FALLBACK_COLOR });
    }
    return segments;
  };

  const weekW = scale.plotW / model.weeks.length;
  const barW = Math.max(8, weekW - 10);

  return (
    <>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={styles.insightsChart}
        role="img"
        aria-label={`Weekly category mix across ${model.weeks.length} weeks`}
      >
        <line
          x1={scale.padLeft}
          x2={scale.padLeft + scale.plotW}
          y1={chartBottom}
          y2={chartBottom}
          className={styles.insightsAxisTick}
        />
        <text
          x={scale.padLeft - 6}
          y={chartTop + 4}
          textAnchor="end"
          className={styles.insightsAxisLabel}
        >
          {maxWeekTotal}
        </text>
        {model.weeks.map((week, weekIdx) => {
          const x = scale.padLeft + weekIdx * weekW + (weekW - barW) / 2;
          const scaleH = (count: number) =>
            ((chartBottom - chartTop) * count) / maxWeekTotal;
          let y = chartBottom;
          const label = `Week of ${shortDayLabel(model.windowStart, week.startIdx)}`;
          return (
            <g key={week.startIdx}>
              <title>{`${label} — ${week.total} ${week.total === 1 ? "email" : "emails"}`}</title>
              {segmentsFor(week).map((segment) => {
                const h = scaleH(segment.count);
                y -= h;
                return (
                  <rect
                    key={segment.key}
                    x={x}
                    y={y + 0.5}
                    width={barW}
                    height={Math.max(1, h - 1)}
                    rx={2}
                    fill={segment.color}
                  />
                );
              })}
              <text
                x={x + barW / 2}
                y={chartBottom + 15}
                textAnchor="middle"
                className={styles.insightsAxisLabel}
              >
                {shortDayLabel(model.windowStart, week.startIdx)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={styles.insightsLegend}>
        {model.topCategories.map((category) => (
          <span key={category} className={styles.insightsLegendItem}>
            <span
              className={styles.insightsLegendSwatch}
              style={{ background: colorFor(category) }}
              aria-hidden="true"
            />
            {EMAIL_CATEGORY_LABELS[category as EmailCategory] ?? category}
          </span>
        ))}
        <span className={styles.insightsLegendItem}>
          <span
            className={styles.insightsLegendSwatch}
            style={{ background: CATEGORY_FALLBACK_COLOR }}
            aria-hidden="true"
          />
          Other
        </span>
      </div>
    </>
  );
}

/* -----------------------------------------------------------------
   Figure 5 — how much each brand discounts
   ----------------------------------------------------------------- */

function DiscountFigure({ model, width }: { model: TimelineModel; width: number }) {
  const discount = model.discount!;
  const [expanded, setExpanded] = useState(false);
  const collapsible = discount.brands.length > MAX_DISCOUNT_BRANDS;
  const rows =
    collapsible && !expanded
      ? discount.brands.slice(0, MAX_DISCOUNT_BRANDS)
      : discount.brands;
  const hiddenCount = discount.brands.length - rows.length;

  const padLeft = LABEL_GUTTER;
  const padRight = 46;
  const plotW = Math.max(10, width - padLeft - padRight);
  // Round the axis up to a tidy 10% step, floored at 20% so a collection
  // of small discounts still reads sensibly.
  const axisMax = Math.min(100, Math.max(20, Math.ceil(discount.maxObserved / 10) * 10));
  const xFor = (pct: number) => padLeft + (plotW * Math.min(pct, axisMax)) / axisMax;

  const topPad = 14;
  const rowH = 22;
  const barH = 10;
  const rowsBottom = topPad + rows.length * rowH;
  const extraRow = collapsible ? 18 : 0;
  const height = rowsBottom + extraRow + 28;

  const gridStep = axisMax <= 40 ? 10 : 25;
  const gridValues: number[] = [];
  for (let v = 0; v <= axisMax; v += gridStep) gridValues.push(v);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={styles.insightsChart}
      role="img"
      aria-label={`Average discount per brand across ${discount.brands.length} brands, deepest ${Math.round(discount.maxObserved)} percent`}
    >
      {gridValues.map((v) => (
        <g key={v}>
          <line
            x1={xFor(v)}
            x2={xFor(v)}
            y1={topPad - 6}
            y2={rowsBottom}
            className={styles.insightsAxisTick}
          />
          <text
            x={xFor(v)}
            y={rowsBottom + extraRow + 16}
            textAnchor="middle"
            className={styles.insightsAxisLabel}
          >
            {v}%
          </text>
        </g>
      ))}
      {rows.map((brand, rowIdx) => {
        const cy = topPad + rowIdx * rowH + rowH / 2;
        const avgX = xFor(brand.avg);
        const benchX = xFor(brand.benchmarkMax);
        const countLabel = `${brand.count} ${brand.count === 1 ? "email" : "emails"}`;
        return (
          <g key={brand.name}>
            <title>{`${brand.name} — avg ${Math.round(brand.avg)}% here (${countLabel}); deepest ${Math.round(brand.benchmarkMax)}% in the past 12 months`}</title>
            <text
              x={padLeft - 10}
              y={cy + 3.5}
              textAnchor="end"
              className={styles.insightsLaneLabel}
            >
              {truncateLabel(brand.name, 18)}
            </text>
            <line
              x1={padLeft}
              x2={padLeft + plotW}
              y1={cy}
              y2={cy}
              className={styles.insightsLaneTrack}
            />
            <rect
              x={padLeft}
              y={cy - barH / 2}
              width={Math.max(2, avgX - padLeft)}
              height={barH}
              rx={3}
              className={styles.insightsDiscountBar}
            />
            {/* Diamond at the brand's deepest 12-month deal, when it sits
                clear of the average bar's end. */}
            {benchX > avgX + 3 ? (
              <path
                d={`M ${benchX} ${cy - 4} L ${benchX + 4} ${cy} L ${benchX} ${cy + 4} L ${benchX - 4} ${cy} Z`}
                className={styles.insightsDiscountMax}
              />
            ) : null}
            <text
              x={Math.max(benchX, avgX) + 8}
              y={cy + 3.5}
              textAnchor="start"
              className={styles.insightsDiscountValue}
            >
              {Math.round(brand.avg)}%
            </text>
          </g>
        );
      })}
      {collapsible ? (
        <text
          x={padLeft - 10}
          y={rowsBottom + 13}
          textAnchor="end"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={
            expanded ? "Show fewer brands" : `Show ${hiddenCount} more brands`
          }
          className={styles.insightsMoreToggle}
          onClick={() => setExpanded((current) => !current)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded((current) => !current);
            }
          }}
        >
          {expanded ? "Show fewer" : `+${hiddenCount} more`}
        </text>
      ) : null}
    </svg>
  );
}

/* -----------------------------------------------------------------
   Formatting helpers
   ----------------------------------------------------------------- */

function formatEventDates(
  startDate: string | null,
  endDate: string | null
): string | null {
  if (!startDate) return null;
  const start = parseDayKey(startDate);
  if (!start) return null;
  const startLabel = formatShortDate(start);
  if (!endDate || endDate === startDate) return startLabel;
  const end = parseDayKey(endDate);
  if (!end) return startLabel;
  return `${startLabel} – ${formatShortDate(end)}`;
}

function formatLead(days: number): string {
  if (days === 0) return "Day of";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.round(days / 7);
  return `${weeks} weeks`;
}

function truncateLabel(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function CalendarSparkIcon() {
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
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <path d="M12 13.5l.9 1.8 1.8.9-1.8.9-.9 1.8-.9-1.8-1.8-.9 1.8-.9z" />
    </svg>
  );
}
