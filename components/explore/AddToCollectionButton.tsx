"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CollectionSummary } from "@/lib/collections-db";
import styles from "./explore.module.css";
import addCollectionStyles from "./add-to-collection.module.css";

const POPOVER_WIDTH = 260;
const POPOVER_GAP = 6;
const POPOVER_HEIGHT_ESTIMATE = 340;
const VIEWPORT_PADDING = 8;

type Variant = "overlay" | "icon";

type Props = {
  emailId: string;
  collections: CollectionSummary[];
  /**
   * Collection ids already containing this email. Mutated optimistically
   * by the parent so the checkbox reflects the latest server state.
   */
  membershipIds: Set<string>;
  /**
   * Toggle membership: `next=true` means "add to collection",
   * `next=false` means "remove". Parent owns the API call so failures
   * can roll back across both this popover and the rest of the page.
   */
  onToggleCollection: (
    collectionId: string,
    emailId: string,
    next: boolean
  ) => Promise<void> | void;
  /**
   * Create a new collection and immediately add this email to it.
   * Returns the new collection (or `null` on failure) so the popover
   * can pre-check it.
   */
  onCreateCollection: (
    name: string,
    emailId: string
  ) => Promise<CollectionSummary | null>;
  /**
   * Optional: parent prefetches this email's memberships when the
   * popover opens. We keep it optional so call sites that already
   * load every membership up front (the public collection view, for
   * example) don't need to wire a no-op.
   */
  onRequestMemberships?: (emailId: string) => Promise<void> | void;
  /**
   * `"overlay"` renders the same pill button used on the Explore card
   * hover overlay (`.overlayButton`). `"icon"` renders the compact
   * square icon used in the modal's `.infoActions` row.
   */
  variant: Variant;
  /**
   * Optional align hint. The popover anchors to the bottom-left of the
   * button by default. When the trigger sits near the right edge of a
   * card the parent can flip it with `align="right"`.
   */
  align?: "left" | "right";
};

const MAX_NAME_LENGTH = 120;

/**
 * Folder-plus trigger + popover that lets a user file an email into
 * any of their collections. Two visual variants share the same popover
 * so the Explore card overlay and the modal's right-pane action row
 * stay consistent.
 *
 * The popover state is local: open/close, the create-mode toggle, and
 * the search query never need to escape this component. Membership
 * lives in the parent (so two cards showing the same email stay in
 * sync), and the parent owns the actual API calls.
 */
