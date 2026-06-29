/**
 * The onboarding product tour: an ordered list of "stops" shown to brand-new
 * signups before the forced plan-choice modal. Each stop names the route it
 * lives on, a stable `[data-tour]` anchor to spotlight, and the copy for its
 * tooltip. The controller (see {@link "./TourProvider"}) navigates to `route`
 * when needed, waits for `anchor` to mount, then drives driver.js to highlight
 * it — so the user walks the real app, not a mirrored copy.
 *
 * Anchors are deliberately chosen to exist for a brand-new *unpaid* user:
 *  - explore filters/sort + the brands grid render in the public/teaser shells;
 *  - the sidebar nav rows are present on every app page regardless of access.
 * (Collections / Compare show a locked upsell for unpaid users, so those stops
 * point at the always-present sidebar row rather than gated page content.)
 */

import type { Side, Alignment } from "driver.js";

export type TourStep = {
  /** Route this stop lives on. The controller navigates here first. */
  route: string;
  /** CSS selector for the element to spotlight. Must exist on `route`. */
  anchor: string;
  title: string;
  body: string;
  /** Which side of the anchor the tooltip sits on. */
  side?: Side;
  align?: Alignment;
};

export const TOUR_STEPS: TourStep[] = [
  {
    route: "/explore",
    anchor: '[data-tour="explore-filters"]',
    title: "Browse every recent email",
    body: "This is your feed of the latest marketing emails. Search, then narrow by brand, category or content type to zero in on what you want to study.",
    side: "bottom",
    align: "start"
  },
  {
    route: "/explore",
    anchor: '[data-tour="explore-sort"]',
    title: "Sort the feed",
    body: "Reorder the feed by newest, oldest, or our recommended mix.",
    side: "bottom",
    align: "end"
  },
  {
    route: "/brands",
    anchor: '[data-tour="brands-grid"]',
    title: "Every sender has a brand page",
    body: "Open any brand to see its full sending history, cadence and stats in one place.",
    side: "top",
    align: "start"
  },
  {
    route: "/following",
    anchor: '[data-tour="nav-following"]',
    title: "Follow the brands you care about",
    body: "Brands you follow gather here, so you can skim their latest sends in one feed.",
    side: "right",
    align: "start"
  },
  {
    route: "/collections",
    anchor: '[data-tour="nav-collections"]',
    title: "Save into collections",
    body: "Group emails into collections for later. Some build themselves automatically — or make your own.",
    side: "right",
    align: "start"
  },
  {
    route: "/compare",
    anchor: '[data-tour="nav-compare"]',
    title: "Compare brands side by side",
    body: "Put two or more brands head to head to see how their email strategies differ.",
    side: "right",
    align: "start"
  },
  {
    route: "/explore",
    anchor: '[data-tour="nav-explore"]',
    title: "That's the tour!",
    body: "Pick a plan to dive in — you can change it anytime.",
    side: "right",
    align: "start"
  }
];
