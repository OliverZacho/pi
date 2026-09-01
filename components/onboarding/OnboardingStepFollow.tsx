"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_ONBOARDING_FOLLOWS } from "@/lib/onboarding";
import { formatMarketLabel } from "@/lib/market-label";
import OnboardingBrandSearch, {
  type OnboardingTrackedBrand
} from "./OnboardingBrandSearch";
import type { OnboardingPick } from "./OnboardingModal";
import styles from "./onboarding.module.css";

type Props = {
  /** Step-2 category slugs — scope the suggestion grid to these. */
  categories: string[];
  /** Server-fetched most-active brands (unscoped) as the initial grid. */
  initialPopular: OnboardingTrackedBrand[];
  picks: OnboardingPick[];
  onChange: (next: OnboardingPick[]) => void;
};

/**
 * Step 3: pick 3 to 20 brands. A dual-source typeahead on top (tracked
 * brands follow instantly; untracked Logo.dev matches become requests we
 * fulfil), and below it a suggestion grid of the most active brands in the
 * step-2 categories. Selected untracked picks are appended to the grid so
 * every pick stays visible and un-pickable in one place.
 */
export default function OnboardingStepFollow({
  categories,
  initialPopular,
  picks,
  onChange
}: Props) {
  const [suggestions, setSuggestions] =
    useState<OnboardingTrackedBrand[]>(initialPopular);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const fetchedFor = useRef<string | null>(null);

  const categoriesKey = categories.join(",");

  useEffect(() => {
    if (!categoriesKey || fetchedFor.current === categoriesKey) return;
    fetchedFor.current = categoriesKey;
    const controller = new AbortController();

    async function run() {
      setLoadingSuggestions(true);
      try {
        const params = new URLSearchParams();
        params.set("markets", categoriesKey);
        const res = await fetch(
          `/api/onboarding/brand-search?${params.toString()}`,
          { credentials: "include", signal: controller.signal }
        );
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const body = (await res.json()) as {
          tracked: OnboardingTrackedBrand[];
        };
        if (Array.isArray(body.tracked) && body.tracked.length > 0) {
          setSuggestions(body.tracked);
        }
      } catch {
        // Keep whatever grid we already show — the unscoped popular list
        // is a fine fallback when the scoped fetch fails.
      } finally {
        if (!controller.signal.aborted) setLoadingSuggestions(false);
      }
    }

    run();
    return () => controller.abort();
  }, [categoriesKey]);

  const selectedKeys = useMemo(
    () => new Set(picks.map((pick) => pick.key)),
    [picks]
  );
  const atLimit = picks.length >= MAX_ONBOARDING_FOLLOWS;

  function togglePick(pick: OnboardingPick) {
    if (selectedKeys.has(pick.key)) {
      onChange(picks.filter((existing) => existing.key !== pick.key));
      return;
    }
    if (atLimit) return;
    onChange([...picks, pick]);
  }

  // Untracked picks have no grid card of their own — surface them ahead of
  // the suggestions so they stay visible and removable.
  const untrackedPicks = picks.filter(
    (pick): pick is Extract<OnboardingPick, { kind: "untracked" }> =>
      pick.kind === "untracked"
  );

  function initial(name: string) {
    return name.charAt(0).toUpperCase();
  }

  return (
    <div>
      <OnboardingBrandSearch
        placeholder="Search any brand…"
        selectedKeys={selectedKeys}
        atLimit={atLimit}
        onPickTracked={(brand) =>
          togglePick({ kind: "tracked", key: brand.id, brand })
        }
        onPickUntracked={(brand) =>
          togglePick({ kind: "untracked", key: brand.domain, brand })
        }
      />

      <div className={styles.brandGrid}>
        {untrackedPicks.map((pick) => (
          <button
            key={pick.key}
            type="button"
            aria-pressed="true"
            className={`${styles.brandCard} ${styles.brandCardActive}`}
            onClick={() => togglePick(pick)}
          >
            <span className={styles.brandCheck} aria-hidden="true">
              <CheckIcon />
            </span>
            <span className={styles.brandLogo} aria-hidden="true">
              {pick.brand.logoUrl ? (
                <img src={pick.brand.logoUrl} alt="" referrerPolicy="no-referrer" />
              ) : (
                initial(pick.brand.name)
              )}
            </span>
            <span className={styles.brandName}>{pick.brand.name}</span>
            <span className={styles.requestBadge}>We&apos;ll add this brand</span>
          </button>
        ))}
        {suggestions.map((brand) => {
          const active = selectedKeys.has(brand.id);
          const disabled = !active && atLimit;
          return (
            <button
              key={brand.id}
              type="button"
              aria-pressed={active}
              className={[
                styles.brandCard,
                active ? styles.brandCardActive : ""
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={disabled}
              onClick={() =>
                togglePick({ kind: "tracked", key: brand.id, brand })
              }
            >
              {active ? (
                <span className={styles.brandCheck} aria-hidden="true">
                  <CheckIcon />
                </span>
              ) : null}
              <span className={styles.brandLogo} aria-hidden="true">
                {brand.logoUrl ? (
                  <img src={brand.logoUrl} alt="" referrerPolicy="no-referrer" />
                ) : (
                  initial(brand.name)
                )}
              </span>
              <span className={styles.brandName}>{brand.name}</span>
              {brand.markets.length > 0 ? (
                <span className={styles.brandMeta}>
                  {formatMarketLabel(brand.markets[0])}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {loadingSuggestions && suggestions.length === 0 ? (
        <div className={styles.gridLoading}>Loading suggestions…</div>
      ) : null}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m5 10 3.5 3.5L15 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
