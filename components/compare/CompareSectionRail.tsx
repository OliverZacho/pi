"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  sectionTitle,
  type CompareSectionId,
  type CompareSectionPrefs
} from "@/lib/comparison-sections";
import styles from "./compare.module.css";

type SectionEntry = {
  id: CompareSectionId;
  /** Server-rendered section content. */
  content: ReactNode;
};

type Props = {
  /** Sections present on this page, in default order. Sections with no
   *  data for the current cohort are simply not passed in. */
  sections: SectionEntry[];
  /** The user's saved layout, resolved server-side. */
  initialPrefs: CompareSectionPrefs;
};

/**
 * Client wrapper that applies the user's saved dashboard layout: every
 * section gets a small control cluster (hide, move up / down), hidden
 * sections collapse to a title bar with a "Show" affordance, and any
 * change is saved optimistically to `user_prefs` so it follows the
 * user to every comparison.
 *
 * The section content itself stays server-rendered — it arrives as
 * `ReactNode` props — so customization adds no client-side rendering
 * cost to the charts.
 */
export default function CompareSectionRail({ sections, initialPrefs }: Props) {
  const [prefs, setPrefs] = useState<CompareSectionPrefs>(initialPrefs);
  // Monotonic save counter so a slow first PUT can't clobber a newer
  // layout when responses land out of order.
  const saveSeq = useRef(0);

  const byId = useMemo(() => {
    const map = new Map<CompareSectionId, SectionEntry>();
    for (const section of sections) map.set(section.id, section);
    return map;
  }, [sections]);

  // Ids that actually render on this page, in the user's order.
  const renderedIds = prefs.order.filter((id) => byId.has(id));
  const hiddenSet = new Set(prefs.hidden);

  function persist(next: CompareSectionPrefs) {
    setPrefs(next);
    const seq = ++saveSeq.current;
    void fetch("/api/user-prefs/compare-sections", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next)
    })
      .then((res) => {
        if (!res.ok && seq === saveSeq.current) {
          console.error(`Failed to save dashboard layout (${res.status})`);
        }
      })
      .catch((err) => {
        if (seq === saveSeq.current) {
          console.error("Failed to save dashboard layout", err);
        }
      });
  }

  function toggleHidden(id: CompareSectionId) {
    const hidden = hiddenSet.has(id)
      ? prefs.hidden.filter((x) => x !== id)
      : [...prefs.hidden, id];
    persist({ ...prefs, hidden });
  }

  /**
   * Swaps the section with its visible neighbour. Operates on the full
   * order array (which also tracks sections absent from this page) so
   * the move persists correctly for cohorts where those sections do
   * render.
   */
  function move(id: CompareSectionId, direction: -1 | 1) {
    const pos = renderedIds.indexOf(id);
    const neighbour = renderedIds[pos + direction];
    if (!neighbour) return;
    const order = [...prefs.order];
    const a = order.indexOf(id);
    const b = order.indexOf(neighbour);
    order[a] = neighbour;
    order[b] = id;
    persist({ ...prefs, order });
  }

  return (
    <>
      {renderedIds.map((id, idx) => {
        const section = byId.get(id);
        if (!section) return null;
        const title = sectionTitle(id);
        const isHidden = hiddenSet.has(id);
        const controls = (
          <span className={styles.railControls}>
            <button
              type="button"
              className={styles.railButton}
              onClick={() => move(id, -1)}
              disabled={idx === 0}
              aria-label={`Move ${title} up`}
              title="Move up"
            >
              <ArrowIcon direction="up" />
            </button>
            <button
              type="button"
              className={styles.railButton}
              onClick={() => move(id, 1)}
              disabled={idx === renderedIds.length - 1}
              aria-label={`Move ${title} down`}
              title="Move down"
            >
              <ArrowIcon direction="down" />
            </button>
            <button
              type="button"
              className={styles.railButton}
              onClick={() => toggleHidden(id)}
              aria-label={isHidden ? `Show ${title}` : `Hide ${title}`}
              title={isHidden ? "Show this section" : "Hide this section"}
            >
              {isHidden ? <EyeIcon /> : <EyeOffIcon />}
            </button>
          </span>
        );

        // Sections cascade in on first mount (same entrance the grid
        // cards use, chunkier stagger for the bigger blocks). Reorder /
        // hide keep their DOM nodes, so the animation never replays.
        const enterStyle =
          idx > 0
            ? { animationDelay: `${Math.min(idx, 8) * 60}ms` }
            : undefined;

        if (isHidden) {
          return (
            <div
              key={id}
              className={`${styles.railCollapsed} ${styles.cardEnter}`}
              style={enterStyle}
            >
              <span className={styles.railCollapsedTitle}>{title}</span>
              {controls}
            </div>
          );
        }

        return (
          <div
            key={id}
            className={`${styles.railShell} ${styles.cardEnter}`}
            style={enterStyle}
          >
            {controls}
            {section.content}
          </div>
        );
      })}
    </>
  );
}

function ArrowIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={direction === "down" ? { transform: "rotate(180deg)" } : undefined}
    >
      <polyline points="6 14 12 8 18 14" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
