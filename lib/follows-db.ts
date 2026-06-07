import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "./storage";
import type { Database } from "@/types/supabase";

/**
 * Helpers for the per-user "follow brand" feature — the global signal
 * that drives the home feed, notifications, and digest emails.
 *
 * Follows are intentionally orthogonal to `competitor_sets`: a follow
 * is a single user/brand pair with no grouping semantics, while sets
 * are named cohorts used by the Compare tab. Keeping the two tables
 * decoupled means unfollowing never silently mutates a user's
 * analytical groups, and ad-hoc cohorts don't need to be followed.
 *
 * Every function takes the *user-bound* Supabase client (not the admin
 * one) so RLS scopes reads / writes to `auth.uid()` automatically. The
 * caller is responsible for verifying the user is authenticated and an
 * admin — see `requireAdminSession`.
 */

const MAX_BATCH_LOOKUP = 500;

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type FollowedBrandSummary = {
  id: string;
  name: string;
  domain: string | null;
  followedAt: string;
};

/**
 * Richer shape used by the `/following` grid: same minimum set of
 * fields the brand explorer card consumes (logo, markets) plus the
 * moment the user followed the brand so the page can sort by
 * "Recently followed". We keep the analytical fields (`primaryEsp`,
 * `avgDaysBetween`) out of this payload because computing them
 * requires the full captured-emails sweep that `searchBrands` does —
 * not worth the cost on a page that's already tightly scoped to the
 * user's follow list.
 */
export type FollowedBrandCard = {
  id: string;
  name: string;
  domain: string | null;
  markets: string[];
  /** Two-letter market country, for the flag chip on the card. */
  primaryMarketCountry: string | null;
  /** Brand operates globally rather than in a single market. */
  isGlobal: boolean;
  logoUrl: string | null;
  followedAt: string;
};

/**
 * Returns the set of `companies.id`s the current user follows.
 *
 * Accepts an optional pre-filter to keep the row count down when we
 * only care about the follow status of brands currently visible in a
 * grid. Passing `null` (or omitting it) returns *every* follow row for
 * the user.
 */
export async function listFollowedBrandIds(
  supabase: SupabaseClient<Database>,
  userId: string,
  scopedToCompanyIds?: string[] | null
): Promise<Set<string>> {
  let query = supabase
    .from("brand_follows")
    .select("company_id")
    .eq("user_id", userId);

  if (scopedToCompanyIds && scopedToCompanyIds.length > 0) {
    const ids = scopedToCompanyIds.slice(0, MAX_BATCH_LOOKUP);
    query = query.in("company_id", ids);
  }

  const { data, error } = await query;
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.company_id));
}

/**
 * Fast point-check used by the brand page to decide whether to render
 * "Follow" or "Following" without pulling the full follow list.
 */
export async function isBrandFollowed(
  supabase: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("brand_follows")
    .select("company_id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function followBrand(
  supabase: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<void> {
  const { error } = await supabase
    .from("brand_follows")
    .upsert(
      { user_id: userId, company_id: companyId },
      { onConflict: "user_id,company_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function unfollowBrand(
  supabase: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<void> {
  const { error } = await supabase
    .from("brand_follows")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (error) throw error;
}

/**
 * Returns every brand the user follows, ordered most-recently-followed
 * first. Used by the "Following" sidebar / page; mirrors the shape of
 * `listCompetitorSetSummaries` so the two collections render with the
 * same row component.
 */
export async function listFollowedBrands(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<FollowedBrandSummary[]> {
  const { data, error } = await supabase
    .from("brand_follows")
    .select(
      `created_at,
       company_id,
       companies!inner(id, name, domain, deleted_at)`
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const out: FollowedBrandSummary[] = [];
  for (const row of data ?? []) {
    const company = pickCompany(row.companies);
    if (!company || company.deleted_at) continue;
    out.push({
      id: company.id,
      name: company.name,
      domain: company.domain ?? null,
      followedAt: row.created_at
    });
  }
  return out;
}

/**
 * Same ordering as `listFollowedBrands` (most recently followed first)
 * but enriched with the brand's markets and a signed logo URL so the
 * `/following` grid can render full brand cards in a single round
 * trip. Mirrors the shape produced by `searchBrands` minus the
 * analytical tags so the same card markup can be reused.
 */
export async function listFollowedBrandCards(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<FollowedBrandCard[]> {
  const { data, error } = await supabase
    .from("brand_follows")
    .select(
      `created_at,
       company_id,
       companies!inner(id, name, domain, markets, primary_market_country, is_global, logo_storage_path, deleted_at)`
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = data ?? [];

  const logoPaths = new Set<string>();
  for (const row of rows) {
    const company = pickCompany(row.companies);
    if (company && !company.deleted_at && company.logo_storage_path) {
      logoPaths.add(company.logo_storage_path);
    }
  }
  const signed =
    logoPaths.size > 0
      ? await getSignedAssets(Array.from(logoPaths), {
          transform: BRAND_LOGO_TRANSFORM
        })
      : {};

  const cards: FollowedBrandCard[] = [];
  for (const row of rows) {
    const company = pickCompany(row.companies);
    if (!company || company.deleted_at) continue;
    const logoPath = company.logo_storage_path ?? null;
    cards.push({
      id: company.id,
      name: company.name,
      domain: company.domain ?? null,
      markets: Array.isArray(company.markets)
        ? company.markets.filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0
          )
        : [],
      primaryMarketCountry: company.primary_market_country ?? null,
      isGlobal: company.is_global ?? false,
      logoUrl: logoPath ? signed[logoPath] ?? null : null,
      followedAt: row.created_at
    });
  }
  return cards;
}

export function isValidCompanyId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

type CompanyRow = {
  id: string;
  name: string;
  domain?: string | null;
  markets?: string[] | null;
  primary_market_country?: string | null;
  is_global?: boolean | null;
  logo_storage_path?: string | null;
  deleted_at?: string | null;
};

type CompanyField = CompanyRow | CompanyRow[] | null | undefined;

function pickCompany(value: CompanyField) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
