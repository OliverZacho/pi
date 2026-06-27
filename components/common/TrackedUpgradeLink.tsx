"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trackUpgradeClick } from "@/lib/upgrade-tracking";

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
  return (
    <Link
      href={href}
      className={className}
      onClick={() => trackUpgradeClick(source)}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}
