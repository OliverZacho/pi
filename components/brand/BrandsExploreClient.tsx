"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type { EspProvider } from "@/lib/admin-types";
import type {
  BrandsActivityWindow,
  BrandsExploreCard,
  BrandsFacets,
  BrandsSortKey
} from "@/lib/brands-explore-db";
import { MAX_BRANDS_PER_COMPARISON } from "@/lib/competitor-db";
import { countryFlag, countryName } from "@/lib/country";
import {
  endOfDayInZone,
  parseDayKey,
  startOfDayInZone
} from "@/lib/datetime";
import BrandRequestForm from "./BrandRequestForm";
import requestStyles from "./BrandRequest.module.css";
import styles from "./brands-explore.module.css";

const SORT_OPTIONS: { id: BrandsSortKey; label: string }[] = [
  { id: "most_active", label: "Most active" },
  { id: "recently_active", label: "Recently active" },
  { id: "recently_added", label: "Recently added" },
  { id: "name_asc", label: "Brand A–Z" },
  { id: "name_desc", label: "Brand Z–A" }
];

const SORT_LABEL: Record<BrandsSortKey, string> = SORT_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.id]: opt.label }),
  {} as Record<BrandsSortKey, string>
);

const ACTIVITY_OPTIONS: { id: BrandsActivityWindow; label: string }[] = [
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "180d", label: "180 days" },
  { id: "inactive", label: "Inactive" }
];

const SEARCH_DEBOUNCE_MS = 250;
/** Smallest cadence-slider step. 0.1 day ≈ 2.4 hours; finer than that and
 *  the dragging feels jittery without giving the user useful precision. */
const CADENCE_STEP = 0.1;

type Props = {
  initialBrands: BrandsExploreCard[];
  initialHasMore: boolean;
  initialTotal: number;
  pageSize: number;
  facets: BrandsFacets;
  /**
   * Paged search endpoint. Defaults to the authenticated route; the public
   * directory passes `/api/public/brands/list` (no auth, all brands).
   */
  searchEndpoint?: string;
  /**
   * Public directory (logged-out / unpaid): hides the authenticated-only
   * "select to compare" affordance. Browsing + search still work.
   */
  isPublic?: boolean;
};

type PopoverName =
  | "markets"
  | "region"
  | "esp"
  | "cadence"
  | "more"
  | "sort"
  | null;

