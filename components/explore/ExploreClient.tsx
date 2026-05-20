"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExploreEmailCard,
  ExploreFacets,
  ExploreSortKey
} from "@/lib/explore-db";
import { EMAIL_CATEGORY_LABELS } from "@/lib/admin-types";
import { endOfDayInZone, parseDayKey, startOfDayInZone } from "@/lib/datetime";
import EmailCard from "./EmailCard";
import EmailModal from "./EmailModal";
import styles from "./explore.module.css";

const SORT_OPTIONS: { id: ExploreSortKey; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "brand_asc", label: "Brand A–Z" },
  { id: "brand_desc", label: "Brand Z–A" },
  { id: "discount_desc", label: "Highest discount" }
];

const SORT_LABEL: Record<ExploreSortKey, string> = SORT_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.id]: opt.label }),
  {} as Record<ExploreSortKey, string>
);

const SEARCH_DEBOUNCE_MS = 250;

type Props = {
  initialEmails: ExploreEmailCard[];
  initialHasMore: boolean;
  pageSize: number;
  facets: ExploreFacets;
};

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SlidersIcon() {
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
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SortIcon() {
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
      <line x1="6" y1="6" x2="18" y2="6" />
      <line x1="6" y1="12" x2="14" y2="12" />
      <line x1="6" y1="18" x2="10" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 12 10 18 20 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 6 9 12 15 18" />
    </svg>
  );
}

function formatMarketLabel(market: string) {
  const trimmed = market.trim();
  if (!trimmed) return market;
  return trimmed
    .split(/[\s_-]+/)
    .map((word) =>
      word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)
    )
    .join(" ");
}

type PopoverName = "brands" | "categories" | "more" | "sort" | null;

