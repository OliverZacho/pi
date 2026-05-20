"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CollectionDetail,
  CollectionSummary
} from "@/lib/collections-db";
import type { ExploreEmailCard } from "@/lib/explore-db";
import EmailCard from "../explore/EmailCard";
import EmailModal from "../explore/EmailModal";
import exploreStyles from "../explore/explore.module.css";
import styles from "./collections.module.css";

const EMPTY_ID_SET = new Set<string>();

type Props = {
  initialCollection: CollectionDetail;
  initialSavedIds: string[];
  initialCollections: CollectionSummary[];
};

/**
 * Owner-side `/collections/[id]` client. Header shows the collection
 * name + meta + Share / Rename / Delete actions; below sits the same
 * `EmailCard` + `EmailModal` pair Explore uses, so users get an
 * identical interaction model (open, save, add to other collections,
 * remove from this collection).
 */
export default function CollectionDetailClient({
  initialCollection,
  initialSavedIds,
  initialCollections
}: Props) {
  const router = useRouter();
  const [collection, setCollection] = useState<CollectionDetail>(
    initialCollection
  );
  const [emails, setEmails] = useState<ExploreEmailCard[]>(
    initialCollection.emails
  );
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(initialSavedIds)
  );

  const [collections, setCollections] =
    useState<CollectionSummary[]>(initialCollections);
  const [membershipByEmail, setMembershipByEmail] = useState<
    Map<string, Set<string>>
  >(() => {
    // Every email visible on this page is, by definition, in this
    // collection — seed the map so the popover shows it pre-checked
    // even before the on-demand fetch fills in the other collections.
    const seed = new Map<string, Set<string>>();
    for (const email of initialCollection.emails) {
      seed.set(email.id, new Set([initialCollection.id]));
    }
    return seed;
  });
  const membershipLoadedRef = useRef<Set<string>>(new Set());
  const membershipPendingRef = useRef<Map<string, Promise<void>>>(new Map());

  // Header controls
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialCollection.name);
  const [renamePending, setRenamePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [copied, setCopied] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) {
      requestAnimationFrame(() => renameInputRef.current?.focus());
    }
  }, [renaming]);

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/c/${collection.shareSlug}`
      : `/c/${collection.shareSlug}`;

  const handleOpenEmail = useCallback((email: ExploreEmailCard) => {
    setOpenEmail(email);
  }, []);
  const handleCloseEmail = useCallback(() => {
    setOpenEmail(null);
  }, []);

  const handleToggleSave = useCallback(
    async (email: ExploreEmailCard, next: boolean) => {
      setSavedIds((current) => {
        const updated = new Set(current);
        if (next) updated.add(email.id);
        else updated.delete(email.id);
        return updated;
      });
      try {
        const res = await fetch(`/api/explore/saved/${email.id}`, {
          method: next ? "PUT" : "DELETE",
          credentials: "include"
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
      } catch (err) {
        setSavedIds((current) => {
          const updated = new Set(current);
          if (next) updated.delete(email.id);
          else updated.add(email.id);
          return updated;
        });
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    },
    []
  );

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

  const handleToggleCollection = useCallback(
    async (collectionId: string, emailId: string, next: boolean) => {
      // Optimistically update both the membership map and (if the user
      // unchecked this very collection) the visible grid.
      updateMembership(emailId, collectionId, next);
      const removeFromGrid = collectionId === collection.id && !next;
      let previousEmails: ExploreEmailCard[] | null = null;
      if (removeFromGrid) {
        previousEmails = emails;
        setEmails((current) => current.filter((item) => item.id !== emailId));
        if (openEmail?.id === emailId) {
          setOpenEmail(null);
        }
      }
      try {
        const res = await fetch(
          `/api/collections/${collectionId}/emails/${emailId}`,
          { method: next ? "PUT" : "DELETE", credentials: "include" }
        );
        if (!res.ok) throw new Error(`Failed (${res.status})`);
      } catch (err) {
        updateMembership(emailId, collectionId, !next);
        if (previousEmails) {
          setEmails(previousEmails);
        }
        setError(
          err instanceof Error ? err.message : "Failed to update collection"
        );
      }
    },
    [collection.id, emails, openEmail, updateMembership]
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

  // ---------- Header actions ----------

  async function handleCopyShare() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = shareUrl;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't copy link");
    }
  }

  async function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (renamePending) return;
    const name = nameDraft.trim();
    if (!name || name === collection.name) {
      setRenaming(false);
      return;
    }
    setRenamePending(true);
    try {
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const body = (await res.json()) as { collection: CollectionSummary };
      setCollection((current) => ({
        ...current,
        name: body.collection.name
      }));
      setNameDraft(body.collection.name);
      setRenaming(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to rename collection"
      );
    } finally {
      setRenamePending(false);
    }
  }

  async function handleDelete() {
    if (deletePending) return;
    const confirmed = window.confirm(
      `Delete collection "${collection.name}"? This can't be undone.`
    );
    if (!confirmed) return;
    setDeletePending(true);
    try {
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.push("/collections");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete collection"
      );
      setDeletePending(false);
    }
  }

  return (
    <>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleGroup}>
          {renaming ? (
            <form onSubmit={handleRename}>
              <input
                ref={renameInputRef}
                type="text"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => {
                  if (!renamePending) {
                    setNameDraft(collection.name);
                    setRenaming(false);
                  }
                }}
                maxLength={120}
                className={styles.detailTitleInput}
                aria-label="Rename collection"
                disabled={renamePending}
              />
            </form>
          ) : (
            <h1 className={styles.detailTitle}>
              {collection.name}
              <button
                type="button"
                className={styles.detailEditIcon}
                onClick={() => {
                  setNameDraft(collection.name);
                  setRenaming(true);
                }}
                aria-label="Rename collection"
                title="Rename"
              >
                <PencilIcon />
              </button>
            </h1>
          )}
          <span className={styles.detailMeta}>
            {emails.length === 0
              ? "Empty collection"
              : `${emails.length} ${emails.length === 1 ? "email" : "emails"}`}
          </span>
        </div>

        <div className={styles.detailActions}>
          <button
            type="button"
            className={`${styles.detailButton} ${
              copied ? styles.detailButtonCopied : ""
            }`}
            onClick={handleCopyShare}
          >
            <ShareIcon />
            <span>{copied ? "Link copied" : "Share link"}</span>
          </button>
          <a
            href={`/c/${collection.shareSlug}`}
            target="_blank"
            rel="noreferrer"
            className={styles.detailButton}
          >
            <ExternalIcon />
            <span>Preview public</span>
          </a>
          <button
            type="button"
            className={`${styles.detailButton} ${styles.detailButtonDanger}`}
            onClick={handleDelete}
            disabled={deletePending}
          >
            <TrashIcon />
            <span>{deletePending ? "Deleting…" : "Delete"}</span>
          </button>
        </div>
      </header>

      {error ? (
        <div className={exploreStyles.resultError} role="alert">
          {error}
        </div>
      ) : null}

      {emails.length === 0 ? (
        <p className={exploreStyles.empty}>
          This collection is empty. Open Explore or Saved and use the
          folder-plus icon on any email to add it here.
        </p>
      ) : (
        <div className={exploreStyles.grid}>
          {emails.map((email) => (
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
            />
          ))}
        </div>
      )}

      {openEmail ? (
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
      ) : null}
    </>
  );
}

function PencilIcon() {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}

function ShareIcon() {
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
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
      <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </svg>
  );
}

function ExternalIcon() {
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
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function TrashIcon() {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
