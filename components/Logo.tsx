"use client";

import { useEffect, useRef } from "react";

type LogoProps = {
  className?: string;
  title?: string;
};

// Eye-dot centres in viewBox units, and how far they may drift from rest.
const EYES = {
  p: { cx: 30.24, cy: 33.4 },
  o: { cx: 83.24, cy: 33.4 },
} as const;
const MAX_OFFSET = 1.9; // viewBox units — small enough to stay in the counters

// viewBox = "11.5 7.8 90.5 51.9"
const VIEW = { minX: 11.5, minY: 7.8, width: 90.5, height: 51.9 } as const;

/**
 * Pirol wordmark ("pirol", lowercase).
 *
 * Painted with plain vector fills driven by `--pirol-logo-color` (ink,
 * defined in globals.css; falls back to `currentColor`), so the mark recolours
 * per surface exactly like its predecessor. The two filled dots sit inside the
 * open counters of the "p" and "o" — the eye motif nodding to the oriole the
 * brand is named after. The viewBox is trimmed to the glyph bounds so the
 * wordmark fills its box without extra padding.
 *
 * Easter egg: very rarely (and briefly) the two eyes wake up and follow the
 * cursor for ~5 seconds before easing back to centre.
 */
export default function Logo({ className, title = "Pirol" }: LogoProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pEyeRef = useRef<SVGGElement>(null);
  const oEyeRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let active = false;
    let pointer: { x: number; y: number } | null = null;
    let raf = 0;
    let looping = false;
    let wakeTimer: ReturnType<typeof setTimeout>;
    let sleepTimer: ReturnType<typeof setTimeout>;

    // Current (animated) offset per eye; eased toward the target each frame.
    const cur = { p: { x: 0, y: 0 }, o: { x: 0, y: 0 } };

    // Where an eye wants to be right now (toward the cursor while active,
    // back to rest otherwise).
    const targetFor = (eye: { cx: number; cy: number }) => {
      if (!active || !pointer) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
      // Map the eye's viewBox centre to screen space.
      const eyeX =
        rect.left + ((eye.cx - VIEW.minX) / VIEW.width) * rect.width;
      const eyeY =
        rect.top + ((eye.cy - VIEW.minY) / VIEW.height) * rect.height;
      const dx = pointer.x - eyeX;
      const dy = pointer.y - eyeY;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, dist / 120) * MAX_OFFSET;
      return { x: (dx / dist) * reach, y: (dy / dist) * reach };
    };

    const apply = (ref: typeof pEyeRef, o: { x: number; y: number }) => {
      ref.current?.setAttribute("transform", `translate(${o.x} ${o.y})`);
    };

    // Ease toward the target so both following and the return glide rather
    // than teleport. Self-stops once settled. The return (active === false)
    // drifts back noticeably slower than the snappier cursor-following.
    const FOLLOW_EASE = 0.18;
    const RETURN_EASE = 0.05;
    const frame = () => {
      const ease = active ? FOLLOW_EASE : RETURN_EASE;
      const tp = targetFor(EYES.p);
      const to = targetFor(EYES.o);
      cur.p.x += (tp.x - cur.p.x) * ease;
      cur.p.y += (tp.y - cur.p.y) * ease;
      cur.o.x += (to.x - cur.o.x) * ease;
      cur.o.y += (to.y - cur.o.y) * ease;
      const rem = Math.max(
        Math.abs(tp.x - cur.p.x),
        Math.abs(tp.y - cur.p.y),
        Math.abs(to.x - cur.o.x),
        Math.abs(to.y - cur.o.y),
      );
      if (rem < 0.01) {
        // Snap exactly onto target and idle until the next change.
        cur.p = { ...tp };
        cur.o = { ...to };
        apply(pEyeRef, cur.p);
        apply(oEyeRef, cur.o);
        looping = false;
        raf = 0;
        return;
      }
      apply(pEyeRef, cur.p);
      apply(oEyeRef, cur.o);
      raf = window.requestAnimationFrame(frame);
    };
    const startLoop = () => {
      if (looping) return;
      looping = true;
      raf = window.requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (active) startLoop();
    };

    // Eyes follow for 10s, then rest ~3min (jittered so it never feels
    // mechanical) before waking again.
    const ACTIVE_MS = 10000;
    const gap = () => 150000 + Math.random() * 60000; // 2.5–3.5 min

    const sleep = () => {
      active = false;
      // Stop listening entirely while asleep — nothing runs between wake-ups.
      window.removeEventListener("pointermove", onMove);
      startLoop(); // glides back to rest, then self-stops
      wakeTimer = setTimeout(wake, gap());
    };
    const wake = () => {
      active = true;
      window.addEventListener("pointermove", onMove, { passive: true });
      startLoop();
      sleepTimer = setTimeout(sleep, ACTIVE_MS);
    };

    // First wake-up is delayed too, so it never fires on load.
    wakeTimer = setTimeout(wake, gap());

    return () => {
      clearTimeout(wakeTimer);
      clearTimeout(sleepTimer);
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
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
