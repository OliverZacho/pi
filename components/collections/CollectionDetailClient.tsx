"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EMAIL_CATEGORY_LABELS,
  type EmailCategory
} from "@/lib/admin-types";
import type {
  CollectionDetail,
  CollectionRules,
  CollectionRuleCondition,
  CollectionRuleScope,
  CollectionRuleTimeWindow,
  CollectionSummary
} from "@/lib/collections-db";
import type { ExploreEmailCard, ExploreFacets } from "@/lib/explore-db";
import { countryLabel } from "@/lib/country";
import type { CollectionIcon } from "@/lib/collection-icons";
import EmailCard from "../explore/EmailCard";
import EmailModal from "../explore/EmailModal";
import exploreStyles from "../explore/explore.module.css";
import CollectionEventInsights from "./CollectionEventInsights";
import CollectionIconPicker from "./CollectionIconPicker";
import CollectionRulesEditor from "./CollectionRulesEditor";
import styles from "./collections.module.css";

const EMPTY_ID_SET = new Set<string>();

type Props = {
  initialCollection: CollectionDetail;
  initialSavedIds: string[];
  initialCollections: CollectionSummary[];
  /**
   * Brand / market / category facets used by the rules editor's
   * dropdowns. Always provided by the server — fall back to empty
   * arrays if loading failed upstream.
   */
  facets: ExploreFacets;
  /**
   * Deepest discount per brand (by company name) over the trailing 12
   * months — benchmarks the discount figure in the event insights.
   */
  brandDiscountBenchmarks: Record<string, number>;
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
  initialCollections,
  facets,
  brandDiscountBenchmarks
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

  // Distinct brands represented in the collection — identify by companyId
  // when present, otherwise fall back to the (always-present) company name.
  const brandCount = useMemo(() => {
    const seen = new Set<string>();
    for (const email of emails) {
      seen.add(email.companyId ?? email.companyName);
    }
    return seen.size;
  }, [emails]);

  const [rulesEditorOpen, setRulesEditorOpen] = useState(false);
  const isRuleBased = collection.rules !== null;
  const openEmailRef = useRef<ExploreEmailCard | null>(null);
  useEffect(() => {
    openEmailRef.current = openEmail;
  }, [openEmail]);

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

  // ---------- Rules ----------

  const applyDetailResponse = useCallback((detail: CollectionDetail) => {
    setCollection(detail);
    setEmails(detail.emails);
    if (openEmailRef.current) {
      const stillThere = detail.emails.find(
        (item) => item.id === openEmailRef.current?.id
      );
      if (!stillThere) {
        setOpenEmail(null);
      }
    }
  }, []);

  const handleSaveRules = useCallback(
    async (rules: CollectionRules | null) => {
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules })
      });
      if (!res.ok) {
        let message = `Failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* fall through */
        }
        throw new Error(message);
      }
      const body = (await res.json()) as { collection: CollectionDetail };
      applyDetailResponse(body.collection);
      setRulesEditorOpen(false);
    },
    [applyDetailResponse, collection.id]
  );

  async function handleClearRules() {
    const confirmed = window.confirm(
      "Remove the automatic rules for this collection? The collection will become empty until you add emails manually."
    );
    if (!confirmed) return;
    try {
      await handleSaveRules(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear rules");
    }
  }

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

  async function handleChangeIcon(icon: CollectionIcon | null) {
    if (icon === collection.icon) return;
    const previous = collection.icon;
    // Optimistically reflect the new icon; roll back on failure.
    setCollection((current) => ({ ...current, icon }));
    try {
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon })
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const body = (await res.json()) as { collection: CollectionDetail };
      applyDetailResponse(body.collection);
      router.refresh();
    } catch (err) {
      setCollection((current) => ({ ...current, icon: previous }));
      setError(
        err instanceof Error ? err.message : "Failed to update icon"
      );
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
      const body = (await res.json()) as { collection: CollectionDetail };
      applyDetailResponse(body.collection);
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
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/explore" className={styles.breadcrumbLink}>
          <ChevronLeftIcon />
          <span>Explore</span>
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <Link href="/collections" className={styles.breadcrumbLink}>
          <span>Collections</span>
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{collection.name}</span>
      </nav>

      <header className={styles.detailHeader}>
        <div className={styles.detailTitleGroup}>
          <div className={styles.detailTitleRow}>
            <CollectionIconPicker
              value={collection.icon}
              onChange={handleChangeIcon}
              size="lg"
              label="Choose an icon for this collection"
            />
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
          </div>
          <span className={styles.detailMeta}>
            {emails.length === 0
              ? "Empty collection"
              : `${emails.length} ${emails.length === 1 ? "email" : "emails"} across ${brandCount} ${
                  brandCount === 1 ? "brand" : "brands"
                }`}
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

      {isRuleBased && !rulesEditorOpen ? (
        <RulesSummary
          rules={collection.rules as CollectionRules}
          facets={facets}
          onEdit={() => setRulesEditorOpen(true)}
          onClear={handleClearRules}
        />
      ) : null}

      {rulesEditorOpen ? (
        <CollectionRulesEditor
          initialRules={collection.rules}
          facets={facets}
          onSave={handleSaveRules}
          onCancel={() => setRulesEditorOpen(false)}
          showCancel
        />
      ) : null}

      {!rulesEditorOpen && emails.length > 0 ? (
        <CollectionEventInsights
          collectionId={collection.id}
          initialDetection={collection.eventDetection}
          emails={emails}
          brandDiscountBenchmarks={brandDiscountBenchmarks}
          onOpenEmail={handleOpenEmail}
          emailModalOpen={openEmail !== null}
        />
      ) : null}

      {!rulesEditorOpen && emails.length === 0 ? (
        isRuleBased ? (
          <p className={exploreStyles.empty}>
            No emails match these rules yet. New incoming emails will be
            added automatically.
          </p>
        ) : (
          <div className={styles.rulesEmptyState}>
            <h2 className={styles.rulesEmptyTitle}>
              This collection is empty
            </h2>
            <p className={styles.rulesEmptyBody}>
              Open Explore or Saved and use the folder-plus icon on any
              email to add it here — or set up automatic rules so new
              incoming emails populate this collection for you.
            </p>
            <div className={styles.rulesEmptyDivider}>or</div>
            <CollectionRulesEditor
              initialRules={null}
              facets={facets}
              onSave={handleSaveRules}
            />
          </div>
        )
      ) : null}

      {!rulesEditorOpen && emails.length > 0 ? (
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
      ) : null}

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

/**
 * Read-only summary of the active rule set. Renders each condition as
 * a chip joined by the combinator, plus Edit / Clear actions. Lives
 * directly above the email grid when a collection is rule-based.
 */
function RulesSummary({
  rules,
  facets,
  onEdit,
  onClear
}: {
  rules: CollectionRules;
  facets: ExploreFacets;
  onEdit: () => void;
  onClear: () => Promise<void> | void;
}) {
  const brandsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const brand of facets.brands) map.set(brand.id, brand.name);
    return map;
  }, [facets.brands]);

  return (
    <div className={styles.rulesSummary}>
      <span className={styles.rulesSummaryLabel}>
        <SparkleIcon /> Auto-rules
      </span>
      <ul className={styles.rulesSummaryList}>
        {rules.scope !== "all" ? (
          <li style={{ display: "contents" }}>
            <span
              className={`${styles.rulesSummaryChip} ${styles.rulesSummaryChipScope}`}
              title={
                rules.appliedAt
                  ? new Date(rules.appliedAt).toLocaleString()
                  : undefined
              }
            >
              <span className={styles.rulesSummaryChipLabel}>Scope</span>
              {describeScope(rules.scope, rules.appliedAt)}
            </span>
            <span className={styles.rulesSummaryJoiner}>AND</span>
          </li>
        ) : null}
        {rules.timeWindow ? (
          <li style={{ display: "contents" }}>
            <span
              className={`${styles.rulesSummaryChip} ${styles.rulesSummaryChipScope}`}
            >
              <span className={styles.rulesSummaryChipLabel}>Time</span>
              {describeTimeWindow(rules.timeWindow)}
            </span>
            <span className={styles.rulesSummaryJoiner}>AND</span>
          </li>
        ) : null}
        {rules.conditions.map((condition, index) => (
          <li key={condition.id} style={{ display: "contents" }}>
            {index > 0 ? (
              <span className={styles.rulesSummaryJoiner}>
                {rules.combinator}
              </span>
            ) : null}
            <span className={styles.rulesSummaryChip}>
              {describeCondition(condition, brandsById)}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.rulesSummaryActions}>
        <button
          type="button"
          className={styles.rulesSummaryButton}
          onClick={onEdit}
        >
          <PencilIcon /> Edit rules
        </button>
        <button
          type="button"
          className={`${styles.rulesSummaryButton} ${styles.rulesSummaryButtonDanger}`}
          onClick={() => {
            void onClear();
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function describeCondition(
  condition: CollectionRuleCondition,
  brandsById: Map<string, string>
): React.ReactNode {
  switch (condition.field) {
    case "search":
      return (
        <>
          <span className={styles.rulesSummaryChipLabel}>Search</span>
          contains "{condition.value}"
        </>
      );
    case "category":
      return (
        <>
          <span className={styles.rulesSummaryChipLabel}>Content type</span>
          {formatList(
            condition.values.map(
              (v) => EMAIL_CATEGORY_LABELS[v as EmailCategory] ?? v
            )
          )}
        </>
      );
    case "brand":
      return (
        <>
          <span className={styles.rulesSummaryChipLabel}>
            {condition.values.length === 1 ? "Brand" : "Brands"}
          </span>
          {formatList(
            condition.values.map(
              (v) => brandsById.get(v) ?? "Selected brand"
            )
          )}
        </>
      );
    case "market":
      return (
        <>
          <span className={styles.rulesSummaryChipLabel}>
            {condition.values.length === 1 ? "Category" : "Categories"}
          </span>
          {formatList(condition.values)}
        </>
      );
    case "country":
      return (
        <>
          <span className={styles.rulesSummaryChipLabel}>
            {condition.values.length === 1 ? "Country" : "Countries"}
          </span>
          {formatList(condition.values.map((v) => countryLabel(v) || v))}
        </>
      );
    case "discount_percent": {
      const op =
        condition.operator === "gte"
          ? "≥"
          : condition.operator === "lte"
            ? "≤"
            : "=";
      return (
        <>
          <span className={styles.rulesSummaryChipLabel}>Discount</span>
          {op} {condition.value}%
        </>
      );
    }
  }
}

function describeTimeWindow(window: CollectionRuleTimeWindow): string {
  if (window.type === "rolling") {
    const unit =
      window.amount === 1 ? window.unit.replace(/s$/, "") : window.unit;
    return `Last ${window.amount} ${unit}`;
  }
  const fmt = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  if (window.from && window.to) return `${fmt(window.from)} – ${fmt(window.to)}`;
  if (window.from) return `From ${fmt(window.from)}`;
  return `Until ${fmt(window.to as string)}`;
}

function describeScope(
  scope: CollectionRuleScope,
  appliedAt: string | null
): string {
  if (scope === "all") return "All emails";
  const formatted = appliedAt
    ? new Date(appliedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      })
    : null;
  if (scope === "future") {
    return formatted
      ? `Only new emails (since ${formatted})`
      : "Only new emails";
  }
  return formatted
    ? `Only existing emails (up to ${formatted})`
    : "Only existing emails";
}

/**
 * Compact list formatter for the summary chips. Renders up to three
 * items inline, then collapses the rest behind a "+N more" suffix so
 * a chip with eight brands selected doesn't overflow the row.
 */
function formatList(items: string[]): string {
  if (items.length === 0) return "—";
  if (items.length <= 3) return items.join(", ");
  return `${items.slice(0, 3).join(", ")} +${items.length - 3} more`;
}

function SparkleIcon() {
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
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M5.6 5.6l2.1 2.1" />
      <path d="M16.3 16.3l2.1 2.1" />
      <path d="M5.6 18.4l2.1-2.1" />
      <path d="M16.3 7.7l2.1-2.1" />
    </svg>
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

function ChevronLeftIcon() {
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
      <polyline points="15 6 9 12 15 18" />
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
