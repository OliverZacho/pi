"use client";

import { useEffect, useState } from "react";
import { TRIAL_PERIOD_DAYS } from "@/lib/trial";

/**
 * Whether to show this visitor the free-trial framing on Solo CTAs.
 *
 * Optimistic by design: it starts at `true`, because that's right for everyone
 * who has never subscribed (a logged-out visitor, and every new signup), and
 * only drops to `false` once `/api/billing/status` says the account has used
 * its one trial. A logged-out visitor gets a 401 and simply stays optimistic,
 * which is correct as far as we can know before they have an account.
 *
 * The cost of that optimism is a returning ex-trialer briefly seeing the trial
 * label before it settles. That's the cheap direction to be wrong in: checkout
 * runs the same `trialEligible` predicate server-side, so the worst case is a
 * label that corrects itself, never a trial we promised and didn't give.
 */
export function useTrialEligibility(): { eligible: boolean; days: number } {
  const [eligible, setEligible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { trialEligible?: boolean } | null) => {
        if (cancelled || !data) return;
        if (data.trialEligible === false) setEligible(false);
      })
      .catch(() => {
        // Never block a CTA on this — the optimistic label stands.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { eligible, days: TRIAL_PERIOD_DAYS };
}
