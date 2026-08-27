"use client";

import { useEffect, useState } from "react";
import type { UserActivity } from "@/app/api/admin/user-activity/route";
import type {
  RecentSignup,
  SignupTier
} from "@/app/api/admin/recent-signups/route";

/**
 * Popout for the admin signups feed: click a user, see everything we capture
 * on them — profile timeline, plan, engagement counts (saves, collections,
 * follows, comparisons), sidebar nav clicks and upgrade-CTA clicks. Reuses
 * the global `.modal-backdrop` / `.modal` shell (see QualityDetailModal).
 */

const TIER_LABEL: Record<SignupTier, string> = {
  free: "Free",
  solo: "Solo",
  team: "Team"
};

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_TIME.format(parsed);
}

function providerLabel(provider: string | null): string | null {
  if (!provider) return null;
  if (provider === "google") return "Google";
  if (provider === "email") return "Email";
  return provider;
}

export default function AdminUserActivityModal({
  signup,
  onClose
}: {
  signup: RecentSignup;
  onClose: () => void;
}) {
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/user-activity?userId=${encodeURIComponent(signup.id)}`,
          { credentials: "include", signal: controller.signal }
        );
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const body = (await res.json()) as { activity?: UserActivity };
        if (body.activity) setActivity(body.activity);
        else setFailed(true);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [signup.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const a = activity;
  const hasEngagement =
    !!a &&
    (a.savedCount > 0 ||
      a.collections.length > 0 ||
      a.followedBrands.length > 0 ||
      a.competitorSets.length > 0 ||
      a.navClicks.length > 0 ||
      a.upgradeClicks.total > 0);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal user-activity-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Activity for ${signup.email}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{signup.name?.trim() || signup.email}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="modal-subtitle user-activity-subtitle">
          {signup.email}
          <span className={`admin-signup-badge tier-${a?.tier ?? signup.tier}`}>
            {TIER_LABEL[a?.tier ?? signup.tier]}
          </span>
        </p>

        {failed ? (
          <p className="muted">Couldn&apos;t load this user&apos;s activity.</p>
        ) : !a ? (
          <p className="muted">Loading activity…</p>
        ) : (
          <div className="user-activity-body">
            <dl className="user-activity-facts">
              <div>
                <dt>Joined</dt>
                <dd>
                  {formatWhen(a.profile.createdAt)}
                  {providerLabel(a.auth.provider)
                    ? ` via ${providerLabel(a.auth.provider)}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Last sign-in</dt>
                <dd>{formatWhen(a.auth.lastSignInAt)}</dd>
              </div>
              <div>
                <dt>Last active</dt>
                <dd>{formatWhen(a.profile.lastActiveAt)}</dd>
              </div>
              <div>
                <dt>Onboarding</dt>
                <dd>
                  {a.profile.onboardingCompletedAt
                    ? `Done ${formatWhen(a.profile.onboardingCompletedAt)}`
                    : "Not completed"}
                </dd>
              </div>
            </dl>

            <div className="user-activity-stats">
              <div className="user-activity-stat">
                <span className="user-activity-stat-num">{a.savedCount}</span>
                <span className="user-activity-stat-label">Saved</span>
              </div>
              <div className="user-activity-stat">
                <span className="user-activity-stat-num">
                  {a.collections.length}
                </span>
                <span className="user-activity-stat-label">Collections</span>
              </div>
              <div className="user-activity-stat">
                <span className="user-activity-stat-num">
                  {a.followedBrands.length}
                </span>
                <span className="user-activity-stat-label">Following</span>
              </div>
              <div className="user-activity-stat">
                <span className="user-activity-stat-num">
                  {a.competitorSets.length}
                </span>
                <span className="user-activity-stat-label">Comparisons</span>
              </div>
              <div className="user-activity-stat">
                <span className="user-activity-stat-num">
                  {a.upgradeClicks.total}
                </span>
                <span className="user-activity-stat-label">Upgrade clicks</span>
              </div>
            </div>

            {!hasEngagement ? (
              <p className="muted">
                No activity captured yet — signed up but hasn&apos;t engaged
                with the product.
              </p>
            ) : null}

            {a.navClicks.length > 0 ? (
              <section className="user-activity-section">
                <h3>Sidebar nav clicks</h3>
                <ul className="user-activity-list">
                  {a.navClicks.map((n) => (
                    <li key={n.navId}>
                      <span>{n.label}</span>
                      <span className="muted">
                        {n.count}× · last {formatWhen(n.lastAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {a.followedBrands.length > 0 ? (
              <section className="user-activity-section">
                <h3>Following</h3>
                <p className="user-activity-inline">
                  {a.followedBrands.join(", ")}
                </p>
              </section>
            ) : null}

            {a.collections.length > 0 ? (
              <section className="user-activity-section">
                <h3>Collections</h3>
                <ul className="user-activity-list">
                  {a.collections.map((c) => (
                    <li key={`${c.name}-${c.createdAt}`}>
                      <span>{c.name}</span>
                      <span className="muted">{formatWhen(c.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {a.competitorSets.length > 0 ? (
              <section className="user-activity-section">
                <h3>Comparisons</h3>
                <ul className="user-activity-list">
                  {a.competitorSets.map((s) => (
                    <li key={`${s.name}-${s.createdAt}`}>
                      <span>{s.name}</span>
                      <span className="muted">{formatWhen(s.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {a.upgradeClicks.recent.length > 0 ? (
              <section className="user-activity-section">
                <h3>Upgrade clicks</h3>
                <ul className="user-activity-list">
                  {a.upgradeClicks.recent.map((u, i) => (
                    <li key={`${u.createdAt}-${i}`}>
                      <span>{u.label}</span>
                      <span className="muted">{formatWhen(u.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
