"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { BrandPageData } from "@/lib/brand-db";
import { MAX_BRANDS_PER_COMPARISON } from "@/lib/competitor-constants";
import BrandSearchPicker, {
  type BrandSearchOption
} from "./BrandSearchPicker";
import MemberListSelect from "./MemberListSelect";
import TeamUpgradeButton from "@/components/common/TeamUpgradeButton";
import InlineRenameForm, {
  RenameButton
} from "@/components/common/InlineRenameForm";
import { getCompareColor } from "./compareColors";
import styles from "./compare.module.css";
import v2 from "./compare-v2.module.css";

type Props = {
  brands: BrandPageData[];
  /**
   * Set id when viewing a saved set; null on ad-hoc compares. Saved-set
   * mode unlocks the rename / add-brand / delete controls.
   */
  setId: string | null;
  /** Display name for the saved set (or computed default for ad-hoc). */
  setName: string;
  /**
   * Sub-title under the name. Saved sets pass the updated-at date;
   * ad-hoc compares pass a count + "ad-hoc comparison" label.
   */
  subtitle: string;
  /**
   * Whether the viewer owns this set. False when a teammate is viewing a
   * team-shared comparison — controls are hidden and it renders read-only.
   * Defaults to true for ad-hoc / owner use.
   */
  canEdit?: boolean;
  /** Whether the set is shared with the owner's team (owner view only). */
  sharedWithTeam?: boolean;
  /**
   * Whether the owner may actually share with their team — true for an
   * active Team plan (or an admin). When false the owner still sees the
   * "Share with team" button, but it's rendered as a locked upsell that
   * starts the Team-plan upgrade instead of toggling sharing.
   */
  canShareWithTeam?: boolean;
};

/**
 * Client-side header for the comparison dashboard. Owns the rename /
 * delete / "add brand" / "remove brand" affordances. Wraps the
 * otherwise server-only dashboard so the bulk of the page stays static
 * while the operations that need fetches stay isolated to this island.
 *
 * When viewing a saved set the "Add brands" button opens a modal that
 * embeds the shared `BrandSearchPicker`, so growing an existing set
 * uses the same search-as-you-type flow as the landing page.
 */
