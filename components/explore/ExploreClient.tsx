"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  ExploreEmailCard,
  ExploreFacets,
  ExploreSortKey
} from "@/lib/explore-db";
import type { CollectionSummary } from "@/lib/collections-db";
import { EMAIL_CATEGORY_LABELS } from "@/lib/admin-types";
import { endOfDayInZone, parseDayKey, startOfDayInZone } from "@/lib/datetime";
import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
import EmailCard from "./EmailCard";
import EmailModal from "./EmailModal";
import BrandRequestModal from "@/components/brand/BrandRequestModal";
import requestStyles from "@/components/brand/BrandRequest.module.css";
import styles from "./explore.module.css";
import publicStyles from "./public-explore.module.css";

const SORT_OPTIONS: { id: ExploreSortKey; label: string }[] = [
  // "Recommended" is a curated-brand filter disguised as a sort: it shows
  // only emails from the admin-picked allowlist, newest first. Listed
  // first because it's the default landing order on Explore.
  { id: "recommended", label: "Recommended" },
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

// Stable empty Set so a card / modal that hasn't loaded membership yet
// still gets the same reference each render — keeps memoized children
// from invalidating just because the parent re-rendered. Never mutated.
const EMPTY_ID_SET = new Set<string>();

type Props = {
  initialEmails: ExploreEmailCard[];
  initialHasMore: boolean;
  pageSize: number;
  facets: ExploreFacets;
  /**
   * Set of email IDs the current user has already saved, looked up
   * server-side so the first paint shows the correct Save / Saved
   * state without an extra round trip.
   */
  initialSavedIds: string[];
  /**
   * User's collections (lightweight `{ id, name, shareSlug }` rows).
   * Powers the "Add to collection" popover on every card / modal.
   */
  initialCollections: CollectionSummary[];
  /**
   * Paged-search endpoint the grid fetches from. Defaults to the global
   * Explore feed; `/following` passes its follow-scoped route so the same
   * component renders an email flow confined to the brands the user
   * follows. Must accept the same query params and return the same
   * `FetchResponse` shape.
   */
  searchEndpoint?: string;
  /**
   * Sort selected on first paint and treated as the "clean URL" default
   * (omitted from the query string). Explore passes `"recommended"` so
   * landing users see the curated feed; `/following` leaves it at
   * `"newest"` since the curated allowlist isn't its organising idea.
   */
  defaultSort?: ExploreSortKey;
  /**
   * "public" renders the logged-out / unpaid teaser: same search / filter /
   * sort UI, but the grid is capped (no infinite scroll), Save and
   * Add-to-collection are hidden, the detail view opens the read-only
   * `PublicEmailModal`, card previews render via {@link renderUrlBase}, and a
   * gradient fade + "unlock to see more" box covers the lower grid.
   */
  mode?: "authenticated" | "public";
  /** Render-endpoint base passed to each card (see EmailCard). */
  renderUrlBase?: string;
  /**
   * Enable the Save button in `public` mode for signed-in but unpaid
   * users — the free conversion hook. Logged-out visitors leave this
   * false and keep read-only cards. Ignored outside `public` mode.
   */
  allowSave?: boolean;
  /** Free-tier save cap, surfaced in the quota nudge. */
  saveLimit?: number;
  /** The user's current total saved count (cap basis) on first paint. */
  initialSavedCount?: number;
  /**
   * Admin viewer: enables the per-card "Recommended" star so admins can
   * curate the Explore allowlist (`companies.is_curated`) while browsing
   * the grid. Off for everyone else.
   */
  isAdmin?: boolean;
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

type PopoverName =
  | "brands"
  | "brandCategories"
  | "categories"
  | "more"
  | "sort"
  | null;

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
  facets,
  initialSavedIds,
  initialCollections,
  searchEndpoint = "/api/explore/emails",
  defaultSort = "newest",
  mode = "authenticated",
  renderUrlBase = "/api/admin/emails",
  allowSave = false,
  saveLimit = 0,
  initialSavedCount = 0,
  isAdmin = false
}: Props) {
  const isPublic = mode === "public";
  // The admin render/detail routes are admin-gated, so a paid NON-admin
  // (e.g. a team member) would get 403 previews. Route them to the
  // entitlement-safe public endpoints; admins keep the admin routes for
  // full-fidelity inspection.
  const authedRenderBase = isAdmin ? renderUrlBase : "/api/explore/emails";
  const authedDetailBase = isAdmin ? "/api/admin/emails" : "/api/public/emails";
  // Free (public + allowSave) users can save curated cards up to a cap;
  // track the running total to drive the quota nudge.
  const [savedCount, setSavedCount] = useState(initialSavedCount);
  const [saveLimitHit, setSaveLimitHit] = useState(false);
  // Logged-out visitors get a Save button too, but clicking it can't
  // persist anything — instead we pop a modal asking them to create a
  // free account. `signupModalNext` is where /login sends them back to.
  const [signupModalOpen, setSignupModalOpen] = useState(false);
  const [signupModalNext, setSignupModalNext] = useState("/explore");
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedBrandIds, setSelectedBrandIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedMarkets, setSelectedMarkets] = useState<Set<string>>(
    new Set()
  );
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set()
  );
  const [brandQuery, setBrandQuery] = useState("");
  const [brandRequestOpen, setBrandRequestOpen] = useState(false);
  const [marketQuery, setMarketQuery] = useState("");
  const [hasGif, setHasGif] = useState(false);
  const [hasDarkMode, setHasDarkMode] = useState(false);
  const [receivedAfter, setReceivedAfter] = useState("");
  const [receivedBefore, setReceivedBefore] = useState("");
  const [sort, setSort] = useState<ExploreSortKey>(defaultSort);
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);

  // Flips true once the initial filter/open-email state has been read
  // from the URL. Gates the URL-writer effect so it never clobbers the
  // incoming query string before we've had a chance to hydrate from it.
  const [hydrated, setHydrated] = useState(false);

  // Server-driven result state. `emails` is the union of every page
  // fetched so far for the current filter combo; resetting it is how we
  // start a fresh search.
  const [emails, setEmails] = useState<ExploreEmailCard[]>(initialEmails);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bookmarks live in a single Set lifted to the page so every card
  // stays in sync (e.g. when an email is hidden by a filter and re-
  // appears later, its Saved state is still correct).
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(initialSavedIds)
  );

  // Admin-only: company ids currently on the "Recommended" allowlist
  // (`companies.is_curated`), seeded from the facets so the stars paint
  // correctly on first render. Lifted to the page so every card from the
  // same brand flips together when an admin toggles the star. Only
  // populated/used when `isAdmin` is set.
  const [recommendedCompanyIds, setRecommendedCompanyIds] = useState<
    Set<string>
  >(() =>
    isAdmin
      ? new Set(
          facets.brands.filter((b) => b.isCurated).map((b) => b.id)
        )
      : new Set()
  );

  // Collections + per-email membership are also lifted here so the
  // popover on a card stays in sync with the same popover on the
  // modal that opens above it.
  const [collections, setCollections] =
    useState<CollectionSummary[]>(initialCollections);
  const [membershipByEmail, setMembershipByEmail] = useState<
    Map<string, Set<string>>
  >(() => new Map());
  // Track which emails have already had their membership lookup
  // resolved so we don't re-fetch on every popover open.
  const membershipLoadedRef = useRef<Set<string>>(new Set());
  const membershipPendingRef = useRef<Map<string, Promise<void>>>(new Map());

  const filterRowRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Skip the initial fetch on mount: the page already SSR'd the first
  // page with the default filter combo, so refetching would just thrash
  // the iframes for nothing.
  const skipNextFetchRef = useRef(true);
  const activeRequestRef = useRef<AbortController | null>(null);

  // True while the open modal owns a dedicated history entry we pushed
  // on open. Lets the close handler decide between popping that entry
  // (Back) and stripping the param in place (deep-linked open).
  const modalPushedRef = useRef(false);
  // Latest emails list, read inside event handlers (popstate) without
  // making them depend on — and churn with — the array reference.
  const emailsRef = useRef(emails);
  emailsRef.current = emails;

  // Resolve a card by id from the loaded set (or fetch it on its own
  // when it isn't on the current page) and open it in the modal.
  const openEmailById = useCallback((id: string) => {
    const existing = emailsRef.current.find((email) => email.id === id);
    if (existing) {
      setOpenEmail(existing);
      return;
    }
    fetch(`${searchEndpoint}?id=${encodeURIComponent(id)}&pageSize=1`, {
      credentials: "include"
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: FetchResponse | null) => {
        const card = body?.items?.[0];
        if (card) setOpenEmail(card);
      })
      .catch(() => {
        /* a missing email just leaves the modal closed */
      });
  }, [searchEndpoint]);

  const handleOpenEmail = useCallback((email: ExploreEmailCard) => {
    setOpenEmail(email);
    // Push a dedicated history entry so the browser Back button closes
    // the modal instead of navigating away from Explore.
    const params = new URLSearchParams(window.location.search);
    params.set("email", email.id);
    modalPushedRef.current = true;
    window.history.pushState(
      window.history.state,
      "",
      `${window.location.pathname}?${params.toString()}`
    );
  }, []);

  const handleCloseEmail = useCallback(() => {
    if (modalPushedRef.current) {
      // Pop the entry we pushed on open; the popstate handler clears
      // openEmail and the browser restores the filters-only URL.
      modalPushedRef.current = false;
      window.history.back();
      return;
    }
    // Opened from a deep link (no pushed entry), so just strip the email
    // param in place rather than navigating away from the page.
    const params = new URLSearchParams(window.location.search);
    params.delete("email");
    const qs = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    );
    setOpenEmail(null);
  }, []);

  // Optimistically flip the saved state, then fire the API call. On
  // failure we roll back so the UI never lies about what's persisted.
  const handleToggleSave = useCallback(
    async (email: ExploreEmailCard, next: boolean) => {
      // Optimistically flip the saved state (and, for free users, the
      // running count) before firing the API call; roll both back on
      // failure so the UI never lies about what's persisted.
      setSavedIds((current) => {
        const updated = new Set(current);
        if (next) updated.add(email.id);
        else updated.delete(email.id);
        return updated;
      });
      if (allowSave) {
        setSavedCount((c) => (next ? c + 1 : Math.max(0, c - 1)));
      }

      const rollback = () => {
        setSavedIds((current) => {
          const updated = new Set(current);
          if (next) updated.delete(email.id);
          else updated.add(email.id);
          return updated;
        });
        if (allowSave) {
          setSavedCount((c) => (next ? Math.max(0, c - 1) : c + 1));
        }
      };

      try {
        const res = await fetch(`/api/explore/saved/${email.id}`, {
          method: next ? "PUT" : "DELETE",
          credentials: "include"
        });
        if (!res.ok) {
          let code: string | undefined;
          try {
            code = ((await res.json()) as { code?: string }).code;
          } catch {
            /* non-JSON error body */
          }
          rollback();
          // Hitting the free cap is an expected outcome, not an error —
          // surface the upgrade nudge instead of a red error banner.
          if (res.status === 409 && code === "SAVE_LIMIT_REACHED") {
            setSaveLimitHit(true);
          } else {
            setError(`Failed (${res.status})`);
          }
          return;
        }
      } catch {
        rollback();
        setError("Failed to save");
      }
    },
    [allowSave]
  );

  // Logged-out visitors can't persist a save, so the Save button instead
  // pops a sign-up nudge. We capture the current path so /login can send
  // them straight back here once they have an account.
  const handleLoggedOutSave = useCallback(() => {
    if (typeof window !== "undefined") {
      const path = window.location.pathname + window.location.search;
      setSignupModalNext(path.startsWith("/") ? path : "/explore");
    }
    setSignupModalOpen(true);
  }, []);

  // Admin-only: flip a brand's recommended status optimistically, then
  // PATCH the curated flag. The whole grid re-reads `recommendedCompanyIds`
  // so every card from the same brand updates together. Roll back on
  // failure so the star never lies about what's persisted.
  const handleToggleRecommended = useCallback(
    async (companyId: string, next: boolean) => {
      setRecommendedCompanyIds((current) => {
        const updated = new Set(current);
        if (next) updated.add(companyId);
        else updated.delete(companyId);
        return updated;
      });

      try {
        const res = await fetch(`/api/admin/companies/${companyId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isCurated: next })
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
      } catch (err) {
        setRecommendedCompanyIds((current) => {
          const updated = new Set(current);
          if (next) updated.delete(companyId);
          else updated.add(companyId);
          return updated;
        });
        setError(
          err instanceof Error ? err.message : "Failed to update Recommended"
        );
      }
    },
    []
  );

  const requestMemberships = useCallback(async (emailId: string) => {
    if (membershipLoadedRef.current.has(emailId)) return;
    // Coalesce: if a fetch is already in flight for this email (e.g.
    // the user opened the popover on the card and then on the modal
    // in quick succession) reuse the same promise.
    const inflight = membershipPendingRef.current.get(emailId);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const res = await fetch(
          `/api/collections/memberships?emailId=${emailId}`,
          { credentials: "include" }
        );
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const body = (await res.json()) as { collectionIds: string[] };
        setMembershipByEmail((current) => {
          const next = new Map(current);
          next.set(emailId, new Set(body.collectionIds));
          return next;
        });
        membershipLoadedRef.current.add(emailId);
      } catch (err) {
        console.error("Failed to load collection memberships", err);
      } finally {
        membershipPendingRef.current.delete(emailId);
      }
    })();

    membershipPendingRef.current.set(emailId, promise);
    return promise;
  }, []);

  const updateMembership = useCallback(
    (emailId: string, collectionId: string, present: boolean) => {
      setMembershipByEmail((current) => {
        const next = new Map(current);
        const existing = new Set(next.get(emailId) ?? []);
        if (present) existing.add(collectionId);
        else existing.delete(collectionId);
        next.set(emailId, existing);
        return next;
      });
    },
    []
  );

  const handleToggleCollection = useCallback(
    async (collectionId: string, emailId: string, next: boolean) => {
      updateMembership(emailId, collectionId, next);
      try {
        const res = await fetch(
          `/api/collections/${collectionId}/emails/${emailId}`,
          { method: next ? "PUT" : "DELETE", credentials: "include" }
        );
        if (!res.ok) throw new Error(`Failed (${res.status})`);
      } catch (err) {
        updateMembership(emailId, collectionId, !next);
        const message =
          err instanceof Error ? err.message : "Failed to update collection";
        setError(message);
      }
    },
    [updateMembership]
  );

  const handleCreateCollection = useCallback(
    async (name: string, emailId: string): Promise<CollectionSummary | null> => {
      try {
        const createRes = await fetch("/api/collections", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        });
        if (!createRes.ok) throw new Error(`Failed (${createRes.status})`);
        const created = (await createRes.json()) as {
          collection: CollectionSummary;
        };
        setCollections((current) => [created.collection, ...current]);
        updateMembership(emailId, created.collection.id, true);

        const addRes = await fetch(
          `/api/collections/${created.collection.id}/emails/${emailId}`,
          { method: "PUT", credentials: "include" }
        );
        if (!addRes.ok) {
          throw new Error(`Failed (${addRes.status})`);
        }
        return created.collection;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create collection";
        setError(message);
        return null;
      }
    },
    [updateMembership]
  );

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

  // Hydrate filters + the open-email modal from the URL on first mount so
  // a shared / bookmarked link reproduces the same view. Runs once; the
  // writer effect below keeps the URL in sync from here on. Seeding state
  // here (rather than in the SSR'd defaults) triggers the fetch effect to
  // reload with the URL's filters, replacing the default first page.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);

    const q = sp.get("q");
    if (q) {
      setQueryInput(q);
      setDebouncedQuery(q.trim());
    }

    const brands = sp.getAll("brand").filter(Boolean);
    if (brands.length > 0) setSelectedBrandIds(new Set(brands));

    const markets = sp.getAll("market").filter(Boolean);
    if (markets.length > 0) setSelectedMarkets(new Set(markets));

    const categories = sp.getAll("category").filter(Boolean);
    if (categories.length > 0) setSelectedCategories(new Set(categories));

    if (sp.get("gif") === "1") setHasGif(true);
    if (sp.get("dark") === "1") setHasDarkMode(true);

    const from = sp.get("from");
    if (from) setReceivedAfter(from);
    const to = sp.get("to");
    if (to) setReceivedBefore(to);

    const sortParam = sp.get("sort");
    if (sortParam && sortParam in SORT_LABEL) {
      setSort(sortParam as ExploreSortKey);
    }

    // A deep-linked email shares the landing history entry (no extra
    // entry to pop), so leave `modalPushedRef` false — closing it strips
    // the param in place instead of navigating away.
    const emailId = sp.get("email");
    if (emailId) openEmailById(emailId);

    setHydrated(true);
    // Mount-only: we intentionally read the URL a single time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Recommended" is a curated *subset* of brands. The moment the user
  // engages any filter or search we widen back to the full feed by
  // switching to Newest, so they see every matching email instead of only
  // the curated brands. One-way by design: once we've moved off
  // Recommended we leave the choice alone, so re-clearing filters doesn't
  // snap the user back into the curated view. Also catches deep links that
  // arrive with filters already in the URL.
  useEffect(() => {
    if (sort !== "recommended") return;
    const filtersActive =
      selectedBrandIds.size > 0 ||
      selectedMarkets.size > 0 ||
      selectedCategories.size > 0 ||
      hasGif ||
      hasDarkMode ||
      receivedAfter !== "" ||
      receivedBefore !== "" ||
      debouncedQuery.length > 0;
    if (filtersActive) setSort("newest");
  }, [
    sort,
    selectedBrandIds,
    selectedMarkets,
    selectedCategories,
    hasGif,
    hasDarkMode,
    receivedAfter,
    receivedBefore,
    debouncedQuery
  ]);

  // Mirror the active filters + open email into the URL with replaceState
  // (no new history entry) so the view is always shareable. Gated on
  // `hydrated` so the first commit can't overwrite the incoming URL.
  useEffect(() => {
    if (!hydrated) return;

    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    for (const id of selectedBrandIds) params.append("brand", id);
    for (const market of selectedMarkets) params.append("market", market);
    for (const category of selectedCategories) {
      params.append("category", category);
    }
    if (hasGif) params.set("gif", "1");
    if (hasDarkMode) params.set("dark", "1");
    if (receivedAfter) params.set("from", receivedAfter);
    if (receivedBefore) params.set("to", receivedBefore);
    if (sort !== defaultSort) params.set("sort", sort);
    // The open-email param is owned by the modal's push/popstate logic,
    // not this filter writer — preserve whatever is currently in the URL
    // so a filter tweak while the modal is open doesn't drop it.
    const currentSearch = new URLSearchParams(window.location.search);
    const currentEmail = currentSearch.get("email");
    if (currentEmail) params.set("email", currentEmail);
    // Likewise the host page's view toggle (`?view=emails` on /following)
    // isn't ours to manage — preserve it so a filter tweak doesn't drop
    // the user back to the default view on the next reload.
    const currentView = currentSearch.get("view");
    if (currentView) params.set("view", currentView);

    const qs = params.toString();
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(window.history.state, "", url);
  }, [
    hydrated,
    debouncedQuery,
    selectedBrandIds,
    selectedMarkets,
    selectedCategories,
    hasGif,
    hasDarkMode,
    receivedAfter,
    receivedBefore,
    sort,
    defaultSort
  ]);

  // Sync the modal to browser navigation: Back from an open email pops
  // the pushed entry (email param gone -> close); a restored entry that
  // still carries an email param reopens it.
  useEffect(() => {
    function handlePop() {
      modalPushedRef.current = false;
      const emailId = new URLSearchParams(window.location.search).get("email");
      if (!emailId) {
        setOpenEmail(null);
        return;
      }
      openEmailById(emailId);
    }
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [openEmailById]);

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
      return `${searchEndpoint}?${params.toString()}`;
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
      pageSize,
      searchEndpoint
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
    if (isPublic) return; // teaser never paginates
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
  }, [loadNextPage, hasMore, emails.length, isPublic]);

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

  const filteredBrandCategoryOptions = useMemo(() => {
    const q = marketQuery.trim().toLowerCase();
    if (!q) return brandCategoryOptions;
    return brandCategoryOptions.filter((option) =>
      option.label.toLowerCase().includes(q)
    );
  }, [brandCategoryOptions, marketQuery]);

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

  const hasAnyFilter =
    selectedBrandIds.size > 0 ||
    selectedMarkets.size > 0 ||
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
                selectedBrandIds.size > 0 ? ` ${styles.filterChipActive}` : ""
              }${openPopover === "brands" ? ` ${styles.filterChipOpen}` : ""}`}
              onClick={() => togglePopover("brands")}
              aria-haspopup="true"
              aria-expanded={openPopover === "brands"}
            >
              <span>Brands</span>
              {selectedBrandIds.size > 0 ? (
                <span className={styles.filterCount}>
                  {selectedBrandIds.size}
                </span>
              ) : null}
              <ChevronIcon />
            </button>
            {openPopover === "brands" ? (
              <div
                className={`${styles.popover} ${styles.popoverList}`}
                role="menu"
              >
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
                    <>
                      <div className={styles.popoverEmpty}>No brands found</div>
                      <button
                        type="button"
                        className={requestStyles.triggerLink}
                        onClick={() => {
                          setOpenPopover(null);
                          setBrandRequestOpen(true);
                        }}
                      >
                        Request a brand?
                      </button>
                    </>
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
                {selectedBrandIds.size > 0 ? (
                  <div className={styles.popoverFooter}>
                    <button
                      type="button"
                      className={styles.popoverClear}
                      onClick={() => setSelectedBrandIds(new Set())}
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
                selectedMarkets.size > 0 ? ` ${styles.filterChipActive}` : ""
              }${
                openPopover === "brandCategories"
                  ? ` ${styles.filterChipOpen}`
                  : ""
              }`}
              onClick={() => togglePopover("brandCategories")}
              aria-haspopup="true"
              aria-expanded={openPopover === "brandCategories"}
            >
              <span>Categories</span>
              {selectedMarkets.size > 0 ? (
                <span className={styles.filterCount}>
                  {selectedMarkets.size}
                </span>
              ) : null}
              <ChevronIcon />
            </button>
            {openPopover === "brandCategories" ? (
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
                    aria-label="Search categories"
                  />
                </div>
                <div className={styles.popoverScroll}>
                  {filteredBrandCategoryOptions.length === 0 ? (
                    <div className={styles.popoverEmpty}>
                      No categories found
                    </div>
                  ) : (
                    filteredBrandCategoryOptions.map((option) => {
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
              <span>Content type</span>
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
                      No content types yet
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

      {signupModalOpen ? (
        <div
          className={styles.signupModalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="signup-modal-title"
          onClick={() => setSignupModalOpen(false)}
        >
          <div
            className={styles.signupModal}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.signupModalClose}
              onClick={() => setSignupModalOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
            <h2 id="signup-modal-title" className={styles.signupModalTitle}>
              Create a free account to save emails
            </h2>
            <p className={styles.signupModalText}>
              Sign up for free to start saving emails to your gallery and pick
              up where you left off.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(signupModalNext)}`}
              className={styles.signupModalCta}
            >
              Sign up
            </Link>
          </div>
        </div>
      ) : null}

      {isPublic && allowSave ? (
        <div
          className={styles.saveQuota}
          role={saveLimitHit ? "alert" : undefined}
        >
          <span className={styles.saveQuotaText}>
            {savedCount >= saveLimit
              ? `You've used all ${saveLimit} free saves.`
              : `Saved ${savedCount} of ${saveLimit} free emails.`}{" "}
            Upgrade to save more and unlock the full archive.
          </span>
          <TrackedUpgradeLink source="explore_save_quota" className={styles.saveQuotaCta}>
            View plans
          </TrackedUpgradeLink>
        </div>
      ) : null}

      {emails.length === 0 && !loading ? (
        <p className={styles.empty}>
          {hasAnyFilter
            ? "No emails match the current filters."
            : "No captured emails yet. Once your subscriptions start receiving newsletters they will appear here."}
        </p>
      ) : (
        <div className={isPublic ? publicStyles.gridWrap : undefined}>
          <div className={styles.grid}>
            {emails.map((email) =>
              isPublic && !allowSave ? (
                // Logged-out visitor: show the Save button as a conversion
                // hook, but clicking it nudges them to sign up rather than
                // saving (nothing persists without an account).
                <EmailCard
                  key={email.id}
                  email={email}
                  onOpen={handleOpenEmail}
                  renderUrlBase={renderUrlBase}
                  isSaved={false}
                  onToggleSave={handleLoggedOutSave}
                />
              ) : isPublic && allowSave ? (
                // Signed-in free user: Save enabled, collections withheld
                // (no collection props ⇒ EmailCard hides that affordance).
                <EmailCard
                  key={email.id}
                  email={email}
                  onOpen={handleOpenEmail}
                  renderUrlBase={renderUrlBase}
                  isSaved={savedIds.has(email.id)}
                  onToggleSave={handleToggleSave}
                />
              ) : (
                <EmailCard
                  key={email.id}
                  email={email}
                  onOpen={handleOpenEmail}
                  renderUrlBase={authedRenderBase}
                  isSaved={savedIds.has(email.id)}
                  onToggleSave={handleToggleSave}
                  collections={collections}
                  membershipIds={
                    membershipByEmail.get(email.id) ?? EMPTY_ID_SET
                  }
                  onToggleCollection={handleToggleCollection}
                  onCreateCollection={handleCreateCollection}
                  onRequestMemberships={requestMemberships}
                  isAdmin={isAdmin}
                  isRecommended={
                    email.companyId
                      ? recommendedCompanyIds.has(email.companyId)
                      : false
                  }
                  onToggleRecommended={handleToggleRecommended}
                />
              )
            )}
          </div>

          {isPublic ? (
            <div className={publicStyles.fade}>
              <div className={publicStyles.unlockBox}>
                <span className={publicStyles.unlockLock} aria-hidden="true">
                  <LockIcon />
                </span>
                <h2 className={publicStyles.unlockTitle}>
                  Unlock endless scrolling
                </h2>
                <p className={publicStyles.unlockText}>
                  {allowSave
                    ? `Free accounts see the first ${pageSize} results of every search. Upgrade to scroll the entire archive, save without limits, and unlock collections & compare.`
                    : `You're seeing the first ${pageSize} results of every search. Create a free account to start saving emails, or subscribe to scroll the entire archive.`}
                </p>
                <TrackedUpgradeLink source="explore_paywall" className={publicStyles.unlockCta}>
                  View plans
                </TrackedUpgradeLink>
              </div>
            </div>
          ) : hasMore ? (
            <div
              ref={sentinelRef}
              className={styles.loadMoreSentinel}
              aria-hidden="true"
            />
          ) : null}
        </div>
      )}

      {openEmail ? (
        isPublic ? (
          <EmailModal
            email={openEmail}
            onClose={handleCloseEmail}
            renderUrlBase={renderUrlBase}
            detailUrlBase="/api/public/emails"
            readOnly
          />
        ) : (
          <EmailModal
            email={openEmail}
            onClose={handleCloseEmail}
            renderUrlBase={authedRenderBase}
            detailUrlBase={authedDetailBase}
            isSaved={savedIds.has(openEmail.id)}
            onToggleSave={handleToggleSave}
            collections={collections}
            membershipIds={membershipByEmail.get(openEmail.id) ?? EMPTY_ID_SET}
            onToggleCollection={handleToggleCollection}
            onCreateCollection={handleCreateCollection}
            onRequestMemberships={requestMemberships}
          />
        )
      ) : null}

      {brandRequestOpen ? (
        <BrandRequestModal
          defaultCompanyName={brandQuery.trim()}
          onClose={() => setBrandRequestOpen(false)}
        />
      ) : null}
    </>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
