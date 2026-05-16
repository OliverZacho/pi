"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORY_LABEL,
  TIMELINE_BRANDS,
  type TimelineBrand,
  type TimelineSend,
} from "@/lib/marketing/hero5-data";
import styles from "./timelinehero.module.css";

/**
 * "The Timeline" hero (/hero5).
 *
 * A horizontal axis plotting a single brand's entire newsletter history.
 * Each send is a dot positioned on the day it went out. Hovering a dot
 * — or letting the auto-tour land on one — lifts the full newsletter
 * thumbnail upward, like picking up a card off a table.
 *
 * The whole thing makes patterns visible at a glance: weekly send days,
 * quiet months, sudden palette shifts when a brand redesigns.
 */

const MONTH_NAMES = [
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
  "Dec",
];

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

// How long each tour step dwells before advancing to the next interesting node.
const TOUR_INTERVAL_MS = 2600;

export default function TimelineHero() {
  const [brandIdx, setBrandIdx] = useState(0);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [hoverPaused, setHoverPaused] = useState(false);

  const brand = TIMELINE_BRANDS[brandIdx];

  // Track which tour step we're on so changing brands restarts cleanly.
  const tourStepRef = useRef(0);

  // Auto-tour: advance the active node through the brand's "tour" sequence
  // every TOUR_INTERVAL_MS unless the user is hovering the timeline.
  useEffect(() => {
    tourStepRef.current = 0;
    if (brand.tour.length === 0) {
      setActiveIdx(null);
      return;
    }
    setActiveIdx(brand.tour[0]);

    if (hoverPaused) return;
    const id = setInterval(() => {
      tourStepRef.current = (tourStepRef.current + 1) % brand.tour.length;
      setActiveIdx(brand.tour[tourStepRef.current]);
    }, TOUR_INTERVAL_MS);
    return () => clearInterval(id);
  }, [brandIdx, hoverPaused, brand.tour]);

  return (
    <section className={styles.wrap} aria-labelledby="hero5-title">
      <header className={styles.headerBlock}>
        <p className={styles.eyebrow}>Timeline</p>
        <h1 id="hero5-title" className={styles.headline}>
          See every newsletter,
          <br />
          every brand, every send.
        </h1>
        <p className={styles.subhead}>
          Every email a competitor has ever shipped, plotted on a single
          line. The patterns reveal themselves — the weekly cadence, the
          quiet months, the moment a brand changes its mind.
        </p>
      </header>

      <div className={styles.stage}>
        <BrandSwitcher
          brands={TIMELINE_BRANDS}
          activeIdx={brandIdx}
          onSelect={(i) => {
            setBrandIdx(i);
            setActiveIdx(null);
          }}
        />

        <Timeline
          brand={brand}
          activeIdx={activeIdx}
          onActiveChange={setActiveIdx}
          onHoverState={setHoverPaused}
        />

        <InsightsPanel brand={brand} activeSend={getActiveSend(brand, activeIdx)} />
      </div>
    </section>
  );
}

function getActiveSend(brand: TimelineBrand, idx: number | null): TimelineSend | null {
  if (idx == null || idx < 0 || idx >= brand.sends.length) return null;
  return brand.sends[idx];
}

// ---------- Brand switcher ----------------------------------------------

