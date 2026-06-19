"use client";

import { useEffect, useRef, useState } from "react";
import v2 from "./compare-v2.module.css";

/** A brand's mailing list, with the category it maps to. */
export type ListSegment = {
  inboxId: string;
  label: string;
  categoryLabel: string | null;
};

type Props = {
  /** Brand whose lists we're choosing from. */
  brandId: string;
  /**
   * Selected inbox ids. Empty = "All lists" (the brand's full output).
   */
  value: string[];
  onChange: (inboxIds: string[]) => void;
  /**
   * Pre-resolved segments. When supplied we skip the network fetch — the
   * brand strip already has them from `BrandPageData.listTabs`. When
   * omitted (the pickers, where the brand isn't in a set yet) we fetch from
   * `/api/brands/[id]/segments` on mount.
   */
  segments?: ListSegment[];
  disabled?: boolean;
  ariaLabel?: string;
};

/**
 * Lets the user scope a multi-list brand (e.g. ARKET) to ANY subset of its
 * mailing lists inside a comparison — one, several, or all. Renders nothing
 * for single-list brands, where there's no choice to make.
 *
 * Selecting every list (or none) collapses to "All lists" (an empty value),
 * so the two extremes read identically.
 */
export default function MemberListSelect({
  brandId,
  value,
  onChange,
  segments,
  disabled,
  ariaLabel
}: Props) {
  const [fetched, setFetched] = useState<ListSegment[] | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (segments) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/brands/${brandId}/segments`, {
          credentials: "include"
        });
        if (!res.ok) return;
        const body = (await res.json()) as { segments: ListSegment[] };
        if (!cancelled) setFetched(body.segments ?? []);
      } catch {
        // Silent — a brand whose lists we can't load just shows no choice.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId, segments]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = segments ?? fetched ?? [];
  // Fewer than two lists → nothing meaningful to pick between.
  if (list.length < 2) return null;

  const selected = new Set(value);
  const orderedIds = list.map((segment) => segment.inboxId);

  function toggle(inboxId: string) {
    const next = new Set(selected);
    if (next.has(inboxId)) next.delete(inboxId);
    else next.add(inboxId);
    // Both extremes — none, or every list — mean "All lists" (empty value).
    if (next.size === 0 || next.size === orderedIds.length) {
      onChange([]);
      return;
    }
    // Keep the brand's own list order for stable storage + display.
    onChange(orderedIds.filter((id) => next.has(id)));
  }

  const allSelected = selected.size === 0;
  const summary = allSelected
    ? "All lists"
    : (() => {
        const labels = list
          .filter((segment) => selected.has(segment.inboxId))
          .map((segment) => segment.label);
        return labels.length <= 2 ? labels.join(", ") : `${labels.length} lists`;
      })();

  return (
    <div className={v2.listMultiWrap} ref={wrapRef}>
      <button
        type="button"
        className={v2.listMultiTrigger}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? "Choose which lists to compare"}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={v2.listMultiLabel}>{summary}</span>
        <span className={v2.listMultiCaret} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div
          className={v2.listMultiPopover}
          role="listbox"
          aria-multiselectable="true"
        >
          <button
            type="button"
            role="option"
            aria-selected={allSelected}
            className={v2.listMultiOption}
            onClick={() => onChange([])}
          >
            <span
              className={`${v2.listMultiCheckbox} ${
                allSelected ? v2.listMultiCheckboxChecked : ""
              }`}
              aria-hidden="true"
            >
              {allSelected ? "✓" : ""}
            </span>
            <span className={v2.listMultiOptionLabel}>All lists</span>
          </button>

          {list.map((segment) => {
            const on = selected.has(segment.inboxId);
            return (
              <button
                key={segment.inboxId}
                type="button"
                role="option"
                aria-selected={on}
                className={v2.listMultiOption}
                onClick={() => toggle(segment.inboxId)}
              >
                <span
                  className={`${v2.listMultiCheckbox} ${
                    on ? v2.listMultiCheckboxChecked : ""
                  }`}
                  aria-hidden="true"
                >
                  {on ? "✓" : ""}
                </span>
                <span className={v2.listMultiOptionLabel}>
                  {segment.label}
                  {segment.categoryLabel ? (
                    <span className={v2.listMultiOptionCat}>
                      {" · "}
                      {segment.categoryLabel}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
