"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { BrandPageData } from "@/lib/brand-db";
import styles from "./compare.module.css";

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
 * delete / "remove brand" affordances. Wraps the otherwise server-only
 * dashboard so the bulk of the page stays static while the operations
 * that need fetches stay isolated to this island.
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
    const confirmed = window.confirm(`Remove ${brandName} from this set?`);
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
                aria-label="Set name"
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
        {brands.map((b) => {
          const accentStyle = {
            ["--accent" as string]: b.brand.accent.base
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
    </header>
  );
}
