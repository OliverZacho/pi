"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  RecentSignup,
  SignupTier
} from "@/app/api/admin/recent-signups/route";
import AdminUserActivityModal from "./AdminUserActivityModal";

/**
 * Admin sidebar feed of the most recent signups and their plan tier
 * (Free / Solo / Team). Fetched once on mount — not a live stream — so it
 * shows who joined since you last opened the Admin Center. Rows created
 * after the admin's previous visit are flagged "new" (green dot + header
 * count); the last-seen marker is a timestamp in localStorage so the flags
 * clear on the next visit. Lives in the admin left rail above Sign out.
 */

const LAST_SEEN_KEY = "pirol:admin-signups-last-seen";

const TIER_LABEL: Record<SignupTier, string> = {
  free: "Free",
  solo: "Solo",
  team: "Team"
};

function readLastSeen(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_KEY);
    const ms = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}

export default function AdminSignupsFeed() {
  const [signups, setSignups] = useState<RecentSignup[] | null>(null);
  // Clicked row → activity popout showing everything we capture on them.
  const [selected, setSelected] = useState<RecentSignup | null>(null);
  // Captured once on mount so the "new since last visit" markers stay stable
  // for this render even after we advance the stored marker below.
  const [lastSeen] = useState<number>(readLastSeen);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/admin/recent-signups", {
          credentials: "include",
          signal: controller.signal
        });
        if (!res.ok) return;
        const body = (await res.json()) as { signups?: RecentSignup[] };
        setSignups(Array.isArray(body.signups) ? body.signups : []);
      } catch {
        // Network hiccup — the feed just stays hidden for this render.
      }
    })();
    return () => controller.abort();
  }, []);

  // Once we've shown the feed, advance the last-seen marker to the newest
  // signup so its "new" flag clears next visit. Runs after render, so the
  // current render still reflects the pre-visit `lastSeen`.
  useEffect(() => {
    if (!signups || signups.length === 0) return;
    const newest = signups.reduce(
      (max, s) => Math.max(max, Date.parse(s.createdAt) || 0),
      0
    );
    if (newest > 0) {
      try {
        window.localStorage.setItem(
          LAST_SEEN_KEY,
          new Date(newest).toISOString()
        );
      } catch {
        // Storage blocked — markers just won't clear; harmless.
      }
    }
  }, [signups]);

  const newCount = useMemo(() => {
    if (!signups) return 0;
    return signups.filter((s) => (Date.parse(s.createdAt) || 0) > lastSeen)
      .length;
  }, [signups, lastSeen]);

  if (!signups || signups.length === 0) return null;

  return (
    <div className="admin-signups" role="status" aria-label="Recent signups">
      <div className="admin-signups-header">
        <span className="admin-signups-title">New signups</span>
        {newCount > 0 ? (
          <span className="admin-signups-count">{newCount} new</span>
        ) : null}
      </div>
      <ul className="admin-signups-list">
        {signups.map((s) => {
          const isNew = (Date.parse(s.createdAt) || 0) > lastSeen;
          const display = s.name?.trim() || s.email;
          return (
            <li key={s.id}>
              <button
                type="button"
                className="admin-signup-row"
                onClick={() => setSelected(s)}
                aria-haspopup="dialog"
              >
                <span
                  className={`admin-signup-dot${isNew ? "" : " is-seen"}`}
                  aria-hidden="true"
                />
                <span className="admin-signup-info">
                  <span className="admin-signup-name" title={s.email}>
                    {display}
                  </span>
                  <span className="admin-signup-meta">
                    {relativeTime(s.createdAt)}
                  </span>
                </span>
                <span className={`admin-signup-badge tier-${s.tier}`}>
                  {TIER_LABEL[s.tier]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <AdminUserActivityModal
          signup={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
