"use client";

import { useEffect, useRef, useState } from "react";
import { MOSAIC_IMAGES, SEARCH_SCENARIOS } from "@/lib/marketing/hero2-data";
import styles from "./searchhero.module.css";

type Phase = "idle" | "typing" | "paused" | "revealed" | "holding" | "resetting";

const TIMING = {
  idle: 700,
  charInterval: 55,
  paused: 380,
  revealed: 700, // results visible, before stats appear
  holding: 2400, // dwell after stats are in
  resetting: 550
};

export default function SearchHero() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [typed, setTyped] = useState("");

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scenario = SEARCH_SCENARIOS[scenarioIdx];

  // Drive the state machine. Each phase schedules its own exit.
  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    clearTimer();

    if (phase === "idle") {
      setTyped("");
      timerRef.current = setTimeout(() => setPhase("typing"), TIMING.idle);
    } else if (phase === "typing") {
      let i = 0;
      intervalRef.current = setInterval(() => {
        i += 1;
        setTyped(scenario.query.slice(0, i));
        if (i >= scenario.query.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          timerRef.current = setTimeout(() => setPhase("paused"), TIMING.paused);
        }
      }, TIMING.charInterval);
    } else if (phase === "paused") {
      timerRef.current = setTimeout(() => setPhase("revealed"), 50);
    } else if (phase === "revealed") {
      timerRef.current = setTimeout(() => setPhase("holding"), TIMING.revealed);
    } else if (phase === "holding") {
      timerRef.current = setTimeout(() => setPhase("resetting"), TIMING.holding);
    } else if (phase === "resetting") {
      timerRef.current = setTimeout(() => {
        setScenarioIdx((i) => (i + 1) % SEARCH_SCENARIOS.length);
        setPhase("idle");
      }, TIMING.resetting);
    }

    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scenarioIdx]);

  const isRevealed = phase === "revealed" || phase === "holding";
  const showStats = phase === "holding";

  return (
    <section className={styles.searchHero} aria-label="Search demo">
      {/* Background mosaic */}
      <div
        className={`${styles.mosaicWrap} ${isRevealed ? styles.mosaicDimmed : ""}`}
        aria-hidden="true"
      >
        <div className={styles.mosaic}>
          {MOSAIC_IMAGES.map((src, i) => (
            <div
              key={`${src}-${i}`}
              className={styles.tile}
              style={{
                gridRowEnd: `span ${TILE_SPANS[i % TILE_SPANS.length]}`,
                transform: `rotate(${TILE_ROTATIONS[i % TILE_ROTATIONS.length]}deg)`
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" />
            </div>
          ))}
        </div>
        <div className={styles.mosaicVignette} />
      </div>

      {/* Foreground stack */}
      <div className={styles.foreground}>
        <div className={styles.searchBar}>
          <svg
            className={styles.searchIcon}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span className={styles.searchPrefix}>{scenario.prefix ?? ""}</span>
          <span className={styles.searchQuery}>
            {typed}
            <span
              className={`${styles.cursor} ${
                phase === "typing" ? styles.cursorTyping : ""
              }`}
              aria-hidden="true"
            />
          </span>
          <kbd className={styles.kbd}>↵</kbd>
        </div>

        {/* Result cards */}
        <div
          className={`${styles.results} ${isRevealed ? styles.resultsIn : ""}`}
          aria-live="polite"
        >
          {scenario.results.map((r, i) => (
            <article
              key={r.emailId}
              className={styles.resultCard}
              style={{ "--i": i } as React.CSSProperties}
            >
              <div className={styles.resultThumb}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.imageSrc} alt={`${r.brand} — ${r.subject}`} loading="lazy" />
              </div>
              <div className={styles.resultMeta}>
                <span className={styles.resultBrand}>{r.brand}</span>
                <span className={styles.resultSubject}>{r.subject}</span>
              </div>
            </article>
          ))}
        </div>

        {/* Stat pills */}
        <div
          className={`${styles.stats} ${showStats ? styles.statsIn : ""}`}
          aria-live="polite"
        >
          <div className={styles.statPill} style={{ "--i": 0 } as React.CSSProperties}>
            <CalendarIcon />
            <span>{scenario.stats.sendDay}</span>
          </div>
          <div className={styles.statPill} style={{ "--i": 1 } as React.CSSProperties}>
            <TextIcon />
            <span>{scenario.stats.subjectLength}</span>
          </div>
          <div className={styles.statPill} style={{ "--i": 2 } as React.CSSProperties}>
            <span
              className={styles.colorChip}
              style={{ background: scenario.stats.color.hex }}
              aria-hidden="true"
            />
            <span>{scenario.stats.color.label}</span>
          </div>
        </div>

        {/* Loop indicator dots */}
        <div className={styles.dots} aria-hidden="true">
          {SEARCH_SCENARIOS.map((_, i) => (
            <span
              key={i}
              className={`${styles.dot} ${i === scenarioIdx ? styles.dotActive : ""}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// Deterministic decorations so SSR and client agree
const TILE_SPANS = [16, 22, 18, 24, 14, 20, 26, 18, 22, 16, 24, 18];
const TILE_ROTATIONS = [-2, 1, -1, 2, 0, -2, 1, 0, 2, -1, 1, -2];

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M5 7h14M5 12h10M5 17h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
