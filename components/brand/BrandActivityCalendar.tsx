"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type { BrandPageData } from "@/lib/brand-db";
import { colorForCategory } from "@/lib/category-colors";
import {
  formatLongDate as formatLongDateZoned,
  formatTime as formatTimeZoned,
  parseDayKey
} from "@/lib/datetime";
import styles from "./brand.module.css";

type CalendarEmail = BrandPageData["calendar"]["days"][number]["emails"][number];

type CalendarCell = {
  /** Midday instant of the day this cell represents, in the platform zone. */
  date: Date;
  iso: string;
  emails: CalendarEmail[];
  inRange: boolean;
};

type TooltipState = {
  cell: CalendarCell;
  anchorRect: DOMRect;
};

type Props = {
  brandName: string;
  calendar: BrandPageData["calendar"];
};

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

// Showing every weekday makes the y-axis feel cluttered; GitHub-style
// "every other label" reads cleanly and still anchors the eye.
const WEEKDAY_LABELS: Array<string | null> = [
  "Mon",
  null,
  "Wed",
  null,
  "Fri",
  null,
  null
];

/**
 * GitHub-style activity heatmap for a single brand. Renders one square
 * per day across the trailing year, coloured by the campaign category
 * that brand sent that day. Days with multiple distinct categories get
 * a split fill so the operator can spot "this Black Friday Tuesday was
 * one sale email and one product launch" at a glance.
 *
 * The component is intentionally self-contained: the server hands it a
 * sparse `calendar.days` array plus the date window, and the client
 * builds the full week-by-week grid in memory. Hover state lives in
 * React; the tooltip is portaled inline (no portal needed — fixed
 * positioning relative to the viewport is enough at this size).
 */
