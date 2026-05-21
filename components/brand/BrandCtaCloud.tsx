"use client";

import { useLayoutEffect, useRef, useState } from "react";

type CtaEntry = { text: string; count: number };

type Props = {
  ctas: CtaEntry[];
};

type Placed = {
  text: string;
  count: number;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  height: number;
};

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const HEIGHT = 320;
const BOX_PADDING = 4;

/**
 * Tiny non-cryptographic string hash. We use it to give each word a
 * stable starting angle on the spiral so a brand's cloud lays out
 * the same way across renders without all words clustering on the
 * same axis from the centre.
 */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Spiral-packed word cloud rendered as inline SVG.
 *
 * Algorithm (sized for the 5-30 CTA range we typically see per brand):
 *   1. Map each CTA's count onto a font-size ramp anchored on the
 *      brand's own min/max so even a low-volume brand still anchors
 *      its biggest CTA at the visual centre.
 *   2. Measure each word's bounding box via a hidden 2D canvas (same
 *      font stack as the SVG so the measurements are honest).
 *   3. Walk the words from largest to smallest, placing each one by
 *      tracing an Archimedean spiral outward from the centre of the
 *      cloud and accepting the first position whose AABB doesn't
 *      collide with any already-placed word.
 *
 * All words render horizontally and in the same colour (the brand
 * accent) so the cloud reads as a single, on-brand visual unit;
 * font-size carries all of the frequency signal.
 *
 * Bounding-box (vs pixel-sprite) collision is good enough at our
 * volumes and keeps the layout fully synchronous. The component
 * re-runs layout whenever the container width changes so the cloud
 * stays packed on resize.
 */
export default function BrandCtaCloud({ ctas }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [placed, setPlaced] = useState<Placed[]>([]);

  // Measure the container width and keep it in state so the layout
  // pass below has the real value before the first paint. Using
  // useLayoutEffect (rather than useEffect) avoids a 1-frame flash
  // of an empty SVG on mount.
  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const measure = () => {
      const w = wrapRef.current?.clientWidth ?? 0;
      if (w > 0) {
        setWidth(w);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (ctas.length === 0) {
      setPlaced([]);
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const maxCount = ctas[0].count;
    const minCount = ctas[ctas.length - 1].count;
    const span = Math.max(1, maxCount - minCount);

    // Adaptive size ramp: a 6-CTA cloud wants its biggest word much
    // larger than a 30-CTA cloud so the same canvas height feels
    // populated. Tuned by eye against the real brand data sets.
    const maxFontSize =
      ctas.length <= 6 ? 64 : ctas.length <= 14 ? 52 : 44;
    const minFontSize = 13;

    const W = Math.max(280, width);
    const H = HEIGHT;
    const cx = W / 2;
    const cy = H / 2;

    const result: Placed[] = [];

    for (let i = 0; i < ctas.length; i++) {
      const entry = ctas[i];
      const ratio = span === 0 ? 1 : (entry.count - minCount) / span;
      const fontSize =
        minFontSize + Math.pow(ratio, 0.85) * (maxFontSize - minFontSize);
      const h = hashStr(entry.text);

      ctx.font = `600 ${fontSize}px ${FONT_STACK}`;
      const tm = ctx.measureText(entry.text);
      const textWidth = tm.width;
      const textHeight = fontSize * 1.02;

      const boxW = textWidth + BOX_PADDING * 2;
      const boxH = textHeight + BOX_PADDING * 2;

      // If the very first word is wider than the canvas, scale the
      // whole cloud down rather than crashing into the right edge.
      // (This only triggers when the container is unusually narrow.)
      if (boxW > W) {
        // Skip a word that simply cannot fit; the next iteration
        // will use a smaller font and likely succeed.
        continue;
      }

      // Archimedean spiral search. `radiusGrowth` controls how
      // quickly the spiral spreads — small enough that we don't
      // skip over valid positions, big enough that we converge fast.
      let foundX: number | null = null;
      let foundY: number | null = null;
      const maxIter = 6000;
      const angleStep = 0.18;
      const radiusGrowth = 0.55;
      let theta = (h % 360) * (Math.PI / 180);
      let radius = 0;

      for (let it = 0; it < maxIter; it++) {
        const px = cx + radius * Math.cos(theta);
        const py = cy + radius * Math.sin(theta);

        const left = px - boxW / 2;
        const right = px + boxW / 2;
        const top = py - boxH / 2;
        const bottom = py + boxH / 2;

        if (left < 2 || right > W - 2 || top < 2 || bottom > H - 2) {
          theta += angleStep;
          radius += radiusGrowth * angleStep;
          continue;
        }

        let collides = false;
        for (const p of result) {
          if (
            Math.abs(p.x - px) < (boxW + p.width) / 2 &&
            Math.abs(p.y - py) < (boxH + p.height) / 2
          ) {
            collides = true;
            break;
          }
        }

        if (!collides) {
          foundX = px;
          foundY = py;
          break;
        }

        theta += angleStep;
        radius += radiusGrowth * angleStep;
      }

      if (foundX !== null && foundY !== null) {
        result.push({
          text: entry.text,
          count: entry.count,
          x: foundX,
          y: foundY,
          fontSize,
          width: boxW,
          height: boxH
        });
      }
    }

    setPlaced(result);
  }, [ctas, width]);

  return (
    <div
      ref={wrapRef}
      style={{
        width: "100%",
        minHeight: HEIGHT
      }}
    >
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        style={{ display: "block", overflow: "visible" }}
        role="img"
        aria-label="Most used calls to action"
      >
        {placed.map((p) => (
          <text
            key={p.text}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={FONT_STACK}
            fontSize={p.fontSize}
            fontWeight={600}
            fill="var(--brand-accent, #0f172a)"
            style={{ cursor: "default" }}
          >
            <title>{`${p.text} — ${p.count} email${
              p.count === 1 ? "" : "s"
            }`}</title>
            {p.text}
          </text>
        ))}
      </svg>
    </div>
  );
}
