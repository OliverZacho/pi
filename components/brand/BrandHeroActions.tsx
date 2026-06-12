"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import type { CompetitorSetSummary } from "@/lib/competitor-db";
import styles from "./brand.module.css";

const POPOVER_WIDTH = 280;
const POPOVER_GAP = 6;
const POPOVER_HEIGHT_ESTIMATE = 360;
const VIEWPORT_PADDING = 8;
const MAX_NAME_LENGTH = 120;

type Props = {
  brandId: string;
  brandName: string;
  initialFollowing: boolean;
  initialGroups: CompetitorSetSummary[];
  /**
   * Subset of `initialGroups` ids that already contain this brand. The
   * popover seeds its "checked" state from this so toggling feels
   * instant.
   */
  initialMembershipIds: string[];
};

/**
 * Hero-strip actions for the brand page: a Follow toggle (writes to
 * `brand_follows`) plus an "Add to comparison" popover that lets the user
 * file the brand into any of their `competitor_sets` or spin up a new
 * one. The two actions are independent — following never implicitly
 * touches groups and vice versa, mirroring the schema.
 */
export default function BrandHeroActions({
  brandId,
  brandName,
  initialFollowing,
  initialGroups,
  initialMembershipIds
}: Props) {
  const [following, setFollowing] = useState(initialFollowing);
  const [followPending, setFollowPending] = useState(false);
  const [groups, setGroups] = useState(initialGroups);
  const [membership, setMembership] = useState<Set<string>>(
    () => new Set(initialMembershipIds)
  );

  const handleToggleFollow = useCallback(async () => {
    if (followPending) return;
    const next = !following;
    setFollowPending(true);
    setFollowing(next);
    try {
      const response = await fetch(
        `/api/brand-follows/${encodeURIComponent(brandId)}`,
        { method: next ? "PUT" : "DELETE" }
      );
      if (!response.ok) {
        setFollowing(!next);
      }
    } catch {
      setFollowing(!next);
    } finally {
      setFollowPending(false);
    }
  }, [brandId, followPending, following]);

  const handleToggleGroup = useCallback(
    async (setId: string, next: boolean) => {
      // Optimistic update; reverts on failure so the checkbox state
      // never lies about the server.
      setMembership((current) => {
        const updated = new Set(current);
        if (next) updated.add(setId);
        else updated.delete(setId);
        return updated;
      });
      try {
        if (next) {
          const response = await fetch(
            `/api/competitor-sets/${encodeURIComponent(setId)}/brands`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ brandIds: [brandId] })
            }
          );
          if (!response.ok) throw new Error("Add failed");
        } else {
          const response = await fetch(
            `/api/competitor-sets/${encodeURIComponent(setId)}/brands/${encodeURIComponent(brandId)}`,
            { method: "DELETE" }
          );
          if (!response.ok) throw new Error("Remove failed");
        }
      } catch {
        setMembership((current) => {
          const updated = new Set(current);
          if (next) updated.delete(setId);
          else updated.add(setId);
          return updated;
        });
      }
    },
    [brandId]
  );

  const handleCreateGroup = useCallback(
    async (name: string): Promise<CompetitorSetSummary | null> => {
      try {
        const response = await fetch(`/api/competitor-sets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, brandIds: [brandId] })
        });
        if (!response.ok) return null;
        const payload = (await response.json()) as {
          set?: { id: string; name: string; updatedAt: string; brands: unknown[] };
        };
        if (!payload.set) return null;
        const summary: CompetitorSetSummary = {
          id: payload.set.id,
          name: payload.set.name,
          brandCount: Array.isArray(payload.set.brands)
            ? payload.set.brands.length
            : 1,
          updatedAt: payload.set.updatedAt
        };
        setGroups((current) => [summary, ...current]);
        setMembership((current) => {
          const updated = new Set(current);
          updated.add(summary.id);
          return updated;
        });
        return summary;
      } catch {
        return null;
      }
    },
    [brandId]
  );

  return (
    <div className={styles.heroActions}>
      <AddToGroupButton
        brandName={brandName}
        groups={groups}
        membershipIds={membership}
        onToggleGroup={handleToggleGroup}
        onCreateGroup={handleCreateGroup}
      />
      <button
        type="button"
        className={following ? styles.actionGhost : styles.actionPrimary}
        onClick={() => void handleToggleFollow()}
        disabled={followPending}
        aria-pressed={following}
      >
        {following ? <CheckIcon /> : <PlusIcon />}
        <span>{following ? "Following" : "Follow brand"}</span>
      </button>
    </div>
  );
}

/* -----------------------------------------------------------------
   Add-to-group popover
   -----------------------------------------------------------------
   Mirrors the structure of `AddToCollectionButton` (portal-rendered,
   outside-click + Escape close, "create new" inline form) so the two
   features feel like the same primitive at different scopes.
*/

type AddToGroupProps = {
  brandName: string;
  groups: CompetitorSetSummary[];
  membershipIds: Set<string>;
  onToggleGroup: (setId: string, next: boolean) => Promise<void> | void;
  onCreateGroup: (name: string) => Promise<CompetitorSetSummary | null>;
};

function AddToGroupButton({
  brandName,
  groups,
  membershipIds,
  onToggleGroup,
  onCreateGroup
}: AddToGroupProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);

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
    const popHeight =
      popoverRef.current?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE;

    const spaceBelow = viewportHeight - rect.bottom;
    const placement: "below" | "above" =
      spaceBelow < popHeight + POPOVER_GAP &&
      rect.top > popHeight + POPOVER_GAP
        ? "above"
        : "below";

    // Anchor to the trigger's right edge — the brand-page actions sit
    // flush right, so a left-aligned popover would punch off-screen.
    const rawLeft = rect.right - POPOVER_WIDTH;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(rawLeft, viewportWidth - POPOVER_WIDTH - VIEWPORT_PADDING)
    );
    const top =
      placement === "above"
        ? Math.max(VIEWPORT_PADDING, rect.top - POPOVER_GAP - popHeight)
        : rect.bottom + POPOVER_GAP;

    setCoords({ top, left, placement });
  }, []);

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

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      if (wrapRef.current?.contains(event.target)) return;
      if (popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
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
    }
  }, [open]);

  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => createInputRef.current?.focus());
    }
  }, [creating]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, query]);

  const inAnyGroup = membershipIds.size > 0;

  async function handleToggle(setId: string) {
    if (pendingId) return;
    setPendingId(setId);
    const next = !membershipIds.has(setId);
    try {
      await onToggleGroup(setId, next);
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
      const created = await onCreateGroup(name);
      if (created) {
        setCreating(false);
        setCreateName("");
      }
    } finally {
      setCreatePending(false);
    }
  }

  const triggerLabel = inAnyGroup
    ? `In ${membershipIds.size} comparison${membershipIds.size === 1 ? "" : "s"}`
    : "Add to comparison";

  return (
    <div ref={wrapRef} className={styles.heroActionWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.actionGhost}
        onClick={() => setOpen((c) => !c)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <FolderPlusIcon />
        <span>{triggerLabel}</span>
      </button>

      {open && portalReady && coords
        ? createPortal(
            <div
              ref={popoverRef}
              className={styles.popover}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                width: POPOVER_WIDTH
              }}
              data-placement={coords.placement}
              role="dialog"
              aria-label={`Add ${brandName} to comparison`}
            >
              {creating ? (
                <form
                  className={styles.popoverCreate}
                  onSubmit={handleCreate}
                >
                  <input
                    ref={createInputRef}
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Comparison name"
                    maxLength={MAX_NAME_LENGTH}
                    className={styles.popoverInput}
                    aria-label="New comparison name"
                  />
                  <div className={styles.popoverCreateRow}>
                    <button
                      type="button"
                      className={styles.popoverGhost}
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
                      className={styles.popoverPrimary}
                      disabled={
                        createPending || createName.trim().length === 0
                      }
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
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search comparisons"
                      className={styles.popoverSearchInput}
                      aria-label="Search comparisons"
                    />
                  </div>
                  <div className={styles.popoverScroll}>
                    {filtered.length === 0 ? (
                      <div className={styles.popoverEmpty}>
                        {groups.length === 0
                          ? "No comparisons yet"
                          : "No matches"}
                      </div>
                    ) : (
                      filtered.map((group) => {
                        const checked = membershipIds.has(group.id);
                        const isPending = pendingId === group.id;
                        return (
                          <button
                            key={group.id}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={checked}
                            className={styles.popoverRow}
                            onClick={() => void handleToggle(group.id)}
                            disabled={isPending}
                          >
                            <span
                              className={`${styles.popoverCheckbox}${
                                checked
                                  ? ` ${styles.popoverCheckboxChecked}`
                                  : ""
                              }`}
                              aria-hidden="true"
                            >
                              {checked ? <CheckIcon /> : null}
                            </span>
                            <span className={styles.popoverRowLabel}>
                              {group.name}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className={styles.popoverFooter}>
                    <button
                      type="button"
                      className={styles.popoverCreateButton}
                      onClick={() => setCreating(true)}
                    >
                      <PlusIcon />
                      <span>New comparison</span>
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

/* -----------------------------------------------------------------
   Icons (kept local so this client component has zero external deps)
   ----------------------------------------------------------------- */

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

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
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
