"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CollectionCardData } from "@/lib/collections-db";
import type { CollectionIcon } from "@/lib/collection-icons";
import CollectionCard from "./CollectionCard";
import CollectionIconPicker from "./CollectionIconPicker";
import styles from "./collections.module.css";
import exploreStyles from "../explore/explore.module.css";

const SEARCH_DEBOUNCE_MS = 150;

type Props = {
  initialCollections: CollectionCardData[];
};

/**
 * Owner-side `/collections` grid. Per the product spec, the only
 * filter chrome is a search bar — sorting is implicit
 * (most-recently-updated first, as the API returns them).
 *
 * Search runs entirely client-side over the in-memory list. A user
 * will typically have at most a few dozen collections; an extra round
 * trip per keystroke would be wasteful and would also flicker the
 * mosaic iframes.
 */
export default function CollectionsGridClient({
  initialCollections
}: Props) {
  const router = useRouter();
  const [collections] = useState<CollectionCardData[]>(initialCollections);
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createIcon, setCreateIcon] = useState<CollectionIcon | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(queryInput.trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

  useEffect(() => {
    if (createOpen) {
      requestAnimationFrame(() => createInputRef.current?.focus());
    }
  }, [createOpen]);

  const filtered = useMemo(() => {
    if (!debouncedQuery) return collections;
    return collections.filter((collection) =>
      collection.name.toLowerCase().includes(debouncedQuery)
    );
  }, [collections, debouncedQuery]);

  const shareOrigin =
    typeof window !== "undefined" ? window.location.origin : "";

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createPending) return;
    const name = createName.trim();
    if (!name) return;
    setCreatePending(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon: createIcon })
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const body = await res.json();
      const newId = body?.collection?.id as string | undefined;
      setCreateName("");
      setCreateIcon(null);
      setCreateOpen(false);
      if (newId) {
        router.push(`/collections/${newId}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create collection"
      );
    } finally {
      setCreatePending(false);
    }
  }

  return (
    <>
      <div className={exploreStyles.filterRow}>
        <label className={exploreStyles.searchField}>
          <SearchIcon />
          <input
            type="search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search collections"
            className={exploreStyles.searchInput}
            aria-label="Search collections"
          />
        </label>
      </div>

      {createError ? (
        <div className={exploreStyles.resultError} role="alert">
          {createError}
        </div>
      ) : null}

      <div className={styles.grid}>
        {createOpen ? (
          <form
            className={`${styles.card} ${styles.createCard}`}
            onSubmit={handleCreate}
          >
            <div className={styles.createBody}>
              <span className={styles.createTitle}>New collection</span>
              <div className={styles.createNameRow}>
                <CollectionIconPicker
                  value={createIcon}
                  onChange={setCreateIcon}
                  label="Choose an icon for this collection"
                  disabled={createPending}
                />
                <input
                  ref={createInputRef}
                  type="text"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="e.g. Black Friday"
                  maxLength={120}
                  className={styles.createInput}
                  aria-label="New collection name"
                  disabled={createPending}
                />
              </div>
              <div className={styles.createButtons}>
                <button
                  type="button"
                  className={styles.createCancel}
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateName("");
                    setCreateIcon(null);
                    setCreateError(null);
                  }}
                  disabled={createPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.createSubmit}
                  disabled={createPending || createName.trim().length === 0}
                >
                  {createPending ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={`${styles.card} ${styles.newTile}`}
            onClick={() => setCreateOpen(true)}
            aria-label="Create a new collection"
          >
            <span className={styles.newTileIcon}>
              <PlusIcon />
            </span>
            <span className={styles.newTileLabel}>New collection</span>
          </button>
        )}

        {filtered.map((collection) => (
          <CollectionCard
            key={collection.id}
            collection={collection}
            renderUrlFor={(emailId) =>
              `/api/explore/emails/${emailId}/render?preview=1`
            }
            shareUrl={
              shareOrigin
                ? `${shareOrigin}/c/${collection.shareSlug}`
                : `/c/${collection.shareSlug}`
            }
            openHref={`/collections/${collection.id}`}
          />
        ))}
      </div>

      {collections.length > 0 && filtered.length === 0 ? (
        <p className={exploreStyles.empty}>No collections match your search.</p>
      ) : null}
    </>
  );
}

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
