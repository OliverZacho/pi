"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useReveal } from "./useReveal";
import { resolveBrandLogo } from "@/lib/logo-dev";
import type { ArchiveStats } from "@/lib/marketing-stats";
import styles from "./home-story.module.css";

/* =================================================================
   The homepage story beneath the hero, four ideas told visually:

   1. Intelligence + inspiration — a slot-machine reel of the signals
      Pirol measures next to a self-shuffling deck of real archive
      emails whose last card opens the archive.
   2. Automatic collections — the triage animation: emails pass an
      Auto-rules gate, get stamped with a category, and file
      themselves into collections that count up.
   3. Brand comparisons — real brand logos orbit, slow down, and
      morph into a bar chart of their real 90-day send counts.
   4. A quiet text band for the rest (teams, following, events...).

   Every real brand name sits next to genuinely captured data; the
   sorting animation uses unattributed generic collections only.
   ================================================================= */

/* -----------------------------------------------------------------
   Shared: reduced-motion hook
   ----------------------------------------------------------------- */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

export default function HomeStory({ stats }: { stats: ArchiveStats }) {
  return (
    <div className={styles.story}>
      <IntelInspoSplit stats={stats} />
      <AutoSortBand />
      <CompareOrbit />
      <MoreBand />
      <CtaBand />
    </div>
  );
}

/* =================================================================
   Section 1 — Intelligence reel + inspiration deck
   ================================================================= */

// Signals Pirol genuinely extracts (see admin email breakdowns and
// brand dashboards). Short so the reel window stays one line.
const REEL_WORDS = [
  "send cadence",
  "discount depth",
  "offer deadlines",
  "send hours",
  "design DNA",
  "CTA patterns",
  "subject lines",
  "email platform",
  "GIF usage",
  "event timing",
  "colour palettes",
  "font choices",
  "dark mode",
  "content types",
  "image weight",
  "welcome series",
  "email authentication"
];

function IntelInspoSplit({ stats }: { stats: ArchiveStats }) {
  const head = useReveal<HTMLDivElement>();
  const grid = useReveal<HTMLDivElement>();

  return (
    <section className={styles.band} aria-labelledby="split-title">
      <div
        ref={head.ref}
        data-reveal={head.revealed ? "in" : "out"}
        className={`${styles.head} ${styles.reveal}`}
      >
        <p className={styles.eyebrow}>What Pirol does</p>
        <h2 id="split-title" className={styles.title}>
          Intelligence on one side. Inspiration on the other.
        </h2>
        <p className={styles.lede}>
          Every captured email is measured, and every one is worth looking at.
        </p>
      </div>

      <StatTicker stats={stats} />

      <div
        ref={grid.ref}
        data-reveal={grid.revealed ? "in" : "out"}
        className={styles.splitGrid}
      >
        <div className={`${styles.sideCard} ${styles.reveal}`}>
          <p className={styles.sideKicker}>Intelligence</p>
          <p className={styles.reelLine}>
            Pirol reads every email for{" "}
            <WordReel active={grid.revealed} />
          </p>
          <p className={styles.sideBody}>
            Measured per brand and across the whole archive, from one send to a
            year of history.
          </p>
          <Link href="/features/brands" className={styles.sideLink}>
            See brand insights
            <ArrowIcon />
          </Link>
        </div>

        <div
          className={`${styles.sideCard} ${styles.sideCardDeck} ${styles.reveal}`}
          style={{ ["--i" as string]: 1 }}
        >
          <p className={styles.sideKicker}>Inspiration</p>
          <EmailDeck active={grid.revealed} stats={stats} />
        </div>
      </div>
    </section>
  );
}

/** Slot-machine reel: spins through the signal list, eases to a stop
 *  on the next word, pauses, spins again. Reduced motion: plain swap. */
