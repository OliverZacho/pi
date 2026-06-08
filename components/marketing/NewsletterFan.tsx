import { LOGIN_SHOWCASE } from "@/lib/marketing/login-showcase";
import styles from "./newsletter-fan.module.css";

/**
 * The 3D fanned stack of real newsletters (login visual + homepage hero).
 *
 * `animate` (default true) deals the cards in with a staggered, decelerating
 * entrance (pure CSS, starts immediately on load). `animate={false}` renders
 * the stack static.
 *
 * `interactive` (default false) enables the hover pull-out: mousing a card
 * straightens it to face the viewer, lifts it toward the camera, and raises it
 * above its neighbours; mousing away tucks it back. Pure CSS `:hover`.
 *
 * `geometry` controls card size + the diagonal the stack marches along, so the
 * same component serves both the half-width login panel and the hero column.
 *
 * Cards are pre-baked WebP thumbnails (`public/hero-emails/{id}.webp`, generated
 * by `scripts/screenshot-hero-emails.ts`) rather than live email iframes — far
 * fewer/lighter requests, and crisper when scaled.
 */

export type FanGeometry = {
  /** Card (slot) size in px. */
  cardW: number;
  cardH: number;
  /** translateX in px at the first (t=0) and last (t=1) card. */
  xFrom: number;
  xTo: number;
  /** translateY in px at t=0 / t=1 (runs off the top/bottom edges). */
  yFrom: number;
  yTo: number;
  /** translateZ in px at t=0 / t=1 — drives size variation via perspective. */
  zFrom: number;
  zTo: number;
};

// Sweeps top-right (far/small) → bottom-left (near/large). Tuned for the hero
// column; the login panel passes a slightly larger, wider-spaced geometry.
const DEFAULT_GEOMETRY: FanGeometry = {
  cardW: 300,
  cardH: 380,
  xFrom: 360,
  xTo: -400,
  yFrom: -520,
  yTo: 660,
  zFrom: -300,
  zTo: 120
};

type Props = {
  animate?: boolean;
  interactive?: boolean;
  geometry?: FanGeometry;
};

export default function NewsletterFan({
  animate = true,
  interactive = false,
  geometry = DEFAULT_GEOMETRY
}: Props) {
  const fanClass = [
    styles.fan,
    animate ? styles.fanReady : styles.fanStatic,
    interactive ? styles.fanInteractive : ""
  ]
    .filter(Boolean)
    .join(" ");

  const { cardW, cardH, xFrom, xTo, yFrom, yTo, zFrom, zTo } = geometry;

  return (
    <div className={fanClass}>
      {LOGIN_SHOWCASE.map((n, i) => {
        const t = LOGIN_SHOWCASE.length > 1 ? i / (LOGIN_SHOWCASE.length - 1) : 0;
        const tx = xFrom + t * (xTo - xFrom);
        const ty = yFrom + t * (yTo - yFrom);
        const tz = zFrom + t * (zTo - zFrom);
        // Front-loaded stagger (t^1.7): rapid at first, then widening so the
        // stack decelerates and settles. Last card lands ~700ms + 550ms.
        const delayMs = Math.round(Math.pow(t, 1.7) * 700);
        return (
          // Stacking is by DOM order (later card = in front), so no z-index is
          // needed here — which lets the hover rule raise a card cleanly.
          <div
            key={n.id}
            className={styles.fanSlot}
            style={{
              width: `${cardW}px`,
              height: `${cardH}px`,
              margin: `${-cardH / 2}px 0 0 ${-cardW / 2}px`,
              transform: `translate3d(${tx}px, ${ty}px, ${tz}px) rotateY(-16deg) rotateZ(16deg)`
            }}
          >
            {/* Wrapper carries the entrance animation so the card's transform
                stays free for the hover pull-out. */}
            <div className={styles.fanEnter} style={{ animationDelay: `${delayMs}ms` }}>
              <div className={styles.fanCard}>
                {/* eslint-disable-next-line @next/next/no-img-element -- decorative,
                    pre-sized thumbnail; next/image adds no value for a fixed-size
                    absolutely-positioned card and complicates the fan layout. */}
                <img
                  className={styles.fanImg}
                  src={`/hero-emails/${n.id}.webp`}
                  alt=""
                  draggable={false}
                  loading="eager"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
