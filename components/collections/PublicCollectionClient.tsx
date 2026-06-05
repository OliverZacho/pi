"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { CollectionDetail } from "@/lib/collections-db";
import type { ExploreEmailCard } from "@/lib/explore-db";
import PublicEmailCard from "./PublicEmailCard";
import PublicEmailModal from "./PublicEmailModal";
import exploreStyles from "../explore/explore.module.css";
import styles from "./public-collection.module.css";

type Props = {
  collection: CollectionDetail;
  slug: string;
};

/**
 * The publicly visible "shared collection" surface. We render a
 * minimal header (collection name + email count + Copy link), then
 * the same grid + modal pair the owner sees — but with iframes
 * pointed at `/api/c/[slug]/emails/[id]/render` so anonymous visitors
 * can still load the email previews.
 */
export default function PublicCollectionClient({ collection, slug }: Props) {
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const renderUrlFor = useCallback(
    (emailId: string) => `/api/c/${slug}/emails/${emailId}/render`,
    [slug]
  );

  async function handleCopy() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/c/${slug}`
        : `/c/${slug}`;
    setCopyError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = url;
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
      setCopyError(
        err instanceof Error ? err.message : "Couldn't copy link"
      );
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.wordmark}>
            Pirol
          </Link>
          <button
            type="button"
            className={`${styles.copyButton} ${
              copied ? styles.copyButtonCopied : ""
            }`}
            onClick={handleCopy}
          >
            <ShareIcon />
            <span>{copied ? "Link copied" : "Copy link"}</span>
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>Shared collection</span>
          <h1 className={styles.title}>
            {collection.icon ? (
              <span className={styles.titleIcon} aria-hidden="true">
                {collection.icon}
              </span>
            ) : null}
            {collection.name}
          </h1>
          <p className={styles.meta}>
            {collection.emails.length === 0
              ? "No emails in this collection yet."
              : `${collection.emails.length} ${
                  collection.emails.length === 1 ? "email" : "emails"
                }`}
          </p>
        </div>

        {copyError ? (
          <div className={exploreStyles.resultError} role="alert">
            {copyError}
          </div>
        ) : null}

        {collection.emails.length === 0 ? (
          <p className={exploreStyles.empty}>
            The owner hasn&apos;t added any emails to this collection.
          </p>
        ) : (
          <div className={exploreStyles.grid}>
            {collection.emails.map((email) => (
              <PublicEmailCard
                key={email.id}
                email={email}
                onOpen={setOpenEmail}
                renderUrlFor={renderUrlFor}
              />
            ))}
          </div>
        )}
      </main>

      {openEmail ? (
        <PublicEmailModal
          email={openEmail}
          onClose={() => setOpenEmail(null)}
          renderUrlFor={renderUrlFor}
        />
      ) : null}
    </>
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
