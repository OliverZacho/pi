"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FollowedBrandCard } from "@/lib/follows-db";
import type { ExploreEmailCard, ExploreFacets } from "@/lib/explore-db";
import type { CollectionSummary } from "@/lib/collections-db";
import {
  MAX_BRANDS_PER_COMPARISON,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { countryFlag, countryName } from "@/lib/country";
import BrandBatchBar from "@/components/brand/BrandBatchBar";
import ExploreClient from "@/components/explore/ExploreClient";
import styles from "@/components/brand/brands-explore.module.css";

const SEARCH_DEBOUNCE_MS = 200;

type ViewMode = "brands" | "emails";

type BrandSortKey = "recently_followed" | "name_asc" | "name_desc";

const BRAND_SORT_OPTIONS: { id: BrandSortKey; label: string }[] = [
  { id: "recently_followed", label: "Recently followed" },
  { id: "name_asc", label: "Brand A–Z" },
  { id: "name_desc", label: "Brand Z–A" }
];

const BRAND_SORT_LABEL: Record<BrandSortKey, string> = BRAND_SORT_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.id]: opt.label }),
  {} as Record<BrandSortKey, string>
);

type PopoverName = "markets" | "region" | "sort" | null;

type Props = {
  /** Every brand the user follows, most-recently-followed first. */
  brands: FollowedBrandCard[];
  /** SSR'd first page of the follow-scoped email flow. */
  initialEmails: ExploreEmailCard[];
  initialHasMore: boolean;
  emailPageSize: number;
  emailFacets: ExploreFacets;
  initialSavedIds: string[];
  initialCollections: CollectionSummary[];
  /** The user's saved comparisons, for the selection bar's "Add to…". */
  comparisons: CompetitorSetSummary[];
};