type FetchResponse = {
  items: ExploreEmailCard[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export default function ExploreClient({
  initialEmails,
  initialHasMore,
  pageSize,
  facets
}: Props) {
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedBrandIds, setSelectedBrandIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedMarkets, setSelectedMarkets] = useState<Set<string>>(
    new Set()
  );
  const [brandView, setBrandView] = useState<"brands" | "categories">("brands");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set()
  );
  const [brandQuery, setBrandQuery] = useState("");
  const [hasGif, setHasGif] = useState(false);
  const [hasDarkMode, setHasDarkMode] = useState(false);
  const [receivedAfter, setReceivedAfter] = useState("");
  const [receivedBefore, setReceivedBefore] = useState("");
  const [sort, setSort] = useState<ExploreSortKey>("newest");
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);

  // Server-driven result state. `emails` is the union of every page
  // fetched so far for the current filter combo; resetting it is how we
  // start a fresh search.
  const [emails, setEmails] = useState<ExploreEmailCard[]>(initialEmails);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filterRowRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Skip the initial fetch on mount: the page already SSR'd the first
  // page with the default filter combo, so refetching would just thrash
  // the iframes for nothing.
  const skipNextFetchRef = useRef(true);
  const activeRequestRef = useRef<AbortController | null>(null);

  const handleOpenEmail = useCallback((email: ExploreEmailCard) => {
    setOpenEmail(email);
  }, []);

  const handleCloseEmail = useCallback(() => {
    setOpenEmail(null);
  }, []);

  // Debounce the search input so we don't fire a request on every
  // keystroke. Every other filter updates immediately because they're
  // discrete (toggles / clicks).
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(queryInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

  // Close any open popover when the user clicks outside the filter row
  // or presses Escape — feels like a native menu without pulling in a
  // dependency.
  useEffect(() => {
    if (openPopover === null) return;

    function handlePointerDown(event: MouseEvent) {
      const row = filterRowRef.current;
      if (!row) return;
      if (event.target instanceof Node && !row.contains(event.target)) {
        setOpenPopover(null);
      }
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenPopover(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openPopover]);

  useEffect(() => {
    if (openPopover !== "brands") {
      setBrandView("brands");
    }
  }, [openPopover]);

  // Build the search URL the API route expects. Centralized so the
  // initial fetch and the infinite-scroll fetch use identical encoding.
  const buildSearchUrl = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      for (const id of selectedBrandIds) params.append("brand", id);
      for (const market of selectedMarkets) params.append("market", market);
      for (const category of selectedCategories) {
        params.append("category", category);
      }
      if (hasGif) params.set("hasGif", "1");
      if (hasDarkMode) params.set("hasDarkMode", "1");

      // Translate the day-keyed inputs into the same Copenhagen-zoned
      // ISO instants the original client used so the server sees the
      // same window the user picked in the date inputs.
      if (receivedAfter) {
        const anchor = parseDayKey(receivedAfter);
        if (anchor) {
          params.set("after", startOfDayInZone(anchor).toISOString());
        }
      }
      if (receivedBefore) {
        const anchor = parseDayKey(receivedBefore);
        if (anchor) {
          params.set("before", endOfDayInZone(anchor).toISOString());
        }
      }

      params.set("sort", sort);
      params.set("page", String(nextPage));
      params.set("pageSize", String(pageSize));
      return `/api/explore/emails?${params.toString()}`;
    },
    [
      debouncedQuery,
      selectedBrandIds,
      selectedMarkets,
      selectedCategories,
      hasGif,
      hasDarkMode,
      receivedAfter,
      receivedBefore,
      sort,
      pageSize
    ]
  );

  // Refetch from page 1 whenever any filter / sort / debounced query
  // changes. Initial mount is skipped via `skipNextFetchRef` because the
  // server already rendered page 1 with the default combo.
  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;

    setLoading(true);
    setError(null);

    fetch(buildSearchUrl(1), {
      credentials: "include",
      signal: controller.signal
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        return (await res.json()) as FetchResponse;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setEmails(body.items);
        setPage(body.page);
        setHasMore(body.hasMore);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });

    return () => controller.abort();
  }, [buildSearchUrl]);

  const loadNextPage = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);

    fetch(buildSearchUrl(nextPage), { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        return (await res.json()) as FetchResponse;
      })
      .then((body) => {
        setEmails((current) => {
          // Defensive de-dupe in case the dataset shifts between
          // requests (a fresh email lands while paging).
          const seen = new Set(current.map((email) => email.id));
          const additions = body.items.filter((item) => !seen.has(item.id));
          return [...current, ...additions];
        });
        setPage(body.page);
        setHasMore(body.hasMore);
        setLoadingMore(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoadingMore(false);
      });
  }, [buildSearchUrl, page, hasMore, loading, loadingMore]);

  // Infinite scroll. The sentinel sits ~600px below the grid; as soon
  // as it enters the viewport we kick off the next page request. We
  // attach the observer to the *element* (via ref callback) rather than
  // a stable ref + effect so it re-evaluates whenever the sentinel
  // mounts/unmounts (the empty-state and end-of-list both hide it).
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasMore) return;
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadNextPage();
            break;
          }
        }
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadNextPage, hasMore, emails.length]);

  const brandOptions = useMemo(
    () =>
      facets.brands.map((brand) => ({
        id: brand.id,
        label: brand.name
      })),
    [facets.brands]
  );

  const brandCategoryOptions = useMemo(
    () =>
      facets.markets.map((market) => ({
        id: market,
        label: formatMarketLabel(market)
      })),
    [facets.markets]
  );

  const categoryOptions = useMemo(
    () =>
      facets.categories.map((id) => ({
        id,
        label:
          EMAIL_CATEGORY_LABELS[id as keyof typeof EMAIL_CATEGORY_LABELS] ?? id
      })),
    [facets.categories]
  );

  const filteredBrandOptions = useMemo(() => {
    const q = brandQuery.trim().toLowerCase();
    if (!q) return brandOptions;
    return brandOptions.filter((option) =>
      option.label.toLowerCase().includes(q)
    );
  }, [brandOptions, brandQuery]);

  const moreFiltersCount =
    (hasGif ? 1 : 0) +
    (hasDarkMode ? 1 : 0) +
    (receivedAfter ? 1 : 0) +
    (receivedBefore ? 1 : 0);

  function toggleBrand(id: string) {
    setSelectedBrandIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBrandCategory(id: string) {
    setSelectedMarkets((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCategory(id: string) {
    setSelectedCategories((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearMoreFilters() {
    setHasGif(false);
    setHasDarkMode(false);
    setReceivedAfter("");
    setReceivedBefore("");
  }

  function togglePopover(name: PopoverName) {
    setOpenPopover((current) => (current === name ? null : name));
  }

  const brandFilterCount = selectedBrandIds.size + selectedMarkets.size;
  const hasAnyFilter =
    brandFilterCount > 0 ||
    selectedCategories.size > 0 ||
    moreFiltersCount > 0 ||
    debouncedQuery.length > 0;

  return (
    <>
      <div className={styles.filterRow} ref={filterRowRef}>
        <label className={styles.searchField}>
          <SearchIcon />
          <input
            type="search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search emails"
            className={styles.searchInput}
            aria-label="Search emails"
          />
        </label>

        <div className={styles.filterCluster}>
          <div className={styles.filterChipWrap}>
            <button
              type="button"
              className={`${styles.filterChip}${
                brandFilterCount > 0 ? ` ${styles.filterChipActive}` : ""
              }${openPopover === "brands" ? ` ${styles.filterChipOpen}` : ""}`}
              onClick={() => togglePopover("brands")}
              aria-haspopup="true"
              aria-expanded={openPopover === "brands"}
            >
              <span>Brands</span>
              {brandFilterCount > 0 ? (
                <span className={styles.filterCount}>{brandFilterCount}</span>
              ) : null}
              <ChevronIcon />
            </button>
            {openPopover === "brands" ? (
              <div
                className={`${styles.popover} ${styles.popoverList}`}
                role="menu"
              >
                {brandView === "brands" ? (
                  <>
                    <button
                      type="button"
                      className={styles.popoverHeaderRow}
                      onClick={() => setBrandView("categories")}
                      aria-label="Switch to brand categories"
                    >
                      <span className={styles.popoverHeaderLabel}>
                        Search by brand category
                      </span>
                      {selectedMarkets.size > 0 ? (
                        <span className={styles.popoverHeaderCount}>
                          {selectedMarkets.size}
                        </span>
                      ) : null}
                      <span className={styles.popoverNavChevron}>
                        <ChevronRightIcon />
                      </span>
                    </button>
                    <div className={styles.popoverSearch}>
                      <SearchIcon />
                      <input
                        type="search"
                        value={brandQuery}
                        onChange={(event) => setBrandQuery(event.target.value)}
                        placeholder="Search brands"
                        className={styles.popoverSearchInput}
                        aria-label="Search brands"
                      />
                    </div>
                    <div className={styles.popoverScroll}>
                      {filteredBrandOptions.length === 0 ? (
                        <div className={styles.popoverEmpty}>
                          No brands found
                        </div>
                      ) : (
                        filteredBrandOptions.map((option) => {
                          const checked = selectedBrandIds.has(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={checked}
                              className={styles.checkRow}
                              onClick={() => toggleBrand(option.id)}
                            >
                              <span
                                className={`${styles.checkBox}${
                                  checked ? ` ${styles.checkBoxChecked}` : ""
                                }`}
                              >
                                {checked ? <CheckIcon /> : null}
                              </span>
                              <span className={styles.checkLabel}>
                                {option.label}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {brandFilterCount > 0 ? (
                      <div className={styles.popoverFooter}>
                        <button
                          type="button"
                          className={styles.popoverClear}
                          onClick={() => {
                            setSelectedBrandIds(new Set());
                            setSelectedMarkets(new Set());
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.popoverHeaderRow}
                      onClick={() => setBrandView("brands")}
                      aria-label="Back to brands"
                    >
                      <span className={styles.popoverNavChevron}>
                        <ChevronLeftIcon />
                      </span>
                      <span className={styles.popoverHeaderLabel}>
                        Brand categories
                      </span>
                    </button>
                    <div className={styles.popoverScroll}>
                      {brandCategoryOptions.length === 0 ? (
                        <div className={styles.popoverEmpty}>
                          No brand categories yet
                        </div>
                      ) : (
                        brandCategoryOptions.map((option) => {
                          const checked = selectedMarkets.has(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={checked}
                              className={styles.checkRow}
                              onClick={() => toggleBrandCategory(option.id)}
                            >
                              <span
                                className={`${styles.checkBox}${
                                  checked ? ` ${styles.checkBoxChecked}` : ""
                                }`}
                              >
                                {checked ? <CheckIcon /> : null}
                              </span>
                              <span className={styles.checkLabel}>
                                {option.label}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {selectedMarkets.size > 0 ? (
                      <div className={styles.popoverFooter}>
                        <button
                          type="button"
                          className={styles.popoverClear}
                          onClick={() => setSelectedMarkets(new Set())}
                        >
                          Clear
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>

          <div className={styles.filterChipWrap}>
            <button
              type="button"
              className={`${styles.filterChip}${
                selectedCategories.size > 0 ? ` ${styles.filterChipActive}` : ""
              }${
                openPopover === "categories" ? ` ${styles.filterChipOpen}` : ""
              }`}
              onClick={() => togglePopover("categories")}
              aria-haspopup="true"
              aria-expanded={openPopover === "categories"}
            >
              <span>Categories</span>
              {selectedCategories.size > 0 ? (
                <span className={styles.filterCount}>
                  {selectedCategories.size}
                </span>
              ) : null}
              <ChevronIcon />
            </button>
            {openPopover === "categories" ? (
              <div
                className={`${styles.popover} ${styles.popoverList}`}
                role="menu"
              >
                <div className={styles.popoverScroll}>
                  {categoryOptions.length === 0 ? (
                    <div className={styles.popoverEmpty}>
                      No categories yet
                    </div>
                  ) : (
                    categoryOptions.map((option) => {
                      const checked = selectedCategories.has(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={checked}
                          className={styles.checkRow}
                          onClick={() => toggleCategory(option.id)}
                        >
                          <span
                            className={`${styles.checkBox}${
                              checked ? ` ${styles.checkBoxChecked}` : ""
                            }`}
                          >
                            {checked ? <CheckIcon /> : null}
                          </span>
                          <span className={styles.checkLabel}>
                            {option.label}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                {selectedCategories.size > 0 ? (
                  <div className={styles.popoverFooter}>
                    <button
                      type="button"
                      className={styles.popoverClear}
                      onClick={() => setSelectedCategories(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className={styles.filterChipWrap}>
            <button
              type="button"
              className={`${styles.filterChip}${
                moreFiltersCount > 0 ? ` ${styles.filterChipActive}` : ""
              }${openPopover === "more" ? ` ${styles.filterChipOpen}` : ""}`}
              onClick={() => togglePopover("more")}
              aria-haspopup="dialog"
              aria-expanded={openPopover === "more"}
            >
              <SlidersIcon />
              <span>More filters</span>
              {moreFiltersCount > 0 ? (
                <span className={styles.filterCount}>{moreFiltersCount}</span>
              ) : null}
            </button>
            {openPopover === "more" ? (
              <div
                className={`${styles.popover} ${styles.popoverPanel}`}
                role="dialog"
                aria-label="More filters"
              >
                <div className={styles.panelGroup}>
                  <div className={styles.panelLabel}>Email features</div>
                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      checked={hasGif}
                      onChange={(event) => setHasGif(event.target.checked)}
                    />
                    <span>Has a GIF</span>
                  </label>
                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      checked={hasDarkMode}
                      onChange={(event) => setHasDarkMode(event.target.checked)}
                    />
                    <span>Has dark mode</span>
                  </label>
                </div>

                <div className={styles.panelDivider} />

                <div className={styles.panelGroup}>
                  <div className={styles.panelLabel}>Sending period</div>
                  <div className={styles.dateRow}>
                    <label className={styles.dateField}>
                      <span>From</span>
                      <input
                        type="date"
                        value={receivedAfter}
                        max={receivedBefore || undefined}
                        onChange={(event) =>
                          setReceivedAfter(event.target.value)
                        }
                      />
                    </label>
                    <label className={styles.dateField}>
                      <span>To</span>
                      <input
                        type="date"
                        value={receivedBefore}
                        min={receivedAfter || undefined}
                        onChange={(event) =>
                          setReceivedBefore(event.target.value)
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className={styles.panelFooter}>
                  <button
                    type="button"
                    className={styles.popoverClear}
                    onClick={clearMoreFilters}
                    disabled={moreFiltersCount === 0}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className={styles.panelApply}
                    onClick={() => setOpenPopover(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.sortWrap}>
          <button
            type="button"
            className={`${styles.filterChip} ${styles.sortChip}${
              openPopover === "sort" ? ` ${styles.filterChipOpen}` : ""
            }`}
            onClick={() => togglePopover("sort")}
            aria-haspopup="true"
            aria-expanded={openPopover === "sort"}
          >
            <SortIcon />
            <span>
              Sort: <strong>{SORT_LABEL[sort]}</strong>
            </span>
            <ChevronIcon />
          </button>
          {openPopover === "sort" ? (
            <div
              className={`${styles.popover} ${styles.popoverList} ${styles.popoverRight}`}
              role="menu"
            >
              {SORT_OPTIONS.map((option) => {
                const checked = sort === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    className={styles.checkRow}
                    onClick={() => {
                      setSort(option.id);
                      setOpenPopover(null);
                    }}
                  >
                    <span
                      className={`${styles.radioDot}${
                        checked ? ` ${styles.radioDotChecked}` : ""
                      }`}
                    />
                    <span className={styles.checkLabel}>{option.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className={styles.resultError} role="alert">
          {error}
        </div>
      ) : null}

      {emails.length === 0 && !loading ? (
        <p className={styles.empty}>
          {hasAnyFilter
            ? "No emails match the current filters."
            : "No captured emails yet. Once your subscriptions start receiving newsletters they will appear here."}
        </p>
      ) : (
        <>
          <div className={styles.grid}>
            {emails.map((email) => (
              <EmailCard key={email.id} email={email} onOpen={handleOpenEmail} />
            ))}
          </div>

          {hasMore ? (
            <div
              ref={sentinelRef}
              className={styles.loadMoreSentinel}
              aria-hidden="true"
            />
          ) : null}
        </>
      )}

      {openEmail ? (
        <EmailModal email={openEmail} onClose={handleCloseEmail} />
      ) : null}
    </>
  );
}
