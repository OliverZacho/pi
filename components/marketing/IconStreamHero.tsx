"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LEFT_COLUMN,
  RIGHT_COLUMN,
  type IconStreamItem
} from "@/lib/marketing/icon-stream-data";
import styles from "./iconstream.module.css";

/**
 * Icon Stream Hero (front page).
 *
 * Two vertical columns of placeholder app-icon tiles flank the
 * right side of the hero. The left column scrolls upward, the right
 * downward, both at a calm pace. A single typewriter callout in a
 * monospace font alternates between one logo on the left column and
 * one on the right — connector line + text fade in, type out, hold
 * briefly, then fade away.
 *
 * Buttons are intentionally non-functional placeholders.
 */

const SCROLL_SPEED_PX_PER_SEC = 18;

// Spotlight cycle durations (ms)
const PRE_TYPE_DELAY_MS = 280;
const TYPING_MS_PER_CHAR = 44;
const HOLD_MS = 2600;
// Backspace is intentionally much quicker than typing (5x faster) —
// feels like holding down the delete key.
const DELETE_MS_PER_CHAR = Math.round(TYPING_MS_PER_CHAR / 5);
// Brief window for the connector line to retract and the spotlight
// opacity to fade before the next cycle picks up on the other column.
const TEARDOWN_MS = 220;
// Quiet beat after the spotlight has fully retracted, before the next
// cycle begins. Gives the reader a moment to digest the previous stat.
const REST_MS = 1200;

// Horizontal offset from the active tile's edge to the connector line
const TILE_EDGE_OFFSET = 10;
// Length of the connector line in px
const LINE_LENGTH_PX = 40;

type Side = "left" | "right";
type Phase =
  | "idle"
  | "revealing"
  | "typing"
  | "hold"
  | "deleting"
  | "teardown";

type SpotlightState = {
  side: Side;
  itemId: string | null;
  fullText: string;
  typedText: string;
  phase: Phase;
};

const INITIAL_SPOTLIGHT: SpotlightState = {
  side: "right",
  itemId: null,
  fullText: "",
  typedText: "",
  phase: "idle"
};

