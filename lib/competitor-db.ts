import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrandPageData, type BrandPageData } from "./brand-db";
import { getSignedAssets } from "./storage";
import type { Database } from "@/types/supabase";

/**
 * Helpers for the user-owned Competitor Sets feature.
 *
 * A competitor set is a private, named group of `companies` rows owned
 * by a single admin user. The Compare tab uses these sets to render
 * side-by-side analytics for the contained brands.
 *
 * Unlike `collections`, sets are *private* (no share slug, no `anon`
 * access). RLS — defined in the matching migration — scopes every
 * read / write to `auth.uid()` plus a row in `admin_users`.
 */

const MAX_NAME_LENGTH = 120;

/**
 * Maximum number of brands the compare dashboard will render at once.
 * The dashboard's aggregate views (stacked send-frequency bars,
 * aggregated KPI tiles with per-brand drill-down) keep crowding bounded
 * even when the cohort is sizable, so 20 strikes a good balance: large
 * enough to model a category-wide benchmark, small enough that the
 * per-brand heatmap rows + drill-down legend stay readable.
 */
export const MAX_BRANDS_PER_COMPARISON = 20;

/**
 * Sidebar / picker shape — just enough metadata to render the row.
 */
export type CompetitorSetSummary = {
  id: string;
  name: string;
  brandCount: number;
  updatedAt: string;
};

export type CompetitorSetBrand = {
  id: string;
  name: string;
  domain: string | null;
  /**
   * All market / category tags attached to the brand (lower-cased
   * slugs). Empty when the brand is uncategorised. Replaces the previous
   * scalar `market` field — brands can now sit in multiple categories.
   */
  markets: string[];
  logoUrl: string | null;
};

export type CompetitorSetDetail = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  brands: CompetitorSetBrand[];
};

/**
 * Result of `getCompetitorComparison`. The dashboard receives a parallel
 * list of `BrandPageData` (one per requested brand) so every chart can
 * reuse the existing per-brand helpers in `brand-db.ts`. Missing /
 * deleted brand ids are silently dropped — the caller's responsibility
 * to render an appropriate "X is no longer tracked" hint when the
 * requested vs. returned counts differ.
 */
export type CompetitorComparison = {
  brands: BrandPageData[];
  missing: string[];
};

/**
 * Returns every competitor set the user owns, ordered most-recently-
 * updated first to match the sidebar's expected display order. Member
 * counts are pulled in a second query and folded in client-side; this
 * keeps the SELECT trivial and skips a (more expensive) group-by while
 * users have at most a few dozen sets.
 */
export async function listCompetitorSetSummaries(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<CompetitorSetSummary[]> {
  const { data, error } = await supabase
    .from("competitor_sets")
    .select("id, name, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const setIds = rows.map((row) => row.id);
  const { data: memberRows, error: memberError } = await supabase
    .from("competitor_set_members")
    .select("set_id")
    .in("set_id", setIds);

  if (memberError) throw memberError;

  const counts = new Map<string, number>();
  for (const row of memberRows ?? []) {
    counts.set(row.set_id, (counts.get(row.set_id) ?? 0) + 1);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brandCount: counts.get(row.id) ?? 0,
    updatedAt: row.updated_at
  }));
}

/**
 * Owner-side detail view used by `/compare/[id]`. Returns `null` when
 * the set doesn't exist or doesn't belong to `userId` so the page can
 * 404 cleanly.
 */
export async function getCompetitorSetForOwner(
  supabase: SupabaseClient<Database>,
  userId: string,
  setId: string
): Promise<CompetitorSetDetail | null> {
  const { data: setRow, error: setError } = await supabase
    .from("competitor_sets")
    .select("id, name, user_id, created_at, updated_at")
    .eq("id", setId)
    .eq("user_id", userId)
    .maybeSingle();

  if (setError) throw setError;
  if (!setRow) return null;

  const brands = await loadSetBrands(supabase, setId);

  return {
    id: setRow.id,
    name: setRow.name,
    ownerId: setRow.user_id,
    createdAt: setRow.created_at,
    updatedAt: setRow.updated_at,
    brands
  };
}

/**
 * Create a competitor set + bulk-add its initial brand members.
 *
 * Two-step write because PostgREST doesn't support transactions over
 * the wire. If the membership insert fails after the parent row was
 * created we roll back by deleting the orphan set so the caller never
 * ends up with an empty set it didn't intend to keep.
 */
