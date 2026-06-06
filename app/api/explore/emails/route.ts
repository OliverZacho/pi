import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import {
  searchExploreEmails,
  type ExploreSearchParams,
  type ExploreSortKey
} from "@/lib/explore-db";

const SORT_KEYS: ExploreSortKey[] = [
  "newest",
  "oldest",
  "brand_asc",
  "brand_desc",
  "discount_desc"
];

/**
 * Paged Explore search. The client calls this on every filter / sort
 * change and on infinite-scroll page bumps. Returns a slim card payload
 * matching the existing `ExploreEmailCard` shape so the UI doesn't have
 * to fan out per row.
 */
export async function GET(request: Request) {
  const session = await requireAdminSession();
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

  const search: ExploreSearchParams = {
    query: params.get("q") ?? undefined,
    emailIds: emailIds.length > 0 ? emailIds : undefined,
    brandIds: params.getAll("brand").filter(Boolean),
    markets: params.getAll("market").filter(Boolean),
    categories: params.getAll("category").filter(Boolean),
    hasGif: params.get("hasGif") === "1",
    hasDarkMode: params.get("hasDarkMode") === "1",
    receivedAfter: params.get("after") ?? null,
    receivedBefore: params.get("before") ?? null,
    sort,
    page: parsePositiveInt(params.get("page"), 1),
    pageSize: parsePositiveInt(params.get("pageSize"), 36)
  };

  try {
    const result = await searchExploreEmails(session.supabase, search);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to search Explore emails", error);
    return NextResponse.json(
      { error: "Failed to search Explore emails" },
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
