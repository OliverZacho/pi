/**
 * Client-safe pieces of the sidebar notice system: the notice shape and
 * the pure usage-card builders. Split from `sidebar-notices.ts` so the
 * client sidebar can rebuild the free save-usage card locally (after an
 * optimistic save/unsave) without pulling the server-only query modules
 * into the bundle. `sidebar-notices.ts` re-exports everything here, so
 * server code keeps importing from one place.
 */

export type SidebarNotice = {
  id: string;
  kind: "save-usage" | "brand-request" | "team-joined" | "follow-activity";
  title: string;
  /** Muted second line under the title, or `null` for title-only. */
  detail: string | null;
  cta: { label: string; href: string } | null;
  /** Dismissible notices show an ✕; persistent ones (the save cap) don't. */
  dismissible: boolean;
  /** Drives the progress bar on the free save-usage card. */
  progress?: { count: number; limit: number };
};

/** How close to the cap the copy switches to "only N left" urgency. */
export const SAVE_CAP_WARNING_WINDOW = 5;

/**
 * The free-tier base card: progress toward the save cap, escalating as
 * the user approaches it. Pure so the threshold copy is unit-testable.
 */
export function saveUsageNotice(count: number, limit: number): SidebarNotice {
  const remaining = Math.max(0, limit - count);
  let title: string;
  let detail: string;
  if (remaining === 0) {
    title = `You've used all ${limit} free saves`;
    detail = "Upgrade for unlimited saving";
  } else if (remaining <= SAVE_CAP_WARNING_WINDOW) {
    title = `Only ${remaining} free ${remaining === 1 ? "save" : "saves"} left`;
    detail = "Upgrade for unlimited saving";
  } else {
    title = `${count} of ${limit} free saves used`;
    detail = "Upgrade for unlimited use";
  }
  return {
    id: "save-usage",
    kind: "save-usage",
    title,
    detail,
    cta: { label: "Upgrade", href: "/pricing" },
    dismissible: false,
    progress: { count: Math.min(count, limit), limit }
  };
}

/**
 * Free-tier follow meter. Unlike the always-on save card, this one only
 * appears once the user is close to (or at) the cap — two permanent
 * meters would crowd the slot, and a user following a handful of brands
 * doesn't need a countdown. Pure for unit testing; returns `null` while
 * the user is comfortably under the cap.
 */
export function followUsageNotice(
  count: number,
  limit: number
): SidebarNotice | null {
  const remaining = Math.max(0, limit - count);
  if (remaining > SAVE_CAP_WARNING_WINDOW) return null;
  let title: string;
  if (remaining === 0) {
    title = `You follow all ${limit} free brands`;
  } else {
    title = `Only ${remaining} free ${
      remaining === 1 ? "follow" : "follows"
    } left`;
  }
  return {
    id: "follow-usage",
    kind: "save-usage",
    title,
    detail: "Upgrade to follow unlimited brands",
    cta: { label: "Upgrade", href: "/pricing" },
    dismissible: false,
    progress: { count: Math.min(count, limit), limit }
  };
}