export default function AddToCollectionButton({
  emailId,
  collections,
  membershipIds,
  onToggleCollection,
  onCreateCollection,
  onRequestMemberships,
  variant,
  align = "left"
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);

  // The card overlay and modal info pane both clip overflow, so the
  // popover is rendered through a portal to document.body and positioned
  // with fixed coordinates derived from the trigger's bounding rect.
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    placement: "below" | "above";
  } | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const updateCoords = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Once the popover is in the DOM we use its actual height so the
    // "above" placement lines up exactly with the trigger; on the very
    // first frame we fall back to a conservative estimate.
    const popHeight =
      popoverRef.current?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE;

    const spaceBelow = viewportHeight - rect.bottom;
    const placement: "below" | "above" =
      spaceBelow < popHeight + POPOVER_GAP &&
      rect.top > popHeight + POPOVER_GAP
        ? "above"
        : "below";

    const rawLeft =
      align === "right" ? rect.right - POPOVER_WIDTH : rect.left;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(rawLeft, viewportWidth - POPOVER_WIDTH - VIEWPORT_PADDING)
    );
    const top =
      placement === "above"
        ? Math.max(VIEWPORT_PADDING, rect.top - POPOVER_GAP - popHeight)
        : rect.bottom + POPOVER_GAP;

    setCoords({ top, left, placement });
  }, [align]);

  // First pass uses the height estimate so the popover renders in
  // roughly the right place; a second pass after the popover is in the
  // DOM corrects it using the measured height.
  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    const frame = requestAnimationFrame(updateCoords);
    return () => cancelAnimationFrame(frame);
  }, [open, updateCoords, creating, query]);

  useEffect(() => {
    if (!open) return;
    const handler = () => updateCoords();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, updateCoords]);

  // Close on outside click / Escape so the popover feels native. The
  // popover lives in a portal, so we also have to treat clicks inside
  // it as "inside".
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      if (wrapRef.current?.contains(event.target)) return;
      if (popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setCreateName("");
      setQuery("");
      return;
    }
    if (onRequestMemberships) {
      void onRequestMemberships(emailId);
    }
  }, [open, emailId, onRequestMemberships]);

  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => createInputRef.current?.focus());
    }
  }, [creating]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, query]);

  const inAnyCollection = membershipIds.size > 0;

  async function handleToggle(collectionId: string) {
    if (pendingId) return;
    setPendingId(collectionId);
    const next = !membershipIds.has(collectionId);
    try {
      await onToggleCollection(collectionId, emailId, next);
    } finally {
      setPendingId(null);
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createPending) return;
    const name = createName.trim();
    if (!name) return;
    setCreatePending(true);
    try {
      const created = await onCreateCollection(name, emailId);
      if (created) {
        setCreating(false);
        setCreateName("");
      }
    } finally {
      setCreatePending(false);
    }
  }

  function handleStopPropagation(event: React.MouseEvent) {
    // The card overlay treats the whole card as a button — keep clicks
    // on this trigger from also opening the email modal.
    event.stopPropagation();
  }

  const triggerLabel = inAnyCollection
    ? `In ${membershipIds.size} collection${membershipIds.size === 1 ? "" : "s"}`
    : "Add to collection";

  return (
    <div
      ref={wrapRef}
      className={addCollectionStyles.wrap}
      onClick={handleStopPropagation}
    >
      {variant === "overlay" ? (
        <button
          ref={triggerRef}
          type="button"
          className={`${styles.overlayButton}${
            inAnyCollection ? ` ${addCollectionStyles.overlayActive}` : ""
          }`}
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={triggerLabel}
          title={triggerLabel}
        >
          <FolderPlusIcon />
          <span>{inAnyCollection ? `In ${membershipIds.size}` : "Collect"}</span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className={`${styles.infoActionIcon}${
            inAnyCollection ? ` ${addCollectionStyles.iconActive}` : ""
          }`}
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={triggerLabel}
          title={triggerLabel}
        >
          <FolderPlusIcon />
        </button>
      )}

      {open && portalReady && coords
        ? createPortal(
        <div
          ref={popoverRef}
          className={`${styles.popover} ${styles.popoverList} ${addCollectionStyles.popover} ${addCollectionStyles.popoverPortal}`}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left
          }}
          data-placement={coords.placement}
          role="dialog"
          aria-label="Add to collection"
          onClick={handleStopPropagation}
        >
          {creating ? (
            <form
              className={addCollectionStyles.createForm}
              onSubmit={handleCreate}
            >
              <input
                ref={createInputRef}
                type="text"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Collection name"
                maxLength={MAX_NAME_LENGTH}
                className={addCollectionStyles.createInput}
                aria-label="New collection name"
              />
              <div className={addCollectionStyles.createButtons}>
                <button
                  type="button"
                  className={styles.popoverClear}
                  onClick={() => {
                    setCreating(false);
                    setCreateName("");
                  }}
                  disabled={createPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={addCollectionStyles.createSubmit}
                  disabled={createPending || createName.trim().length === 0}
                >
                  {createPending ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className={styles.popoverSearch}>
                <SearchIcon />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search collections"
                  className={styles.popoverSearchInput}
                  aria-label="Search collections"
                />
              </div>

              <div className={styles.popoverScroll}>
                {filtered.length === 0 ? (
                  <div className={styles.popoverEmpty}>
                    {collections.length === 0
                      ? "No collections yet"
                      : "No matches"}
                  </div>
                ) : (
                  filtered.map((collection) => {
                    const checked = membershipIds.has(collection.id);
                    const isPending = pendingId === collection.id;
                    return (
                      <button
                        key={collection.id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={checked}
                        className={styles.checkRow}
                        onClick={() => void handleToggle(collection.id)}
                        disabled={isPending}
                      >
                        <span
                          className={`${styles.checkBox}${
                            checked ? ` ${styles.checkBoxChecked}` : ""
                          }`}
                          aria-hidden="true"
                        >
                          {checked ? <CheckIcon /> : null}
                        </span>
                        <span className={styles.checkLabel}>
                          {collection.name}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className={addCollectionStyles.footer}>
                <button
                  type="button"
                  className={addCollectionStyles.createButton}
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon /> Create collection
                </button>
              </div>
            </>
          )}
        </div>,
            document.body
          )
        : null}
    </div>
  );
}

function FolderPlusIcon() {
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
      className={styles.overlayIcon}
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function SearchIcon() {
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
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 12 10 18 20 6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
