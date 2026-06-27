"use client";

import { useState, type ReactNode } from "react";
import { trackUpgradeClick } from "@/lib/upgrade-tracking";

/**
 * An upgrade CTA that starts the Team-plan upgrade directly — no detour
 * through `/pricing`. Records the click (tagged with `source`) then kicks off
 * checkout. On success it reloads the page so the now-entitled owner lands
 * back where they were with the feature unlocked.
 *
 * TEMPORARY launch bridge: during the external-test window upgrades grant a
 * free, time-boxed entitlement via `/api/free-upgrade` instead of opening
 * Stripe checkout — same as `components/marketing/Pricing.tsx`. To restore the
 * real paid path, revert both to POST `/api/checkout` (body
 * `{ plan: "team", billing }`) and `window.location.assign(data.url)` to the
 * returned Stripe Checkout url.
 */
export default function TeamUpgradeButton({
  source,
  className,
  title,
  children,
  onError
}: {
  source: string;
  className?: string;
  title?: string;
  children: ReactNode;
  /** Surface failures in the host's existing error banner. */
  onError?: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    trackUpgradeClick(source);
    setPending(true);
    onError?.("");
    try {
      const res = await fetch("/api/free-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "team" })
      });
      // Not signed in — send them to log in, then back to this page.
      if (res.status === 401) {
        const next =
          typeof window !== "undefined" ? window.location.pathname : "/";
        window.location.assign(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      const data: { ok?: boolean; error?: string } = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Could not complete upgrade");
      }
      // Reload so the server re-evaluates entitlement and swaps the locked
      // upsell for the live share toggle.
      window.location.reload();
    } catch (err) {
      onError?.(
        err instanceof Error ? err.message : "Could not complete upgrade"
      );
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={pending}
      title={title}
    >
      {children}
    </button>
  );
}
