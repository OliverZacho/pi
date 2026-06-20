import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  searchBrands,
  type BrandsActivityWindow,
  type BrandsSearchParams,
  type BrandsSortKey
} from "@/lib/brands-explore-db";

const SORT_KEYS: BrandsSortKey[] = [
  "most_active",
  "recently_active",
  "recently_added",
  "name_asc",
  "name_desc"
];

const ACTIVITY_WINDOWS: BrandsActivityWindow[] = [
  "30d",
  "90d",
  "180d",
  "inactive"
];

/**
 * Public (no-auth) mirror of `/api/brands/list`, powering the browsable
 * directory for logged-out / unpaid visitors. Same query surface, but reads
 * via the service-role client (RLS would otherwise return nothing). Lists
 * every brand and paginates normally — the directory is meant to be fully
 * browsable; the per-brand data stays locked on the detail page.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const sortRaw = params.get("sort");
  const sort: BrandsSortKey =
    sortRaw && (SORT_KEYS as string[]).includes(sortRaw)
      ? (sortRaw as BrandsSortKey)
      : "most_active";

  const activityRaw = params.get("activity");
  const activity: BrandsActivityWindow | null =
    activityRaw && (ACTIVITY_WINDOWS as string[]).includes(activityRaw)
      ? (activityRaw as BrandsActivityWindow)
      : null;

  const countryRaw = params.get("country");
  const country =
    countryRaw && /^[A-Za-z]{2}$/.test(countryRaw)
      ? countryRaw.toUpperCase()
      : null;

  const search: BrandsSearchParams = {
    query: params.get("q") ?? undefined,
    markets: params.getAll("market").filter(Boolean),
    country,
    global: params.get("global") === "1",
    // ESP filtering is a paid feature — never honored on the public directory,
    // even if an `esp` query param is supplied directly.
    espProviders: [],
    cadenceMinDays: parseNonNegativeFloat(params.get("cadenceMin")),
    cadenceMaxDays: parseNonNegativeFloat(params.get("cadenceMax")),
    activity,
    minEmailCount: parseNonNegativeInt(params.get("minEmails")),
    hasLogo: params.get("hasLogo") === "1",
    subscribedAfter: params.get("after") ?? null,
    subscribedBefore: params.get("before") ?? null,
    sort,
    page: parsePositiveInt(params.get("page"), 1),
    pageSize: parsePositiveInt(params.get("pageSize"), 36)
  };

  try {
    const result = await searchBrands(getSupabaseAdmin(), search);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to search public brands", error);
    return NextResponse.json(
      { error: "Failed to search brands" },
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

function parseNonNegativeInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseNonNegativeFloat(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}
