"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { BrandPageData } from "@/lib/brand-db";
import { MAX_BRANDS_PER_COMPARISON } from "@/lib/competitor-constants";
import BrandSearchPicker from "./BrandSearchPicker";
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
  subtitle
}: Props) {
  const router = useRouter();
  const [name, setName_] = useState(setName);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Keep the rename input in sync if the parent re-renders with a new
  // canonical name (e.g. after a successful PATCH refresh).
  useEffect(() => {
    setName_(setName);
  }, [setName]);

  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setPendingAdds([]);
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

  async function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setId || pending) return;
    const next = name.trim();
    if (!next) return;
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
        body: JSON.stringify({ brandIds: pendingAdds })
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
            <form
              onSubmit={handleRename}
              className={styles.pickerSearchRow}
              style={{ marginBottom: 0 }}
            >
              <input
                type="text"
                value={name}
                maxLength={120}
                onChange={(e) => setName_(e.target.value)}
                className={styles.pickerSearch}
                aria-label="Comparison name"
                disabled={pending}
                autoFocus
              />
              <button
                type="submit"
                className={styles.pickerCompare}
                disabled={pending || name.trim().length === 0}
              >
                Save
              </button>
              <button
                type="button"
                className={styles.pickerSecondary}
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setName_(setName);
                  setError(null);
                }}
              >
                Cancel
              </button>
              {error ? (
                <span className={styles.saveError}>{error}</span>
              ) : null}
            </form>
          ) : (
            <>
              <h1>{name}</h1>
              <p>{subtitle}</p>
            </>
          )}
        </div>

        {setId ? (
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
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setEditing((v) => !v)}
              disabled={pending}
            >
              {editing ? "Close" : "Rename"}
            </button>
            <button
              type="button"
              className={`${styles.iconButton} ${styles.iconButton_danger}`}
              onClick={handleDelete}
              disabled={pending}
            >
              Delete
            </button>
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

            <BrandSearchPicker
              alreadySelectedIds={existingIds}
              remainingSlots={remainingSlots}
              pendingIds={pendingAdds}
              onChange={setPendingAdds}
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
