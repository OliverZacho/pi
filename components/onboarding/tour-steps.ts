/**
 * The onboarding product tour: an ordered list of "stops" shown to brand-new
 * signups before the forced plan-choice modal. Each stop names the route it
 * lives on, a stable `[data-tour]` anchor to spotlight, and the copy for its
 * tooltip. The controller (see {@link "./TourProvider"}) navigates to `route`
 * when needed, waits for `anchor` to mount, then drives driver.js to highlight
 * it — so the user walks the real app, not a mirrored copy.
 *
 * Most stops are informational (read + Next). A few are `interactive`: the
 * spotlighted element stays clickable and the tour advances when the user does
 * the thing (e.g. opens an email). Next always stays available as a fallback so
 * the user is never stuck.
 *
 * Anchors are deliberately chosen to exist for a brand-new *unpaid* user:
 *  - explore filters/sort, the email cards and the brands grid render in the
 *    public/teaser shells;
 *  - the sidebar nav rows + the "Need help?" button are present on every app
 *    page regardless of access.
 * (Collections / Compare show a locked upsell for unpaid users, so those stops
 * point at the always-present sidebar row rather than gated page content — until
 * Phase 2 gives them real demo items to click into.)
 */

import type { Side, Alignment } from "driver.js";
import {
  DEMO_BRAND_PATH,
  DEMO_BRAND_SLUG,
  DEMO_COLLECTION_PATH,
  DEMO_COMPARISON_PATH
} from "@/lib/demo";

export type TourStep = {
  /** Route this stop lives on. The controller navigates here first. */
  route: string;
  /**
   * CSS selector for the element to spotlight. Empty string → a centered
   * popover with no spotlight (used for the welcome intro).
   */
  anchor: string;
  title: string;
  body: string;
  /** Which side of the anchor the tooltip sits on. */
  side?: Side;
  align?: Alignment;
  /**
   * Keep the spotlighted element clickable (driver's active-interaction stays
   * on for this stop). Pair with `advance` to move on when the user acts.
   */
  interactive?: boolean;
  /**
   * Special handling for the full-email preview. `"email-modal"` drops driver's
   * overlay while the preview is open (it renders below the scrim) and restores
   * this stop's spotlight on close. It does NOT auto-advance — the user moves on
   * with Next. Omitted → no modal handling.
   */
  advance?: "email-modal";
  /** Scroll the window to the top before highlighting (for fixed top-bar UI). */
  scrollTop?: boolean;
  /**
   * Extra class(es) for this stop's popover. Use to override placement — e.g.
   * the brand dashboard pins the tooltip to a fixed corner so it stays put
   * while the user scrolls the (tall, fully-spotlit) page. Include the base
   * "pirol-tour" class since this replaces the default popover class.
   */
  popoverClass?: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    route: "/explore",
    anchor: "",
    title: "Welcome to Pirol 👋",
    body: "Pirol is a living archive of how real brands run their email marketing. Here's a quick tour of what you can do — use Next to move along, or skip anytime.",
    align: "center"
  },
  {
    route: "/explore",
    anchor: '[data-tour="explore-filters"]',
    title: "Browse every recent email",
    body: "This is your feed of the latest marketing emails — search and filter by brand, category or content type to zero in on what you want to study.",
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
    route: "/explore",
    anchor: '[data-tour="email-card"]',
    title: "Open any email",
    body: "Go ahead — click a card to read the full email, exactly as it landed in the inbox. Close it when you're done, then hit Next.",
    side: "right",
    align: "start",
    interactive: true,
    advance: "email-modal"
  },
  {
    // Interactive: spotlight the demo brand's card (anchored by href, so we
    // grab ARKET specifically, not whichever card happens to be first) and
    // invite the click. Clicking navigates to its real dashboard — the next
    // stop — and the tour advances on arrival. Next stays as a fallback.
    route: "/brands",
    anchor: `a[href="${DEMO_BRAND_PATH}"]`,
    title: "Open a brand page",
    body: `Go ahead — click ${DEMO_BRAND_SLUG.toUpperCase()} to open its brand page. You'll see the real dashboard, free.`,
    side: "right",
    align: "start",
    interactive: true
  },
  {
    // Spotlight the whole dashboard (the <main>) so every chart is lit, and pin
    // the tooltip to a fixed corner — driver doesn't lock wheel-scroll, so the
    // user can scroll down through all the graphs while the tooltip stays put.
    route: DEMO_BRAND_PATH,
    anchor: '[data-tour="brand-stats"]',
    title: "A full brand dashboard",
    body: "Scroll down to explore ARKET's full dashboard — send volume, cadence, busiest times, category mix, design and discount patterns.",
    popoverClass: "pirol-tour pirol-tour-pinned"
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
    // Drops the user straight into a real demo collection (rendered to unpaid
    // users only for this one designated id) so they see the actual feature.
    route: DEMO_COLLECTION_PATH,
    anchor: '[data-tour="collection-demo"]',
    title: "Save into collections",
    body: "Group emails into collections to study a campaign or theme. This is a real one — every card is a captured send.",
    side: "bottom",
    align: "start"
  },
  {
    route: DEMO_COMPARISON_PATH,
    anchor: '[data-tour="compare-demo"]',
    title: "Compare brands side by side",
    body: "Put brands head to head to see how their strategies differ. Here's a live comparison to explore.",
    side: "bottom",
    align: "start"
  },
  {
    route: "/explore",
    anchor: '[data-tour="help-button"]',
    title: "Help is always here",
    body: "Stuck or curious? Open “Need help?” any time for video tutorials, guides and support.",
    side: "left",
    align: "start",
    scrollTop: true
  }
];
