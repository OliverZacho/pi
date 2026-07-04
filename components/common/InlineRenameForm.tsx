"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./inline-rename.module.css";

type Props = {
  /** Canonical current name — seeds the draft when the form mounts. */
  initialValue: string;
  ariaLabel: string;
  /** True while the parent's save request is in flight; locks the controls. */
  pending: boolean;
  maxLength?: number;
  /**
   * Context class applied to the input alongside the base style. Should
   * only set the sizing custom properties (`--rename-font-size`,
   * `--rename-min-width`) so it can't fight the base rule.
   */
  inputClassName?: string;
  /** Receives the trimmed draft on Enter or the Save button. */
  onSave: (name: string) => void;
  /** Escape key or the Cancel button. */
  onCancel: () => void;
};

/**
 * Shared inline rename form for detail-page titles (collections and
 * comparisons). Swaps in where the title renders: an input seeded with
 * the current name plus explicit Save / Cancel buttons, so the flow
 * works without knowing the Enter shortcut (which still submits, and
 * Escape still cancels). The parent owns the request + error surface;
 * this component owns the draft.
 */
export default function InlineRenameForm({
  initialValue,
  ariaLabel,
  pending,
  maxLength = 120,
  inputClassName,
  onSave,
  onCancel
}: Props) {
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Focus + select on mount so typing immediately replaces the name.
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const name = draft.trim();
    if (!name) return;
    onSave(name);
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) onCancel();
        }}
        maxLength={maxLength}
        className={
          inputClassName ? `${styles.input} ${inputClassName}` : styles.input
        }
        aria-label={ariaLabel}
        disabled={pending}
      />
      <button
        type="submit"
        className={styles.save}
        disabled={pending || draft.trim().length === 0}
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        className={styles.cancel}
        onClick={onCancel}
        disabled={pending}
      >
        Cancel
      </button>
    </form>
  );
}

/**
 * The pencil trigger that sits next to a title and opens the form.
 * Kept here so both detail pages render the identical affordance.
 */
export function RenameButton({
  onClick,
  label
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={styles.editIcon}
      onClick={onClick}
      aria-label={label}
      title="Rename"
    >
      <PencilIcon />
    </button>
  );
}

export function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}
