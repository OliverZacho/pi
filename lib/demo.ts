/**
 * Designated "demo" content for the onboarding tour. So a brand-new UNPAID user
 * can click into the REAL in-app brand / collection / comparison views (not the
 * locked upsells) for exactly ONE item each, the detail pages compare the
 * requested slug/id against these constants — an O(1) check on the unpaid path
 * only, so paid users and list pages are never touched — and, on a match, render
 * the real page with service-role-fetched data.
 *
 * The collection + comparison rows are seeded with these exact fixed UUIDs (see
 * migration 20260629110000_demo_tour_content). The brand is an existing company
 * (ARKET — the richest dataset), referenced by its slug.
 *
 * Pure constants only (no "use client" / "server-only"), so both the server
 * pages and the client tour can import them.
 */
export const DEMO_BRAND_SLUG = "arket";
export const DEMO_COLLECTION_ID = "00000000-dec0-4011-8000-000000000001";
export const DEMO_COMPARISON_ID = "00000000-dec0-4c12-8000-000000000002";

/** Route into the demo brand's full dashboard. */
export const DEMO_BRAND_PATH = `/brands/${DEMO_BRAND_SLUG}`;
/** Route into the demo collection detail. */
export const DEMO_COLLECTION_PATH = `/collections/${DEMO_COLLECTION_ID}`;
/** Route into the demo comparison detail. */
export const DEMO_COMPARISON_PATH = `/compare/${DEMO_COMPARISON_ID}`;
