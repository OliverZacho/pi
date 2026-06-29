"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { trackUpgradeClick } from "@/lib/upgrade-tracking";
import { useUpgradeModal } from "@/components/onboarding/UpgradeModalProvider";

/**
 * Every upgrade / subscribe / "View plans" CTA. It records the click (tagged
 * with a stable `source` so the admin "Upgrades" dashboard can rank which CTAs
 * drive the most upgrade intent), then opens the in-app plan picker modal so the
 * user can upgrade without leaving the page.
 *
 * TEMPORARY launch bridge: the modal runs the free-grant flow during the test
 * window. The element stays an `<a href="/pricing">` so a plain navigation is
 * still the fallback when JS is off or no modal provider is mounted, and so
 * cmd/ctrl/middle-click can still open the pricing page in a new tab. To restore
 * the old "always go to /pricing" behaviour, drop the modal `open()` branch.
 *
 * The tracking beacon is fire-and-forget (`sendBeacon`, falling back to a
 * keepalive fetch) so it never blocks the click, and a failed beacon is ignored.
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
  const upgradeModal = useUpgradeModal();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    trackUpgradeClick(source);
    // Let cmd/ctrl/middle-click open /pricing in a new tab as usual, and fall
    // back to plain navigation when no modal provider is mounted.
    if (
      !upgradeModal ||
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    upgradeModal.open();
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
