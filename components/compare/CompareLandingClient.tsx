"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  CompetitorSetBrand,
  CompetitorSetSummary
} from "@/lib/competitor-db";
import { MAX_BRANDS_PER_COMPARISON } from "@/lib/competitor-db";
import styles from "./compare.module.css";

type BrandOption = {
  id: string;
  name: string;
  market: string | null;
  logoUrl: string | null;
};

type Props = {
  sets: CompetitorSetSummary[];
  /**
   * Lightweight brand directory used by the picker. The server hydrates
   * this with every tracked brand (filtered to those with captured
   * emails) so the picker is fully responsive without an extra fetch
   * once the page lands.
   */
  brands: BrandOption[];
  /**
   * Brand ids selected via `?brands=...` deep-link (e.g. from the
   * /brands "Compare selected" shortcut). When present we seed the
   * tray and bias the layout toward "you're already comparing".
   */
  initialBrandIds: string[];
  /** Preview row for each saved set (first ~4 brands by added_at). */
  setPreviews: Record<string, CompetitorSetBrand[]>;
};

/**
 * Landing page for `/compare`. Houses:
 *  - The grid of saved competitor sets the user owns.
 *  - The ad-hoc brand picker that powers `/compare?brands=...` and
 *    "Save as set" creation.
 *
 * Kept as a single client island so the picker state (selected ids,
 * search input, save form) can stay reactive without us round-tripping
 * to the server. The dashboard itself, when `?brands=` is present in
 * the URL, is rendered by the server page below this component — we
 * only own the picker UI.
 */
