"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  ComparisonActivity,
  CompetitorSetBrand,
  CompetitorSetSummary
} from "@/lib/competitor-db";
import { MAX_BRANDS_PER_COMPARISON } from "@/lib/competitor-db";
import BrandSearchPicker, {
  type BrandSearchOption
} from "./BrandSearchPicker";
import styles from "./compare.module.css";

type Props = {
  sets: CompetitorSetSummary[];
  /**
   * Brand ids selected via `?brands=...` deep-link (e.g. from the
   * /brands "Compare selected" shortcut). When present we seed the
   * picker's chip tray and bias the layout toward "you're already
   * comparing".
   */
  initialBrandIds: string[];
  /**
   * Hydration payload for the initial chip tray. Lets us render the
   * brand name + logo for every deep-linked brand id without an extra
   * client roundtrip on the first paint.
   */
  initialBrandOptions: BrandSearchOption[];
  /** Preview row for each saved set (first ~4 brands by added_at). */
  setPreviews: Record<string, CompetitorSetBrand[]>;
  /**
   * 7-day freshness per set (sends + brands running sales) so a card
   * already answers "did anything happen?" before the click.
   */
  setActivity: Record<string, ComparisonActivity>;
};

/**
 * Landing page for `/compare`. Houses:
 *  - The grid of saved comparisons the user owns.
 *  - The ad-hoc brand picker that powers `/compare?brands=...` and
 *    "Save as comparison" creation (secondary to the Brands-page
 *    multi-select flow).
 *
 * The picker no longer renders the full brand directory inline — the
 * catalogue is large enough that an always-on grid is just visual
 * noise. Instead the user searches by name or category (the brand's
 * market label) and picks from a short result list. Selected brands
 * stack into a chip tray above the search so it stays clear what
 * cohort is about to be compared.
 */
export default function CompareLandingClient({
  sets,
  initialBrandIds,
  initialBrandOptions,
  setPreviews,
  setActivity
}: Props) {
  const router = useRouter();

  const [selectedIds, setSelectedIds] = useState<string[]>(initialBrandIds);
  const [knownBrands, setKnownBrands] = useState<Map<string, BrandSearchOption>>(
    () => {
      const map = new Map<string, BrandSearchOption>();
      for (const brand of initialBrandOptions) {
        map.set(brand.id, brand);
      }
      return map;
    }
  );
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingSlots = MAX_BRANDS_PER_COMPARISON - selectedIds.length;
  // Picker has no notion of "already saved" on the landing flow —
  // everything in the tray is brand-new ad-hoc picks. The empty set
  // is memoised so the picker's `useMemo` deps don't churn on every
  // render.
  const alreadySelectedIds = useMemo(() => new Set<string>(), []);

  // Region the picker should default to: the most common primary market among
  // the brands already in the tray, so newly searched peers stay same-market by
  // default. `null` (no picks yet, or all unknown) leaves the picker unscoped.
  const defaultCountry = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of selectedIds) {
      const cc = knownBrands.get(id)?.primaryMarketCountry;
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
  }, [selectedIds, knownBrands]);

  function handleAddFromPicker(nextPending: string[]) {
    // The picker hands back the full pending list, capped to the
    // global max so a stale ref can never exceed it. `rememberBrand`
    // below has already cached the metadata for any ids the picker
    // surfaced, so the chip tray can render names + logos without an
    // extra fetch.
    const ids = nextPending.slice(0, MAX_BRANDS_PER_COMPARISON);
    setSelectedIds(ids);
  }

  // When the search picker hydrates a row we haven't seen before,
  // memoise it so the chip tray can render the logo + name without
  // an extra fetch.
  function rememberBrand(brand: BrandSearchOption) {
    setKnownBrands((current) => {
      if (current.has(brand.id)) return current;
      const next = new Map(current);
      next.set(brand.id, brand);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds([]);
    setSaveOpen(false);
    setSaveName("");
  }

  function removeChip(id: string) {
    setSelectedIds((current) => current.filter((x) => x !== id));
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
            <h2>Your comparisons</h2>
            <p>Saved brand groups you can reopen any time.</p>
          </div>
        </div>

        {sets.length === 0 ? (
          <div className={styles.setsEmpty}>
            You haven't saved any comparisons yet.{" "}
            <Link href="/brands">Select a few brands on the Brands page</Link>{" "}
            — or pick them below — and save the group for next time.
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
                    <ActivityChip activity={setActivity[set.id]} />
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
              The easiest way is selecting brands on the{" "}
              <Link href="/brands">Brands page</Link> — or search below and
              add up to {MAX_BRANDS_PER_COMPARISON}.
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

        <div className={styles.pickerSelectedTray} aria-live="polite">
          {selectedIds.length === 0 ? (
            <span className={styles.pickerChipEmpty}>
              No brands selected yet — start typing below.
            </span>
          ) : (
            selectedIds.map((id) => {
              const brand = knownBrands.get(id);
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
                  <button
                    type="button"
                    className={styles.pickerChipRemove}
                    aria-label={`Remove ${displayName}`}
                    onClick={() => removeChip(id)}
                  >
                    ×
                  </button>
                </span>
              );
            })
          )}
        </div>

        <BrandSearchPicker
          alreadySelectedIds={alreadySelectedIds}
          remainingSlots={remainingSlots}
          pendingIds={selectedIds}
          onChange={handleAddFromPicker}
          onBrandSeen={rememberBrand}
          defaultCountry={defaultCountry}
        />

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
            {saveOpen ? "Cancel save" : "Save as comparison…"}
          </button>
          <span className={styles.pickerHint}>
            {remainingSlots <= 0
              ? `Max ${MAX_BRANDS_PER_COMPARISON} brands per comparison`
              : `${selectedIds.length} / ${MAX_BRANDS_PER_COMPARISON} selected`}
          </span>
        </div>

        {saveOpen ? (
          <form onSubmit={handleSave} className={styles.saveModal}>
            <label
              htmlFor="comparison-name"
              className={styles.saveModalLabel}
            >
              Name this comparison
            </label>
            <div className={styles.saveForm}>
              <input
                id="comparison-name"
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

/**
 * One-line freshness read under a comparison card's meta: how active
 * the group was in the last 7 days and whether anyone is running a
 * sale. Quiet weeks render muted so an active card stands out.
 */
function ActivityChip({ activity }: { activity?: ComparisonActivity }) {
  if (!activity) return null;

  if (activity.sends7d === 0) {
    return (
      <div
        className={`${styles.setCardActivity} ${styles.setCardActivityQuiet}`}
      >
        Quiet week — no sends
      </div>
    );
  }

  const parts = [
    `${activity.sends7d} send${activity.sends7d === 1 ? "" : "s"} this week`
  ];
  if (activity.saleBrands > 0) {
    parts.push(
      activity.saleBrands === 1
        ? "1 brand running a sale"
        : `${activity.saleBrands} brands running sales`
    );
  }
  return <div className={styles.setCardActivity}>{parts.join(" · ")}</div>;
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
  // Pinned locale + timezone — see the equivalent helper in
  // CadenceStack.tsx. `toLocaleDateString(undefined, …)` would render
  // differently on Node (en-US) versus an en-GB browser and trigger
  // a hydration mismatch on the saved-sets grid.
  return ts.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}
