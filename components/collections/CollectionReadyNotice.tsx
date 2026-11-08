"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import type { ReadyCollection } from "./useCollectionBuildWatcher";
import styles from "./collections.module.css";

type Props = {
  ready: ReadyCollection[];
  onDismiss: (id: string) => void;
};

/**
 * The "your collection is ready" ping: a notice pinned to the corner of
 * every app page, one per finished build, until opened or dismissed.
 */
export default function CollectionReadyNotice({ ready, onDismiss }: Props) {
  // Portalled to <body> so no transformed ancestor (the mobile nav
  // drawer) can trap the fixed positioning. `ready` only fills from
  // client-side polling, so it's always empty during server rendering.
  if (ready.length === 0 || typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.readyStack} role="status" aria-live="polite">
      {ready.map((collection) => (
        <div key={collection.id} className={styles.readyNotice}>
          <div className={styles.readyText}>
            <strong>{collection.name} is ready</strong>
            <span>All matching emails have been added.</span>
          </div>
          <div className={styles.readyActions}>
            <Link
              href={`/collections/${collection.id}`}
              className={styles.readyOpen}
              onClick={() => onDismiss(collection.id)}
            >
              Open collection
            </Link>
            <button
              type="button"
              className={styles.readyDismiss}
              onClick={() => onDismiss(collection.id)}
              aria-label={`Dismiss notice for ${collection.name}`}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
}