export default function BrandActivityCalendar({ brandName, calendar }: Props) {
  const { weeks, monthSpans, perDayLookup } = useMemo(
    () => buildGrid(calendar),
    [calendar]
  );

  const presentCategories = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    for (const day of calendar.days) {
      for (const email of day.emails) {
        if (!seen.has(email.category)) {
          seen.set(email.category, {
            id: email.category,
            label: email.categoryLabel
          });
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [calendar.days]);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // If the page scrolls under the cursor while a tooltip is open we'd
  // otherwise leave the popup floating over the wrong cell. Closing on
  // scroll is the cheap, correct behaviour.
  useEffect(() => {
    if (!tooltip) return undefined;
    const handle = () => setTooltip(null);
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [tooltip]);

  const handleEnter = useCallback(
    (cell: CalendarCell, target: HTMLElement) => {
      if (!cell.inRange || cell.emails.length === 0) {
        setTooltip(null);
        return;
      }
      setTooltip({ cell, anchorRect: target.getBoundingClientRect() });
    },
    []
  );

  const handleLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const totalSends = calendar.days.reduce(
    (acc, day) => acc + day.emails.length,
    0
  );
  const activeDays = perDayLookup.size;

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardEyebrow}>Activity</span>
          <h2 className={styles.cardTitle}>Send calendar</h2>
          <p className={styles.cardSub}>
            Every email {brandName} sent in the last year, coloured by
            campaign type. Hover any square for the subject line and send
            time.
          </p>
        </div>
        <div className={styles.calendarSummary}>
          <span className={styles.calendarSummaryValue}>{totalSends}</span>
          <span className={styles.calendarSummaryLabel}>
            sends across {activeDays} day{activeDays === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className={styles.calendarScroller}>
        <div className={styles.calendarLayout}>
          <div className={styles.calendarDayLabels} aria-hidden="true">
            {WEEKDAY_LABELS.map((label, idx) => (
              <span key={idx} className={styles.calendarDayLabel}>
                {label ?? ""}
              </span>
            ))}
          </div>

          <div className={styles.calendarBody}>
            <div
              className={styles.calendarMonthRow}
              style={
                { "--col-count": weeks.length } as CSSProperties
              }
              aria-hidden="true"
            >
              {monthSpans.map((span) => (
                <span
                  key={`${span.year}-${span.month}-${span.startCol}`}
                  className={styles.calendarMonthLabel}
                  style={{
                    gridColumn: `${span.startCol + 1} / span ${span.span}`
                  }}
                >
                  {MONTH_SHORT[span.month]}
                </span>
              ))}
            </div>

            <div
              className={styles.calendarGrid}
              ref={gridRef}
              style={
                { "--col-count": weeks.length } as CSSProperties
              }
              role="grid"
              aria-label={`${brandName} send activity by day`}
            >
              {weeks.map((week, weekIdx) =>
                week.map((cell, dayIdx) => (
                  <CalendarSquare
                    key={`${weekIdx}-${dayIdx}`}
                    cell={cell}
                    onEnter={handleEnter}
                    onLeave={handleLeave}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {presentCategories.length > 0 ? (
        <div className={styles.calendarLegend} aria-label="Category legend">
          {presentCategories.map((cat) => (
            <span key={cat.id} className={styles.calendarLegendItem}>
              <span
                className={styles.calendarLegendSwatch}
                style={{ background: colorForCategory(cat.id) }}
                aria-hidden="true"
              />
              <span>{cat.label}</span>
            </span>
          ))}
        </div>
      ) : null}

      {tooltip ? (
        <CalendarTooltip key={tooltip.cell.iso} state={tooltip} />
      ) : null}
    </article>
  );
}

function CalendarSquare({
  cell,
  onEnter,
  onLeave
}: {
  cell: CalendarCell;
  onEnter: (cell: CalendarCell, el: HTMLElement) => void;
  onLeave: () => void;
}) {
  const distinct = useMemo(() => {
    const map = new Map<string, string>();
    for (const email of cell.emails) {
      if (!map.has(email.category)) {
        map.set(email.category, colorForCategory(email.category));
      }
    }
    return Array.from(map.entries()).map(([id, color]) => ({ id, color }));
  }, [cell.emails]);

  const background = useMemo(() => buildFill(distinct.map((d) => d.color)), [
    distinct
  ]);

  if (!cell.inRange) {
    return <span className={`${styles.calendarCell} ${styles.calendarCellGhost}`} />;
  }

  const isEmpty = cell.emails.length === 0;

  return (
    <span
      className={`${styles.calendarCell}${
        isEmpty ? ` ${styles.calendarCellEmpty}` : ""
      }`}
      style={isEmpty ? undefined : { background }}
      onMouseEnter={(event) => onEnter(cell, event.currentTarget)}
      onMouseLeave={onLeave}
      onFocus={(event) => onEnter(cell, event.currentTarget)}
      onBlur={onLeave}
      tabIndex={isEmpty ? -1 : 0}
      role="gridcell"
      aria-label={describeCellForA11y(cell)}
    />
  );
}

function CalendarTooltip({ state }: { state: TooltipState }) {
  const { cell, anchorRect } = state;
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null
  );

  // Measure once mounted, then clamp inside the viewport. Two-pass
  // layout (mount invisibly, measure, paint) keeps the popup from
  // flickering at the edge of the screen the first time it appears.
  useEffect(() => {
    const node = tooltipRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const gap = 10;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let top = anchorRect.top - rect.height - gap;
    if (top < 8) {
      top = anchorRect.bottom + gap;
    }
    let left = anchorRect.left + anchorRect.width / 2 - rect.width / 2;
    left = Math.max(8, Math.min(left, viewportW - rect.width - 8));
    top = Math.max(8, Math.min(top, viewportH - rect.height - 8));

    setPosition({ top, left });
  }, [anchorRect]);

  return (
    <div
      ref={tooltipRef}
      className={styles.calendarTooltip}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        opacity: position ? 1 : 0
      }}
      role="tooltip"
    >
      <div className={styles.calendarTooltipDate}>
        {formatLongDateZoned(cell.date)}
      </div>
      <ul className={styles.calendarTooltipList}>
        {cell.emails.map((email) => (
          <li key={email.id} className={styles.calendarTooltipItem}>
            <div className={styles.calendarTooltipChipRow}>
              <span className={styles.calendarTooltipChip}>
                <span
                  className={styles.calendarTooltipChipDot}
                  style={{ background: colorForCategory(email.category) }}
                />
                {email.categoryLabel}
              </span>
              <span className={styles.calendarTooltipTime}>
                {formatTimeZoned(email.receivedAt)}
              </span>
            </div>
            <div className={styles.calendarTooltipSubject}>
              {email.subject || "(no subject)"}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -----------------------------------------------------------------
   Grid construction
   ----------------------------------------------------------------- */

type MonthSpan = {
  year: number;
  month: number;
  startCol: number;
  span: number;
};

function buildGrid(calendar: BrandPageData["calendar"]) {
  // The server emits `start` / `end` as `YYYY-MM-DD` calendar days
  // anchored in the platform zone. We iterate by stepping the day
  // string forward — that keeps the grid logic free of timezone math
  // and the `iso` keys line up exactly with the per-day buckets the
  // server already produced.
  const startIso = calendar.start;
  const endIso = calendar.end;

  const perDayLookup = new Map<string, CalendarEmail[]>();
  for (const day of calendar.days) {
    perDayLookup.set(day.date, day.emails);
  }

  const weeks: CalendarCell[][] = [];
  let currentWeek: CalendarCell[] = [];
  let cursor = startIso;
  // Build cells until we close the week that contains `endIso`. We
  // always emit complete Mon-Sun strips so the grid stays rectangular.
  while (true) {
    const inRange = cursor <= endIso;
    const emails = inRange ? perDayLookup.get(cursor) ?? [] : [];
    const cellInstant =
      parseDayKey(cursor) ?? new Date(`${cursor}T12:00:00Z`);
    currentWeek.push({
      date: cellInstant,
      iso: cursor,
      emails,
      inRange
    });

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    if (cursor > endIso && currentWeek.length === 0) break;
    cursor = stepDayKey(cursor, 1);
    if (cursor > endIso && currentWeek.length === 0) break;
  }

  // Month spans: a label per calendar month, placed above the first
  // week column that contains the first of that month. We use the
  // top-row cell (Monday) as the representative day for each column,
  // and pull the month directly from the iso so we don't accidentally
  // re-introduce browser-locale ambiguity.
  const monthSpans: MonthSpan[] = [];
  let currentSpan: MonthSpan | null = null;
  for (let col = 0; col < weeks.length; col++) {
    const mondayIso = weeks[col][0]?.iso;
    if (!mondayIso) continue;
    const [yearStr, monthStr] = mondayIso.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    if (
      !currentSpan ||
      currentSpan.year !== year ||
      currentSpan.month !== month
    ) {
      if (currentSpan) monthSpans.push(currentSpan);
      currentSpan = { year, month, startCol: col, span: 1 };
    } else {
      currentSpan.span += 1;
    }
  }
  if (currentSpan) monthSpans.push(currentSpan);

  // Drop month labels that only own a single column at the very start —
  // there isn't room to render them legibly and they read as visual
  // noise. (GitHub does the same.)
  const filtered = monthSpans.filter(
    (span, idx) => !(idx === 0 && span.span < 2)
  );

  return { weeks, monthSpans: filtered, perDayLookup };
}

/**
 * Steps a `YYYY-MM-DD` calendar key forward / backward by `delta`
 * days. We do the math against UTC because the input is a pure
 * calendar string with no zone — the platform-zone instant for each
 * day is reconstructed separately by `parseDayKey`.
 */
function stepDayKey(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  const ms = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const next = new Date(ms);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/* -----------------------------------------------------------------
   Fill construction
   ----------------------------------------------------------------- */

/**
 * Builds the CSS background string for a single calendar square based
 * on how many *distinct* categories were sent that day. One color is
 * solid; two split diagonally; three or more split into equal
 * vertical stripes so every category still shows up.
 *
 * We cap the displayed palette at five stripes — beyond that the cell
 * is too small to read and any extra categories share the last
 * stripe's hue. In practice we've never seen a single day with more
 * than three categories on this dataset, so the cap is theoretical.
 */
function buildFill(colors: string[]): string {
  if (colors.length === 0) return "#f1f5f9";
  if (colors.length === 1) return colors[0];
  if (colors.length === 2) {
    return `linear-gradient(135deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
  }
  const cap = Math.min(colors.length, 5);
  const step = 100 / cap;
  const stops: string[] = [];
  for (let i = 0; i < cap; i++) {
    const from = (i * step).toFixed(2);
    const to = ((i + 1) * step).toFixed(2);
    stops.push(`${colors[i]} ${from}% ${to}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/* -----------------------------------------------------------------
   Formatting helpers
   ----------------------------------------------------------------- */

function describeCellForA11y(cell: CalendarCell): string {
  const base = formatLongDateZoned(cell.date);
  if (cell.emails.length === 0) return `${base}: no emails`;
  const parts = cell.emails.map(
    (e) => `${e.categoryLabel} — ${e.subject || "(no subject)"}`
  );
  return `${base}: ${parts.join(", ")}`;
}
