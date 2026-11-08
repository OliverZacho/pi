"use client";

import { useEffect, useRef, useState } from "react";
import type { CollectionMatchBuild } from "@/lib/collections-db";
import styles from "./collections.module.css";

type Props = {
  collectionId: string;
  initialBuild: CollectionMatchBuild;
  /** Called once when the build finishes; the parent reloads the detail. */
  onReady: () => void;
};

const POLL_MS = 3_000;

/**
 * Emails checked per second before this build has measured its own pace.
 * Conservative on purpose: an estimate that comes in early reads better
 * than one that keeps slipping.
 */
const FALLBACK_RATE = 500;

/** Seconds of build time before the measured pace replaces the fallback. */
const MIN_MEASURE_SECONDS = 5;

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function estimateSecondsLeft(build: CollectionMatchBuild): number {
  const elapsed =
    (new Date(build.serverNow).getTime() - new Date(build.startedAt).getTime()) /
    1000;
  const remaining = Math.max(build.total - build.scanned, 0);
  const measured =
    elapsed >= MIN_MEASURE_SECONDS && build.scanned > 0
      ? build.scanned / elapsed
      : null;
  return remaining / (measured ?? FALLBACK_RATE);
}

function describeTimeLeft(seconds: number, scanned: number, total: number): string {
  if (scanned >= total) return "Almost done";
  if (seconds < 60) return "Less than a minute left";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? "About a minute left" : `About ${minutes} minutes left`;
  }
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "About an hour left" : `About ${hours} hours left`;
}

/**
 * Shown in place of the email grid while a smart collection's matches are
 * built for the first time (or rebuilt after a rule change). Polls the
 * build's progress and tells the viewer what's happening, roughly how long
 * it will take, and that they're free to leave.
 */
export default function CollectionBuildProgress({
  collectionId,
  initialBuild,
  onReady
}: Props) {
  const [build, setBuild] = useState<CollectionMatchBuild>(initialBuild);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/collections/${collectionId}/build`, {
            credentials: "include",
            cache: "no-store"
          });
          if (res.ok) {
            const body = (await res.json()) as {
              build: CollectionMatchBuild | null;
            };
            if (cancelled) return;
            if (!body.build) {
              onReadyRef.current();
              return;
            }
            setBuild(body.build);
          }
        } catch {
          // Network blip: keep polling.
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [collectionId]);

  const total = Math.max(build.total, build.scanned, 1);
  const percent = Math.min(100, Math.round((build.scanned / total) * 100));
  const timeLeft = describeTimeLeft(
    estimateSecondsLeft(build),
    build.scanned,
    build.total
  );

  return (
    <section className={styles.buildPanel} aria-live="polite">
      {build.kind === "catchUp" ? (
        <>
          <h2 className={styles.buildTitle}>Updating this collection</h2>
          <p className={styles.buildBody}>
            This collection hasn&apos;t been opened in a while, so it paused
            updating. We&apos;re checking the {formatCount(build.total)}{" "}
            emails that arrived since then against your rules.
          </p>
        </>
      ) : (
        <>
          <h2 className={styles.buildTitle}>Building this collection</h2>
          <p className={styles.buildBody}>
            We&apos;re checking all {formatCount(build.total)} emails in the
            archive against your rules. This only happens once. After that,
            opening it only checks emails that are new since your last visit.
          </p>
        </>
      )}
      <div
        className={styles.buildBar}
        role="progressbar"
        aria-label={
          build.kind === "catchUp"
            ? "Collection update progress"
            : "Collection build progress"
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={styles.buildBarFill} style={{ width: `${percent}%` }} />
      </div>
      <div className={styles.buildStats}>
        <span>
          {formatCount(Math.min(build.scanned, build.total))} of{" "}
          {formatCount(build.total)} emails checked
        </span>
        <strong>{timeLeft}</strong>
      </div>
      <p className={styles.buildNote}>
        You don&apos;t have to stay on this page. The build keeps running in
        the background, and a notice will pop up anywhere in Pirol when
        it&apos;s ready.
      </p>
    </section>
  );
}