export default function CompareBrandStrip({
  brands,
  setId,
  setName,
  subtitle,
  canEdit = true,
  sharedWithTeam = false,
  canShareWithTeam = false
}: Props) {
  const router = useRouter();
  const [name, setName_] = useState(setName);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [shared, setShared] = useState(sharedWithTeam);
  const [sharePending, setSharePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Metadata cache for picked brands so the selected-tray can render each
  // chip's name + logo without an extra fetch. The picker hands us a row
  // via `onBrandSeen` whenever it surfaces one in its results.
  const [knownAdds, setKnownAdds] = useState<Map<string, BrandSearchOption>>(
    () => new Map()
  );

  const rememberAdd = useCallback((brand: BrandSearchOption) => {
    setKnownAdds((current) => {
      if (current.has(brand.id)) return current;
      const next = new Map(current);
      next.set(brand.id, brand);
      return next;
    });
  }, []);

  // Per-brand list scope chosen in the add modal, keyed by company id.
  // Absent / empty = "All lists".
  const [pendingInbox, setPendingInbox] = useState<Record<string, string[]>>(
    {}
  );

  // Keep the rename input in sync if the parent re-renders with a new
  // canonical name (e.g. after a successful PATCH refresh).
  useEffect(() => {
    setName_(setName);
  }, [setName]);

  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setPendingAdds([]);
    setPendingInbox({});
    setAddError(null);
  }, []);

  useEffect(() => {
    if (!addOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeAdd();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addOpen, closeAdd]);

  // Existing members get marked "in set" inside the picker so the
  // user can't double-add them.
  const existingIds = useMemo(
    () => new Set(brands.map((b) => b.brand.id)),
    [brands]
  );
  const remainingSlots = MAX_BRANDS_PER_COMPARISON - brands.length;

  // Default the "add a brand" picker to the cohort's dominant region so peers
  // added to an existing comparison stay same-market by default.
  const defaultCountry = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of brands) {
      const cc = b.brand.primaryMarketCountry;
      if (cc) counts.set(cc, (counts.get(cc) ?? 0) + 1);
    }
    let top: string | null = null;
    let topN = 0;
    for (const [cc, n] of counts) {
      if (n > topN) {
        top = cc;
        topN = n;
      }
    }
    return top;
  }, [brands]);

  async function handleRename(next: string) {
    if (!setId || pending) return;
    if (next === name) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/competitor-sets/${setId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next })
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setName_(next);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!setId || pending) return;
    const confirmed = window.confirm(
      `Delete "${name}"? This can't be undone.`
    );
    if (!confirmed) return;
    setPending(true);
    try {
      const res = await fetch(`/api/competitor-sets/${setId}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.push("/compare");
      router.refresh();
    } catch (err) {
      console.error("Failed to delete set", err);
      setPending(false);
    }
  }

  async function handleToggleShare() {
    if (!setId || sharePending) return;
    const next = !shared;
    setSharePending(true);
    setShared(next); // optimistic
    setError(null);
    try {
      const res = await fetch(`/api/competitor-sets/${setId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedWithTeam: next })
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
    } catch (err) {
      setShared(!next);
      setError(
        err instanceof Error ? err.message : "Failed to update team sharing"
      );
    } finally {
      setSharePending(false);
    }
  }

  async function handleRemoveBrand(companyId: string, brandName: string) {
    if (!setId || pending) return;
    const confirmed = window.confirm(`Remove ${brandName} from this comparison?`);
    if (!confirmed) return;
    setPending(true);
    try {
      const res = await fetch(
        `/api/competitor-sets/${setId}/brands/${companyId}`,
        {
          method: "DELETE",
          credentials: "include"
        }
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.refresh();
    } catch (err) {
      console.error("Failed to remove brand", err);
    } finally {
      setPending(false);
    }
  }

  // Change which lists an existing member is scoped to (empty = "All"),
  // persisting immediately and refreshing so the dashboard recomputes.
  async function handleChangeList(companyId: string, inboxIds: string[]) {
    if (!setId || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/competitor-sets/${setId}/brands/${companyId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inboxIds })
        }
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change list");
    } finally {
      setPending(false);
    }
  }

  async function handleSubmitAdds() {
    if (!setId || adding) return;
    if (pendingAdds.length === 0) {
      closeAdd();
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/competitor-sets/${setId}/brands`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members: pendingAdds.map((companyId) => ({
            companyId,
            inboxIds: pendingInbox[companyId] ?? []
          }))
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      closeAdd();
      router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add brands");
    } finally {
      setAdding(false);
    }
  }

  return (
    <header className={styles.compareHeader}>
      <div className={styles.compareHeaderRow}>
        <div className={styles.compareTitle}>
          {editing && setId ? (
            <InlineRenameForm
              initialValue={name}
              ariaLabel="Comparison name"
              pending={pending}
              inputClassName={styles.compareTitleRename}
              onSave={handleRename}
              onCancel={() => {
                setEditing(false);
                setError(null);
              }}
            />
          ) : (
            <h1>
              {name}
              {setId && canEdit ? (
                <RenameButton
                  onClick={() => setEditing(true)}
                  label="Rename comparison"
                />
              ) : null}
            </h1>
          )}
          <p>{subtitle}</p>
          {error ? (
            <span className={styles.saveError} role="alert">
              {error}
            </span>
          ) : null}
        </div>

        {setId && canEdit ? (
          <div className={styles.compareActions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => {
                setAddOpen(true);
                setPendingAdds([]);
                setAddError(null);
              }}
              disabled={pending || remainingSlots <= 0}
              title={
                remainingSlots <= 0
                  ? `Comparisons are limited to ${MAX_BRANDS_PER_COMPARISON} brands`
                  : "Add more brands to this comparison"
              }
            >
              + Add brands
            </button>
            {canShareWithTeam ? (
              <button
                type="button"
                className={styles.iconButton}
                onClick={handleToggleShare}
                disabled={sharePending}
                title={
                  shared
                    ? "Your team can view this comparison. Click to stop sharing."
                    : "Let your team view this comparison"
                }
              >
                {shared ? "✓ Shared with team" : "Share with team"}
              </button>
            ) : (
              <TeamUpgradeButton
                source="compare_share_team"
                className={`${styles.iconButton} ${styles.iconButtonLocked}`}
                title="Sharing comparisons with your team is a Team plan feature. Upgrade to enable it."
                onError={setError}
              >
                <span>Share with team</span>
                <span className={styles.lockGlyph}>
                  <LockGlyph />
                </span>
              </TeamUpgradeButton>
            )}
            <button
              type="button"
              className={`${styles.iconButton} ${styles.iconButton_danger}`}
              onClick={handleDelete}
              disabled={pending}
            >
              Delete
            </button>
          </div>
        ) : setId && !canEdit ? (
          <div className={styles.compareActions}>
            <span className={styles.compareReadonly}>
              {shared ? "Shared with your team · read-only" : "Read-only"}
            </span>
          </div>
        ) : null}
      </div>

      <div className={styles.brandStrip}>
        {brands.map((b, idx) => {
          const color = getCompareColor(idx);
          const accentStyle = {
            ["--accent" as string]: color
          } as CSSProperties;
          return (
            <span
              key={b.brand.id}
              className={styles.brandStripItem}
              style={accentStyle}
            >
              <span className={styles.brandStripAccentDot} />
              <span className={styles.brandStripLogo} aria-hidden="true">
                {b.brand.logoUrl ? (
                  <img
                    src={b.brand.logoUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  b.brand.name.charAt(0).toUpperCase()
                )}
              </span>
              <span className={styles.brandStripName}>{b.brand.name}</span>
              {setId && b.brand.listTabs.length > 1 ? (
                <MemberListSelect
                  brandId={b.brand.id}
                  value={b.brand.activeSegmentIds}
                  segments={b.brand.listTabs.map((tab) => ({
                    inboxId: tab.inboxId,
                    label: tab.label,
                    categoryLabel: tab.categoryLabel
                  }))}
                  disabled={pending}
                  ariaLabel={`Which ${b.brand.name} lists to compare`}
                  onChange={(inboxIds) =>
                    handleChangeList(b.brand.id, inboxIds)
                  }
                />
              ) : null}
              {setId && brands.length > 1 ? (
                <button
                  type="button"
                  className={styles.brandStripRemove}
                  aria-label={`Remove ${b.brand.name}`}
                  disabled={pending}
                  onClick={() => handleRemoveBrand(b.brand.id, b.brand.name)}
                >
                  ×
                </button>
              ) : null}
            </span>
          );
        })}
      </div>

      {addOpen && setId ? (
        <div
          className={v2.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Add brands to comparison"
          onClick={closeAdd}
        >
          <div
            className={`${v2.modal} ${v2.modalWide}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className={v2.modalHead}>
              <div>
                <span className={v2.modalEyebrow}>Expand the comparison</span>
                <h3 className={v2.modalTitle}>Add brands</h3>
                <p className={v2.modalSub}>
                  Search by name or category. Up to {remainingSlots} more brand
                  {remainingSlots === 1 ? "" : "s"} can be added to this comparison.
                </p>
              </div>
              <button
                type="button"
                className={v2.modalClose}
                onClick={closeAdd}
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <div className={styles.pickerSelectedTray} aria-live="polite">
              {pendingAdds.length === 0 ? (
                <span className={styles.pickerChipEmpty}>
                  No brands picked yet — search and click to add.
                </span>
              ) : (
                pendingAdds.map((id) => {
                  const brand = knownAdds.get(id);
                  const displayName = brand?.name ?? "Loading…";
                  return (
                    <span key={id} className={styles.pickerChip}>
                      <span
                        className={styles.pickerChipLogo}
                        aria-hidden="true"
                      >
                        {brand?.logoUrl ? (
                          <img
                            src={brand.logoUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          displayName.charAt(0).toUpperCase()
                        )}
                      </span>
                      <span>{displayName}</span>
                      <MemberListSelect
                        brandId={id}
                        value={pendingInbox[id] ?? []}
                        ariaLabel={`Which ${displayName} lists to add`}
                        onChange={(inboxIds) =>
                          setPendingInbox((current) => ({
                            ...current,
                            [id]: inboxIds
                          }))
                        }
                      />
                      <button
                        type="button"
                        className={styles.pickerChipRemove}
                        aria-label={`Remove ${displayName}`}
                        onClick={() =>
                          setPendingAdds((current) =>
                            current.filter((x) => x !== id)
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  );
                })
              )}
            </div>

            <BrandSearchPicker
              alreadySelectedIds={existingIds}
              remainingSlots={remainingSlots}
              pendingIds={pendingAdds}
              onChange={setPendingAdds}
              onBrandSeen={rememberAdd}
              variant="modal"
              placeholder="Search for a brand or category to add…"
              defaultCountry={defaultCountry}
            />

            {addError ? (
              <span className={styles.saveError} role="alert">
                {addError}
              </span>
            ) : null}

            <div className={v2.modalActions}>
              <button
                type="button"
                className={styles.pickerSecondary}
                onClick={closeAdd}
                disabled={adding}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.pickerCompare}
                onClick={handleSubmitAdds}
                disabled={adding || pendingAdds.length === 0}
              >
                {adding
                  ? "Adding…"
                  : `Add ${pendingAdds.length} brand${
                      pendingAdds.length === 1 ? "" : "s"
                    }`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
