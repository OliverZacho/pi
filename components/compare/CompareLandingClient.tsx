"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type {
  ComparisonActivity,
  CompetitorSetBrand,
  CompetitorSetSummary
} from "@/lib/competitor-db";
import { MAX_BRANDS_PER_COMPARISON } from "@/lib/competitor-constants";
import BrandSearchPicker, {
  type BrandSearchOption
} from "./BrandSearchPicker";
import MemberListSelect from "./MemberListSelect";
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-brand list scope, keyed by company id. Absent / empty = "All lists".
  const [pendingInbox, setPendingInbox] = useState<Record<string, string[]>>(
    {}
  );
  // Build panel mirrors the Collections "New collection" tile: it stays
  // tucked away until the user opens it. Deep-links (`?brands=…` from the
  // Brands page) arrive with brands pre-selected, so open it immediately
  // in that case.
  const [buildOpen, setBuildOpen] = useState(initialBrandIds.length > 0);
  const buildRef = useRef<HTMLElement | null>(null);

  function toggleBuild() {
    setBuildOpen((open) => {
      const next = !open;
      if (next) {
        // Scroll the panel into view on the next paint once it exists.
        requestAnimationFrame(() =>
          buildRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest"
          })
        );
      }
      return next;
    });
  }

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
    setPendingInbox({});
    setError(null);
  }

  function removeChip(id: string) {
    setSelectedIds((current) => current.filter((x) => x !== id));
  }

  // Single action: pressing "Compare" saves the group as a comparison
  // (auto-named from the picked brands) and opens it. The user can rename
  // it later from the comparison's own header, so there's no name prompt
  // standing between them and the result.
  async function handleCompare() {
    if (selectedIds.length === 0 || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/competitor-sets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: defaultComparisonName(selectedIds, knownBrands),
          members: selectedIds.map((companyId) => ({
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
      const body = (await res.json()) as { set: { id: string } };
      router.push(`/compare/${body.set.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save comparison");
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

        <div className={styles.cmpGrid}>
          <button
            type="button"
            className={`${styles.cmpNewTile} ${
              buildOpen ? styles.cmpNewTileActive : ""
            }`}
            onClick={toggleBuild}
            aria-expanded={buildOpen}
            aria-controls="build"
          >
            <span className={styles.cmpNewTileIcon}>
              <PlusIcon />
            </span>
            <span className={styles.cmpNewTileLabel}>New comparison</span>
          </button>

          {sets.map((set, index) => {
            const preview = setPreviews[set.id] ?? [];
            // Always lay out four mosaic slots so cards stay the same
            // height; empty slots get a subtle placeholder tile.
            const slots = Array.from({ length: 4 }, (_, i) => preview[i] ?? null);
            const hiddenCount = Math.max(0, set.brandCount - 4);
            return (
              <Link
                key={set.id}
                href={`/compare/${set.id}`}
                className={`${styles.cmpCard} ${styles.cardEnter}`}
                style={
                  index > 0
                    ? { animationDelay: `${Math.min(index, 16) * 30}ms` }
                    : undefined
                }
              >
                <div className={styles.cmpMosaic} aria-hidden="true">
                  {slots.map((brand, index) => {
                    const isLast = index === slots.length - 1;
                    return (
                      <div key={index} className={styles.cmpMosaicCell}>
                        {brand ? (
                          brand.logoUrl ? (
                            <img
                              src={brand.logoUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className={styles.cmpMosaicInitial}>
                              {brand.name.charAt(0).toUpperCase()}
                            </span>
                          )
                        ) : (
                          <div className={styles.cmpMosaicEmpty} />
                        )}
                        {isLast && hiddenCount > 0 ? (
                          <div className={styles.cmpMosaicMore}>
                            <span className={styles.cmpMosaicMoreLabel}>
                              +{hiddenCount}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  <div className={styles.cmpCardOverlay}>
                    <span className={styles.cmpOpenPill}>
                      <OpenIcon />
                      Open
                    </span>
                  </div>
                </div>
                <div className={styles.cmpCardMeta}>
                  <span className={styles.cmpCardName} title={set.name}>
                    {set.name}
                  </span>
                  <span className={styles.cmpCardMetaLine}>
                    {set.brandCount} brand
                    {set.brandCount === 1 ? "" : "s"}
                    {" · "}
                    Updated {formatRelativeDate(set.updatedAt)}
                  </span>
                  <ActivityChip activity={setActivity[set.id]} />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {buildOpen ? (
        <section
          id="build"
          ref={buildRef}
          className={styles.pickerCard}
        >
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
                  <MemberListSelect
                    brandId={id}
                    value={pendingInbox[id] ?? []}
                    ariaLabel={`Which ${displayName} lists to compare`}
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
          // Landing flow has no already-committed brands — every pick is
          // pending — so the picker gets the full budget and lets
          // `pendingIds` do the single decrement. Passing the post-selection
          // `remainingSlots` here would double-count and cap the tray at 10.
          remainingSlots={MAX_BRANDS_PER_COMPARISON}
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
            disabled={selectedIds.length === 0 || pending}
          >
            {pending ? "Comparing…" : "Compare"}
          </button>
          <span className={styles.pickerHint}>
            {remainingSlots <= 0
              ? `Max ${MAX_BRANDS_PER_COMPARISON} brands per comparison`
              : `${selectedIds.length} / ${MAX_BRANDS_PER_COMPARISON} selected`}
          </span>
        </div>

        {error ? (
          <span className={styles.saveError} role="alert">
            {error}
          </span>
        ) : null}
        </section>
      ) : null}
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

/**
 * Auto-name for a one-click-saved comparison, derived from the picked
 * brands so the saved card reads sensibly without a name prompt:
 *   1 → "Mango"
 *   2 → "Mango & Zara"
 *   3 → "Mango, Zara & H&M"
 *  4+ → "Mango, Zara & 3 more"
 * Capped to the 120-char column limit; the user can rename later.
 */
function defaultComparisonName(
  ids: string[],
  known: Map<string, BrandSearchOption>
): string {
  const names = ids
    .map((id) => known.get(id)?.name?.trim())
    .filter((name): name is string => Boolean(name));
  let label: string;
  if (names.length === 0) label = "New comparison";
  else if (names.length === 1) label = names[0];
  else if (names.length === 2) label = `${names[0]} & ${names[1]}`;
  else if (names.length === 3)
    label = `${names[0]}, ${names[1]} & ${names[2]}`;
  else label = `${names[0]}, ${names[1]} & ${names.length - 2} more`;
  return label.length > 120 ? `${label.slice(0, 117)}…` : label;
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function OpenIcon() {
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
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
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
