import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { listFollowedBrandIds } from "@/lib/follows-db";
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
 * Follow-scoped Explore search. Same paged card payload as
 * `/api/explore/emails`, but the result set is hard-restricted to the
 * brands the current user follows. The follow list is resolved
 * server-side from `auth.uid()` so the client can't widen the scope by
 * tampering with the request — the in-view brand / market chips can only
 * narrow within it.
 */
export async function GET(request: Request) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  const sortRaw = params.get("sort");
  const sort: ExploreSortKey =
    sortRaw && (SORT_KEYS as string[]).includes(sortRaw)
      ? (sortRaw as ExploreSortKey)
      : "newest";

  const emailIds = params.getAll("id").filter(Boolean);

  try {
    const followedIds = await listFollowedBrandIds(
      session.supabase,
      session.user.id
    );

    const search: ExploreSearchParams = {
      query: params.get("q") ?? undefined,
      emailIds: emailIds.length > 0 ? emailIds : undefined,
      restrictBrandIds: Array.from(followedIds),
      brandIds: params.getAll("brand").filter(Boolean),
      markets: params.getAll("market").filter(Boolean),
      categories: params.getAll("category").filter(Boolean),
      hasGif: params.get("hasGif") === "1",
      hasDarkMode: params.get("hasDarkMode") === "1",
      receivedAfter: params.get("after") ?? null,
      receivedBefore: params.get("before") ?? null,
      sort,
      page: parsePositiveInt(params.get("page"), 1),
      pageSize: parsePositiveInt(params.get("pageSize"), 24)
    };

    const result = await searchExploreEmails(session.supabase, search);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to search followed-brand emails", error);
    return NextResponse.json(
      { error: "Failed to search followed-brand emails" },
      { status: 500 }
    );
  }
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}
