"use client";

import { useEffect, useState } from "react";
import { HERO_ANALYTICS, HERO_EMAIL } from "@/lib/marketing/hero-data";
import styles from "./splitreveal.module.css";

const COUNTER_START_MS = 4200;
const COUNTER_DURATION_MS = 900;

export default function AnalysisPanel() {
  const a = HERO_ANALYTICS;
  const email = HERO_EMAIL;
  const target = a.competitorWindow.count;

  const [count, setCount] = useState(0);

  useEffect(() => {
    let raf = 0;
    const startTimer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / COUNTER_DURATION_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        setCount(Math.round(eased * target));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, COUNTER_START_MS);

    return () => {
      window.clearTimeout(startTimer);
      cancelAnimationFrame(raf);
    };
  }, [target]);

  const maxBar = Math.max(...a.sendTime.chart.map((b) => b.count));

  return (
    <aside className={styles.panel} aria-label="Pirol intelligence analysis">
      <header className={styles.panelHeader} style={{ animationDelay: "0.3s" }}>
        <div className={styles.panelEyebrow}>
          <span className={styles.dot} aria-hidden="true" />
          Pirol intelligence
        </div>
        <div className={styles.panelTitleRow}>
          <span className={styles.brandBadge}>{email.brand.name}</span>
          <span className={styles.divider}>/</span>
          <span className={styles.espBadge}>
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path
                d="m5 12 4 4 10-10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Sent with {email.esp.label}
          </span>
        </div>
      </header>

      <section className={styles.panelSection} style={{ animationDelay: "0.6s" }}>
        <div className={styles.sectionLabel}>Palette extracted</div>
        <div className={styles.swatches}>
          {a.palette.map((c, i) => (
            <div
              key={c.hex}
              className={styles.swatch}
              style={
                {
                  background: c.hex,
                  animationDelay: `${0.85 + i * 0.12}s`
                } as React.CSSProperties
              }
              title={`${c.label} · ${c.hex}`}
            >
              <span className={styles.swatchHex}>{c.hex}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panelSection} style={{ animationDelay: "1.7s" }}>
        <div className={styles.sectionLabel}>Typography</div>
        <ul className={styles.fontList}>
          {a.fonts.map((f, i) => (
            <li
              key={f.name}
              className={styles.fontRow}
              style={{ animationDelay: `${1.9 + i * 0.15}s` }}
            >
              <span className={styles.fontName} style={{ fontFamily: `${f.name}, sans-serif` }}>
                {f.name}
              </span>
              <span className={styles.fontRole}>{f.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.panelSection} style={{ animationDelay: "2.7s" }}>
        <div className={styles.sectionRow}>
          <span className={styles.sectionLabel}>Send time pattern</span>
          <span className={styles.sectionMeta}>
            {a.sendTime.hourLabel} {a.sendTime.timezone}
          </span>
        </div>
        <div className={styles.chart} aria-hidden="true">
          {a.sendTime.chart.map((bar, i) => (
            <div key={bar.hour} className={styles.barCol}>
              <div
                className={`${styles.bar} ${bar.highlighted ? styles.barOn : ""}`}
                style={
                  {
                    "--bar-h": `${(bar.count / maxBar) * 100}%`,
                    animationDelay: `${2.95 + i * 0.045}s`
                  } as React.CSSProperties
                }
              />
              {bar.hour % 4 === 0 ? (
                <span className={styles.barLabel}>{bar.hour}</span>
              ) : (
                <span className={styles.barLabel} aria-hidden="true">
                  &nbsp;
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.statCard} style={{ animationDelay: "3.9s" }}>
        <div className={styles.statNumber}>
          <span>{count}</span>
        </div>
        <div className={styles.statCopy}>
          <div className={styles.statTitle}>competitor brands hit the same window</div>
          <div className={styles.statSubtitle}>{a.competitorWindow.windowLabel}</div>
          <div className={styles.statBrands}>
            {a.competitorWindow.sampleBrands.map((b) => (
              <span key={b} className={styles.brandChip}>
                {b}
              </span>
            ))}
          </div>
        </div>
      </section>
    </aside>
  );
}
