"use client";

import { useState } from "react";
import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
import styles from "./brand.module.css";
import quota from "@/components/explore/explore.module.css";

/**
 * Standalone Follow toggle for the locked (free-tier) brand dashboard.
 *
 * Free users can't see the analytics, but following is their feature —
 * it's what populates `/following` and gives them a reason to come back.
 * Mirrors the Follow half of `BrandHeroActions` (optimistic toggle over
 * the shared `brand_follows` endpoints) minus the comparison-group
 * popover, plus the free-tier cap handling: a 409 FOLLOW_LIMIT_REACHED
 * renders an upgrade nudge instead of silently reverting.
 */
export default function BrandFollowButton({
  brandId,
  initialFollowing
}: {
  brandId: string;
  initialFollowing: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [limitHit, setLimitHit] = useState(false);

  async function handleToggle() {
    if (pending) return;
    const next = !following;
    setPending(true);
    setFollowing(next);
    try {
      const res = await fetch(
        `/api/brand-follows/${encodeURIComponent(brandId)}`,
        { method: next ? "PUT" : "DELETE" }
      );
      if (!res.ok) {
        setFollowing(!next);
        if (res.status === 409) {
          const body = (await res.json().catch(() => null)) as {
            code?: string;
          } | null;
          if (body?.code === "FOLLOW_LIMIT_REACHED") setLimitHit(true);
        }
      }
    } catch {
      setFollowing(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.heroActions}>
      {limitHit ? (
        <div className={quota.saveQuota} role="alert">
          <span className={quota.saveQuotaText}>
            You follow the maximum number of brands on the free plan.
          </span>
          <TrackedUpgradeLink source="follow_quota" className={quota.saveQuotaCta}>
            View plans
          </TrackedUpgradeLink>
        </div>
      ) : null}
      <button
        type="button"
        className={following ? styles.actionGhost : styles.actionPrimary}
        onClick={() => void handleToggle()}
        disabled={pending}
        aria-pressed={following}
      >
        <span>{following ? "Following" : "Follow brand"}</span>
      </button>
    </div>
  );
}
