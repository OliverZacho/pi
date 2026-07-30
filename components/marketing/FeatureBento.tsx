"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useReveal } from "./useReveal";
import {
  ClockPairVisual,
  CollectionRulesVisual,
  CompareHeatmapVisual,
  EventSwimlaneVisual,
  FollowFeedVisual
} from "./feature-visuals";
import styles from "./feature-bento.module.css";

/* =================================================================
   Everything Pirol sees — Ramp-style rhythm instead of a metronome:
   a live stat ticker (REAL archive numbers), the flagship brand
   chapter, a typographic interlude, a varied-width bento, and a
   marquee of genuinely tracked brands. Each block reveals on its own
   scroll position so the animations happen in front of the visitor.
   ================================================================= */

// Real counts from captured_emails / companies (2026-07-25). Update
// alongside the library band's "3,500+" claim when these grow stale.
const TICKER_STATS = [
  { value: 3508, label: "emails read" },
  { value: 485, label: "brands tracked" },
  { value: 1008, label: "discounts measured" },
  { value: 366, label: "deadlines checked" }
];

// All names below are real tracked brands (verified against the DB).
const MARQUEE_BRANDS = [
  "Hay",
  "Muuto",
  "GANNI",
  "Rapha",
  "ARKET",
  "Stine Goya",
  "Ralph Lauren",
  "SKIMS",
  "Audo",
  "Georg Jensen",
  "Ferm Living",
  "Samsøe Samsøe",
  "BYREDO",
  "Coffee Collective"
];

export default function FeatureBento() {
  const head = useReveal<HTMLDivElement>();

  return (
    <section className={styles.band} aria-labelledby="bento-title">
      <div
        ref={head.ref}
        data-reveal={head.revealed ? "in" : "out"}
        className={`${styles.head} ${styles.reveal}`}
      >
        <p className={styles.eyebrow}>Everything Pirol sees</p>
        <h2 id="bento-title" className={styles.title}>
          Every email, read like an analyst.
        </h2>
        <p className={styles.lede}>
          One capture feeds every view, from a single brand's habits to a
          whole cohort.
        </p>
      </div>

      <StatTicker />

      <ChapterCard
        href="/features/brands"
        kicker="Brand insights"
        title="Know exactly how a brand sends."
        body="Cadence, send hours, design DNA, and every discount they have run."
        link="See brand insights"
        brandAccent
      >
        <ClockPairVisual large />
      </ChapterCard>

      <Interlude />

      <BentoRow flip={false}>
        <BentoCard
          wide
          href="/features/collections"
          kicker="Collections"
          title="Collections that fill themselves."
          link="See collections"
        >
          <CollectionRulesVisual />
        </BentoCard>
        <BentoCard
          href="/features/collections"
          kicker="Event detection"
          title="Real-world moments, spotted automatically."
          link="See event detection"
        >
          <EventSwimlaneVisual />
        </BentoCard>
      </BentoRow>

      <BentoRow flip>
        <BentoCard
          href="/features/following"
          kicker="Following"
          title="A clean feed of just your senders."
          link="See following"
        >
          <FollowFeedVisual />
        </BentoCard>
        <BentoCard
          wide
          href="/features/comparisons"
          kicker="Comparisons"
          title="See how a whole cohort behaves."
          link="See comparisons"
        >
          <CompareHeatmapVisual />
        </BentoCard>
      </BentoRow>

      <BrandMarquee />

      <CtaBand />
    </section>
  );
}

/* -----------------------------------------------------------------
   Stat ticker — Ramp's "agents at work" move, with real numbers
   ----------------------------------------------------------------- */

function StatTicker() {
  const { ref, revealed } = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={`${styles.ticker} ${styles.reveal}`}
      role="group"
      aria-label="Archive totals"
    >
      <span className={styles.tickerLabel}>Counted so far</span>
      {TICKER_STATS.map((s, i) => (
        <span key={s.label} className={styles.tickerStat}>
          <span className={styles.tickerNum}>
            <CountUp value={s.value} run={revealed} delayMs={i * 120} />
          </span>
          <span className={styles.tickerCaption}>{s.label}</span>
        </span>
      ))}
    </div>
  );
}