type FetchResponse = {
  items: BrandsExploreCard[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export default function BrandsExploreClient({
  initialBrands,
  initialHasMore,
  initialTotal,
  pageSize,
  facets,
  searchEndpoint = "/api/brands/list",
  isPublic = false
}: Props) {
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedGlobal, setSelectedGlobal] = useState(false);
  const [selectedMarkets, setSelectedMarkets] = useState<Set<string>>(
    new Set()
  );
  const [marketQuery, setMarketQuery] = useState("");

  const [selectedEsps, setSelectedEsps] = useState<Set<EspProvider>>(
    new Set()
  );
  const [espQuery, setEspQuery] = useState("");

  // Cadence range. `null` on either bound means "no constraint at that
  // end". Persisting the slider position separately from the applied
  // filter keeps the thumbs visually responsive while we debounce the
  // fetch.
  const [cadenceRange, setCadenceRange] = useState<[number, number]>([
    0,
    facets.cadenceMaxDays
  ]);
  const cadenceActive =
    cadenceRange[0] > 0 || cadenceRange[1] < facets.cadenceMaxDays;

  const [activity, setActivity] = useState<BrandsActivityWindow | null>(null);
  const [minEmailsInput, setMinEmailsInput] = useState("");
  const [hasLogo, setHasLogo] = useState(false);
  const [subscribedAfter, setSubscribedAfter] = useState("");
  const [subscribedBefore, setSubscribedBefore] = useState("");
  const [sort, setSort] = useState<BrandsSortKey>("most_active");

  // Flips true once the initial filter state has been read from the URL.
  // Gates the URL-writer effect so it can't clobber the incoming query
  // string before we've hydrated from it.
  const [hydrated, setHydrated] = useState(false);

  const [brands, setBrands] = useState<BrandsExploreCard[]>(initialBrands);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Select mode lets the user pick a handful of brands and jump
  // straight into a side-by-side compare. State is kept local — when
  // the user wants to persist the group they hit "Save as set", which
  // round-trips to the API and navigates to the set's page.
  const router = useRouter();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const filterRowRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Skip the first effect run; the page already SSR'd with the default
  // filter combo so refetching would be wasted work.
  const skipNextFetchRef = useRef(true);
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(queryInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

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

  const parsedMinEmails = useMemo(() => {
    const n = Number.parseInt(minEmailsInput, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }, [minEmailsInput]);

  // Hydrate filters from the URL on first mount so a shared / bookmarked
  // link reproduces the same view. Runs once; the writer effect below
  // keeps the URL in sync from here on. Seeding state here triggers the
  // fetch effect to reload with the URL's filters in place of the SSR'd
  // default first page.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);

    const q = sp.get("q");
    if (q) {
      setQueryInput(q);
      setDebouncedQuery(q.trim());
    }

    const markets = sp.getAll("market").filter(Boolean);
    if (markets.length > 0) setSelectedMarkets(new Set(markets));

    if (sp.get("global") === "1") {
      setSelectedGlobal(true);
    } else {
      const country = sp.get("country");
      if (country && /^[A-Za-z]{2}$/.test(country)) {
        setSelectedCountry(country.toUpperCase());
      }
    }

    const validEsps = new Set(facets.espProviders.map((esp) => esp.id));
    const esps = sp
      .getAll("esp")
      .filter((id): id is EspProvider => validEsps.has(id as EspProvider));
    if (esps.length > 0) setSelectedEsps(new Set(esps));

    const cadenceMin = Number.parseFloat(sp.get("cadenceMin") ?? "");
    const cadenceMax = Number.parseFloat(sp.get("cadenceMax") ?? "");
    if (Number.isFinite(cadenceMin) || Number.isFinite(cadenceMax)) {
      const lo = Number.isFinite(cadenceMin) ? Math.max(0, cadenceMin) : 0;
      const hi = Number.isFinite(cadenceMax)
        ? Math.min(facets.cadenceMaxDays, cadenceMax)
        : facets.cadenceMaxDays;
      setCadenceRange([Math.min(lo, hi), Math.max(lo, hi)]);
    }

    const activityParam = sp.get("activity");
    if (
      activityParam &&
      ACTIVITY_OPTIONS.some((option) => option.id === activityParam)
    ) {
      setActivity(activityParam as BrandsActivityWindow);
    }

    const minEmails = sp.get("minEmails");
    if (minEmails) setMinEmailsInput(minEmails);

    if (sp.get("logo") === "1") setHasLogo(true);

    const from = sp.get("from");
    if (from) setSubscribedAfter(from);
    const to = sp.get("to");
    if (to) setSubscribedBefore(to);

    const sortParam = sp.get("sort");
    if (sortParam && sortParam in SORT_LABEL) {
      setSort(sortParam as BrandsSortKey);
    }

    setHydrated(true);
    // Mount-only: we intentionally read the URL a single time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the active filters into the URL with replaceState (no new
  // history entry) so the view is always shareable. Gated on `hydrated`
  // so the first commit can't overwrite the incoming URL.
  useEffect(() => {
    if (!hydrated) return;

    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    for (const market of selectedMarkets) params.append("market", market);
    if (selectedGlobal) params.set("global", "1");
    else if (selectedCountry) params.set("country", selectedCountry);
    for (const esp of selectedEsps) params.append("esp", esp);
    if (cadenceActive) {
      params.set("cadenceMin", cadenceRange[0].toFixed(1));
      params.set("cadenceMax", cadenceRange[1].toFixed(1));
    }
    if (activity) params.set("activity", activity);
    if (parsedMinEmails !== null) {
      params.set("minEmails", String(parsedMinEmails));
    }
    if (hasLogo) params.set("logo", "1");
    if (subscribedAfter) params.set("from", subscribedAfter);
    if (subscribedBefore) params.set("to", subscribedBefore);
    if (sort !== "most_active") params.set("sort", sort);

    const qs = params.toString();
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(window.history.state, "", url);
  }, [
    hydrated,
    debouncedQuery,
    selectedMarkets,
    selectedCountry,
    selectedGlobal,
    selectedEsps,
    cadenceActive,
    cadenceRange,
    activity,
    parsedMinEmails,
    hasLogo,
    subscribedAfter,
    subscribedBefore,
    sort
  ]);

  const buildSearchUrl = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      for (const market of selectedMarkets) params.append("market", market);
      if (selectedGlobal) params.set("global", "1");
      else if (selectedCountry) params.set("country", selectedCountry);
      for (const esp of selectedEsps) params.append("esp", esp);
      if (cadenceActive) {
        params.set("cadenceMin", cadenceRange[0].toFixed(1));
        params.set("cadenceMax", cadenceRange[1].toFixed(1));
      }
      if (activity) params.set("activity", activity);
      if (parsedMinEmails !== null) {
        params.set("minEmails", String(parsedMinEmails));
      }
      if (hasLogo) params.set("hasLogo", "1");

      if (subscribedAfter) {
        const anchor = parseDayKey(subscribedAfter);
        if (anchor) {
          params.set("after", startOfDayInZone(anchor).toISOString());
        }
      }
      if (subscribedBefore) {
        const anchor = parseDayKey(subscribedBefore);
        if (anchor) {
          params.set("before", endOfDayInZone(anchor).toISOString());
        }
      }

      params.set("sort", sort);
      params.set("page", String(nextPage));
      params.set("pageSize", String(pageSize));
      return `${searchEndpoint}?${params.toString()}`;
    },
    [
      debouncedQuery,
      selectedMarkets,
      selectedCountry,
      selectedGlobal,
      selectedEsps,
      cadenceActive,
      cadenceRange,
      activity,
      parsedMinEmails,
      hasLogo,
      subscribedAfter,
      subscribedBefore,
      sort,
      pageSize,
      searchEndpoint
    ]
  );

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
        setBrands(body.items);
        setTotal(body.total);
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
        setBrands((current) => {
          const seen = new Set(current.map((brand) => brand.id));
          const additions = body.items.filter((item) => !seen.has(item.id));
          return [...current, ...additions];
        });
        setTotal(body.total);
        setPage(body.page);
        setHasMore(body.hasMore);
        setLoadingMore(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoadingMore(false);
      });
  }, [buildSearchUrl, page, hasMore, loading, loadingMore]);

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
  }, [loadNextPage, hasMore, brands.length]);

  const marketOptions = useMemo(
    () =>
      facets.markets.map((market) => ({
        id: market,
        label: formatMarketLabel(market)
      })),
    [facets.markets]
  );

  const filteredMarketOptions = useMemo(() => {
    const q = marketQuery.trim().toLowerCase();
    if (!q) return marketOptions;
    return marketOptions.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [marketOptions, marketQuery]);

  const filteredEspOptions = useMemo(() => {
    const q = espQuery.trim().toLowerCase();
    if (!q) return facets.espProviders;
    return facets.espProviders.filter((opt) =>
      opt.label.toLowerCase().includes(q)
    );
  }, [facets.espProviders, espQuery]);

  const moreFiltersCount =
    (activity ? 1 : 0) +
    (parsedMinEmails !== null ? 1 : 0) +
    (hasLogo ? 1 : 0) +
    (subscribedAfter ? 1 : 0) +
    (subscribedBefore ? 1 : 0);

  function toggleMarket(id: string) {
    setSelectedMarkets((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleEsp(id: EspProvider) {
    setSelectedEsps((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearMoreFilters() {
    setActivity(null);
    setMinEmailsInput("");
    setHasLogo(false);
    setSubscribedAfter("");
    setSubscribedBefore("");
  }

  function togglePopover(name: PopoverName) {
    setOpenPopover((current) => (current === name ? null : name));
  }

  const selectedSet = useMemo(
    () => new Set(selectedBrandIds),
    [selectedBrandIds]
  );

  function toggleBrand(id: string) {
    setSelectedBrandIds((current) => {
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
    setSelectedBrandIds([]);
    setSaveOpen(false);
    setSaveName("");
    setSaveError(null);
  }

  function exitSelectMode() {
    clearSelection();
    setSelectMode(false);
  }

  function handleCompareSelected() {
    if (selectedBrandIds.length === 0) return;
    const qs = new URLSearchParams();
    for (const id of selectedBrandIds) qs.append("brands", id);
    router.push(`/compare?${qs.toString()}`);
  }

  async function handleSaveSelectedAsSet(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    const trimmed = saveName.trim();
    if (!trimmed || savePending) return;
    if (selectedBrandIds.length === 0) {
      setSaveError("Pick at least one brand first");
      return;
    }
    setSavePending(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/competitor-sets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          brandIds: selectedBrandIds
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
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavePending(false);
    }
  }

  const hasAnyFilter =
    selectedMarkets.size > 0 ||
    selectedCountry !== null ||
    selectedGlobal ||
    selectedEsps.size > 0 ||
    cadenceActive ||
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
            placeholder="Search brands"
            className={styles.searchInput}
            aria-label="Search brands"
          />
        </label>

        <div className={styles.filterCluster}>
          <div className={styles.filterChipWrap}>
            <button
              type="button"
              className={`${styles.filterChip}${
                selectedMarkets.size > 0 ? ` ${styles.filterChipActive}` : ""
              }${openPopover === "markets" ? ` ${styles.filterChipOpen}` : ""}`}
              onClick={() => togglePopover("markets")}
              aria-haspopup="true"
              aria-expanded={openPopover === "markets"}
            >
              <span>Brand categories</span>
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
                    onChange={(event) => setMarketQuery(event.target.value)}
                    placeholder="Search categories"
                    className={styles.popoverSearchInput}
                    aria-label="Search brand categories"
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

          {facets.countries.length > 0 ? (
            <div className={styles.filterChipWrap}>
              <button
                type="button"
                className={`${styles.filterChip}${
                  selectedCountry || selectedGlobal ? ` ${styles.filterChipActive}` : ""
                }${openPopover === "region" ? ` ${styles.filterChipOpen}` : ""}`}
                onClick={() => togglePopover("region")}
                aria-haspopup="true"
                aria-expanded={openPopover === "region"}
              >
                <span>
                  {selectedGlobal
                    ? "🌍 Global"
                    : selectedCountry
                      ? `${countryFlag(selectedCountry)} ${countryName(selectedCountry)}`
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
                      <span className={styles.checkLabel}>🌍 Global brands</span>
                    </button>
                    {facets.countries.map((code) => {
                      const checked = !selectedGlobal && selectedCountry === code;
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

          <div className={styles.filterChipWrap}>
            <button
              type="button"
              className={`${styles.filterChip}${
                selectedEsps.size > 0 ? ` ${styles.filterChipActive}` : ""
              }${openPopover === "esp" ? ` ${styles.filterChipOpen}` : ""}`}
              onClick={() => togglePopover("esp")}
              aria-haspopup="true"
              aria-expanded={openPopover === "esp"}
              disabled={facets.espProviders.length === 0}
            >
              <span>ESP</span>
              {selectedEsps.size > 0 ? (
                <span className={styles.filterCount}>{selectedEsps.size}</span>
              ) : null}
              <ChevronIcon />
            </button>
            {openPopover === "esp" ? (
              <div
                className={`${styles.popover} ${styles.popoverList}`}
                role="menu"
              >
                <div className={styles.popoverSearch}>
                  <SearchIcon />
                  <input
                    type="search"
                    value={espQuery}
                    onChange={(event) => setEspQuery(event.target.value)}
                    placeholder="Search providers"
                    className={styles.popoverSearchInput}
                    aria-label="Search ESPs"
                  />
                </div>
                <div className={styles.popoverScroll}>
                  {filteredEspOptions.length === 0 ? (
                    <div className={styles.popoverEmpty}>
                      No providers detected yet
                    </div>
                  ) : (
                    filteredEspOptions.map((option) => {
                      const checked = selectedEsps.has(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={checked}
                          className={styles.checkRow}
                          onClick={() => toggleEsp(option.id)}
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
                {selectedEsps.size > 0 ? (
                  <div className={styles.popoverFooter}>
                    <button
                      type="button"
                      className={styles.popoverClear}
                      onClick={() => setSelectedEsps(new Set())}
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
                cadenceActive ? ` ${styles.filterChipActive}` : ""
              }${openPopover === "cadence" ? ` ${styles.filterChipOpen}` : ""}`}
              onClick={() => togglePopover("cadence")}
              aria-haspopup="dialog"
              aria-expanded={openPopover === "cadence"}
            >
              <ClockIcon />
              <span>
                Cadence
                {cadenceActive ? (
                  <>
                    : {formatDaysShort(cadenceRange[0])}–
                    {formatDaysShort(cadenceRange[1])}
                  </>
                ) : null}
              </span>
            </button>
            {openPopover === "cadence" ? (
              <div
                className={`${styles.popover} ${styles.popoverPanel} ${styles.cadencePanel}`}
                role="dialog"
                aria-label="Send cadence range"
              >
                <div className={styles.panelGroup}>
                  <div className={styles.cadencePanelHead}>
                    <div className={styles.panelLabel}>Send cadence</div>
                    <div className={styles.cadencePanelValue}>
                      {formatDaysLong(cadenceRange[0])} –{" "}
                      {formatDaysLong(cadenceRange[1])}
                    </div>
                  </div>
                  <RangeSlider
                    min={0}
                    max={facets.cadenceMaxDays}
                    step={CADENCE_STEP}
                    value={cadenceRange}
                    onChange={setCadenceRange}
                  />
                  <div className={styles.cadenceAxis}>
                    <span>0 days</span>
                    <span>{facets.cadenceMaxDays} days</span>
                  </div>
                  <p className={styles.cadenceHelp}>
                    Average days between consecutive sends. Brands with fewer
                    than two captured emails are excluded while this filter is
                    active.
                  </p>
                </div>
                <div className={styles.panelFooter}>
                  <button
                    type="button"
                    className={styles.popoverClear}
                    onClick={() =>
                      setCadenceRange([0, facets.cadenceMaxDays])
                    }
                    disabled={!cadenceActive}
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
                aria-label="More brand filters"
              >
                <div className={styles.panelGroup}>
                  <div className={styles.panelLabel}>Last activity</div>
                  <div className={styles.segmented}>
                    {ACTIVITY_OPTIONS.map((option) => {
                      const selected = activity === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`${styles.segmentedItem}${
                            selected ? ` ${styles.segmentedItemActive}` : ""
                          }`}
                          onClick={() =>
                            setActivity(selected ? null : option.id)
                          }
                          aria-pressed={selected}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.panelDivider} />

                <div className={styles.panelGroup}>
                  <div className={styles.panelLabel}>Minimum emails</div>
                  <div className={styles.numberRow}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className={styles.numberInput}
                      value={minEmailsInput}
                      onChange={(event) =>
                        setMinEmailsInput(event.target.value)
                      }
                      placeholder="0"
                    />
                    <span className={styles.numberHint}>
                      emails captured or more
                    </span>
                  </div>
                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      checked={hasLogo}
                      onChange={(event) => setHasLogo(event.target.checked)}
                    />
                    <span>Has logo</span>
                  </label>
                </div>

                <div className={styles.panelDivider} />

                <div className={styles.panelGroup}>
                  <div className={styles.panelLabel}>Tracking period</div>
                  <div className={styles.dateRow}>
                    <label className={styles.dateField}>
                      <span>From</span>
                      <input
                        type="date"
                        value={subscribedAfter}
                        max={subscribedBefore || undefined}
                        onChange={(event) =>
                          setSubscribedAfter(event.target.value)
                        }
                      />
                    </label>
                    <label className={styles.dateField}>
                      <span>To</span>
                      <input
                        type="date"
                        value={subscribedBefore}
                        min={subscribedAfter || undefined}
                        onChange={(event) =>
                          setSubscribedBefore(event.target.value)
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

        {isPublic ? null : (
          <button
            type="button"
            className={`${styles.selectToggle}${
              selectMode ? ` ${styles.selectToggle_active}` : ""
            }`}
            onClick={() =>
              selectMode ? exitSelectMode() : setSelectMode(true)
            }
            aria-pressed={selectMode}
            title="Toggle compare-select mode"
          >
            <span>
              {selectMode
                ? selectedBrandIds.length > 0
                  ? `${selectedBrandIds.length} selected`
                  : "Select…"
                : "Select to compare"}
            </span>
          </button>
        )}

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

      {brands.length === 0 && !loading ? (
        hasAnyFilter ? (
          <div className={requestStyles.inline}>
            <h2 className={requestStyles.inlineHeading}>No brands match yet</h2>
            <p className={requestStyles.inlineLead}>
              We couldn&apos;t find a brand for that search. Request it below and
              we&apos;ll add it — brands are usually added within 24 hours, so
              check back soon.
            </p>
            <BrandRequestForm defaultCompanyName={queryInput.trim()} />
          </div>
        ) : (
          <p className={styles.empty}>No brands have been added yet.</p>
        )
      ) : (
        <>
          <div className={styles.resultCount} aria-live="polite">
            {loading ? (
              <span className={styles.resultCountMuted}>Loading…</span>
            ) : (
              <>
                <strong>{formatNumber(total)}</strong>{" "}
                {total === 1 ? "brand" : "brands"}
                {hasAnyFilter ? " match these filters" : ""}
              </>
            )}
          </div>

          <div className={styles.grid}>
            {brands.map((brand) => (
              <BrandGridCard
                key={brand.id}
                brand={brand}
                selectMode={selectMode}
                selected={selectedSet.has(brand.id)}
                disabled={
                  selectMode &&
                  !selectedSet.has(brand.id) &&
                  selectedBrandIds.length >= MAX_BRANDS_PER_COMPARISON
                }
                onToggle={toggleBrand}
              />
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

      {selectMode && selectedBrandIds.length > 0 ? (
        <div className={styles.compareBar} role="region" aria-label="Compare selected brands">
          <span className={styles.compareBarCount}>
            {selectedBrandIds.length} brand
            {selectedBrandIds.length === 1 ? "" : "s"} selected
          </span>
          {saveOpen ? (
            <form
              onSubmit={handleSaveSelectedAsSet}
              className={styles.compareSaveForm}
            >
              <input
                type="text"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                maxLength={120}
                placeholder="Name this set…"
                className={styles.compareSaveInput}
                disabled={savePending}
                autoFocus
                aria-label="Name for new competitor set"
              />
              <button
                type="submit"
                className={styles.compareBarPrimary}
                disabled={
                  savePending ||
                  saveName.trim().length === 0 ||
                  selectedBrandIds.length === 0
                }
              >
                {savePending ? "Saving…" : "Save & open"}
              </button>
              <button
                type="button"
                className={styles.compareBarSecondary}
                onClick={() => {
                  setSaveOpen(false);
                  setSaveError(null);
                }}
                disabled={savePending}
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <span className={styles.compareBarSpacer} />
              <button
                type="button"
                className={styles.compareBarPrimary}
                onClick={handleCompareSelected}
              >
                Compare ({selectedBrandIds.length})
              </button>
              <button
                type="button"
                className={styles.compareBarSecondary}
                onClick={() => setSaveOpen(true)}
              >
                Save as set…
              </button>
              <button
                type="button"
                className={styles.compareBarSecondary}
                onClick={clearSelection}
              >
                Clear
              </button>
            </>
          )}
          {saveError ? (
            <span className={styles.compareBarError} role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/* -----------------------------------------------------------------
   Brand card
   ----------------------------------------------------------------- */

type BrandGridCardProps = {
  brand: BrandsExploreCard;
  selectMode?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onToggle?: (id: string) => void;
};

function BrandGridCard({
  brand,
  selectMode = false,
  selected = false,
  disabled = false,
  onToggle
}: BrandGridCardProps) {
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

      {brand.primaryEsp || brand.avgDaysBetween !== null ? (
        <div className={styles.cardTagRow}>
          {brand.primaryEsp ? (
            <span className={styles.cardTag} title="Primary ESP">
              <StackIcon />
              {brand.primaryEsp.label}
            </span>
          ) : null}
          {brand.avgDaysBetween !== null ? (
            <span className={styles.cardTag} title="Average days between sends">
              <ClockIcon />
              {formatDaysShort(brand.avgDaysBetween)}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (selectMode) {
    const className = `${styles.card} ${styles.cardSelectable} ${styles.cardSelectableButton}${
      selected ? ` ${styles.cardSelected}` : ""
    }`;
    return (
      <button
        type="button"
        className={className}
        onClick={() => onToggle?.(brand.id)}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={`${selected ? "Unselect" : "Select"} ${brand.name}`}
      >
        {cardBody}
      </button>
    );
  }

  return (
    <Link
      href={`/brands/${brand.id}`}
      className={styles.card}
      aria-label={`Open ${brand.name} dashboard`}
    >
      {cardBody}
    </Link>
  );
}

/* -----------------------------------------------------------------
   Cadence range slider (two-thumb)
   ----------------------------------------------------------------- */

type RangeSliderProps = {
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
};

/**
 * Lightweight dual-thumb range built from two stacked
 * `<input type="range">`. The trick is to overlay both inputs and use
 * `pointer-events: none` on their backgrounds so only the thumbs are
 * grabbable; the visible track and the highlighted "selected" band are
 * pure CSS positioned by percentage.
 *
 * Clamping each thumb against the other on change avoids them ever
 * crossing — the lower thumb can't drag past the upper and vice
 * versa.
 */
function RangeSlider({ min, max, step, value, onChange }: RangeSliderProps) {
  const [low, high] = value;
  const span = max - min;
  const pctLow = span > 0 ? ((low - min) / span) * 100 : 0;
  const pctHigh = span > 0 ? ((high - min) / span) * 100 : 100;

  // When both thumbs sit at the right edge the lower thumb would
  // otherwise be unreachable (the higher input's invisible thumb sits
  // on top). Bump the lower input's z-index in that case so the user
  // can drag it back to the left.
  const lowOnTop = pctLow >= 95;

  const fillStyle: CSSProperties = {
    left: `${pctLow}%`,
    right: `${100 - pctHigh}%`
  };

  return (
    <div className={styles.rangeSlider}>
      <div className={styles.rangeTrack} />
      <div className={styles.rangeFill} style={fillStyle} />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={low}
        onChange={(event) => {
          const next = Math.min(Number(event.target.value), high);
          onChange([next, high]);
        }}
        className={`${styles.rangeInput}${
          lowOnTop ? ` ${styles.rangeInputOnTop}` : ""
        }`}
        aria-label="Minimum days between sends"
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={high}
        onChange={(event) => {
          const next = Math.max(Number(event.target.value), low);
          onChange([low, next]);
        }}
        className={styles.rangeInput}
        aria-label="Maximum days between sends"
      />
    </div>
  );
}

/* -----------------------------------------------------------------
   Helpers
   ----------------------------------------------------------------- */

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

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Compact form used inside chips and on the card. */
function formatDaysShort(days: number): string {
  if (days < 1) {
    return `${(days * 24).toFixed(1)}h`;
  }
  if (days < 10) {
    return `${days.toFixed(1)}d`;
  }
  return `${Math.round(days)}d`;
}

/** Long form used inside the cadence panel header. */
function formatDaysLong(days: number): string {
  if (days < 1) {
    return `${(days * 24).toFixed(1)} hours`;
  }
  if (days < 10) {
    return `${days.toFixed(1)} days`;
  }
  return `${Math.round(days)} days`;
}

/* -----------------------------------------------------------------
   Icons (inline SVG, sized to match the rest of the explore UI)
   ----------------------------------------------------------------- */

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

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}

function StackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
