"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExploreEmailCard } from "@/lib/explore-db";
import { EMAIL_CATEGORY_LABELS } from "@/lib/admin-types";
import EmailCard from "./EmailCard";
import EmailModal from "./EmailModal";
import styles from "./explore.module.css";

type SortKey =
  | "newest"
  | "oldest"
  | "brand_asc"
  | "brand_desc"
  | "discount_desc";

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "brand_asc", label: "Brand A–Z" },
  { id: "brand_desc", label: "Brand Z–A" },
  { id: "discount_desc", label: "Highest discount" }
];

const SORT_LABEL: Record<SortKey, string> = SORT_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.id]: opt.label }),
  {} as Record<SortKey, string>
);

type Props = {
  emails: ExploreEmailCard[];
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

export default function ExploreClient({ emails }: Props) {
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);
  const [query, setQuery] = useState("");
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [selectedBrandCategories, setSelectedBrandCategories] = useState<
    Set<string>
  >(new Set());
  const [brandView, setBrandView] = useState<"brands" | "categories">("brands");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set()
  );
  const [brandQuery, setBrandQuery] = useState("");
  const [hasGif, setHasGif] = useState(false);
  const [hasDarkMode, setHasDarkMode] = useState(false);
  const [receivedAfter, setReceivedAfter] = useState("");
  const [receivedBefore, setReceivedBefore] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);

  const filterRowRef = useRef<HTMLDivElement | null>(null);

  const handleOpenEmail = useCallback((email: ExploreEmailCard) => {
    setOpenEmail(email);
  }, []);

  const handleCloseEmail = useCallback(() => {
    setOpenEmail(null);
  }, []);

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

  const brandOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const email of emails) {
      if (email.companyName && !seen.has(email.companyName)) {
        seen.set(email.companyName, email.companyName);
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [emails]);

  // Brand categories come from `companies.market` (a free-text vertical the
  // taxonomy migration added). We dedupe on the raw value so filtering stays
  // exact, but the UI label is title-cased for readability.
  const brandCategoryOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const email of emails) {
      const market = email.companyMarket?.trim();
      if (market) seen.add(market);
    }
    return Array.from(seen)
      .map((id) => ({ id, label: formatMarketLabel(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [emails]);

  const categoryOptions = useMemo(() => {
    const present = new Set<string>();
    for (const email of emails) {
      if (email.category) present.add(email.category);
    }
    return Array.from(present)
      .map((id) => ({
        id,
        label:
          EMAIL_CATEGORY_LABELS[id as keyof typeof EMAIL_CATEGORY_LABELS] ?? id
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [emails]);

  const filteredBrandOptions = useMemo(() => {
    const q = brandQuery.trim().toLowerCase();
    if (!q) return brandOptions;
    return brandOptions.filter((name) => name.toLowerCase().includes(q));
  }, [brandOptions, brandQuery]);

  const moreFiltersCount =
    (hasGif ? 1 : 0) +
    (hasDarkMode ? 1 : 0) +
    (receivedAfter ? 1 : 0) +
    (receivedBefore ? 1 : 0);

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const afterMs = receivedAfter ? new Date(receivedAfter).getTime() : null;
    // Treat the "to" date as inclusive: the end of that day.
    const beforeMs = receivedBefore
      ? new Date(receivedBefore).getTime() + 24 * 60 * 60 * 1000 - 1
      : null;

    const result = emails.filter((email) => {
      if (
        q &&
        !email.subject.toLowerCase().includes(q) &&
        !email.companyName.toLowerCase().includes(q)
      ) {
        return false;
      }
      // The Brands chip combines two selections (specific brands + brand
      // categories). They union: an email passes if its brand is selected
      // OR its market is one of the selected categories.
      const hasBrandFilter =
        selectedBrands.size > 0 || selectedBrandCategories.size > 0;
      if (hasBrandFilter) {
        const brandMatch = selectedBrands.has(email.companyName);
        const market = email.companyMarket?.trim() ?? "";
        const categoryMatch =
          market.length > 0 && selectedBrandCategories.has(market);
        if (!brandMatch && !categoryMatch) return false;
      }
      if (
        selectedCategories.size > 0 &&
        !selectedCategories.has(email.category)
      ) {
        return false;
      }
      if (hasGif && !email.hasGif) return false;
      if (hasDarkMode && !email.hasDarkMode) return false;

      if (afterMs !== null || beforeMs !== null) {
        const receivedMs = new Date(email.receivedAt).getTime();
        if (Number.isNaN(receivedMs)) return false;
        if (afterMs !== null && receivedMs < afterMs) return false;
        if (beforeMs !== null && receivedMs > beforeMs) return false;
      }

      return true;
    });

    result.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return (
            new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
          );
        case "brand_asc":
          return a.companyName.localeCompare(b.companyName);
        case "brand_desc":
          return b.companyName.localeCompare(a.companyName);
        case "discount_desc": {
          const da = a.discountPercent ?? -Infinity;
          const db = b.discountPercent ?? -Infinity;
          return db - da;
        }
        case "newest":
        default:
          return (
            new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
          );
      }
    });

    return result;
  }, [
    emails,
    query,
    selectedBrands,
    selectedBrandCategories,
    selectedCategories,
    hasGif,
    hasDarkMode,
    receivedAfter,
    receivedBefore,
    sort
  ]);

  function toggleBrand(name: string) {
    setSelectedBrands((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleBrandCategory(id: string) {
    setSelectedBrandCategories((current) => {
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

  return (
    <>
      <div className={styles.filterRow} ref={filterRowRef}>
        <label className={styles.searchField}>
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
                selectedBrands.size + selectedBrandCategories.size > 0
                  ? ` ${styles.filterChipActive}`
                  : ""
              }${openPopover === "brands" ? ` ${styles.filterChipOpen}` : ""}`}
              onClick={() => togglePopover("brands")}
              aria-haspopup="true"
              aria-expanded={openPopover === "brands"}
            >
              <span>Brands</span>
              {selectedBrands.size + selectedBrandCategories.size > 0 ? (
                <span className={styles.filterCount}>
                  {selectedBrands.size + selectedBrandCategories.size}
                </span>
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
                      {selectedBrandCategories.size > 0 ? (
                        <span className={styles.popoverHeaderCount}>
                          {selectedBrandCategories.size}
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
                        filteredBrandOptions.map((name) => {
                          const checked = selectedBrands.has(name);
                          return (
                            <button
                              key={name}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={checked}
                              className={styles.checkRow}
                              onClick={() => toggleBrand(name)}
                            >
                              <span
                                className={`${styles.checkBox}${
                                  checked ? ` ${styles.checkBoxChecked}` : ""
                                }`}
                              >
                                {checked ? <CheckIcon /> : null}
                              </span>
                              <span className={styles.checkLabel}>{name}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {selectedBrands.size + selectedBrandCategories.size > 0 ? (
                      <div className={styles.popoverFooter}>
                        <button
                          type="button"
                          className={styles.popoverClear}
                          onClick={() => {
                            setSelectedBrands(new Set());
                            setSelectedBrandCategories(new Set());
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
                          const checked = selectedBrandCategories.has(
                            option.id
                          );
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
                    {selectedBrandCategories.size > 0 ? (
                      <div className={styles.popoverFooter}>
                        <button
                          type="button"
                          className={styles.popoverClear}
                          onClick={() =>
                            setSelectedBrandCategories(new Set())
                          }
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

      {filteredSorted.length === 0 ? (
        <p className={styles.empty}>
          {emails.length === 0
            ? "No captured emails yet. Once your subscriptions start receiving newsletters they will appear here."
            : "No emails match the current filters."}
        </p>
      ) : (
        <div className={styles.grid}>
          {filteredSorted.map((email) => (
            <EmailCard key={email.id} email={email} onOpen={handleOpenEmail} />
          ))}
        </div>
      )}

      {openEmail ? (
        <EmailModal email={openEmail} onClose={handleCloseEmail} />
      ) : null}
    </>
  );
}