export default function IconStreamHero() {
  const streamAreaRef = useRef<HTMLDivElement | null>(null);
  const leftColumnRef = useRef<HTMLDivElement | null>(null);
  const rightColumnRef = useRef<HTMLDivElement | null>(null);
  const leftScrollerRef = useRef<HTMLDivElement | null>(null);
  const rightScrollerRef = useRef<HTMLDivElement | null>(null);
  const leftStackRef = useRef<HTMLDivElement | null>(null);
  const rightStackRef = useRef<HTMLDivElement | null>(null);
  const leftTileRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const rightTileRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const spotlightElRef = useRef<HTMLDivElement | null>(null);

  const [spotlight, setSpotlight] = useState<SpotlightState>(INITIAL_SPOTLIGHT);
  const spotlightStateRef = useRef<SpotlightState>(INITIAL_SPOTLIGHT);
  spotlightStateRef.current = spotlight;

  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  // ---- Scroll + spotlight position RAF ---------------------------------
  useEffect(() => {
    const leftScroller = leftScrollerRef.current;
    const rightScroller = rightScrollerRef.current;
    const leftStack = leftStackRef.current;
    const rightStack = rightStackRef.current;
    const streamArea = streamAreaRef.current;
    if (
      !leftScroller ||
      !rightScroller ||
      !leftStack ||
      !rightStack ||
      !streamArea
    ) {
      return;
    }

    let leftStackHeight = leftStack.offsetHeight;
    let rightStackHeight = rightStack.offsetHeight;
    let leftOffset = 0;
    let rightOffset = 0;
    let last = performance.now();
    let raf = 0;

    const ro = new ResizeObserver(() => {
      leftStackHeight = leftStack.offsetHeight;
      rightStackHeight = rightStack.offsetHeight;
    });
    ro.observe(leftStack);
    ro.observe(rightStack);

    if (reducedMotion) {
      // No motion: both scrollers rest on the first (live) stack so the
      // visible tiles are the ones we hold refs to.
      leftScroller.style.transform = `translate3d(0, 0, 0)`;
      rightScroller.style.transform = `translate3d(0, 0, 0)`;
    } else if (rightStackHeight > 0) {
      // Seed the right column so its duplicate stack fills the viewport on
      // first paint — without this, the right column briefly appears empty
      // before the first downward step.
      rightScroller.style.transform = `translate3d(0, ${-rightStackHeight}px, 0)`;
    }

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (!reducedMotion) {
        const step = SCROLL_SPEED_PX_PER_SEC * dt;
        leftOffset += step;
        if (leftStackHeight > 0 && leftOffset >= leftStackHeight) {
          leftOffset -= leftStackHeight;
        }
        rightOffset += step;
        if (rightStackHeight > 0 && rightOffset >= rightStackHeight) {
          rightOffset -= rightStackHeight;
        }

        leftScroller.style.transform = `translate3d(0, ${-leftOffset}px, 0)`;
        rightScroller.style.transform = `translate3d(0, ${
          rightOffset - rightStackHeight
        }px, 0)`;
      }

      // Position the spotlight against the currently active tile. We
      // anchor to the tile's own bounding rect (not the column's) so the
      // connector line always starts right next to the tile regardless
      // of any horizontal padding the column carries to accommodate the
      // active scale/outline.
      const state = spotlightStateRef.current;
      const spotlightEl = spotlightElRef.current;
      if (state.itemId && spotlightEl) {
        const refs =
          state.side === "left" ? leftTileRefs.current : rightTileRefs.current;
        const tile = refs.get(state.itemId);
        if (tile) {
          const sRect = streamArea.getBoundingClientRect();
          const tRect = tile.getBoundingClientRect();
          const centerY = tRect.top + tRect.height / 2 - sRect.top;

          spotlightEl.style.top = `${centerY}px`;
          if (state.side === "left") {
            const rightDist = sRect.right - tRect.left + TILE_EDGE_OFFSET;
            spotlightEl.style.right = `${rightDist}px`;
            spotlightEl.style.left = "auto";
          } else {
            const leftDist = tRect.right - sRect.left + TILE_EDGE_OFFSET;
            spotlightEl.style.left = `${leftDist}px`;
            spotlightEl.style.right = "auto";
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reducedMotion]);

  // ---- Spotlight cycle scheduler ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    // Each pending wait registers a canceler so cleanup can immediately
    // resolve the promise — letting the async loop notice `cancelled`
    // and exit instead of leaking forever.
    const cancelers: Array<() => void> = [];

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(() => {
          resolve();
        }, ms);
        cancelers.push(() => {
          window.clearTimeout(id);
          resolve();
        });
      });

    const pickItem = (side: Side): IconStreamItem | null => {
      const list = side === "left" ? LEFT_COLUMN : RIGHT_COLUMN;
      const refs =
        side === "left" ? leftTileRefs.current : rightTileRefs.current;
      const streamArea = streamAreaRef.current;
      if (!streamArea) return null;
      const sRect = streamArea.getBoundingClientRect();
      const sCenter = sRect.top + sRect.height / 2;

      let best: { item: IconStreamItem; dist: number } | null = null;
      for (const item of list) {
        const el = refs.get(item.id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom < sRect.top + 60 || r.top > sRect.bottom - 60) continue;
        const c = r.top + r.height / 2;
        const dist = Math.abs(c - sCenter);
        if (!best || dist < best.dist) best = { item, dist };
      }
      return best?.item ?? null;
    };

    const run = async () => {
      // Initial settle so the scroller has a chance to lay out before we
      // start querying tile positions.
      await wait(900);
      if (cancelled) return;

      let nextSide: Side = "left";
      while (!cancelled) {
        const item = pickItem(nextSide);
        if (!item) {
          await wait(250);
          continue;
        }

        const text = item.stat;

        // Reveal phase: line draws out, opacity fades in. No typing yet.
        setSpotlight({
          side: nextSide,
          itemId: item.id,
          fullText: text,
          typedText: "",
          phase: "revealing"
        });
        await wait(PRE_TYPE_DELAY_MS);
        if (cancelled) return;

        // Typing phase.
        setSpotlight((s) =>
          s.itemId === item.id ? { ...s, phase: "typing" } : s
        );
        if (reducedMotion) {
          setSpotlight((s) =>
            s.itemId === item.id ? { ...s, typedText: text } : s
          );
        } else {
          for (let i = 1; i <= text.length; i++) {
            await wait(TYPING_MS_PER_CHAR);
            if (cancelled) return;
            setSpotlight((s) =>
              s.itemId === item.id ? { ...s, typedText: text.slice(0, i) } : s
            );
          }
        }

        // Hold the full text on screen.
        setSpotlight((s) =>
          s.itemId === item.id ? { ...s, phase: "hold" } : s
        );
        await wait(HOLD_MS);
        if (cancelled) return;

        // Backspace: tear the text down char-by-char, much faster than
        // the typing pass — feels like holding the delete key.
        setSpotlight((s) =>
          s.itemId === item.id ? { ...s, phase: "deleting" } : s
        );
        if (reducedMotion) {
          setSpotlight((s) =>
            s.itemId === item.id ? { ...s, typedText: "" } : s
          );
        } else {
          for (let i = text.length - 1; i >= 0; i--) {
            await wait(DELETE_MS_PER_CHAR);
            if (cancelled) return;
            setSpotlight((s) =>
              s.itemId === item.id
                ? { ...s, typedText: text.slice(0, i) }
                : s
            );
          }
        }

        // Teardown: keep the same itemId (so the spotlight stays
        // positioned at the old tile while it gracefully retracts), but
        // flip the phase so the line shrinks back and the container
        // fades out.
        setSpotlight((s) =>
          s.itemId === item.id ? { ...s, phase: "teardown" } : s
        );
        await wait(TEARDOWN_MS);
        if (cancelled) return;

        // Quiet rest before the next cycle — the spotlight is already
        // invisible at this point, this is just deliberate dead air so
        // the previous stat has time to settle.
        await wait(REST_MS);
        if (cancelled) return;

        nextSide = nextSide === "left" ? "right" : "left";
      }
    };

    void run();

    return () => {
      cancelled = true;
      cancelers.forEach((fn) => fn());
    };
  }, [reducedMotion]);

  // The line + opacity stay revealed for every phase EXCEPT teardown
  // and idle. We use phase here instead of itemId so the teardown phase
  // (which keeps itemId set, to anchor the spotlight to the old tile
  // while it retracts) correctly triggers the exit transitions.
  const spotlightActive =
    spotlight.itemId !== null &&
    spotlight.phase !== "idle" &&
    spotlight.phase !== "teardown";
  const showCursor =
    spotlight.phase === "typing" ||
    spotlight.phase === "hold" ||
    spotlight.phase === "deleting";

  return (
    <section className={styles.hero} aria-label="Brand intelligence preview">
      <div className={styles.heroCopy}>
        <h1 className={styles.headline}>
          Intelligence and inspiration across thousands of newsletters
        </h1>
        <div className={styles.ctaRow}>
          <Link href="/signup" className={styles.primaryBtn}>
            Sign up
          </Link>
          <button type="button" className={styles.secondaryBtn}>
            See plans
            <span className={styles.secondaryArrow} aria-hidden>
              →
            </span>
          </button>
        </div>
      </div>

      <div className={styles.streamArea} ref={streamAreaRef}>
        <div className={styles.columns}>
          <div className={styles.column} ref={leftColumnRef}>
            <div className={styles.scroller} ref={leftScrollerRef}>
              <Stack
                items={LEFT_COLUMN}
                stackRef={leftStackRef}
                tileRefs={leftTileRefs}
                activeId={spotlight.itemId}
              />
              <Stack items={LEFT_COLUMN} tileRefs={null} activeId={null} ariaHidden />
            </div>
          </div>

          <div className={styles.column} ref={rightColumnRef}>
            <div className={styles.scroller} ref={rightScrollerRef}>
              <Stack
                items={RIGHT_COLUMN}
                stackRef={rightStackRef}
                tileRefs={rightTileRefs}
                activeId={spotlight.itemId}
              />
              <Stack
                items={RIGHT_COLUMN}
                tileRefs={null}
                activeId={null}
                ariaHidden
              />
            </div>
          </div>
        </div>

        <div className={styles.spotlightLayer}>
          {/*
            The line and text are always rendered in the same DOM order
            (text first, line second). The visual order is flipped per
            side via CSS `order` on the children of `.spotlightLeft` /
            `.spotlightRight`. Keeping the DOM stable means React never
            re-mounts these nodes when the side flips, so their
            transform/opacity transitions don't reset mid-flight.
          */}
          <div
            ref={spotlightElRef}
            className={[
              styles.spotlight,
              spotlight.side === "left"
                ? styles.spotlightLeft
                : styles.spotlightRight,
              spotlightActive ? styles.spotlightVisible : ""
            ]
              .filter(Boolean)
              .join(" ")}
            aria-live="polite"
          >
            <span className={styles.spotlightText}>
              {spotlight.typedText}
              <span
                className={`${styles.cursor} ${
                  showCursor ? "" : styles.cursorHidden
                }`}
                aria-hidden
              />
            </span>
            <div
              className={`${styles.spotlightLine} ${
                spotlightActive ? styles.spotlightLineRevealed : ""
              }`}
              style={{ width: `${LINE_LENGTH_PX}px` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Stack ---------------------------------------------------------

function Stack({
  items,
  stackRef,
  tileRefs,
  activeId,
  ariaHidden = false
}: {
  items: IconStreamItem[];
  stackRef?: React.MutableRefObject<HTMLDivElement | null>;
  tileRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>> | null;
  activeId: string | null;
  ariaHidden?: boolean;
}) {
  return (
    <div
      ref={stackRef}
      className={styles.stack}
      aria-hidden={ariaHidden ? "true" : undefined}
    >
      {items.map((item) => (
        <Tile
          key={`${item.id}-${ariaHidden ? "b" : "a"}`}
          item={item}
          isActive={!ariaHidden && activeId === item.id}
          registerRef={
            tileRefs
              ? (el) => {
                  tileRefs.current.set(item.id, el);
                }
              : null
          }
        />
      ))}
    </div>
  );
}

// ---------- Tile ----------------------------------------------------------

function Tile({
  item,
  isActive,
  registerRef
}: {
  item: IconStreamItem;
  isActive: boolean;
  registerRef: ((el: HTMLDivElement | null) => void) | null;
}) {
  const glyphLong = item.glyph.length > 1;
  // Treat lowercase, multi-char glyphs as a "wordmark" placeholder
  // styled like the gisou/Marais reference logo.
  const isScript =
    item.glyph.length > 2 && item.glyph === item.glyph.toLowerCase();

  return (
    <div
      ref={registerRef ?? undefined}
      className={`${styles.tile} ${isActive ? styles.tileActive : ""}`}
      style={{ background: item.bg, color: item.fg }}
      aria-hidden="true"
    >
      <span
        className={[
          styles.tileGlyph,
          isScript
            ? styles.tileGlyphScript
            : glyphLong
              ? styles.tileGlyphLong
              : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {item.glyph}
      </span>
    </div>
  );
}
