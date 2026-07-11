"use client";

import { useState, type ReactNode } from "react";
import { trackUpgradeClick } from "@/lib/upgrade-tracking";

/**
 * An upgrade CTA that starts the Team-plan upgrade directly — no detour
 * through `/pricing`. Records the click (tagged with `source`) then opens
 * Stripe Checkout for the annual Team plan (the marketing default; the pricing
 * page is where a monthly/annual choice is made). On success the browser is
 * redirected to the returned Checkout url.
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
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "team", billing: "annual" })
      });
      // Not signed in — send them to sign up, then back to this page.
      if (res.status === 401) {
        const next =
          typeof window !== "undefined" ? window.location.pathname : "/";
        window.location.assign(`/signup?next=${encodeURIComponent(next)}`);
        return;
      }
      const data: { url?: string; error?: string } = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Could not complete upgrade");
      }
      // Hand off to Stripe Checkout.
      window.location.assign(data.url);
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
