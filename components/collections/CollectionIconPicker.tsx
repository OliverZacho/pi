"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  COLLECTION_ICONS,
  type CollectionIcon
} from "@/lib/collection-icons";
import styles from "./icon-picker.module.css";

type Props = {
  /** Currently selected icon, or `null` for the generic fallback glyph. */
  value: CollectionIcon | null;
  /** Fired with the chosen icon, or `null` when the user clears it. */
  onChange: (icon: CollectionIcon | null) => void;
  /**
   * Visual size of the trigger. `md` (default) suits the create form;
   * `lg` is used in the collection detail header next to the title.
   */
  size?: "md" | "lg";
  /** Accessible label for the trigger button. */
  label?: string;
  disabled?: boolean;
};

/**
 * Emoji icon picker for a collection. The trigger shows the current
 * icon (or a neutral placeholder), and clicking it opens a popover with
 * the curated `COLLECTION_ICONS` grid plus a "No icon" option. Selection
 * is immediate — there's no separate confirm step — so the parent can
 * persist (or stage) the change in its `onChange` handler.
 */
export default function CollectionIconPicker({
  value,
  onChange,
  size = "md",
  label = "Choose an icon",
  disabled = false
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();

  // Close on outside click / Escape while the popover is open.
  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function choose(icon: CollectionIcon | null) {
    onChange(icon);
    setOpen(false);
  }

  return (
    <div className={styles.root} ref={containerRef}>
      <button
        type="button"
        className={`${styles.trigger} ${
          size === "lg" ? styles.triggerLg : ""
        }`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={label}
        title={label}
        disabled={disabled}
      >
        {value ? (
          <span className={styles.triggerIcon} aria-hidden="true">
            {value}
          </span>
        ) : (
          <PlaceholderIcon />
        )}
      </button>

      {open ? (
        <div className={styles.popover} id={popoverId} role="dialog">
          <div className={styles.grid}>
            {COLLECTION_ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                className={`${styles.option} ${
                  icon === value ? styles.optionSelected : ""
                }`}
                onClick={() => choose(icon)}
                aria-pressed={icon === value}
                aria-label={`Icon ${icon}`}
              >
                <span aria-hidden="true">{icon}</span>
              </button>
            ))}
          </div>
          {value ? (
            <button
              type="button"
              className={styles.clear}
              onClick={() => choose(null)}
            >
              Remove icon
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PlaceholderIcon() {
  // Neutral "add an icon" glyph (smiley outline + plus) shown when no
  // emoji has been chosen yet.
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M8 13a3.5 3.5 0 0 0 5 0" />
      <path d="M9 9h.01" />
      <path d="M14 9h.01" />
    </svg>
  );
}