export default function FollowingClient({
  brands,
  initialEmails,
  initialHasMore,
  emailPageSize,
  emailFacets,
  initialSavedIds,
  initialCollections,
  comparisons
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("brands");

  // Multi-select for batch actions (compare / save / add-to / unfollow),
  // shared with the Brands explorer via <BrandBatchBar>. Selection
  // starts from a card's hover checkbox; everything followed here is, by
  // definition, already followed — so the bar offers "Unfollow". With no
  // toolbar toggle on this page, select mode is simply "anything picked"
  // — clearing the last brand returns the cards to plain links.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectMode = selectedIds.length > 0;

  // Brand-view filter state.
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedMarkets, setSelectedMarkets] = useState<Set<string>>(
    new Set()
  );
  const [marketQuery, setMarketQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedGlobal, setSelectedGlobal] = useState(false);
  const [sort, setSort] = useState<BrandSortKey>("recently_followed");

  const filterRowRef = useRef<HTMLDivElement | null>(null);

  // Read the view from the URL once on mount so a shared `?view=emails`
  // link lands on the right tab. The setter below keeps it in sync.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("view") === "emails") setView("emails");
    // Mount-only: we read the URL a single time.
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(queryInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

  // Close any open popover on outside-click / Escape.
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
      if (event.key === "Escape") setOpenPopover(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openPopover]);

  function changeView(next: ViewMode) {
    setView(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "emails") params.set("view", "emails");
    else params.delete("view");
    const qs = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    );
  }

  // Facet lists derived from the followed brands themselves — no extra
  // round trip, and they only ever show options that can actually match.
  const marketOptions = useMemo(() => {
    const set = new Set<string>();
    for (const brand of brands) {
      for (const market of brand.markets) set.add(market);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ id, label: formatMarketLabel(id) }));
  }, [brands]);

  const filteredMarketOptions = useMemo(() => {
    const q = marketQuery.trim().toLowerCase();
    if (!q) return marketOptions;
    return marketOptions.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [marketOptions, marketQuery]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const brand of brands) {
      if (brand.primaryMarketCountry) set.add(brand.primaryMarketCountry);
    }
    return Array.from(set).sort((a, b) =>
      countryName(a).localeCompare(countryName(b))
    );
  }, [brands]);

  const hasGlobalBrands = useMemo(
    () => brands.some((brand) => brand.isGlobal),
    [brands]
  );

  const visibleBrands = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    let list = brands.filter((brand) => {
      if (q) {
        const haystack = `${brand.name} ${brand.domain ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (selectedMarkets.size > 0) {
        if (!brand.markets.some((market) => selectedMarkets.has(market))) {
          return false;
        }
      }
      if (selectedGlobal && !brand.isGlobal) return false;
      if (selectedCountry && brand.primaryMarketCountry !== selectedCountry) {
        return false;
      }
      return true;
    });

    if (sort === "name_asc" || sort === "name_desc") {
      list = [...list].sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, undefined, {
          sensitivity: "base"
        });
        return sort === "name_asc" ? cmp : -cmp;
      });
    }
    // "recently_followed" keeps the server order (followedAt desc).
    return list;
  }, [
    brands,
    debouncedQuery,
    selectedMarkets,
    selectedGlobal,
    selectedCountry,
    sort
  ]);

  const hasAnyFilter =
    debouncedQuery.length > 0 ||
    selectedMarkets.size > 0 ||
    selectedGlobal ||
    selectedCountry !== null;

  function toggleMarket(id: string) {
    setSelectedMarkets((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePopover(name: PopoverName) {
    setOpenPopover((current) => (current === name ? null : name));
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= MAX_BRANDS_PER_COMPARISON) return current;
      return [...current, id];
    });
  }

  // After a batch unfollow, refresh so the unfollowed brands fall out of
  // the (server-rendered) followed list, and drop them from the selection.
  function handleAfterFollowChange(ids: string[], nowFollowing: boolean) {
    if (!nowFollowing) {
      const removed = new Set(ids);
      setSelectedIds((current) => current.filter((id) => !removed.has(id)));
      router.refresh();
    }
  }

  // Escape clears the selection (unless a filter popover owns it first).
  useEffect(() => {
    if (!selectMode) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && openPopover === null) {
        setSelectedIds([]);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectMode, openPopover]);

  return (
    <>
      <div className={styles.viewToggle} role="tablist" aria-label="Following view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "brands"}
          className={`${styles.viewToggleItem}${
            view === "brands" ? ` ${styles.viewToggleItemActive}` : ""
          }`}
          onClick={() => changeView("brands")}
        >
          <BrandsIcon />
          <span>Brands</span>
          <span className={styles.viewToggleCount}>{brands.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "emails"}
          className={`${styles.viewToggleItem}${
            view === "emails" ? ` ${styles.viewToggleItemActive}` : ""
          }`}
          onClick={() => changeView("emails")}
        >
          <MailIcon />
          <span>Emails</span>
        </button>
      </div>

      {brands.length === 0 ? (
        <div className={styles.empty}>
          You&apos;re not following any brands yet. Open{" "}
          <Link href="/brands">Brands</Link> and tap{" "}
          <strong>Follow brand</strong> on the ones you care about.
        </div>
      ) : view === "brands" ? (
        <>
          <div className={styles.filterRow} ref={filterRowRef}>
            <label className={styles.searchField}>
              <SearchIcon />
              <input
                type="search"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="Search followed brands"
                className={styles.searchInput}
                aria-label="Search followed brands"
              />
            </label>

            <div className={styles.filterCluster}>
              {marketOptions.length > 0 ? (
                <div className={styles.filterChipWrap}>
                  <button
                    type="button"
                    className={`${styles.filterChip}${
                      selectedMarkets.size > 0
                        ? ` ${styles.filterChipActive}`
                        : ""
                    }${
                      openPopover === "markets"
                        ? ` ${styles.filterChipOpen}`
                        : ""
                    }`}
                    onClick={() => togglePopover("markets")}
                    aria-haspopup="true"
                    aria-expanded={openPopover === "markets"}
                  >
                    <span>Categories</span>
                    {selectedMarkets.size > 0 ? (
                      <span className={styles.filterCount}>
                        {selectedMarkets.size}
                      </span>
                    ) : null}
                    <ChevronIcon />
                  </button>
                  {openPopover === "markets" ? (
                    <div
                      className={`${styles.popover} ${styles.popoverList}`}
                      role="menu"
                    >
                      <div className={styles.popoverSearch}>
                        <SearchIcon />
                        <input
                          type="search"
                          value={marketQuery}
                          onChange={(event) =>
                            setMarketQuery(event.target.value)
                          }
                          placeholder="Search categories"
                          className={styles.popoverSearchInput}
                          aria-label="Search categories"
                        />
                      </div>
                      <div className={styles.popoverScroll}>
                        {filteredMarketOptions.length === 0 ? (
                          <div className={styles.popoverEmpty}>
                            No categories found
                          </div>
                        ) : (
                          filteredMarketOptions.map((option) => {
                            const checked = selectedMarkets.has(option.id);
                            return (
                              <button
                                key={option.id}
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={checked}
                                className={styles.checkRow}
                                onClick={() => toggleMarket(option.id)}
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
                    </div>
                  ) : null}
                </div>
              ) : null}

              {countryOptions.length > 0 || hasGlobalBrands ? (
                <div className={styles.filterChipWrap}>
                  <button
                    type="button"
                    className={`${styles.filterChip}${
                      selectedCountry || selectedGlobal
                        ? ` ${styles.filterChipActive}`
                        : ""
                    }${
                      openPopover === "region"
                        ? ` ${styles.filterChipOpen}`
                        : ""
                    }`}
                    onClick={() => togglePopover("region")}
                    aria-haspopup="true"
                    aria-expanded={openPopover === "region"}
                  >
                    <span>
                      {selectedGlobal
                        ? "🌍 Global"
                        : selectedCountry
                          ? `${countryFlag(selectedCountry)} ${countryName(
                              selectedCountry
                            )}`
                          : "Region"}
                    </span>
                    <ChevronIcon />
                  </button>
                  {openPopover === "region" ? (
                    <div
                      className={`${styles.popover} ${styles.popoverList}`}
                      role="menu"
                    >
                      <div className={styles.popoverScroll}>
                        {hasGlobalBrands ? (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selectedGlobal}
                            className={styles.checkRow}
                            onClick={() => {
                              setSelectedGlobal((v) => !v);
                              setSelectedCountry(null);
                            }}
                          >
                            <span
                              className={`${styles.checkBox}${
                                selectedGlobal ? ` ${styles.checkBoxChecked}` : ""
                              }`}
                            >
                              {selectedGlobal ? <CheckIcon /> : null}
                            </span>
                            <span className={styles.checkLabel}>
                              🌍 Global brands
                            </span>
                          </button>
                        ) : null}
                        {countryOptions.map((code) => {
                          const checked =
                            !selectedGlobal && selectedCountry === code;
                          return (
                            <button
                              key={code}
                              type="button"
                              role="menuitemradio"
                              aria-checked={checked}
                              className={styles.checkRow}
                              onClick={() => {
                                setSelectedGlobal(false);
                                setSelectedCountry((current) =>
                                  current === code ? null : code
                                );
                              }}
                            >
                              <span
                                className={`${styles.checkBox}${
                                  checked ? ` ${styles.checkBoxChecked}` : ""
                                }`}
                              >
                                {checked ? <CheckIcon /> : null}
                              </span>
                              <span className={styles.checkLabel}>
                                {countryFlag(code)} {countryName(code)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {selectedCountry || selectedGlobal ? (
                        <div className={styles.popoverFooter}>
                          <button
                            type="button"
                            className={styles.popoverClear}
                            onClick={() => {
                              setSelectedCountry(null);
                              setSelectedGlobal(false);
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
                  Sort: <strong>{BRAND_SORT_LABEL[sort]}</strong>
                </span>
                <ChevronIcon />
              </button>
              {openPopover === "sort" ? (
                <div
                  className={`${styles.popover} ${styles.popoverList} ${styles.popoverRight}`}
                  role="menu"
                >
                  {BRAND_SORT_OPTIONS.map((option) => {
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

          {visibleBrands.length === 0 ? (
            <p className={styles.empty}>
              No followed brands match the current filters.
            </p>
          ) : (
            <>
              <div className={styles.resultCount} aria-live="polite">
                <strong>{visibleBrands.length}</strong>{" "}
                {visibleBrands.length === 1 ? "brand" : "brands"}
                {hasAnyFilter ? " match these filters" : ""}
              </div>
              <div className={styles.grid}>
                {visibleBrands.map((brand) => (
                  <FollowingCard
                    key={brand.id}
                    brand={brand}
                    selectMode={selectMode}
                    selected={selectedSet.has(brand.id)}
                    disabled={
                      selectMode &&
                      !selectedSet.has(brand.id) &&
                      selectedIds.length >= MAX_BRANDS_PER_COMPARISON
                    }
                    onToggle={toggleSelect}
                  />
                ))}
              </div>
            </>
          )}

          {selectMode ? (
            <BrandBatchBar
              selectedIds={selectedIds}
              comparisons={comparisons}
              initialFollowedIds={brands.map((b) => b.id)}
              onAfterFollowChange={handleAfterFollowChange}
              onClear={() => setSelectedIds([])}
            />
          ) : null}
        </>
      ) : (
        <ExploreClient
          initialEmails={initialEmails}
          initialHasMore={initialHasMore}
          pageSize={emailPageSize}
          facets={emailFacets}
          initialSavedIds={initialSavedIds}
          initialCollections={initialCollections}
          searchEndpoint="/api/following/emails"
        />
      )}
    </>
  );
}

type FollowingCardProps = {
  brand: FollowedBrandCard;
  selectMode: boolean;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
};

function FollowingCard({
  brand,
  selectMode,
  selected,
  disabled,
  onToggle
}: FollowingCardProps) {
  const cardBody = (
    <>
      {selectMode ? (
        <span
          className={`${styles.cardCheck}${
            selected ? ` ${styles.cardCheck_on}` : ""
          }`}
          aria-hidden="true"
        >
          {selected ? <CheckIcon /> : null}
        </span>
      ) : null}

      <span className={styles.cardAvatar} aria-hidden="true">
        {brand.logoUrl ? (
          <img
            src={brand.logoUrl}
            alt=""
            className={styles.cardAvatarLogo}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className={styles.cardAvatarMonogram}>
            {brand.name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>

      <div className={styles.cardBody}>
        <span className={styles.cardName}>
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
            <span title="Global brand" style={{ marginLeft: "0.3rem" }}>
              🌍
            </span>
          ) : null}
        </span>
        {brand.markets.length > 0 ? (
          <span className={styles.cardMarket}>
            {brand.markets.map(formatMarketLabel).join(" · ")}
          </span>
        ) : null}
      </div>
    </>
  );

  if (selectMode) {
    return (
      <button
        type="button"
        className={`${styles.card} ${styles.cardSelectable} ${styles.cardSelectableButton}${
          selected ? ` ${styles.cardSelected}` : ""
        }`}
        onClick={() => onToggle(brand.id)}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={`${selected ? "Unselect" : "Select"} ${brand.name}`}
      >
        {cardBody}
      </button>
    );
  }

  // Default: a link to the dashboard, with a hover checkbox as the entry
  // point into selection (same pattern as the Brands explorer).
  return (
    <div className={styles.cardWrap}>
      <Link
        href={`/brands/${brand.id}`}
        className={styles.card}
        aria-label={`Open ${brand.name} dashboard`}
      >
        {cardBody}
      </Link>
      <button
        type="button"
        className={styles.cardHoverCheck}
        onClick={() => onToggle(brand.id)}
        aria-label={`Select ${brand.name}`}
        title={`Select ${brand.name}`}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function formatMarketLabel(market: string): string {
  const trimmed = market.trim();
  if (!trimmed) return market;
  return trimmed
    .split(/[\s_-]+/)
    .map((word) =>
      word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)
    )
    .join(" ");
}

/* ----------------------------- Icons ----------------------------- */

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

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function BrandsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7l9-4 9 4-9 4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <polyline points="3 7 12 13 21 7" />
    </svg>
  );
}
