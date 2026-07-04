"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionSummary } from "@/lib/collections-db";
import type { ExploreEmailCard } from "@/lib/explore-db";
import type { SavedEmailCard } from "@/lib/saved-emails-db";
import EmailCard from "./EmailCard";
import EmailModal from "./EmailModal";
import styles from "./explore.module.css";

type Props = {
  initialEmails: SavedEmailCard[];
  /**
   * Collections to surface in the per-card "Add to collection"
   * popover. Same payload the Explore page passes down so the two
   * stay in sync.
   */
  initialCollections: CollectionSummary[];
  /**
   * Free (unpaid) view: render previews/detail through the public,
   * no-auth endpoints, hide collections (a paid feature), and open the
   * read-only modal. Removing a save still works from the card.
   */
  publicView?: boolean;
};

const EMPTY_ID_SET = new Set<string>();

type SavedSortKey =
  | "saved_desc"
  | "saved_asc"
  | "newest"
  | "oldest"
  | "brand_asc"
  | "brand_desc"
  | "discount_desc";

const SORT_OPTIONS: { id: SavedSortKey; label: string }[] = [
  { id: "saved_desc", label: "Recently saved" },
  { id: "saved_asc", label: "Earliest saved" },
  { id: "newest", label: "Newest email" },
  { id: "oldest", label: "Oldest email" },
  { id: "brand_asc", label: "Brand A–Z" },
  { id: "brand_desc", label: "Brand Z–A" },
  { id: "discount_desc", label: "Highest discount" }
];

const SORT_LABEL: Record<SavedSortKey, string> = SORT_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.id]: opt.label }),
  {} as Record<SavedSortKey, string>
);

const SEARCH_DEBOUNCE_MS = 150;

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

/**
 * Saved gallery client. Reuses the Explore `EmailCard` + `EmailModal`
 * primitives so the visual language is identical, but the controls
 * above the grid are intentionally trimmed: a free-text search and a
 * sort dropdown — no filters (per product spec).
 *
 * Search + sort run entirely client-side over the in-memory saved
 * list. The gallery is naturally small (a single user's bookmarks)
 * so an extra round trip per keystroke would be wasteful, and lets
 * the controls feel instant.
 */
