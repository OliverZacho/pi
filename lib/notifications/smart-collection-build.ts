import type { DigestCadence } from "@/lib/notification-prefs";

/**
 * "New matches in a smart collection" model. Unlike the brand-based
 * notifications, detection is per rule-based collection and is inherently
 * DB-bound (rules are evaluated against captured_emails), so the run job
 * gathers the raw matches and this module only shapes them for the email.
 */

export type CollectionMatch = {
  collectionId: string;
  collectionName: string;
  /** New matching emails since the last send. */
  newCount: number;
  /** A few recent examples for the email body. */
  samples: { subject: string; brandName: string | null }[];
};

/** Collection blocks shown in the email; the rest collapse to a count. */
const MAX_COLLECTIONS = 6;

export type SmartCollectionModel = {
  cadence: DigestCadence;
  /** Collections shown in the body, busiest first (capped). */
  collections: CollectionMatch[];
  /** Total collections with new matches (may exceed `collections.length`). */
  collectionCount: number;
  /** Collections not shown in the body (folded into an "and N more" line). */
  moreCollections: number;
  /** New matches across every collection, not just the shown ones. */
  totalNew: number;
};

export function buildSmartCollectionModel(
  cadence: DigestCadence,
  matches: CollectionMatch[]
): SmartCollectionModel {
  const all = matches
    .filter((m) => m.newCount > 0)
    .sort((a, b) => b.newCount - a.newCount);
  const collections = all.slice(0, MAX_COLLECTIONS);
  return {
    cadence,
    collections,
    collectionCount: all.length,
    moreCollections: all.length - collections.length,
    totalNew: all.reduce((sum, m) => sum + m.newCount, 0)
  };
}