export async function createCompetitorSet(
  supabase: SupabaseClient<Database>,
  userId: string,
  args: { name: string; brandIds: string[] }
): Promise<CompetitorSetDetail> {
  const name = sanitizeName(args.name);
  const brandIds = dedupeBrandIds(args.brandIds).slice(
    0,
    MAX_BRANDS_PER_COMPARISON
  );

  const { data: inserted, error: insertError } = await supabase
    .from("competitor_sets")
    .insert({ user_id: userId, name })
    .select("id, name, user_id, created_at, updated_at")
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to create competitor set");
  }

  if (brandIds.length > 0) {
    const rows = brandIds.map((companyId) => ({
      set_id: inserted.id,
      company_id: companyId
    }));
    const { error: memberError } = await supabase
      .from("competitor_set_members")
      .insert(rows);
    if (memberError) {
      // Roll back the parent row so we don't leave dangling empty sets
      // behind when the membership write fails (e.g. one of the
      // company ids doesn't exist any more).
      await supabase
        .from("competitor_sets")
        .delete()
        .eq("id", inserted.id)
        .eq("user_id", userId);
      throw memberError;
    }
  }

  const brands = await loadSetBrands(supabase, inserted.id);

  return {
    id: inserted.id,
    name: inserted.name,
    ownerId: inserted.user_id,
    createdAt: inserted.created_at,
    updatedAt: inserted.updated_at,
    brands
  };
}

export async function renameCompetitorSet(
  supabase: SupabaseClient<Database>,
  userId: string,
  setId: string,
  rawName: string
): Promise<CompetitorSetSummary | null> {
  const name = sanitizeName(rawName);
  const { data, error } = await supabase
    .from("competitor_sets")
    .update({ name })
    .eq("id", setId)
    .eq("user_id", userId)
    .select("id, name, updated_at")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  // We don't fetch the member count here — the caller can hit
  // `listCompetitorSetSummaries` if it needs the full sidebar row. Most
  // callers (rename API, inline rename) only care that the write
  // succeeded and that they have the new name back.
  return {
    id: data.id,
    name: data.name,
    brandCount: 0,
    updatedAt: data.updated_at
  };
}

