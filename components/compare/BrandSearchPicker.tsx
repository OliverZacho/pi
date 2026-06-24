"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { countryFlag, countryName } from "@/lib/country";
import v2 from "./compare-v2.module.css";

/**
 * Lightweight brand record consumed by the search picker.
 */
export type BrandSearchOption = {
  id: string;
  name: string;
  /**
   * All categories tagged on the brand. The picker only renders the
   * first one to keep each row compact, but the parent caches the full
   * list so chip displays elsewhere can show every category.
   */
  markets: string[];
  /** Rolled-up primary market (ISO alpha-2), or null when unknown. */
  primaryMarketCountry: string | null;
  /** True for genuine global brands. */
  isGlobal: boolean;
  logoUrl: string | null;
};

type Props = {
  /** Brand ids already on the canvas — picker marks them "In set". */
  alreadySelectedIds: ReadonlySet<string>;
  /** Upper bound on how many new picks the consumer can absorb. */
  remainingSlots: number;
  /** Current pending pick list, owned by the parent. */
  pendingIds: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /**
   * Inline = popover dropdown anchored under the input.
   * Modal = vertical list inside an enclosing dialog.
   */
  variant?: "inline" | "modal";
  /** Lets the parent cache `{id,name,logoUrl}` for chip rendering. */
  onBrandSeen?: (brand: BrandSearchOption) => void;
  /**
   * ISO alpha-2 market of the brands already being compared. When present the
   * picker defaults to scoping results to that region (keeping peers
   * same-market for fair send-time comparison), with a one-click "All regions"
   * escape hatch.
   */
  defaultCountry?: string | null;
};

/**
 * Server-backed brand picker.
 *
 * The picker is empty until the user types — no on-mount fetch, no
 * always-visible brand directory. Each keystroke is debounced and
 * sent to `/api/brands/list?q=…`, which matches against both brand
 * name and market label so "eyewear" surfaces every brand in that
 * category. Results appear in a floating dropdown below the input;
 * clicking a result toggles it in the parent's pending list and the
 * picker stays open so the user can keep picking before clearing the
 * search.
 *
 * Styles live in `compare-v2.module.css` (new file) instead of the
 * shared `compare.module.css` so Turbopack reliably picks them up;
 * the original file had stale-cache issues mid-session.
 */
