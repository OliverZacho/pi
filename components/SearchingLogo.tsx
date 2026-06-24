"use client";

import { useEffect, useRef } from "react";

type SearchingLogoProps = {
  className?: string;
  title?: string;
};

// How far a pupil may drift from rest (viewBox units) before it touches the
// inner wall of its counter. The counters are NOT symmetric around the resting
// pupil — the dots sit toward the outer edge of the "p"/"o", so there is lots
// of room to look left but almost none to look right. Measured empirically
// (with a small safety margin) so a hard-left glance really does sweep to the
// edge instead of barely twitching.
const REACH = { left: 5.4, right: 1.2, up: 2.6, down: 2.8 } as const;

/**
 * Pirol wordmark whose two eyes wander around as if searching for something —
 * used on the 404 page. Unlike the everyday {@link Logo}, the eyes here don't
 * wait for the cursor: they autonomously scan to fresh look-points, dwell a
 * beat as if peering, then move on. Honours `prefers-reduced-motion`.
 */
export default function SearchingLogo({
  className,
  title = "Pirol is looking around",
}: SearchingLogoProps) {
  const pEyeRef = useRef<SVGGElement>(null);
  const oEyeRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let raf = 0;
    let dwellTimer: ReturnType<typeof setTimeout>;

    // Both eyes look the same way, like a real pair scanning a room.
    const cur = { x: 0, y: 0 };
    let target = { x: 0, y: 0 };

    const apply = (ref: typeof pEyeRef) => {
      ref.current?.setAttribute("transform", `translate(${cur.x} ${cur.y})`);
    };

    // How far the pupil can travel in a given (unit) direction before hitting
    // the counter wall — the edge of the asymmetric reach ellipse.
    const reachFor = (ux: number, uy: number) => {
      const ax = ux < 0 ? REACH.left : REACH.right;
      const ay = uy < 0 ? REACH.up : REACH.down;
      return 1 / Math.hypot(ux / ax, uy / ay);
    };

    // Curated look directions so the scan reliably hits the dramatic glances
    // (hard left, up, the corners) rather than meandering in the middle.
    const DIRS = [
      [-1, 0], // hard left
      [-0.85, -0.5], // up-left
      [0, -1], // up
      [0.9, -0.45], // up-right
      [1, 0], // right
      [-0.6, 0.75], // down-left
      [0, 1], // down
      [-0.95, 0.2], // left, a touch low
    ];

    // Pick a fresh look-point: mostly a curated direction at near-full reach,
    // occasionally a random angle for life. Reach is clamped to the counter
    // ellipse so even the corners stay inside the glyph.
    const pickTarget = () => {
      let ux: number;
      let uy: number;
      if (Math.random() < 0.7) {
        const d = DIRS[Math.floor(Math.random() * DIRS.length)];
        [ux, uy] = d;
      } else {
        const a = Math.random() * Math.PI * 2;
        ux = Math.cos(a);
        uy = Math.sin(a);
      }
      const len = Math.hypot(ux, uy) || 1;
      ux /= len;
      uy /= len;
      const t = reachFor(ux, uy) * (0.85 + Math.random() * 0.15);
      target = { x: ux * t, y: uy * t };
    };

    const EASE = 0.12;
    const frame = () => {
      cur.x += (target.x - cur.x) * EASE;
      cur.y += (target.y - cur.y) * EASE;
      apply(pEyeRef);
      apply(oEyeRef);

      const settled =
        Math.abs(target.x - cur.x) < 0.02 && Math.abs(target.y - cur.y) < 0.02;
      if (settled) {
        // Reached the look-point: peer at it for a beat, then move on.
        dwellTimer = setTimeout(() => {
          pickTarget();
          raf = window.requestAnimationFrame(frame);
        }, 320 + Math.random() * 520);
        raf = 0;
        return;
      }
      raf = window.requestAnimationFrame(frame);
    };

    pickTarget();
    raf = window.requestAnimationFrame(frame);

    return () => {
      clearTimeout(dwellTimer);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <svg
      className={className}
      viewBox="11.5 7.8 90.5 51.9"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <g fill="var(--pirol-logo-color, currentColor)">
        {/* "pirol" letters with the p/o counters knocked out */}
        <path d="M19.032 23.248C19.896 22.032 21.08 21.024 22.584 20.224C24.12 19.392 25.864 18.976 27.816 18.976C30.088 18.976 32.136 19.536 33.96 20.656C35.816 21.776 37.272 23.376 38.328 25.456C39.416 27.504 39.96 29.888 39.96 32.608C39.96 35.328 39.416 37.744 38.328 39.856C37.272 41.936 35.816 43.552 33.96 44.704C32.136 45.856 30.088 46.432 27.816 46.432C25.864 46.432 24.136 46.032 22.632 45.232C21.16 44.432 19.96 43.424 19.032 42.208V58.672H12.312V19.408H19.032V23.248ZM33.096 32.608C33.096 31.008 32.76 29.632 32.088 28.48C31.448 27.296 30.584 26.4 29.496 25.792C28.44 25.184 27.288 24.88 26.04 24.88C24.824 24.88 23.672 25.2 22.584 25.84C21.528 26.448 20.664 27.344 19.992 28.528C19.352 29.712 19.032 31.104 19.032 32.704C19.032 34.304 19.352 35.696 19.992 36.88C20.664 38.064 21.528 38.976 22.584 39.616C23.672 40.224 24.824 40.528 26.04 40.528C27.288 40.528 28.44 40.208 29.496 39.568C30.584 38.928 31.448 38.016 32.088 36.832C32.76 35.648 33.096 34.24 33.096 32.608ZM44.8912 16.24C43.7072 16.24 42.7152 15.872 41.9152 15.136C41.1472 14.368 40.7632 13.424 40.7632 12.304C40.7632 11.184 41.1472 10.256 41.9152 9.52C42.7152 8.752 43.7072 8.368 44.8912 8.368C46.0752 8.368 47.0512 8.752 47.8192 9.52C48.6192 10.256 49.0192 11.184 49.0192 12.304C49.0192 13.424 48.6192 14.368 47.8192 15.136C47.0512 15.872 46.0752 16.24 44.8912 16.24ZM48.2032 19.408V46H41.4832V19.408H48.2032ZM58.2026 23.536C59.0666 22.128 60.1866 21.024 61.5626 20.224C62.9706 19.424 64.5706 19.024 66.3626 19.024V26.08H64.5866C62.4746 26.08 60.8746 26.576 59.7866 27.568C58.7306 28.56 58.2026 30.288 58.2026 32.752V46H51.4826V19.408H58.2026V23.536ZM79.3369 46.432C76.7769 46.432 74.4729 45.872 72.4249 44.752C70.3769 43.6 68.7609 41.984 67.5769 39.904C66.4249 37.824 65.8489 35.424 65.8489 32.704C65.8489 29.984 66.4409 27.584 67.6249 25.504C68.8409 23.424 70.4889 21.824 72.5689 20.704C74.6489 19.552 76.9689 18.976 79.5289 18.976C82.0889 18.976 84.4089 19.552 86.4889 20.704C88.5689 21.824 90.2009 23.424 91.3849 25.504C92.6009 27.584 93.2089 29.984 93.2089 32.704C93.2089 35.424 92.5849 37.824 91.3369 39.904C90.1209 41.984 88.4569 43.6 86.3449 44.752C84.2649 45.872 81.9289 46.432 79.3369 46.432ZM79.3369 40.576C80.5529 40.576 81.6889 40.288 82.7449 39.712C83.8329 39.104 84.6969 38.208 85.3369 37.024C85.9769 35.84 86.2969 34.4 86.2969 32.704C86.2969 30.176 85.6249 28.24 84.2809 26.896C82.9689 25.52 81.3529 24.832 79.4329 24.832C77.5129 24.832 75.8969 25.52 74.5849 26.896C73.3049 28.24 72.6649 30.176 72.6649 32.704C72.6649 35.232 73.2889 37.184 74.5369 38.56C75.8169 39.904 77.4169 40.576 79.3369 40.576ZM101.498 10.48V46H94.7782V10.48H101.498Z" />
        {/* Eye dot in the "o" counter */}
        <g ref={oEyeRef}>
          <path d="M83.288 37.336C82.072 37.336 81.064 36.968 80.264 36.232C79.496 35.464 79.112 34.52 79.112 33.4C79.112 32.28 79.496 31.352 80.264 30.616C81.064 29.848 82.072 29.464 83.288 29.464C84.472 29.464 85.448 29.848 86.216 30.616C86.984 31.352 87.368 32.28 87.368 33.4C87.368 34.52 86.984 35.464 86.216 36.232C85.448 36.968 84.472 37.336 83.288 37.336Z" />
        </g>
        {/* Eye dot in the "p" counter */}
        <g ref={pEyeRef}>
          <path d="M30.288 37.336C29.072 37.336 28.064 36.968 27.264 36.232C26.496 35.464 26.112 34.52 26.112 33.4C26.112 32.28 26.496 31.352 27.264 30.616C28.064 29.848 29.072 29.464 30.288 29.464C31.472 29.464 32.448 29.848 33.216 30.616C33.984 31.352 34.368 32.28 34.368 33.4C34.368 34.52 33.984 35.464 33.216 36.232C32.448 36.968 31.472 37.336 30.288 37.336Z" />
        </g>
      </g>
    </svg>
  );
}