export async function deleteCompetitorSet(
  supabase: SupabaseClient<Database>,
  userId: string,
  setId: string
): Promise<boolean> {
  const { error, count } = await supabase
    .from("competitor_sets")
    .delete({ count: "exact" })
    .eq("id", setId)
    .eq("user_id", userId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Idempotent membership add. Validates ownership first so a request for
 * a set the caller doesn't own returns `missing` (→ 404) rather than
 * leaking the existence of the set via a 403/permission error from
 * PostgREST.
 */
export async function addBrandsToSet(
  supabase: SupabaseClient<Database>,
  userId: string,
  setId: string,
  brandIds: string[]
): Promise<
  | { status: "missing" }
  | { status: "ok"; brands: CompetitorSetBrand[]; addedCount: number }
  | { status: "full" }
> {
  const owned = await assertSetOwnership(supabase, userId, setId);
  if (!owned) return { status: "missing" };

  const cleaned = dedupeBrandIds(brandIds);
  if (cleaned.length === 0) {
    const brands = await loadSetBrands(supabase, setId);
    return { status: "ok", brands, addedCount: 0 };
  }

  // Count existing members so we can reject the request when adding
  // would push the set past `MAX_BRANDS_PER_COMPARISON`. PostgREST has
  // no convenient atomic "insert up to N" primitive so we do this in
  // two reads + one write.
  const { count: existingCount, error: countError } = await supabase
    .from("competitor_set_members")
    .select("set_id", { count: "exact", head: true })
    .eq("set_id", setId);

  if (countError) throw countError;
  const currentCount = existingCount ?? 0;

  if (currentCount + cleaned.length > MAX_BRANDS_PER_COMPARISON) {
    return { status: "full" };
  }

  const rows = cleaned.map((companyId) => ({
    set_id: setId,
    company_id: companyId
  }));
  const { error: insertError } = await supabase
    .from("competitor_set_members")
    .upsert(rows, {
      onConflict: "set_id,company_id",
      ignoreDuplicates: true
    });

  if (insertError) throw insertError;

  const brands = await loadSetBrands(supabase, setId);
  // The exact addedCount can be lower than `cleaned.length` if some
  // were already members; we don't bother computing the precise delta
  // because the API consumer only uses this for a "Added N brand(s)"
  // toast.
  return { status: "ok", brands, addedCount: cleaned.length };
}

export async function removeBrandFromSet(
  supabase: SupabaseClient<Database>,
  userId: string,
  setId: string,
  companyId: string
): Promise<"removed" | "missing"> {
  const owned = await assertSetOwnership(supabase, userId, setId);
  if (!owned) return "missing";

  const { error } = await supabase
    .from("competitor_set_members")
    .delete()
    .eq("set_id", setId)
    .eq("company_id", companyId);

  if (error) throw error;
  return "removed";
}

/**
 * Fetch the multi-brand comparison payload for the dashboard. Calls the
 * existing per-brand `getBrandPageData` in parallel so we reuse every
 * aggregation already battle-tested by the `/brands/[id]` route, and
 * returns the list in the same order the caller supplied.
 *
 * Brand ids that resolve to `null` (deleted, never existed) are
 * collected into `missing` so the caller can surface them.
 */
export async function getCompetitorComparison(
  supabase: SupabaseClient<Database>,
  brandIds: string[]
): Promise<CompetitorComparison> {
  const cleaned = dedupeBrandIds(brandIds).slice(0, MAX_BRANDS_PER_COMPARISON);
  if (cleaned.length === 0) {
    return { brands: [], missing: [] };
  }

  const results = await Promise.all(
    cleaned.map((id) => getBrandPageData(supabase, id))
  );

  const brands: BrandPageData[] = [];
  const missing: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const result = results[i];
    if (result) {
      brands.push(result);
    } else {
      missing.push(cleaned[i]);
    }
  }

  return { brands, missing };
}

// ---------- internal helpers ----------

async function loadSetBrands(
  supabase: SupabaseClient<Database>,
  setId: string
): Promise<CompetitorSetBrand[]> {
  const { data, error } = await supabase
    .from("competitor_set_members")
    .select(
      `added_at,
       company_id,
       companies!inner(id, name, domain, markets, logo_storage_path, deleted_at)`
    )
    .eq("set_id", setId)
    .order("added_at", { ascending: true });

  if (error) throw error;

  const rows = data ?? [];
  const logoPaths = new Set<string>();
  for (const row of rows) {
    const company = pickCompany(row.companies);
    if (
      company &&
      !company.deleted_at &&
      company.logo_storage_path
    ) {
      logoPaths.add(company.logo_storage_path);
    }
  }
  const signed =
    logoPaths.size > 0 ? await getSignedAssets(Array.from(logoPaths)) : {};

  const brands: CompetitorSetBrand[] = [];
  for (const row of rows) {
    const company = pickCompany(row.companies);
    if (!company || company.deleted_at) continue;
    const logoPath = company.logo_storage_path ?? null;
    brands.push({
      id: company.id,
      name: company.name,
      domain: company.domain ?? null,
      markets: Array.isArray(company.markets)
        ? company.markets.filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0
          )
        : [],
      logoUrl: logoPath ? signed[logoPath] ?? null : null
    });
  }
  return brands;
}

async function assertSetOwnership(
  supabase: SupabaseClient<Database>,
  userId: string,
  setId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("competitor_sets")
    .select("id")
    .eq("id", setId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

function sanitizeName(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    throw new Error("Set name is required");
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return trimmed.slice(0, MAX_NAME_LENGTH);
  }
  return trimmed;
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * De-duplicates a list of brand ids while keeping the caller's order
 * (first occurrence wins). Anything that doesn't look like a UUID is
 * dropped quietly so an upstream typo doesn't leak into a PostgREST
 * 22P02. Exported so the API layer can share the same gate.
 */
export function dedupeBrandIds(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!UUID_PATTERN.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

type CompanyField =
  | {
      id: string
      name: string
      domain?: string | null
      markets?: string[] | null
      logo_storage_path?: string | null
      deleted_at?: string | null
    }
  | Array<{
      id: string
      name: string
      domain?: string | null
      markets?: string[] | null
      logo_storage_path?: string | null
      deleted_at?: string | null
    }>
  | null
  | undefined;

function pickCompany(value: CompanyField) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
