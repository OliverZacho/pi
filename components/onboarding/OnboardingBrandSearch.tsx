"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./onboarding.module.css";

/** A tracked brand row returned by /api/onboarding/brand-search. */
export type OnboardingTrackedBrand = {
  id: string;
  name: string;
  markets: string[];
  /** Normalized registrable host, for the own-brand answer. */
  domain: string | null;
  logoUrl: string | null;
};

/** An untracked (Logo.dev) row — requestable, not yet in the catalogue. */
export type OnboardingUntrackedBrand = {
  name: string;
  domain: string;
  logoUrl: string | null;
};

type Props = {
  placeholder: string;
  /** Keys already picked — tracked ids and untracked domains — so rows
   *  render their "Added" state and clicking toggles off in the parent. */
  selectedKeys: ReadonlySet<string>;
  /** Whether the parent can absorb another pick (step 3's max-20 cap). */
  atLimit?: boolean;
  onPickTracked: (brand: OnboardingTrackedBrand) => void;
  onPickUntracked: (brand: OnboardingUntrackedBrand) => void;
  /** Single-pick consumers (step 1's own-brand field) close after a pick. */
  closeOnPick?: boolean;
};

/**
 * Debounced dual-source brand typeahead for the onboarding modal, modeled
 * on the Compare picker but pointed at `/api/onboarding/brand-search`:
 * tracked brands surface as followable rows, and Logo.dev-only matches
 * surface under "Not tracked yet" as requestable picks. The parent owns
 * all selection state; this component just reports clicks.
 */
export default function OnboardingBrandSearch({
  placeholder,
  selectedKeys,
  atLimit = false,
  onPickTracked,
  onPickUntracked,
  closeOnPick = false
}: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [tracked, setTracked] = useState<OnboardingTrackedBrand[]>([]);
  const [untracked, setUntracked] = useState<OnboardingUntrackedBrand[]>([]);
  const [open, setOpen] = useState(false);
  const requestSeq = useRef(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;

  useEffect(() => {
    if (!hasQuery) {
      setTracked([]);
      setUntracked([]);
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    const controller = new AbortController();

    async function run() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("q", trimmedQuery);
        params.set("untracked", "1");
        const res = await fetch(
          `/api/onboarding/brand-search?${params.toString()}`,
          { credentials: "include", signal: controller.signal }
        );
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const body = (await res.json()) as {
          tracked: OnboardingTrackedBrand[];
          untracked: OnboardingUntrackedBrand[];
        };
        if (seq !== requestSeq.current) return;
        setTracked(body.tracked ?? []);
        setUntracked(body.untracked ?? []);
      } catch {
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        setTracked([]);
        setUntracked([]);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }

    run();
    return () => controller.abort();
  }, [trimmedQuery, hasQuery]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function closeAfterPick() {
    if (!closeOnPick) return;
    setQuery("");
    setDebouncedQuery("");
    setTracked([]);
    setUntracked([]);
    setOpen(false);
  }

  const showDropdown = open && hasQuery;

  function initial(name: string) {
    return name.charAt(0).toUpperCase();
  }

  return (
    <div className={styles.searchWrap} ref={wrapperRef}>
      <input
        type="search"
        className={styles.searchInput}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-expanded={showDropdown}
      />
      {showDropdown ? (
        <div className={styles.searchDropdown} role="listbox">
          {tracked.length > 0 ? (
            <div className={styles.searchSection}>In the archive</div>
          ) : null}
          {tracked.map((brand) => {
            const picked = selectedKeys.has(brand.id);
            const disabled = !picked && atLimit;
            return (
              <button
                key={brand.id}
                type="button"
                role="option"
                aria-selected={picked}
                className={[
                  styles.searchRow,
                  disabled ? styles.searchRowDisabled : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={disabled}
                onClick={() => {
                  onPickTracked(brand);
                  closeAfterPick();
                }}
              >
                <span className={styles.searchRowLogo} aria-hidden="true">
                  {brand.logoUrl ? (
                    <img src={brand.logoUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    initial(brand.name)
                  )}
                </span>
                <span className={styles.searchRowName}>{brand.name}</span>
                {picked ? (
                  <span className={styles.searchRowAdded}>Added</span>
                ) : null}
              </button>
            );
          })}
          {untracked.length > 0 ? (
            <div className={styles.searchSection}>
              Not tracked yet, we will add it for you
            </div>
          ) : null}
          {untracked.map((brand) => {
            const picked = selectedKeys.has(brand.domain);
            const disabled = !picked && atLimit;
            return (
              <button
                key={brand.domain}
                type="button"
                role="option"
                aria-selected={picked}
                className={[
                  styles.searchRow,
                  disabled ? styles.searchRowDisabled : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={disabled}
                onClick={() => {
                  onPickUntracked(brand);
                  closeAfterPick();
                }}
              >
                <span className={styles.searchRowLogo} aria-hidden="true">
                  {brand.logoUrl ? (
                    <img src={brand.logoUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    initial(brand.name)
                  )}
                </span>
                <span className={styles.searchRowName}>{brand.name}</span>
                <span className={styles.searchRowMeta}>{brand.domain}</span>
                {picked ? (
                  <span className={styles.searchRowAdded}>Added</span>
                ) : null}
              </button>
            );
          })}
          {!loading && tracked.length === 0 && untracked.length === 0 ? (
            <div className={styles.searchEmpty}>
              No brands match &quot;{trimmedQuery}&quot;.
            </div>
          ) : null}
          {loading && tracked.length === 0 && untracked.length === 0 ? (
            <div className={styles.searchEmpty}>Searching…</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
