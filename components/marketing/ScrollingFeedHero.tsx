"use client";

import { useEffect, useRef, useState } from "react";
import {
  FEED_NEWSLETTERS,
  LIVE_COUNTER_START,
  type FeedNewsletter
} from "@/lib/marketing/hero3-data";
import styles from "./scrollingfeed.module.css";

/**
 * The Scrolling Intelligence Feed (/hero3).
 *
 * One column of full-size newsletter renders that scrolls slowly
 * upward on a CSS animation. Two copies of the stack are rendered
 * back-to-back so the loop is seamless. An IntersectionObserver
 * with a thin centre trigger updates the right-edge data panel
 * whenever a different newsletter passes through the centre.
 */
// Scroll speed in pixels per second. Tuned so each newsletter sits in
// the centre for a few unhurried beats. Lower = slower / more cinematic.
const SCROLL_SPEED_PX_PER_SEC = 90;

export default function ScrollingFeedHero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [liveCounter, setLiveCounter] = useState(LIVE_COUNTER_START);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<HTMLElement[]>([]);

  // Live counter ticks up by 1 every 750ms forever. Quiet, constant motion.
  useEffect(() => {
    const id = setInterval(() => {
      setLiveCounter((c) => c + 1);
    }, 750);
    return () => clearInterval(id);
  }, []);

  // JS-driven smooth upward scroll. Each frame advances the translation
  // by elapsed seconds * speed. When the offset reaches one full stack
  // height, we wrap around to 0 — the duplicate stack underneath makes
  // this seamless to the eye.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const stack = stackRef.current;
    if (!scroller || !stack) return;

    let stackHeight = stack.offsetHeight; // height of one copy of the stack
    let offset = 0;
    let last = performance.now();
    let raf = 0;

    const measure = () => {
      stackHeight = stack.offsetHeight;
    };
    const ro = new ResizeObserver(measure);
    ro.observe(stack);

    const tick = (now: number) => {
      const dt = (now - last) / 1000; // seconds
      last = now;

      offset += SCROLL_SPEED_PX_PER_SEC * dt;
      if (stackHeight > 0 && offset >= stackHeight) offset -= stackHeight;

      scroller.style.transform = `translate3d(0, ${-offset}px, 0)`;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Detect which newsletter is currently at viewport centre.
  // A 1px-tall virtual trigger at exactly the middle of the viewport,
  // achieved with a symmetric -50% rootMargin, fires for whichever card
  // crosses it.
  useEffect(() => {
    const cards = cardsRef.current.filter(Boolean);
    if (cards.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.newsletterIndex
            );
            if (!Number.isNaN(idx)) setActiveIndex(idx);
          }
        });
      },
      {
        rootMargin: "-50% 0px -50% 0px",
        threshold: 0
      }
    );

    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, []);

  const active =
    FEED_NEWSLETTERS[activeIndex % FEED_NEWSLETTERS.length] ?? FEED_NEWSLETTERS[0];

  return (
    <section className={styles.feedHero} aria-label="Newsletter analysis feed">
      <div className={styles.scrollerMask}>
        <div className={styles.scroller} ref={scrollerRef}>
          {/* Two copies for seamless infinite scroll */}
          <FeedStack
            newsletters={FEED_NEWSLETTERS}
            cardsRef={cardsRef}
            stackRef={stackRef}
          />
          <FeedStack
            newsletters={FEED_NEWSLETTERS}
            cardsRef={cardsRef}
            ariaHidden
          />
        </div>
      </div>

      <DataPanel newsletter={active} liveCounter={liveCounter} />
    </section>
  );
}

// ---------- Feed stack ---------------------------------------------------

function FeedStack({
  newsletters,
  cardsRef,
  stackRef,
  ariaHidden = false
}: {
  newsletters: FeedNewsletter[];
  cardsRef: React.MutableRefObject<HTMLElement[]>;
  stackRef?: React.MutableRefObject<HTMLDivElement | null>;
  ariaHidden?: boolean;
}) {
  return (
    <div
      ref={stackRef}
      className={styles.stack}
      aria-hidden={ariaHidden ? "true" : undefined}
      // We only want one set in the IntersectionObserver to control the
      // active index. The second (cloned) set has no observed cards.
    >
      {newsletters.map((n, i) => (
        <NewsletterCard
          key={`${n.id}-${ariaHidden ? "b" : "a"}`}
          newsletter={n}
          index={i}
          observeRef={
            ariaHidden
              ? null
              : (el) => {
                  if (el) cardsRef.current[i] = el;
                }
          }
        />
      ))}
    </div>
  );
}

