import type { FigureData } from "@/lib/docs/article-insights";
import styles from "./docs.module.css";

/**
 * Renders a prepared, static archive figure inside an article. Server component
 * — no client JS, just numbers, proportional bars, and a CSS heatmap. Each kind
 * is tuned to make its dataset legible at a glance rather than as a plain list.
 */
export default function InsightFigure({ figure }: { figure: FigureData }) {
  switch (figure.kind) {
    case "statStrip":
      return <StatStrip figure={figure} />;
    case "shareBar":
      return <ShareBar figure={figure} />;
    case "heatStrip":
      return <HeatStrip figure={figure} />;
    case "rangeBars":
      return <RangeBars figure={figure} />;
    case "pairedBars":
      return <PairedBars figure={figure} />;
    default:
      return null;
  }
}

/** Opacity ramp so ranked segments read as one cohesive, fading scale. */
const RAMP = [1, 0.82, 0.64, 0.5, 0.38, 0.29, 0.22, 0.17];

function fmt1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
}

function StatStrip({ figure }: { figure: Extract<FigureData, { kind: "statStrip" }> }) {
  if (figure.items.length === 0) return null;
  return (
    <div className={styles.statStrip}>
      {figure.items.map((item) => (
        <div key={item.label} className={styles.statCard}>
          <span className={styles.statBig}>{item.value}</span>
          <span className={styles.statLabel}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function ShareBar({ figure }: { figure: Extract<FigureData, { kind: "shareBar" }> }) {
  if (figure.segments.length === 0) return null;
  const tint = (i: number, label: string) =>
    label.startsWith("Other") ? "rgba(11,11,12,0.16)" : `color-mix(in srgb, var(--accent) ${Math.round(RAMP[Math.min(i, RAMP.length - 1)] * 100)}%, transparent)`;
  return (
    <figure className={styles.shareFigure}>
      {figure.caption ? <figcaption className={styles.rankCaption}>{figure.caption}</figcaption> : null}
      <div className={styles.shareBar}>
        {figure.segments.map((s, i) => (
          <span
            key={s.label}
            className={styles.shareSeg}
            style={{ width: `${s.share}%`, background: tint(i, s.label) }}
            title={`${s.label} · ${s.share}%`}
          />
        ))}
      </div>
      <ul className={styles.shareLegend}>
        {figure.segments.map((s, i) => (
          <li key={s.label} className={styles.shareLegendItem}>
            <span className={styles.shareDot} style={{ background: tint(i, s.label) }} />
            <span className={styles.shareLegendLabel}>{s.label}</span>
            <span className={styles.shareLegendVal}>{s.share}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function HeatStrip({ figure }: { figure: Extract<FigureData, { kind: "heatStrip" }> }) {
  if (figure.cells.length === 0) return null;
  const max = Math.max(1, ...figure.cells);
  const hourLabel = (h: number) => {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${h < 12 ? "am" : "pm"}`;
  };
  return (
    <figure className={styles.heatFigure}>
      {figure.caption ? <figcaption className={styles.rankCaption}>{figure.caption}</figcaption> : null}
      <div className={styles.heatRow}>
        {figure.cells.map((c, h) => (
          <span
            key={h}
            className={h === figure.peakIndex ? `${styles.heatCell} ${styles.heatCellPeak}` : styles.heatCell}
            style={{ background: `color-mix(in srgb, var(--accent) ${Math.round((0.1 + 0.9 * (c / max)) * 100)}%, transparent)` }}
            title={`${hourLabel(h)} — ${c} sends`}
          />
        ))}
      </div>
      <div className={styles.heatAxis}>
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
    </figure>
  );
}

function RangeBars({ figure }: { figure: Extract<FigureData, { kind: "rangeBars" }> }) {
  if (figure.items.length === 0) return null;
  const items = [...figure.items].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...items.map((i) => i.value), figure.reference?.value ?? 0);
  const refPct = figure.reference ? (figure.reference.value / max) * 100 : null;
  return (
    <figure className={styles.rankFigure}>
      {figure.caption ? <figcaption className={styles.rankCaption}>{figure.caption}</figcaption> : null}
      {items.map((item) => (
        <div key={item.label} className={styles.rankRow}>
          <span className={styles.rankLabel} title={item.label}>
            {item.label}
          </span>
          <span className={styles.rangeTrack}>
            <span className={styles.rankFill} style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
            {refPct !== null ? <span className={styles.rangeRef} style={{ left: `${refPct}%` }} /> : null}
          </span>
          <span className={styles.rankVal}>{item.display}</span>
        </div>
      ))}
      {figure.reference ? (
        <p className={styles.rangeRefNote}>
          <span className={styles.rangeRefSwatch} /> {figure.reference.label}: {fmt1(figure.reference.value)} / week
        </p>
      ) : null}
    </figure>
  );
}

function PairedBars({ figure }: { figure: Extract<FigureData, { kind: "pairedBars" }> }) {
  if (figure.items.length === 0) return null;
  const maxA = Math.max(1, ...figure.items.map((i) => i.a.value));
  const maxB = Math.max(1, ...figure.items.map((i) => i.b.value));
  return (
    <figure className={styles.rankFigure}>
      {figure.caption ? <figcaption className={styles.rankCaption}>{figure.caption}</figcaption> : null}
      <div className={styles.pairLegend}>
        <span className={styles.pairKey}>
          <span className={`${styles.pairDot} ${styles.pairDotA}`} />
          {figure.aLabel}
        </span>
        <span className={styles.pairKey}>
          <span className={`${styles.pairDot} ${styles.pairDotB}`} />
          {figure.bLabel}
        </span>
      </div>
      {figure.items.map((item) => (
        <div key={item.label} className={styles.pairRow}>
          <span className={styles.rankLabel} title={item.label}>
            {item.label}
          </span>
          <span className={styles.pairBars}>
            <span className={styles.pairTrack}>
              <span
                className={`${styles.pairFill} ${styles.pairFillA}`}
                style={{ width: `${Math.max(2, (item.a.value / maxA) * 100)}%` }}
              />
              <span className={styles.pairVal}>{item.a.display}</span>
            </span>
            <span className={styles.pairTrack}>
              <span
                className={`${styles.pairFill} ${styles.pairFillB}`}
                style={{ width: `${Math.max(2, (item.b.value / maxB) * 100)}%` }}
              />
              <span className={styles.pairVal}>{item.b.display}</span>
            </span>
          </span>
        </div>
      ))}
    </figure>
  );
}
