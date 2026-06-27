import { track } from "@vercel/analytics";

/**
 * Fire-and-forget upgrade-click tracking, shared by every upgrade CTA
 * (`TrackedUpgradeLink`, `TeamUpgradeButton`, …). Records the click against a
 * stable `source` tag so the admin "Upgrades" dashboard can rank which CTAs
 * drive the most upgrade intent.
 *
 * The beacon never blocks or delays navigation, and a failed beacon is
 * silently ignored — tracking must never interfere with the click.
 */
export function trackUpgradeClick(source: string): void {
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