export default function SavedGalleryClient({
  initialEmails,
  initialCollections,
  publicView = false
}: Props) {
  const [emails, setEmails] = useState<SavedEmailCard[]>(initialEmails);
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [collections, setCollections] =
    useState<CollectionSummary[]>(initialCollections);
  const [membershipByEmail, setMembershipByEmail] = useState<
    Map<string, Set<string>>
  >(() => new Map());
  const membershipLoadedRef = useRef<Set<string>>(new Set());
  const membershipPendingRef = useRef<Map<string, Promise<void>>>(new Map());

  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<SavedSortKey>("saved_desc");
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef<HTMLDivElement | null>(null);

  const handleOpenEmail = useCallback((email: ExploreEmailCard) => {
    setOpenEmail(email);
  }, []);

  const handleCloseEmail = useCallback(() => {
    setOpenEmail(null);
  }, []);

  const handleToggleSave = useCallback(
    async (email: ExploreEmailCard, next: boolean) => {
      // The gallery only ever surfaces saved items, so a toggle here
      // always means "remove from saved" — and is only triggered from
      // a card or modal where the email was already saved.
      if (next) return;
      const previous = emails;
      setEmails((current) => current.filter((item) => item.id !== email.id));
      if (openEmail?.id === email.id) {
        setOpenEmail(null);
      }
      try {
        const res = await fetch(`/api/explore/saved/${email.id}`, {
          method: "DELETE",
          credentials: "include"
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
      } catch (err) {
        setEmails(previous);
        setError(err instanceof Error ? err.message : "Failed to unsave");
      }
    },
    [emails, openEmail]
  );

  const requestMemberships = useCallback(async (emailId: string) => {
    if (membershipLoadedRef.current.has(emailId)) return;
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
        setError(
          err instanceof Error ? err.message : "Failed to update collection"
        );
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
        if (!addRes.ok) throw new Error(`Failed (${addRes.status})`);
        return created.collection;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create collection"
        );
        return null;
      }
    },
    [updateMembership]
  );

  // Debounce the search input so we don't recompute the filtered /
  // sorted view on every keystroke for large saved sets. We keep it
  // short (150ms) since the work is in-memory.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(queryInput.trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

  // Close the sort popover when clicking outside or pressing Escape.
  useEffect(() => {
    if (!sortOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const wrap = sortWrapRef.current;
      if (!wrap) return;
      if (event.target instanceof Node && !wrap.contains(event.target)) {
        setSortOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSortOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [sortOpen]);

  const visibleEmails = useMemo(() => {
    const q = debouncedQuery;
    const filtered = q
      ? emails.filter((email) => {
          if (email.subject?.toLowerCase().includes(q)) return true;
          if (email.preheader?.toLowerCase().includes(q)) return true;
          if (email.companyName?.toLowerCase().includes(q)) return true;
          return false;
        })
      : emails;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "saved_asc":
          return a.savedAt.localeCompare(b.savedAt);
        case "newest":
          return b.receivedAt.localeCompare(a.receivedAt);
        case "oldest":
          return a.receivedAt.localeCompare(b.receivedAt);
        case "brand_asc":
          return a.companyName.localeCompare(b.companyName, undefined, {
            sensitivity: "base"
          });
        case "brand_desc":
          return b.companyName.localeCompare(a.companyName, undefined, {
            sensitivity: "base"
          });
        case "discount_desc": {
          const ad = a.discountPercent ?? -1;
          const bd = b.discountPercent ?? -1;
          if (bd !== ad) return bd - ad;
          return b.receivedAt.localeCompare(a.receivedAt);
        }
        case "saved_desc":
        default:
          return b.savedAt.localeCompare(a.savedAt);
      }
    });
    return sorted;
  }, [emails, debouncedQuery, sort]);

  const savedIds = useMemo(
    () => new Set(emails.map((email) => email.id)),
    [emails]
  );

  return (
    <>
      <div className={styles.filterRow}>
        <label className={styles.searchField}>
          <SearchIcon />
          <input
            type="search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search saved emails"
            className={styles.searchInput}
            aria-label="Search saved emails"
          />
        </label>

        <div className={styles.sortWrap} ref={sortWrapRef}>
          <button
            type="button"
            className={`${styles.filterChip} ${styles.sortChip}${
              sortOpen ? ` ${styles.filterChipOpen}` : ""
            }`}
            onClick={() => setSortOpen((current) => !current)}
            aria-haspopup="true"
            aria-expanded={sortOpen}
          >
            <SortIcon />
            <span>
              Sort: <strong>{SORT_LABEL[sort]}</strong>
            </span>
            <ChevronIcon />
          </button>
          {sortOpen ? (
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
                      setSortOpen(false);
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

      {emails.length === 0 ? (
        <p className={styles.empty}>
          You haven&apos;t saved any emails yet. Hover over any card in
          Explore and tap Save to start building your gallery.
        </p>
      ) : visibleEmails.length === 0 ? (
        <p className={styles.empty}>No saved emails match your search.</p>
      ) : (
        <div className={styles.grid}>
          {visibleEmails.map((email, index) =>
            publicView ? (
              // Free view: public render endpoint, Save toggle (unsave)
              // kept, collections withheld.
              <EmailCard
                key={email.id}
                email={email}
                onOpen={handleOpenEmail}
                renderUrlBase="/api/explore/emails"
                isSaved={savedIds.has(email.id)}
                onToggleSave={handleToggleSave}
                enterDelayMs={Math.min(index, 16) * 30}
              />
            ) : (
              <EmailCard
                key={email.id}
                email={email}
                onOpen={handleOpenEmail}
                isSaved={savedIds.has(email.id)}
                onToggleSave={handleToggleSave}
                collections={collections}
                membershipIds={membershipByEmail.get(email.id) ?? EMPTY_ID_SET}
                onToggleCollection={handleToggleCollection}
                onCreateCollection={handleCreateCollection}
                onRequestMemberships={requestMemberships}
                enterDelayMs={Math.min(index, 16) * 30}
              />
            )
          )}
        </div>
      )}

      {openEmail ? (
        publicView ? (
          <EmailModal
            email={openEmail}
            onClose={handleCloseEmail}
            renderUrlBase="/api/explore/emails"
            detailUrlBase="/api/public/emails"
            readOnly
          />
        ) : (
          <EmailModal
            email={openEmail}
            onClose={handleCloseEmail}
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
    </>
  );
}