// ---------- Newsletter card ---------------------------------------------

function NewsletterCard({
  newsletter,
  index,
  observeRef
}: {
  newsletter: FeedNewsletter;
  index: number;
  observeRef: ((el: HTMLElement | null) => void) | null;
}) {
  return (
    <article
      ref={observeRef ?? undefined}
      data-newsletter-index={index}
      className={styles.card}
      style={{
        background: newsletter.paperBg,
        color: newsletter.paperInk
      }}
    >
      <header className={styles.cardHeader}>
        <div className={styles.brandLine}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={newsletter.brandMark}
            alt={`${newsletter.brand} logo`}
            className={styles.brandMark}
            loading="lazy"
          />
        </div>
        <div className={styles.cardMeta}>
          <span>{newsletter.brand}</span>
          <span aria-hidden>·</span>
          <span>{newsletter.brandTone}</span>
        </div>
      </header>

      <div className={styles.heroImage}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={newsletter.heroImage} alt={newsletter.heroImageAlt} loading="lazy" />
      </div>

      <div className={styles.cardBody}>
        <p className={styles.preheader}>{newsletter.preheader}</p>
        <h2 className={styles.subject}>{newsletter.subject}</h2>
        <p className={styles.body}>{newsletter.body}</p>
        <div className={styles.ctaRow}>
          <span className={styles.cta}>{newsletter.ctaText}</span>
          <span className={styles.ctaArrow} aria-hidden>
            →
          </span>
        </div>
      </div>

      <footer className={styles.cardFooter}>
        <span>{newsletter.brand}</span>
        <span>{newsletter.sentDay}, {newsletter.sentLocal}</span>
      </footer>
    </article>
  );
}

// ---------- Data panel --------------------------------------------------

function DataPanel({
  newsletter,
  liveCounter
}: {
  newsletter: FeedNewsletter;
  liveCounter: number;
}) {
  return (
    <aside className={styles.panel} aria-live="polite">
      <div className={styles.panelHead}>
        <span className={styles.panelLive}>
          <span className={styles.liveDot} />
          Live analysis
        </span>
      </div>

      {/* Brand line with smooth fade swap on change */}
      <div className={styles.panelBrand} key={`brand-${newsletter.id}`}>
        <span className={styles.panelBrandName}>{newsletter.brand}</span>
        <span className={styles.panelBrandTone}>{newsletter.esp}</span>
      </div>

      <div className={styles.panelGrid}>
        <PanelStat
          label="Sent"
          value={`${newsletter.sentDay} · ${newsletter.sentLocal} CET`}
          changeKey={newsletter.id}
        />
        <PanelStat
          label="Subject"
          value={`${newsletter.subjectLength} chars`}
          changeKey={newsletter.id}
        />
        <PanelStat
          label="Typeface"
          value={newsletter.typeface}
          changeKey={newsletter.id}
        />
        <PanelStat
          label="Images"
          value={`${newsletter.imageCount}`}
          changeKey={newsletter.id}
        />
      </div>

      <div className={styles.panelSection}>
        <div className={styles.panelLabel}>Palette</div>
        <div className={styles.swatches} key={`pal-${newsletter.id}`}>
          {newsletter.palette.map((c, i) => (
            <div
              key={`${newsletter.id}-${c.hex}`}
              className={styles.swatch}
              style={{
                background: c.hex,
                animationDelay: `${i * 70}ms`
              }}
              title={c.label ? `${c.label} ${c.hex}` : c.hex}
            />
          ))}
        </div>
      </div>

      <div className={styles.panelDivider} />

      <div className={styles.counter}>
        <div className={styles.panelLabel}>Emails analyzed</div>
        <div className={styles.counterValue}>{formatNumber(liveCounter)}</div>
      </div>
    </aside>
  );
}

function PanelStat({
  label,
  value,
  changeKey
}: {
  label: string;
  value: string;
  changeKey: string;
}) {
  return (
    <div className={styles.panelStat}>
      <div className={styles.panelLabel}>{label}</div>
      <div className={styles.panelValue} key={`${label}-${changeKey}`}>
        {value}
      </div>
    </div>
  );
}

function formatNumber(n: number) {
  return n.toLocaleString("en-US");
}
