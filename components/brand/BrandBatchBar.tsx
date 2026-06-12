"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_BRANDS_PER_COMPARISON,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import styles from "./brands-explore.module.css";

type Props = {
  /** Currently selected brand ids (owned by the parent's selection state). */
  selectedIds: string[];
  /** The user's saved comparisons, for the "Add to…" menu. */
  comparisons: CompetitorSetSummary[];
  /** Brand ids the user already follows, so the bar can offer the right
   *  follow/unfollow action and avoid redundant requests. */
  initialFollowedIds: string[];
  /** Notified after a successful follow/unfollow so the host page can
   *  reflect it (e.g. drop unfollowed brands from the /following list). */
  onAfterFollowChange?: (ids: string[], nowFollowing: boolean) => void;
  /** Clears the parent's selection (the bar's own ephemeral state resets
   *  when it unmounts on empty selection). */
  onClear: () => void;
};

/**
 * Floating action bar for a multi-brand selection — shared by the
 * Brands explorer and the Following page. Offers: open a comparison,
 * save the selection as a comparison, append to an existing one, and
 * follow / unfollow the whole batch. Rendered by the host only while
 * something is selected; it pins itself to the viewport.
 */
export default function BrandBatchBar({
  selectedIds,
  comparisons,
  initialFollowedIds,
  onAfterFollowChange,
  onClear
}: Props) {
  const router = useRouter();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [followedIds, setFollowedIds] = useState<Set<string>>(
    () => new Set(initialFollowedIds)
  );
  const [followPending, setFollowPending] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addPendingId, setAddPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (selectedIds.length === 0) return null;

  function handleCompare() {
    const qs = new URLSearchParams();
    for (const id of selectedIds) qs.append("brands", id);
    router.push(`/compare?${qs.toString()}`);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = saveName.trim();
    if (!trimmed || savePending) return;
    setSavePending(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/competitor-sets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, brandIds: selectedIds })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const body = (await res.json()) as { set: { id: string } };
      router.push(`/compare/${body.set.id}`);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavePending(false);
    }
  }

  async function handleAddToComparison(setId: string) {
    if (addPendingId || selectedIds.length === 0) return;
    setAddPendingId(setId);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/competitor-sets/${encodeURIComponent(setId)}/brands`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandIds: selectedIds })
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      router.push(`/compare/${setId}`);
      router.refresh();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to add to comparison"
      );
      setAddPendingId(null);
    }
  }

  const allSelectedFollowed = selectedIds.every((id) => followedIds.has(id));

  async function handleFollowSelected(follow: boolean) {
    if (followPending || selectedIds.length === 0) return;
    const targets = selectedIds.filter((id) =>
      follow ? !followedIds.has(id) : followedIds.has(id)
    );
    if (targets.length === 0) return;
    setFollowPending(true);
    setActionError(null);
    const results = await Promise.allSettled(
      targets.map(async (id) => {
        const res = await fetch(`/api/brand-follows/${encodeURIComponent(id)}`, {
          method: follow ? "PUT" : "DELETE",
          credentials: "include"
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        return id;
      })
    );
    const okIds = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value);
    if (okIds.length > 0) {
      setFollowedIds((current) => {
        const next = new Set(current);
        for (const id of okIds) {
          if (follow) next.add(id);
          else next.delete(id);
        }
        return next;
      });
      onAfterFollowChange?.(okIds, follow);
    }
    if (okIds.length < targets.length) {
      setActionError(
        `${follow ? "Followed" : "Unfollowed"} ${okIds.length} of ${
          targets.length
        } brands — the rest failed, try again.`
      );
    }
    setFollowPending(false);
  }

  return (
    <div
      className={styles.compareBar}
      role="region"
      aria-label="Actions for selected brands"
    >
      <span className={styles.compareBarCount}>
        {selectedIds.length} brand{selectedIds.length === 1 ? "" : "s"} selected
      </span>
      {saveOpen ? (
        <form onSubmit={handleSave} className={styles.compareSaveForm}>
          <input
            type="text"
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            maxLength={120}
            placeholder="Name this comparison…"
            className={styles.compareSaveInput}
            disabled={savePending}
            autoFocus
            aria-label="Name for new comparison"
          />
          <button
            type="submit"
            className={styles.compareBarPrimary}
            disabled={savePending || saveName.trim().length === 0}
          >
            {savePending ? "Saving…" : "Save & open"}
          </button>
          <button
            type="button"
            className={styles.compareBarSecondary}
            onClick={() => {
              setSaveOpen(false);
              setSaveError(null);
            }}
            disabled={savePending}
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className={styles.compareBarSpacer} />
          <button
            type="button"
            className={styles.compareBarPrimary}
            onClick={handleCompare}
          >
            Compare ({selectedIds.length})
          </button>
          <button
            type="button"
            className={styles.compareBarSecondary}
            onClick={() => setSaveOpen(true)}
          >
            Save as comparison…
          </button>
          {comparisons.length > 0 ? (
            <span className={styles.compareBarMenuWrap}>
              <button
                type="button"
                className={styles.compareBarSecondary}
                onClick={() => setAddMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
              >
                Add to…
              </button>
              {addMenuOpen ? (
                <div className={styles.compareBarMenu} role="menu">
                  {comparisons.map((comparison) => {
                    const wouldOverflow =
                      comparison.brandCount + selectedIds.length >
                      MAX_BRANDS_PER_COMPARISON;
                    return (
                      <button
                        key={comparison.id}
                        type="button"
                        role="menuitem"
                        className={styles.compareBarMenuItem}
                        onClick={() => void handleAddToComparison(comparison.id)}
                        disabled={addPendingId !== null || wouldOverflow}
                        title={
                          wouldOverflow
                            ? `Adding ${selectedIds.length} would exceed the ${MAX_BRANDS_PER_COMPARISON}-brand limit`
                            : undefined
                        }
                      >
                        <span>
                          {addPendingId === comparison.id
                            ? "Adding…"
                            : comparison.name}
                        </span>
                        <span className={styles.compareBarMenuMeta}>
                          {comparison.brandCount} brand
                          {comparison.brandCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </span>
          ) : null}
          <button
            type="button"
            className={styles.compareBarSecondary}
            onClick={() => void handleFollowSelected(!allSelectedFollowed)}
            disabled={followPending}
          >
            {followPending
              ? "Working…"
              : allSelectedFollowed
                ? "Unfollow"
                : "Follow all"}
          </button>
          <button
            type="button"
            className={styles.compareBarSecondary}
            onClick={onClear}
          >
            Clear
          </button>
        </>
      )}
      {saveError || actionError ? (
        <span className={styles.compareBarError} role="alert">
          {saveError ?? actionError}
        </span>
      ) : null}
    </div>
  );
}
