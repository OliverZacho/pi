"use client";

import { useEffect, useRef, useState } from "react";
import type { CollectionSummary } from "@/lib/collections-db";

const POLL_MS = 5_000;

/**
 * Fired when a page starts a build (e.g. saving new rules), so an already
 * mounted sidebar starts watching without waiting for a navigation.
 */
export const COLLECTION_BUILD_STARTED_EVENT = "pirol:collection-build-started";

export function emitCollectionBuildStarted(collectionId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COLLECTION_BUILD_STARTED_EVENT, { detail: { collectionId } })
  );
}

export type ReadyCollection = { id: string; name: string };

/**
 * Watches the viewer's smart collections that are still building. Polls
 * only while at least one build is known to be running and the tab is
 * visible, flips the sidebar rows as builds finish, and returns the ones
 * that finished while the viewer was somewhere else, for the "ready"
 * notice. A build finishing on its own page needs no notice: that page
 * swaps the progress panel for the emails itself.
 */
export function useCollectionBuildWatcher(
  items: CollectionSummary[],
  setItems: (update: (current: CollectionSummary[]) => CollectionSummary[]) => void,
  activeCollectionId: string | null
) {
  const [ready, setReady] = useState<ReadyCollection[]>([]);
  const [extraWatched, setExtraWatched] = useState<string[]>([]);
  const activeRef = useRef(activeCollectionId);
  const itemsRef = useRef(items);
  useEffect(() => {
    activeRef.current = activeCollectionId;
    itemsRef.current = items;
  });

  useEffect(() => {
    const onStarted = (event: Event) => {
      const id = (event as CustomEvent<{ collectionId?: string }>).detail
        ?.collectionId;
      if (!id) return;
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, matchBuilding: true } : item
        )
      );
      setExtraWatched((current) => (current.includes(id) ? current : [...current, id]));
    };
    window.addEventListener(COLLECTION_BUILD_STARTED_EVENT, onStarted);
    return () => window.removeEventListener(COLLECTION_BUILD_STARTED_EVENT, onStarted);
  }, [setItems]);

  const watchedKey = Array.from(
    new Set([
      ...items.filter((item) => item.matchBuilding).map((item) => item.id),
      ...extraWatched
    ])
  )
    .sort()
    .join(",");

  useEffect(() => {
    if (!watchedKey) return;
    const watched = new Set(watchedKey.split(","));
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/collections/builds", {
            credentials: "include",
            cache: "no-store"
          });
          if (res.ok) {
            const body = (await res.json()) as { building?: string[] };
            if (cancelled) return;
            const stillBuilding = new Set(body.building ?? []);
            const finished = Array.from(watched).filter(
              (id) => !stillBuilding.has(id)
            );
            if (finished.length > 0) {
              const names = new Map(itemsRef.current.map((i) => [i.id, i.name]));
              setItems((current) =>
                current.map((item) =>
                  finished.includes(item.id)
                    ? { ...item, matchBuilding: false }
                    : item
                )
              );
              setExtraWatched((current) =>
                current.filter((id) => !finished.includes(id))
              );
              const announce = finished
                .filter((id) => id !== activeRef.current && names.has(id))
                .map((id) => ({ id, name: names.get(id) as string }));
              if (announce.length > 0) {
                setReady((current) => [
                  ...current.filter((r) => !announce.some((a) => a.id === r.id)),
                  ...announce
                ]);
              }
              // The effect re-runs with the smaller watch set.
              return;
            }
          }
        } catch {
          // Network blip: try again next tick.
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [watchedKey, setItems]);

  function dismiss(id: string) {
    setReady((current) => current.filter((r) => r.id !== id));
  }

  // Being on the collection already is the acknowledgement.
  return {
    ready: ready.filter((r) => r.id !== activeCollectionId),
    dismiss
  };
}
