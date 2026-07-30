import { track } from "@vercel/analytics";

/**
 * Fire-and-forget sidebar nav-click tracking, called by each primary
 * left-panel nav button (`ExploreSidebar`) before it navigates. Records the
 * click against the button's stable `navId` so we can see which app surfaces
 * users explore, per user and in aggregate.
 *
 * The beacon never blocks or delays navigation, and a failed beacon is
 * silently ignored — tracking must never interfere with the click. Mirrors
 * `trackUpgradeClick` in ./upgrade-tracking.ts.
 */
export function trackNavClick(navId: string): void {
  try {
    track("nav_click", { navId });
    const payload = JSON.stringify({
      navId,
      path: typeof window !== "undefined" ? window.location.pathname : null
    });
    const url = "/api/track/nav-click";
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