export default function CompareLandingClient({
  sets,
  brands,
  initialBrandIds,
  setPreviews
}: Props) {
  const router = useRouter();

  const [selectedIds, setSelectedIds] = useState<string[]>(initialBrandIds);
  const [query, setQuery] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brandById = useMemo(() => {
    const map = new Map<string, BrandOption>();
    for (const brand of brands) map.set(brand.id, brand);
    return map;
  }, [brands]);

  const filteredBrands = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return brands;
    return brands.filter(
      (b) =>
        b.name.toLowerCase().includes(trimmed) ||
        (b.market ?? "").toLowerCase().includes(trimmed)
    );
  }, [brands, query]);

  const isSelected = (id: string) => selectedIds.includes(id);
  const atLimit = selectedIds.length >= MAX_BRANDS_PER_COMPARISON;

  function toggle(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((x) => x !== id);
      }
      if (current.length >= MAX_BRANDS_PER_COMPARISON) {
        return current;
      }
      return [...current, id];
    });
  }

  function clearSelection() {
    setSelectedIds([]);
    setSaveOpen(false);
    setSaveName("");
  }

  function handleCompare() {
    if (selectedIds.length < 1) return;
    const qs = new URLSearchParams();
    for (const id of selectedIds) qs.append("brands", id);
    router.push(`/compare?${qs.toString()}`);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = saveName.trim();
    if (!trimmed || pending) return;
    if (selectedIds.length === 0) {
      setError("Pick at least one brand first");
      return;
    }
    setPending(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : "Failed to save set");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <section>
        <div className={styles.sectionHead}>
          <div>
            <h2>Your competitor sets</h2>
            <p>Saved groups you can reopen any time.</p>
          </div>
        </div>

        {sets.length === 0 ? (
          <div className={styles.setsEmpty}>
            You haven't saved any competitor sets yet. Pick a few brands below
            and choose <em>Save as set</em> to keep the group for next time.
          </div>
        ) : (
          <div className={styles.setsGrid}>
            {sets.map((set) => {
              const preview = setPreviews[set.id] ?? [];
              return (
                <Link
                  key={set.id}
                  href={`/compare/${set.id}`}
                  className={styles.setCard}
                >
                  <div className={styles.setLogos} aria-hidden="true">
                    {preview.slice(0, 4).map((brand) => (
                      <span key={brand.id} className={styles.setLogo}>
                        {brand.logoUrl ? (
                          <img
                            src={brand.logoUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          brand.name.charAt(0).toUpperCase()
                        )}
                      </span>
                    ))}
                    {set.brandCount > 4 ? (
                      <span
                        className={`${styles.setLogo} ${styles.setLogoMore}`}
                      >
                        +{set.brandCount - 4}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <div className={styles.setCardName}>{set.name}</div>
                    <div className={styles.setCardMeta}>
                      {set.brandCount} brand
                      {set.brandCount === 1 ? "" : "s"}
                      {" · "}
                      Updated {formatRelativeDate(set.updatedAt)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.pickerCard}>
        <div className={styles.pickerHead}>
          <div>
            <h2>Build a comparison</h2>
            <p>
              Pick up to {MAX_BRANDS_PER_COMPARISON} brands to view a
              side-by-side dashboard.
            </p>
          </div>
          {selectedIds.length > 0 ? (
            <button
              type="button"
              className={styles.pickerSecondary}
              onClick={clearSelection}
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className={styles.pickerSearchRow}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search brands by name or market…"
            className={styles.pickerSearch}
            aria-label="Search brands"
          />
        </div>

        <div className={styles.pickerSelectedTray} aria-live="polite">
          {selectedIds.length === 0 ? (
            <span className={styles.pickerChipEmpty}>
              No brands selected yet.
            </span>
          ) : (
            selectedIds.map((id) => {
              const brand = brandById.get(id);
              if (!brand) return null;
              return (
                <span key={id} className={styles.pickerChip}>
                  <span
                    className={styles.pickerChipLogo}
                    aria-hidden="true"
                  >
                    {brand.logoUrl ? (
                      <img
                        src={brand.logoUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      brand.name.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span>{brand.name}</span>
                  <button
                    type="button"
                    className={styles.pickerChipRemove}
                    aria-label={`Remove ${brand.name}`}
                    onClick={() => toggle(id)}
                  >
                    ×
                  </button>
                </span>
              );
            })
          )}
        </div>

        <div className={styles.pickerList}>
          {filteredBrands.length === 0 ? (
            <span className={styles.empty}>No brands match your search.</span>
          ) : (
            filteredBrands.map((brand) => {
              const selected = isSelected(brand.id);
              const disabled = !selected && atLimit;
              const className = `${styles.pickerRow} ${
                selected ? styles.pickerRow_selected : ""
              } ${disabled ? styles.pickerRow_disabled : ""}`.trim();
              return (
                <button
                  key={brand.id}
                  type="button"
                  className={className}
                  onClick={() => toggle(brand.id)}
                  disabled={disabled}
                  aria-pressed={selected}
                >
                  <span className={styles.pickerRowLogo} aria-hidden="true">
                    {brand.logoUrl ? (
                      <img
                        src={brand.logoUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      brand.name.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className={styles.pickerRowName}>{brand.name}</span>
                  {brand.market ? (
                    <span className={styles.pickerRowMarket}>
                      {formatMarketLabel(brand.market)}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <div className={styles.pickerActions}>
          <button
            type="button"
            className={styles.pickerCompare}
            onClick={handleCompare}
            disabled={selectedIds.length === 0}
          >
            Compare ({selectedIds.length})
          </button>
          <button
            type="button"
            className={styles.pickerSecondary}
            onClick={() => setSaveOpen((v) => !v)}
            disabled={selectedIds.length === 0 || pending}
          >
            {saveOpen ? "Cancel save" : "Save as set…"}
          </button>
          <span className={styles.pickerHint}>
            {atLimit
              ? `Max ${MAX_BRANDS_PER_COMPARISON} brands per comparison`
              : `${selectedIds.length} / ${MAX_BRANDS_PER_COMPARISON} selected`}
          </span>
        </div>

        {saveOpen ? (
          <form onSubmit={handleSave} className={styles.saveModal}>
            <label
              htmlFor="competitor-set-name"
              className={styles.saveModalLabel}
            >
              Name this competitor set
            </label>
            <div className={styles.saveForm}>
              <input
                id="competitor-set-name"
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                maxLength={120}
                placeholder="e.g. Nordic eyewear rivals"
                className={styles.saveInput}
                disabled={pending}
                autoFocus
              />
              <button
                type="submit"
                className={styles.pickerCompare}
                disabled={
                  pending ||
                  saveName.trim().length === 0 ||
                  selectedIds.length === 0
                }
              >
                {pending ? "Saving…" : "Save & open"}
              </button>
            </div>
            {error ? (
              <span className={styles.saveError} role="alert">
                {error}
              </span>
            ) : null}
          </form>
        ) : null}
      </section>
    </>
  );
}

function formatMarketLabel(market: string): string {
  return market
    .split(/[\s_-]+/)
    .map((word) =>
      word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)
    )
    .join(" ");
}

function formatRelativeDate(value: string): string {
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return "—";
  const now = Date.now();
  const diff = now - ts.getTime();
  const day = 86_400_000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.round(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.round(diff / (7 * day))}w ago`;
  return ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