function BrandSwitcher({
  brands,
  activeIdx,
  onSelect,
}: {
  brands: TimelineBrand[];
  activeIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <aside className={styles.switcher} aria-label="Brand selector">
      <p className={styles.switcherLabel}>Tracking</p>
      <ul className={styles.switcherList} role="tablist">
        {brands.map((b, i) => {
          const isActive = i === activeIdx;
          return (
            <li key={b.id}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`${styles.switcherItem} ${
                  isActive ? styles.switcherItemActive : ""
                }`}
                onClick={() => onSelect(i)}
              >
                <span className={styles.switcherMark}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.brandMark} alt="" loading="lazy" />
                </span>
                <span className={styles.switcherText}>
                  <span className={styles.switcherName}>{b.name}</span>
                  <span className={styles.switcherCadence}>{b.cadence}</span>
                </span>
                <span className={styles.switcherCount}>
                  {b.sends.length}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// ---------- Timeline (the main axis) ------------------------------------

function Timeline({
  brand,
  activeIdx,
  onActiveChange,
  onHoverState,
}: {
  brand: TimelineBrand;
  activeIdx: number | null;
  onActiveChange: (i: number | null) => void;
  onHoverState: (hovering: boolean) => void;
}) {
  const startMs = useMemo(() => Date.parse(brand.windowStart), [brand.windowStart]);
  const endMs = useMemo(() => Date.parse(brand.windowEnd), [brand.windowEnd]);
  const totalMs = Math.max(1, endMs - startMs);

  const toPct = (iso: string) => {
    const t = Date.parse(iso);
    return Math.max(0, Math.min(100, ((t - startMs) / totalMs) * 100));
  };

  // Pre-compute month markers across the visible window.
  const months = useMemo(() => buildMonthMarkers(brand.windowStart, brand.windowEnd), [
    brand.windowStart,
    brand.windowEnd,
  ]);

  const active = activeIdx != null ? brand.sends[activeIdx] : null;

  return (
    <div
      className={styles.timeline}
      onMouseEnter={() => onHoverState(true)}
      onMouseLeave={() => onHoverState(false)}
    >
      <div className={styles.axisInner}>
        <MonthAxis months={months} />

        <div className={styles.lane}>
          {/* The lift card lives inside the lane so it can be positioned
              relative to the rule itself. */}
          <LiftCard
            brand={brand}
            send={active}
            positionPct={active ? toPct(active.date) : 50}
          />

          {/* The horizontal rule the dots sit on */}
          <div className={styles.rule} aria-hidden="true" />

          {/* Annotation chips (quiet periods, brand refresh, surges) */}
          {brand.annotations.map((a, i) => {
            const startP = toPct(a.start);
            const endP = toPct(a.end);
            const isPoint = a.tone === "shift";
            // Range annotations span their actual width on the axis.
            // Point annotations centre a fixed-width chip on the date.
            const style: React.CSSProperties = isPoint
              ? { left: `${startP}%`, width: "7.5rem", marginLeft: "-3.75rem" }
              : { left: `${startP}%`, width: `${Math.max(0.6, endP - startP)}%` };
            return (
              <div
                key={`ann-${i}`}
                className={`${styles.annotation} ${styles[`annotation_${a.tone}`]}`}
                style={style}
              >
                <span className={styles.annotationLabel}>{a.label}</span>
              </div>
            );
          })}

          {/* Send dots on the rule */}
          {brand.sends.map((s, i) => {
            const isActive = i === activeIdx;
            return (
              <button
                key={s.id}
                type="button"
                className={`${styles.dot} ${isActive ? styles.dotActive : ""} ${
                  styles[`dot_${s.category}`]
                }`}
                style={{
                  left: `${toPct(s.date)}%`,
                  // The dot color comes from the send's accent so a brand
                  // refresh visibly recolors the timeline.
                  ["--dot-color" as string]: s.accent,
                }}
                onMouseEnter={() => onActiveChange(i)}
                onFocus={() => onActiveChange(i)}
                aria-label={`${s.subject} — ${formatLongDate(s.date)}`}
              >
                <span className={styles.dotInner} aria-hidden="true" />
              </button>
            );
          })}
        </div>

        {/* Weekday cadence strip — makes "every Tuesday" visible at a glance */}
        <CadenceStrip
          sends={brand.sends}
          toPct={toPct}
          activeIdx={activeIdx}
          onActiveChange={onActiveChange}
        />
      </div>
    </div>
  );
}

// ---------- Lift-up newsletter card -------------------------------------

function LiftCard({
  brand,
  send,
  positionPct,
}: {
  brand: TimelineBrand;
  send: TimelineSend | null;
  positionPct: number;
}) {
  const visible = send != null;
  return (
    <div
      className={`${styles.liftLayer} ${visible ? styles.liftLayerVisible : ""}`}
      // The CSS clamps this between safe bounds so the card stays in the lane.
      style={{ ["--lift-x" as string]: `${positionPct}%` }}
      aria-hidden={!visible}
    >
      {/* Thin connector from the dot up into the card — the "tether" */}
      <span className={styles.liftTether} />

      <article
        key={send?.id ?? "empty"}
        className={styles.liftCard}
        style={{
          background: send?.paperBg ?? "#f4ecdd",
          color: send?.paperInk ?? "#1a1814",
        }}
      >
        <header className={styles.liftHead}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.liftBrandMark}
            src={brand.brandMark}
            alt=""
            loading="lazy"
          />
          <span className={styles.liftCategory}>
            {send ? CATEGORY_LABEL[send.category] : ""}
          </span>
        </header>

        <div
          className={styles.liftVisual}
          style={{
            background: send?.heroImage
              ? undefined
              : buildGradient(send),
          }}
        >
          {send?.heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={send.heroImage} alt="" loading="lazy" />
          )}
          {!send?.heroImage && send?.swatches && (
            <div className={styles.liftSwatches}>
              {send.swatches.slice(0, 5).map((hex, i) => (
                <span
                  key={`${hex}-${i}`}
                  className={styles.liftSwatch}
                  style={{ background: hex }}
                />
              ))}
            </div>
          )}
        </div>

        <div className={styles.liftBody}>
          <p className={styles.liftSubject}>{send?.subject ?? ""}</p>
          {send?.preheader && (
            <p className={styles.liftPreheader}>{send.preheader}</p>
          )}
        </div>

        <footer className={styles.liftFooter}>
          <span>{send ? formatShortDate(send.date) : ""}</span>
          <span aria-hidden>·</span>
          <span>{send ? dayName(send.date) : ""}</span>
        </footer>
      </article>
    </div>
  );
}

// ---------- Cadence strip (under the rule) ------------------------------

function CadenceStrip({
  sends,
  toPct,
  activeIdx,
  onActiveChange,
}: {
  sends: TimelineSend[];
  toPct: (iso: string) => number;
  activeIdx: number | null;
  onActiveChange: (i: number | null) => void;
}) {
  return (
    <div className={styles.cadence} aria-hidden="true">
      <div className={styles.cadenceLegend}>
        {DAY_LETTERS.map((letter, i) => (
          <span key={i} className={styles.cadenceLetter}>
            {letter}
          </span>
        ))}
      </div>
      <div className={styles.cadenceRow}>
        {sends.map((s, i) => {
          const day = new Date(s.date).getUTCDay(); // 0..6
          const isActive = i === activeIdx;
          return (
            <button
              key={`tick-${s.id}`}
              type="button"
              className={`${styles.cadenceTick} ${
                isActive ? styles.cadenceTickActive : ""
              }`}
              style={{
                left: `${toPct(s.date)}%`,
                top: `${((day + 0.5) / 7) * 100}%`,
                background: s.accent,
              }}
              onMouseEnter={() => onActiveChange(i)}
              onFocus={() => onActiveChange(i)}
              tabIndex={-1}
              aria-label={`${dayName(s.date)} send`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------- Month axis above the rule -----------------------------------

function MonthAxis({ months }: { months: { label: string; leftPct: number }[] }) {
  return (
    <div className={styles.monthAxis} aria-hidden="true">
      {months.map((m, i) => (
        <span key={i} className={styles.month} style={{ left: `${m.leftPct}%` }}>
          {m.label}
        </span>
      ))}
    </div>
  );
}

// ---------- Right-edge insights panel -----------------------------------

function InsightsPanel({
  brand,
  activeSend,
}: {
  brand: TimelineBrand;
  activeSend: TimelineSend | null;
}) {
  return (
    <aside className={styles.insights} aria-live="polite">
      <p className={styles.insightsLabel}>Auto-detected</p>

      <ul className={styles.insightsList}>
        {brand.insights.map((insight) => (
          <li key={insight.label} className={styles.insightItem}>
            <span className={styles.insightLabel}>{insight.label}</span>
            <span className={styles.insightValue}>{insight.value}</span>
          </li>
        ))}
      </ul>

      <div className={styles.insightsDivider} />

      <div className={styles.activeBlock} key={activeSend?.id ?? "none"}>
        <p className={styles.activeLabel}>Focused</p>
        {activeSend ? (
          <>
            <p className={styles.activeDate}>
              {formatLongDate(activeSend.date)}
            </p>
            <p className={styles.activeSubject}>{activeSend.subject}</p>
            <span
              className={`${styles.activeChip} ${
                styles[`chip_${activeSend.category}`]
              }`}
            >
              {CATEGORY_LABEL[activeSend.category]}
            </span>
          </>
        ) : (
          <p className={styles.activeEmpty}>Hover any send on the line</p>
        )}
      </div>
    </aside>
  );
}

// ---------- helpers -----------------------------------------------------

function buildMonthMarkers(startISO: string, endISO: string) {
  const start = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  const startMs = start.getTime();
  const totalMs = Math.max(1, end.getTime() - startMs);

  const markers: { label: string; leftPct: number }[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const ms = cursor.getTime();
    if (ms >= startMs) {
      markers.push({
        label: MONTH_NAMES[cursor.getUTCMonth()],
        leftPct: ((ms - startMs) / totalMs) * 100,
      });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return markers;
}

function buildGradient(send: TimelineSend | null): string {
  if (!send) return "linear-gradient(135deg, #e8dcc9, #c9b392)";
  const a = send.accent;
  const b = send.swatches?.[1] ?? send.paperBg;
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}

function dayName(iso: string): string {
  const names = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return names[new Date(iso + "T00:00:00Z").getUTCDay()];
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function formatLongDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `${dayName(iso)}, ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
