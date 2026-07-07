import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  searchExploreEmails,
  type ExploreSearchParams,
  type ExploreSortKey
} from "@/lib/explore-db";

const SORT_KEYS: ExploreSortKey[] = [
  "recommended",
  "newest",
  "oldest",
  "brand_asc",
  "brand_desc",
  "discount_desc"
];

/**
 * Public (no-auth) Explore search powering the logged-out / unpaid teaser.
 *
 * Same query surface as `/api/explore/emails`, but:
 *  - reads through the service-role client (RLS would otherwise return
 *    nothing for an anonymous request);
 *  - hard-caps the result set to {@link PUBLIC_RESULT_CAP} and never serves
 *    a second page, so the teaser shows a fixed slice no matter the filters.
 *
 * Search spans the whole archive by design (product decision); the matching
 * render route serves the previews. Tighten both to curated-only if the
 * exposure needs to shrink.
 */
const PUBLIC_RESULT_CAP = 16;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const sortRaw = params.get("sort");
  const sort: ExploreSortKey =
    sortRaw && (SORT_KEYS as string[]).includes(sortRaw)
      ? (sortRaw as ExploreSortKey)
      : "recommended";

  // Explicit id lookups power deep links (notification emails open
  // `/explore?email=<id>`); without this the fallback fetch silently
  // returned the first recommended email instead of the linked one.
  const emailIds = params.getAll("id").filter(Boolean);

  const search: ExploreSearchParams = {
    query: params.get("q") ?? undefined,
    emailIds: emailIds.length > 0 ? emailIds : undefined,
    brandIds: params.getAll("brand").filter(Boolean),
    markets: params.getAll("market").filter(Boolean),
    categories: params.getAll("category").filter(Boolean),
    colors: params.getAll("color").filter(Boolean),
    hasGif: params.get("hasGif") === "1",
    hasDarkMode: params.get("hasDarkMode") === "1",
    receivedAfter: params.get("after") ?? null,
    receivedBefore: params.get("before") ?? null,
    sort,
    // Always the first page, always capped — the teaser never paginates.
    page: 1,
    pageSize: PUBLIC_RESULT_CAP
  };

  try {
    const result = await searchExploreEmails(getSupabaseAdmin(), search);
    // Force `hasMore: false` so any client never tries to load page 2.
    return NextResponse.json({ ...result, hasMore: false });
  } catch (error) {
    console.error("Failed to search public Explore emails", error);
    return NextResponse.json(
      { error: "Failed to search Explore emails" },
      { status: 500 }
    );
  }
}
