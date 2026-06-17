"use client";

import Link from "next/link";
import { track } from "@vercel/analytics";
import type { ReactNode } from "react";

/**
 * A `/pricing` (or custom-href) link that records the click before navigating,
 * tagged with a stable `source` so the admin "Upgrades" dashboard can rank
 * which CTAs drive the most upgrade intent.
 *
 * Use this for every upgrade / subscribe / "View plans" CTA. The beacon is
 * fire-and-forget (`sendBeacon`, falling back to a keepalive fetch) so it never
 * blocks or delays the navigation, and a failed beacon is silently ignored.
 */
export default function TrackedUpgradeLink({
  source,
  href = "/pricing",
  className,
  children,
  title,
  "aria-label": ariaLabel
}: {
  source: string;
  href?: string;
  className?: string;
  children: ReactNode;
  title?: string;
  "aria-label"?: string;
}) {
  function handleClick() {
    try {
      track("upgrade_click", { source });
      const payload = JSON.stringify({
        source,
        path: typeof window !== "undefined" ? window.location.pathname : null
      });
      const url = "/api/track/upgrade-click";
      const sent =
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(
          url,
          new Blob([payload], { type: "application/json" })
        );
      if (!sent) {
        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true
        }).catch(() => {});
      }
    } catch {
      // Never let tracking interfere with the click.
    }
  }

  return (
    <Link
      href={href}
      className={className}
      onClick={handleClick}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}