/** Counts 0 → value once `run` flips true. Reduced motion: jumps. */
function CountUp({
  value,
  run,
  delayMs = 0
}: {
  value: number;
  run: boolean;
  delayMs?: number;
}) {
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!run || started.current) return;
    started.current = true;

    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduced) {
      setDisplay(value);
      return;
    }

    let raf = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const duration = 1300;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplay(Math.round(eased * value));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [run, value, delayMs]);

  return <>{display.toLocaleString("en-US")}</>;
}

/* -----------------------------------------------------------------
   Full-width flagship chapter
   ----------------------------------------------------------------- */

function ChapterCard({
  href,
  kicker,
  title,
  body,
  link,
  brandAccent,
  children
}: {
  href: string;
  kicker: string;
  title: string;
  body: string;
  link: string;
  brandAccent?: boolean;
  children: React.ReactNode;
}) {
  const { ref, revealed } = useReveal<HTMLAnchorElement>();

  return (
    <Link
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      href={href}
      className={[
        styles.chapter,
        styles.reveal,
        brandAccent ? styles.brandTile : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.chapterCopy}>
        <p className={styles.chapterKicker}>{kicker}</p>
        <h3 className={styles.chapterTitle}>{title}</h3>
        <p className={styles.chapterBody}>{body}</p>
        <span className={styles.chapterLink}>
          {link}
          <ArrowIcon />
        </span>
      </div>
      <div className={styles.chapterVisual}>{children}</div>
    </Link>
  );
}

/* -----------------------------------------------------------------
   Typographic interlude — rhythm break between card blocks
   ----------------------------------------------------------------- */

function Interlude() {
  const { ref, revealed } = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={`${styles.interlude} ${styles.reveal}`}
    >
      <p className={styles.interludeTitle}>
        Stop guessing what works in email.
      </p>
      <p className={styles.interludeSub}>
        Read what 485 brands actually send.
      </p>
    </div>
  );
}

/* -----------------------------------------------------------------
   Varied bento — one wide card + one narrow card per row
   ----------------------------------------------------------------- */

function BentoRow({
  flip,
  children
}: {
  flip: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${styles.mixGrid} ${flip ? styles.mixGridFlip : ""}`}>
      {children}
    </div>
  );
}

function BentoCard({
  href,
  kicker,
  title,
  link,
  wide,
  children
}: {
  href: string;
  kicker: string;
  title: string;
  link: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const { ref, revealed } = useReveal<HTMLAnchorElement>();

  return (
    <Link
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      href={href}
      className={[
        styles.mixCard,
        styles.reveal,
        wide ? styles.mixCardWide : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.mixCardHead}>
        <div>
          <p className={styles.chapterKicker}>{kicker}</p>
          <h3 className={styles.mixCardTitle}>{title}</h3>
        </div>
        <span className={styles.chapterLink}>
          {link}
          <ArrowIcon />
        </span>
      </div>
      <div className={styles.mixCardVisual}>{children}</div>
    </Link>
  );
}

/* -----------------------------------------------------------------
   Brand marquee — real tracked brands, slow ambient scroll
   ----------------------------------------------------------------- */

function BrandMarquee() {
  const { ref, revealed } = useReveal<HTMLDivElement>();
  const pills = [...MARQUEE_BRANDS, ...MARQUEE_BRANDS];

  return (
    <div
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={`${styles.marqueeWrap} ${styles.reveal}`}
      aria-label="Some of the brands Pirol tracks"
    >
      <div className={styles.marqueeTrack} aria-hidden="true">
        {pills.map((name, i) => (
          <span key={`${name}-${i}`} className={styles.marqueePill}>
            {name}
          </span>
        ))}
      </div>
      <p className={styles.marqueeCaption}>and 470 more</p>
    </div>
  );
}

/* -----------------------------------------------------------------
   Closing CTA
   ----------------------------------------------------------------- */

function CtaBand() {
  const { ref, revealed } = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={`${styles.ctaBand} ${styles.reveal}`}
    >
      <Link href="/explore" className={styles.libraryCta}>
        Browse the archive
        <ArrowIcon />
      </Link>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