export default function BrandSearchPicker({
  alreadySelectedIds,
  remainingSlots,
  pendingIds,
  onChange,
  placeholder = "Search brands by name or category…",
  variant = "inline",
  onBrandSeen,
  defaultCountry = null
}: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BrandSearchOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // null = search every region; otherwise restrict to this ISO alpha-2 code.
  // Seeded from the cohort's region but the user can clear it any time.
  const [countryScope, setCountryScope] = useState<string | null>(defaultCountry);
  const requestSeq = useRef(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Keep the scope in step if the cohort's region changes (e.g. the user adds
  // their first brand), but only while the user hasn't overridden it away from
  // the previous default.
  const prevDefault = useRef(defaultCountry);
  useEffect(() => {
    if (defaultCountry !== prevDefault.current) {
      setCountryScope((current) =>
        current === prevDefault.current ? defaultCountry : current
      );
      prevDefault.current = defaultCountry;
    }
  }, [defaultCountry]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;

  useEffect(() => {
    if (!hasQuery) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    const controller = new AbortController();

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("sort", "name_asc");
        params.set("pageSize", "40");
        params.set("q", trimmedQuery);
        if (countryScope) params.set("country", countryScope);
        const res = await fetch(`/api/brands/list?${params.toString()}`, {
          credentials: "include",
          signal: controller.signal
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const body = (await res.json()) as {
          items: {
            id: string;
            name: string;
            markets?: string[] | null;
            primaryMarketCountry?: string | null;
            isGlobal?: boolean | null;
            logoUrl: string | null;
          }[];
        };
        if (seq !== requestSeq.current) return;
        const items: BrandSearchOption[] = body.items.map((item) => ({
          id: item.id,
          name: item.name,
          markets: Array.isArray(item.markets)
            ? item.markets.filter(
                (value): value is string =>
                  typeof value === "string" && value.length > 0
              )
            : [],
          primaryMarketCountry: item.primaryMarketCountry ?? null,
          isGlobal: item.isGlobal ?? false,
          logoUrl: item.logoUrl
        }));
        setResults(items);
        if (onBrandSeen) {
          for (const brand of items) {
            onBrandSeen(brand);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : "Failed to load brands");
        setResults([]);
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
        }
      }
    }

    run();
    return () => controller.abort();
  }, [trimmedQuery, hasQuery, onBrandSeen, countryScope]);

  useEffect(() => {
    if (!open || variant === "modal") return;
    function onDocClick(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, variant]);

  const pendingSet = useMemo(() => new Set(pendingIds), [pendingIds]);
  const atLimit = remainingSlots - pendingIds.length <= 0;

  const togglePending = useCallback(
    (id: string) => {
      if (alreadySelectedIds.has(id)) return;
      if (pendingSet.has(id)) {
        onChange(pendingIds.filter((x) => x !== id));
        return;
      }
      if (atLimit) return;
      onChange([...pendingIds, id]);
      // Collapse the dropdown once a brand lands in the tray: clearing
      // the query drops `hasQuery`, which closes the result list so the
      // Compare button below it isn't left hidden behind the popover.
      // The picked brand is now a chip in the parent's tray, so nothing
      // is lost — the user just starts a fresh search for the next pick.
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setOpen(false);
    },
    [alreadySelectedIds, atLimit, onChange, pendingIds, pendingSet]
  );

  const showDropdown = (variant === "modal" || open) && hasQuery;

  return (
    <div
      className={variant === "modal" ? v2.searchModal : v2.searchInline}
      ref={wrapperRef}
    >
      <div className={v2.searchInputWrap}>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label="Search brands"
          aria-expanded={showDropdown}
          aria-controls="brand-search-results"
          autoFocus={variant === "modal"}
          style={{
            width: "100%",
            padding: "0.7rem 1.1rem",
            border: 0,
            borderRadius: "999px",
            fontSize: "0.92rem",
            background: "#ffffff",
            color: "inherit",
            outline: "none",
            font: "inherit",
            boxShadow:
              "var(--search-shadow)"
          }}
        />
        {loading ? (
          <span className={v2.searchSpinner} aria-hidden="true" />
        ) : null}
      </div>

      {defaultCountry ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            margin: "0.4rem 0.15rem 0",
            fontSize: "0.82rem",
            color: "#64748b"
          }}
        >
          <span>
            {countryScope
              ? `Showing ${countryFlag(countryScope)} ${countryName(
                  countryScope
                )} brands only`
              : "Showing brands from all regions"}
          </span>
          <button
            type="button"
            onClick={() =>
              setCountryScope((current) => (current ? null : defaultCountry))
            }
            style={{
              border: "none",
              background: "none",
              padding: 0,
              color: "#086e4b",
              cursor: "pointer",
              font: "inherit",
              textDecoration: "underline"
            }}
          >
            {countryScope
              ? "Show all regions"
              : `${countryFlag(defaultCountry)} ${countryName(
                  defaultCountry
                )} only`}
          </button>
        </div>
      ) : null}

      {showDropdown ? (
        <div
          id="brand-search-results"
          className={
            variant === "modal" ? v2.searchResultsModal : v2.searchResultsInline
          }
          role="listbox"
        >
          {error ? (
            <span
              style={{
                color: "#b91c1c",
                fontSize: "0.85rem",
                padding: "0.5rem"
              }}
              role="alert"
            >
              {error}
            </span>
          ) : null}
          {!error && results.length === 0 && !loading ? (
            <span className={v2.searchEmpty}>
              No brands match &quot;{trimmedQuery}&quot;.
            </span>
          ) : null}
          {results.map((brand) => {
            const isAlreadySelected = alreadySelectedIds.has(brand.id);
            const isPending = pendingSet.has(brand.id);
            const disabled = isAlreadySelected || (!isPending && atLimit);
            const className = [
              v2.searchRow,
              isPending ? v2.searchRowSelected : "",
              disabled ? v2.searchRowDisabled : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={brand.id}
                type="button"
                role="option"
                aria-selected={isPending}
                className={className}
                onClick={() => togglePending(brand.id)}
                disabled={disabled && !isPending}
                title={
                  isAlreadySelected
                    ? `${brand.name} is already in this comparison`
                    : undefined
                }
              >
                <span className={v2.searchRowLogo} aria-hidden="true">
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
                <span className={v2.searchRowName}>
                  {brand.name}
                  {brand.primaryMarketCountry ? (
                    <span
                      aria-hidden="true"
                      title={countryName(brand.primaryMarketCountry)}
                      style={{ marginLeft: "0.4rem" }}
                    >
                      {countryFlag(brand.primaryMarketCountry)}
                    </span>
                  ) : null}
                  {brand.isGlobal ? (
                    <span title="Global brand" style={{ marginLeft: "0.25rem" }}>
                      🌍
                    </span>
                  ) : null}
                </span>
                {brand.markets.length > 0 ? (
                  <span className={v2.searchRowMarket}>
                    {formatMarketLabel(brand.markets[0])}
                    {brand.markets.length > 1
                      ? ` +${brand.markets.length - 1}`
                      : ""}
                  </span>
                ) : null}
                {isAlreadySelected ? (
                  <span className={v2.searchAlready}>In comparison</span>
                ) : isPending ? (
                  <span className={v2.searchPicked}>Added</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
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