function WordReel({ active }: { active: boolean }) {
  const stripRef = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();
  const n = REEL_WORDS.length;
  // Three copies so a full loop plus one always has runway; the strip
  // snaps back (transition off) to the middle copy between spins.
  const strip = [...REEL_WORDS, ...REEL_WORDS, ...REEL_WORDS];

  useEffect(() => {
    const el = stripRef.current;
    if (!el || !active) return;

    let alive = true;
    let timer = 0;
    let abs = n; // start on the middle copy's first word

    // The window shows five rows; the active word sits on the centre row,
    // so the strip is offset two rows up from the current index. Rows are
    // dimmed by their distance from the centre (data-d), which is what
    // actually sells the wheel; the landing step gets a soft snap ease.
    const place = (ms: number, snap = false) => {
      el.style.transition = ms
        ? `transform ${ms}ms ${
            snap
              ? "cubic-bezier(0.34, 1.35, 0.64, 1)"
              : "cubic-bezier(0.3, 0.6, 0.35, 1)"
          }`
        : "none";
      el.style.transform = `translateY(${-(abs - 2) * 1.2}em)`;
      const kids = el.children;
      for (let k = 0; k < kids.length; k++) {
        // Circular distance by word, not by row, so the invisible
        // copy-normalisation snaps never re-fade the centred word.
        const dm = (((k - abs) % n) + n) % n;
        const d = Math.min(dm, n - dm);
        (kids[k] as HTMLElement).dataset.d = d > 2 ? "3" : String(d);
      }
    };

    if (reduced) {
      // No reel: swap the word in place every few seconds.
      place(0);
      timer = window.setInterval(() => {
        abs = n + ((abs + 1) % n);
        place(0);
      }, 3000);
      return () => window.clearInterval(timer);
    }

    // After the opening spin the wheel stops touring the whole list:
    // it glides to a random other row, in either direction, like a
    // picker being flicked. `recent` blocks the last few words so it
    // can never ping-pong between the same pair.
    const RECENT = Math.min(4, n - 2);
    const recent: number[] = [];
    const wander = () => {
      timer = window.setTimeout(() => {
        if (!alive) return;
        const cur = abs - n;
        const blocked = new Set([cur, ...recent]);
        const pool = Array.from({ length: n }, (_, i) => i).filter(
          (i) => !blocked.has(i)
        );
        const next = pool[Math.floor(Math.random() * pool.length)];
        recent.push(next);
        if (recent.length > RECENT) recent.shift();
        abs = n + next;
        place(340 + Math.abs(next - cur) * 45, true);
        wander();
      }, 2500);
    };

    // One full blurred loop to introduce the wheel, then wander.
    const spin = () => {
      if (!alive) return;
      abs = n + (abs % n);
      place(0);
      void el.offsetHeight; // commit the snap before animating again
      // Enough steps to read as a spin, capped so a longer word list
      // doesn't drag the opener out.
      const steps = Math.min(n, 11) + 1;
      let i = 0;
      const step = () => {
        if (!alive) return;
        i += 1;
        abs += 1;
        const t = i / steps;
        const ms = 50 + 500 * Math.pow(t, 3); // fast start, slow landing
        el.classList.toggle(styles.reelBlur, ms < 150);
        place(ms, i === steps);
        timer = window.setTimeout(i < steps ? step : rest, ms);
      };
      const rest = () => {
        el.classList.remove(styles.reelBlur);
        abs = n + (abs % n); // wander stays inside the middle copy
        place(0);
        wander();
      };
      step();
    };
    spin();

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [active, reduced, n]);

  return (
    <span className={styles.reelWindow}>
      <span ref={stripRef} className={styles.reelStrip} aria-hidden="true">
        {strip.map((w, i) => (
          <span
            key={`${w}-${i}`}
            className={styles.reelWord}
            data-d={Math.min(i % n, n - (i % n), 3)}
          >
            {w}
          </span>
        ))}
      </span>
      <span className={styles.srOnly}>{REEL_WORDS.join(", ")}</span>
    </span>
  );
}

/* -----------------------------------------------------------------
   The deck — five real archive picks, then the archive itself
   ----------------------------------------------------------------- */

// REAL captured data, same source as the hero fan assets (every id is in
// LOGIN_SHOWCASE, so the .webp exists). Brand names, subjects and send
// times come from captured_emails; never guess these. Refreshed
// 2026-07-31 — keep these recent, a stale deck makes the archive look
// dead, and only use brands that are still sending.
const DECK_EMAILS = [
  {
    src: "/hero-emails/468e051a-ca1d-4639-8c8f-aed05de83f63.webp",
    brand: "Jacquemus",
    subject: "Summer in color",
    date: "Jul 6 · 6:31 PM"
  },
  {
    src: "/hero-emails/54fafa4f-2a4e-4060-bf77-59ddc6b37a0f.webp",
    brand: "Zara Home",
    subject: "Discover this week's new arrivals",
    date: "Jul 6 · 11:19 AM"
  },
  {
    src: "/hero-emails/b85d6123-a8ba-45db-8efa-94fa89e45a55.webp",
    brand: "Tekla",
    subject: "Iconic combinations",
    date: "Jul 30 · 2:15 PM"
  },
  {
    src: "/hero-emails/e73f8145-dcea-4dbb-bbc3-81a7f2e41959.webp",
    brand: "alo Yoga",
    subject: "The Work Edit",
    date: "Jun 26 · 9:48 PM"
  },
  {
    src: "/hero-emails/3024758c-5fc9-4261-a145-05a453b03776.webp",
    brand: "FRAMA",
    subject: "Last Day: Private Community Sale",
    date: "Jul 31 · 8:01 AM"
  }
];

const DECK_SIZE = DECK_EMAILS.length + 1; // + the archive card

/** Self-shuffling deck. Top card slides off to the back every few
 *  seconds (click also advances). The sixth card is the archive CTA
 *  and lingers longer before the loop restarts. */
function EmailDeck({ active, stats }: { active: boolean; stats: ArchiveStats }) {
  const [top, setTop] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  const leavingTimer = useRef(0);

  const advance = () => {
    if (leaving !== null) return;
    setLeaving(top);
    leavingTimer.current = window.setTimeout(() => {
      setLeaving(null);
      setTop((t) => (t + 1) % DECK_SIZE);
    }, 460);
  };

  useEffect(() => () => window.clearTimeout(leavingTimer.current), []);

  useEffect(() => {
    if (!active || reduced || paused || leaving !== null) return;
    const hold = top === DECK_SIZE - 1 ? 4600 : 2700;
    const timer = window.setTimeout(advance, hold);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduced, paused, top, leaving]);

  return (
    <div
      className={styles.deck}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Picks from the archive"
    >
      {DECK_EMAILS.map((e, i) => {
        const depth = (i - top + DECK_SIZE) % DECK_SIZE;
        return (
          <article
            key={e.src}
            className={`${styles.deckCard} ${
              leaving === i ? styles.deckLeaving : ""
            }`}
            style={{ ["--depth" as string]: Math.min(depth, 3) }}
            data-depth={Math.min(depth, 3)}
            onClick={advance}
          >
            <div className={styles.deckPreview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.src} alt={`${e.brand} — ${e.subject}`} loading="lazy" />
            </div>
            <div className={styles.deckMeta}>
              <span className={styles.deckBrand}>{e.brand}</span>
              <span className={styles.deckSubject}>{e.subject}</span>
              <span className={styles.deckDate}>{e.date}</span>
            </div>
          </article>
        );
      })}

      {/* The last card in the cycle: open the whole archive. */}
      <Link
        href="/explore"
        className={`${styles.deckCard} ${styles.deckCtaCard} ${
          leaving === DECK_SIZE - 1 ? styles.deckLeaving : ""
        }`}
        style={{
          ["--depth" as string]: Math.min(
            (DECK_SIZE - 1 - top + DECK_SIZE) % DECK_SIZE,
            3
          )
        }}
        data-depth={Math.min((DECK_SIZE - 1 - top + DECK_SIZE) % DECK_SIZE, 3)}
      >
        <span className={styles.deckCtaTitle}>
          There are thousands more.
        </span>
        <span className={styles.deckCtaSub}>
          {stats.brandsTotal} brands, new emails daily.
        </span>
        <span className={styles.deckCtaLink}>
          Browse the archive
          <ArrowIcon />
        </span>
      </Link>
    </div>
  );
}

/* -----------------------------------------------------------------
   Stat ticker — live 30-day numbers (moved from the old bento)
   ----------------------------------------------------------------- */

function StatTicker({ stats }: { stats: ArchiveStats }) {
  const { ref, revealed } = useReveal<HTMLDivElement>();

  const tickerStats = [
    { value: stats.emails30d, label: "emails read" },
    { value: stats.brandsActive30d, label: "brands sending" },
    { value: stats.discounts30d, label: "discounts measured" },
    { value: stats.deadlines30d, label: "deadlines checked" }
  ];

  return (
    <div
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={`${styles.ticker} ${styles.reveal}`}
      role="group"
      aria-label="Archive activity over the last 30 days"
    >
      <span className={styles.tickerLabel}>The last 30 days</span>
      {tickerStats.map((s, i) => (
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

    const reducedMq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reducedMq?.matches) {
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

/* =================================================================
   Section 2 — Automatic collections: the sorting mechanism
   ================================================================= */

// Generic, unattributed collections. Counts are the visual's own
// running tally, not archive claims; deliberately uneven so the loop
// reads organic rather than idealised.
const SORT_FOLDERS = [
  { name: "Welcome series", base: 14 },
  { name: "Sale alerts", base: 31 },
  { name: "Launches", base: 8 }
];

const SORT_QUEUE: Array<{ chip: string; folder: number; tone: string }> = [
  { chip: "Sale · 30% off", folder: 1, tone: "amber" },
  { chip: "Welcome", folder: 0, tone: "green" },
  { chip: "Product launch", folder: 2, tone: "indigo" },
  { chip: "Sale · 20% off", folder: 1, tone: "amber" },
  { chip: "Sale · 40% off", folder: 1, tone: "amber" },
  { chip: "Welcome", folder: 0, tone: "green" },
  { chip: "Product launch", folder: 2, tone: "indigo" },
  { chip: "Sale · 25% off", folder: 1, tone: "amber" }
];

type SortPhase = "enter" | "scan" | "file";

function AutoSortBand() {
  const { ref, revealed } = useReveal<HTMLElement>();
  const reduced = usePrefersReducedMotion();
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<SortPhase>("enter");
  const [filed, setFiled] = useState<number[]>([0, 0, 0]);

  useEffect(() => {
    if (!revealed || reduced) return;
    let alive = true;
    let timer = 0;
    const next = (fn: () => void, ms: number) => {
      timer = window.setTimeout(() => {
        if (alive) fn();
      }, ms);
    };

    if (phase === "enter") next(() => setPhase("scan"), 700);
    else if (phase === "scan") next(() => setPhase("file"), 1000);
    else {
      next(() => {
        const folder = SORT_QUEUE[idx].folder;
        setFiled((f) => f.map((n, i) => (i === folder ? n + 1 : n)));
        setIdx((i) => (i + 1) % SORT_QUEUE.length);
        setPhase("enter");
      }, 650);
    }
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [revealed, reduced, phase, idx]);

  const item = SORT_QUEUE[idx];
  // Where the card flies: folder centers sit at 1/6, 3/6, 5/6 of the row.
  // cqw (the stage is a size container) so the throw scales with the stage;
  // transform percentages would be relative to the card itself.
  const tx = `${(item.folder - 1) * 31}cqw`;
  const staticView = reduced;
  const phaseClass = staticView
    ? styles.sortCardStatic
    : phase === "enter"
      ? styles.sort_enter
      : phase === "file"
        ? styles.sort_file
        : "";

  return (
    <section
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={styles.band}
      aria-labelledby="sort-title"
    >
      <div className={styles.duo}>
        <div className={`${styles.duoCopy} ${styles.reveal}`}>
          <p className={styles.eyebrow}>Automatic collections</p>
          <h2 id="sort-title" className={styles.title}>
            Collections that sort themselves.
          </h2>
          <p className={styles.duoBody}>
            Set a rule once. From then on, every new email that matches files
            itself into the right collection. No dragging, no tagging, no
            maintenance.
          </p>
          <Link href="/features/collections" className={styles.sideLink}>
            See collections
            <ArrowIcon />
          </Link>
        </div>

        <div
          className={`${styles.sortStage} ${styles.reveal}`}
          style={{ ["--i" as string]: 1 }}
          aria-label="New emails being sorted into collections by rules"
        >
          <div className={styles.sortRules}>
            <SparkleIcon />
            Auto-rules
            <span className={styles.sortRulesHint}>sorting new emails</span>
          </div>

          <div className={styles.sortLane}>
            <div
              key={idx}
              className={`${styles.sortCard} ${phaseClass}`}
              style={{ ["--tx" as string]: tx }}
            >
              <span className={styles.sortCardHeader} />
              <span className={styles.sortCardLine} style={{ width: "82%" }} />
              <span className={styles.sortCardLine} style={{ width: "58%" }} />
              <span className={styles.sortCardBlock} />
              <span
                className={`${styles.sortChip} ${
                  styles[`tone_${item.tone}`]
                } ${phase !== "enter" || staticView ? styles.sortChipOn : ""}`}
              >
                {item.chip}
              </span>
            </div>
          </div>

          <div className={styles.sortFolders}>
            {SORT_FOLDERS.map((f, i) => {
              const count = f.base + (staticView ? 0 : filed[i]);
              const receiving =
                !staticView && phase === "file" && item.folder === i;
              return (
                <div
                  key={f.name}
                  className={`${styles.sortFolder} ${
                    receiving ? styles.sortFolderPulse : ""
                  }`}
                >
                  <FolderIcon />
                  <span className={styles.sortFolderName}>{f.name}</span>
                  <span className={styles.sortFolderCount}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* =================================================================
   Section 3 — Comparisons: logo orbit that becomes a bar chart
   ================================================================= */

// REAL numbers per brand, queried from captured_emails on 2026-07-31
// over the trailing 90 days: capture count, average/min/max stated
// discount (across its discount emails), the most common send hour,
// and the full hourly send histogram as [hour, count] pairs, all in
// Europe/Copenhagen. If a brand is swapped, re-query the DB; never
// invent these values. Only brands that are actively sending belong
// here (Muuto was dropped 2026-07-31 after 43 silent days).
const ORBIT_BRANDS = [
  { name: "ARKET", host: "arket.com", sends: 103, discount: 30, dmin: 10, dmax: 50, hour: 7, hourly: [[6, 4], [7, 56], [8, 24], [9, 2], [16, 4], [18, 12], [20, 1]] },
  { name: "Samsøe Samsøe", host: "samsoe.com", sends: 40, discount: 31, dmin: 10, dmax: 50, hour: 8, hourly: [[8, 34], [9, 1], [10, 3], [11, 1], [19, 1]] },
  { name: "Ferm Living", host: "fermliving.dk", sends: 37, discount: 36, dmin: 10, dmax: 60, hour: 6, hourly: [[0, 1], [6, 8], [7, 6], [8, 8], [9, 1], [10, 1], [15, 4], [16, 8]] },
  { name: "Georg Jensen", host: "georgjensen.com", sends: 36, discount: 20, dmin: 20, dmax: 20, hour: 9, hourly: [[9, 31], [11, 1], [12, 1], [14, 1], [16, 1], [20, 1]] },
  { name: "Stine Goya", host: "stinegoya.com", sends: 36, discount: 36, dmin: 10, dmax: 70, hour: 19, hourly: [[7, 2], [8, 5], [9, 3], [11, 2], [14, 1], [19, 13], [20, 9], [21, 1]] },
  { name: "By Malene Birger", host: "bymalenebirger.com", sends: 34, discount: 29, dmin: 10, dmax: 40, hour: 12, hourly: [[7, 9], [8, 2], [12, 20], [16, 1], [20, 2]] },
  { name: "GANNI", host: "ganni.com", sends: 26, discount: 16, dmin: 15, dmax: 50, hour: 10, hourly: [[8, 1], [10, 18], [11, 2], [13, 1], [14, 1], [20, 3]] },
  { name: "Rapha", host: "rapha.cc", sends: 23, discount: 41, dmin: 15, dmax: 50, hour: 16, hourly: [[14, 1], [16, 10], [17, 5], [19, 1], [20, 6]] }
];

const RANGE_MAX = Math.max(...ORBIT_BRANDS.map((b) => b.dmax));

function formatHour(h: number) {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// The chart cycles through three real metrics. Quantities render as
// bars; the send hour is a POSITION in the day, not a magnitude, so it
// renders as a dot on a time scale instead of a tall-means-more bar.
type OrbitBrand = (typeof ORBIT_BRANDS)[number];
const HOUR_MIN = 5;
const HOUR_SPAN = 17; // the scale runs 5:00 → 22:00

/* Send times render as a vertical heat strip per brand: one slim
   track spanning the day, its hour cells darkening with the share of
   sends that land there. Same opacity ramp as the app's compare
   heatmap, so the poster matches the real product. Top = late. */
const HEAT_CELLS = ORBIT_BRANDS.map((b) => {
  const counts = Array.from({ length: HOUR_SPAN }, () => 0);
  b.hourly.forEach(([h, n]) => {
    if (h >= HOUR_MIN && h < HOUR_MIN + HOUR_SPAN) counts[h - HOUR_MIN] = n;
  });
  const max = Math.max(...counts, 1);
  // Zero hours stay invisible; the strip's thin spine (CSS) carries
  // the day, and only real send hours render as blocks on it.
  return counts
    .map((n) => (n === 0 ? 0 : 0.15 + (n / max) * 0.85))
    .reverse();
});

// The busiest block on each strip carries its own time label, so the
// peak explains itself in place. Derived from the strip (not b.hour)
// so ties resolve to the block that actually renders darkest.
const HEAT_PEAKS = HEAT_CELLS.map((cells) => {
  // lastIndexOf: cells run late→early, so ties resolve to the
  // EARLIEST peak hour (matches the DB's mode; only Ferm ties).
  const idx = cells.lastIndexOf(Math.max(...cells));
  return { idx, label: formatHour(HOUR_MIN + HOUR_SPAN - 1 - idx) };
});

const ORBIT_METRICS: Array<{
  title: string;
  kind: "bar" | "range" | "heat";
  value: (b: OrbitBrand) => number;
  label: (b: OrbitBrand) => string;
  frac?: (v: number) => number;
  lo?: (b: OrbitBrand) => number;
  hi?: (b: OrbitBrand) => number;
  mid?: (b: OrbitBrand) => number;
}> = [
  {
    title: "Send cadence · emails per week",
    kind: "bar",
    value: (b) => (b.sends / 90) * 7,
    label: (b) => ((b.sends / 90) * 7).toFixed(1)
  },
  {
    // Floating min→max bar with a tick at the average.
    title: "Discount range · min, average and max",
    kind: "range",
    value: (b) => b.discount,
    label: (b) => `${b.dmax}%`,
    frac: (v) => v / RANGE_MAX,
    lo: (b) => b.dmin,
    hi: (b) => b.dmax,
    mid: (b) => b.discount
  },
  {
    title: "Send times · where in the day they land",
    kind: "heat",
    value: (b) => b.hour,
    label: (b) => formatHour(b.hour)
  }
];

// Chart geometry, in % of the stage: bars rise from the baseline.
const BASELINE = 18; // % from the bottom
const PLOT = 60; // max bar height in %

function CompareOrbit() {
  const { ref, revealed } = useReveal<HTMLElement>();
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<"orbit" | "chart">("orbit");
  const [metricIdx, setMetricIdx] = useState(0);
  const chipRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!revealed) return;
    if (reduced) {
      setPhase("chart");
      return;
    }
    setPhase("orbit");

    // A perfect circle in PIXELS: the stage is wider than tall, so the
    // percentage radii must differ per axis or the ring turns into an
    // ellipse with uneven gaps between the logos.
    const stageRect = stageRef.current?.getBoundingClientRect();
    const radius = stageRect
      ? 0.42 * Math.min(stageRect.width, stageRect.height)
      : 0;
    const rx = stageRect ? (radius / stageRect.width) * 100 : 28;
    const ry = stageRect ? (radius / stageRect.height) * 100 : 40;

    let raf = 0;
    let alive = true;
    let angle = 0;
    let last = performance.now();
    let v = 430; // deg/s, decays exponentially until the morph

    const frame = (now: number) => {
      if (!alive) return;
      const dt = (now - last) / 1000;
      last = now;
      angle += v * dt;
      v *= Math.pow(0.42, dt); // ~halves every 0.8s
      chipRefs.current.forEach((el, i) => {
        if (!el) return;
        const a = ((angle + (i * 360) / ORBIT_BRANDS.length) * Math.PI) / 180;
        el.style.left = `${50 + rx * Math.cos(a)}%`;
        el.style.top = `${46 + ry * Math.sin(a)}%`;
      });
      if (v > 24) {
        raf = requestAnimationFrame(frame);
      } else {
        setPhase("chart");
      }
    };
    raf = requestAnimationFrame(frame);
    // Backgrounded or throttled documents may never finish the spin;
    // land the chart anyway. Stop the loop BEFORE switching phase or
    // late rAF frames overwrite the chips' chart positions.
    const fallback = window.setTimeout(() => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      setPhase("chart");
    }, 4200);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
    };
  }, [revealed, reduced]);

  // Once the chart has landed, keep rotating through the metrics.
  useEffect(() => {
    if (!revealed || phase !== "chart") {
      setMetricIdx(0);
      return;
    }
    const timer = window.setInterval(
      () => setMetricIdx((m) => (m + 1) % ORBIT_METRICS.length),
      3800
    );
    return () => window.clearInterval(timer);
  }, [revealed, phase]);

  // In the chart phase the chips transition (CSS) from wherever the
  // orbit left them to their column on the axis.
  const chart = phase === "chart";
  const metric = ORBIT_METRICS[metricIdx];
  const metricMax = Math.max(...ORBIT_BRANDS.map(metric.value));

  return (
    <section
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={styles.band}
      aria-labelledby="cmp-title"
    >
      <div className={`${styles.head} ${styles.reveal}`}>
        <p className={styles.eyebrow}>Brand comparisons</p>
        <h2 id="cmp-title" className={styles.title}>
          Line up the brands you care about.
        </h2>
        <p className={styles.lede}>
          Pick a cohort and see who actually sends, how often, and how deep
          the discounts go.
        </p>
      </div>

      <div
        ref={stageRef}
        className={`${styles.orbitStage} ${styles.reveal}`}
        data-phase={chart ? "chart" : "orbit"}
        data-kind={metric.kind}
        role="img"
        aria-label="Eight real brands compared on send cadence, discount range and send times across the day"
      >
        <span key={metric.title} className={styles.orbitTitle}>
          {metric.title}
        </span>
        {ORBIT_BRANDS.map((b, i) => {
          const val = metric.value(b);
          const x = ((i + 0.5) / ORBIT_BRANDS.length) * 100;
          // Bars grow from the axis; range views float lo→hi with a
          // tick marking the metric's mid value, clamped inside the
          // bar (the mode hour can fall just outside the percentile
          // window on sparse senders).
          const isRange = metric.kind === "range";
          const isHeat = metric.kind === "heat";
          const scale = (v: number) =>
            (metric.frac ? metric.frac(v) : v / metricMax) * PLOT;
          const barBottom = isRange
            ? BASELINE + scale(metric.lo!(b))
            : BASELINE;
          // Heat: the bar collapses (CSS) and the full-height track
          // takes over; h only positions the label at the top row.
          const h = isRange
            ? Math.max(scale(metric.hi!(b)) - scale(metric.lo!(b)), 2)
            : isHeat
              ? PLOT
              : scale(val);
          const tickV = isRange
            ? Math.min(
                Math.max(metric.mid!(b), metric.lo!(b)),
                metric.hi!(b)
              )
            : val;
          const logo = resolveBrandLogo(null, null, b.host);
          return (
            <div key={b.name} className={styles.orbitCol}>
              <div
                className={styles.orbitBar}
                style={{
                  left: `${x}%`,
                  height: `${h}%`,
                  bottom: `${barBottom}%`,
                  transitionDelay: `${chart ? 60 + i * 45 : 350 + i * 55}ms`
                }}
              />
              <span
                className={styles.orbitTick}
                style={{
                  left: `${x}%`,
                  bottom: `${BASELINE + scale(tickV)}%`,
                  transitionDelay: `${chart ? 120 + i * 45 : 0}ms`
                }}
                aria-hidden="true"
              />
              <span
                className={styles.orbitHeat}
                style={{
                  left: `${x}%`,
                  bottom: `${BASELINE}%`,
                  height: `${PLOT}%`,
                  transitionDelay: `${chart ? 120 + i * 45 : 0}ms`
                }}
                aria-hidden="true"
              >
                {HEAT_CELLS[i].map((opacity, c) =>
                  c === HEAT_PEAKS[i].idx ? (
                    <span
                      key={c}
                      className={styles.orbitHeatPeak}
                      style={{ opacity }}
                    >
                      {HEAT_PEAKS[i].label}
                    </span>
                  ) : (
                    <span key={c} style={{ opacity }} />
                  )
                )}
              </span>
              <span
                className={styles.orbitValue}
                style={{
                  left: `${x}%`,
                  bottom: `${barBottom + h + 2}%`,
                  transitionDelay: `${chart ? 60 + i * 45 : 520 + i * 55}ms`
                }}
              >
                {isHeat ? "" : metric.label(b)}
              </span>
              <span
                ref={(el) => {
                  chipRefs.current[i] = el;
                }}
                className={styles.orbitChip}
                style={
                  chart
                    ? {
                        left: `${x}%`,
                        top: `${100 - BASELINE + 8}%`,
                        transitionDelay: `${i * 45}ms`
                      }
                    : undefined
                }
                title={`${b.name} · ${b.sends} emails in 90 days`}
              >
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt={b.name} loading="lazy" />
                ) : (
                  <span className={styles.orbitMono}>{b.name.charAt(0)}</span>
                )}
              </span>
            </div>
          );
        })}
        <span
          className={styles.orbitAxis}
          style={{ bottom: `${BASELINE}%` }}
          aria-hidden="true"
        />
      </div>

      <p className={`${styles.orbitCaption} ${styles.reveal}`}>
        Real numbers from the archive. ARKET averages 8 emails a week while
        Rapha sends under two, and Stine Goya has cut as deep as 70% and is the
        only evening sender in the cohort.{" "}
        <Link href="/features/comparisons" className={styles.inlineLink}>
          See comparisons
          <ArrowIcon />
        </Link>
      </p>
    </section>
  );
}

/* =================================================================
   Section 4 — the rest of the toolkit, quietly
   ================================================================= */

const MORE_ITEMS: Array<{
  title: string;
  body: string;
  href?: string;
  link?: string;
}> = [
  {
    title: "Work as a team",
    body: "One Team plan covers six seats with shared collections and saves.",
    href: "/pricing",
    link: "See Team pricing"
  },
  {
    title: "Follow your senders",
    body: "A clean feed of new sends from just the brands you picked.",
    href: "/features/following",
    link: "See following"
  },
  {
    title: "Events, spotted",
    body: "Festival and holiday pushes surface automatically as they build.",
    href: "/features/collections",
    link: "See event detection"
  },
  {
    title: "Deadlines, verified",
    body: "Stated offer windows and quiet extensions, drawn on a timeline."
  },
  {
    title: "Design DNA",
    body: "Palettes, fonts and layout habits extracted from every send."
  },
  {
    title: "Search everything",
    body: "Filter the whole archive by brand, colour, content type or date.",
    href: "/features/explore",
    link: "See the library"
  }
];

function MoreBand() {
  const { ref, revealed } = useReveal<HTMLElement>();

  return (
    <section
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={styles.band}
      aria-labelledby="more-title"
    >
      <div className={`${styles.head} ${styles.reveal}`}>
        <p className={styles.eyebrow}>And more</p>
        <h2 id="more-title" className={styles.title}>
          The rest of the toolkit.
        </h2>
      </div>

      <div className={styles.moreGrid}>
        {MORE_ITEMS.map((item, i) => (
          <div
            key={item.title}
            className={`${styles.moreItem} ${styles.reveal}`}
            style={{ ["--i" as string]: i }}
          >
            <h3 className={styles.moreTitle}>{item.title}</h3>
            <p className={styles.moreBody}>{item.body}</p>
            {item.href && item.link ? (
              <Link href={item.href} className={styles.moreLink}>
                {item.link}
                <ArrowIcon />
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </section>
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
      <Link href="/explore" className={styles.ctaButton}>
        Browse the archive
        <ArrowIcon />
      </Link>
    </div>
  );
}

/* -----------------------------------------------------------------
   Icons
   ----------------------------------------------------------------- */

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function SparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
