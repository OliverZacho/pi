import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrandPageData, type BrandPageData } from "./brand-db";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "./storage";
import { MAX_BRANDS_PER_COMPARISON } from "./competitor-constants";
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
 *
 * Defined in `./competitor-constants` (dependency-free) and re-exported here
 * so server-side callers keep importing it from competitor-db, while client
 * components import it from competitor-constants without dragging in this
 * module's server-only deps.
 */
export { MAX_BRANDS_PER_COMPARISON };

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
  /**
   * Inbox/list ids this brand is scoped to within the set. Empty = the
   * brand's full output ("All lists"). Lets a comparison pin e.g. ARKET to
   * just its "Men" + "Women" lists instead of everything it sends.
   */
  inboxIds: string[];
};

/**
 * One brand to include in a comparison, optionally pinned to a subset of
 * its mailing lists. Used by create / add / compare so the list scope rides
 * alongside the company id through every layer.
 */
export type ComparisonMemberInput = {
  companyId: string;
  inboxIds?: string[] | null;
};

export type CompetitorSetDetail = {
  id: string;
  name: string;
  ownerId: string;
  /** Owner has shared this with their team (read-only for co-members). */
  sharedWithTeam: boolean;
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
 * Returns the set of competitor-set ids (owned by `userId`) that
 * already contain `companyId`. Used by the brand page to pre-check the
 * "Add to group" popover so the UI reflects current membership the
 * moment it opens.
 */
export async function listSetIdsContainingBrand(
  supabase: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("competitor_set_members")
    .select("set_id, competitor_sets!inner(user_id)")
    .eq("company_id", companyId)
    .eq("competitor_sets.user_id", userId);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.set_id));
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
    .select("id, name, user_id, shared_with_team, created_at, updated_at")
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
    sharedWithTeam: setRow.shared_with_team,
    createdAt: setRow.created_at,
    updatedAt: setRow.updated_at,
    brands
  };
}

/**
 * Read a set by id WITHOUT the owner filter — RLS decides access, so this
 * returns the row when the caller owns it OR it's shared with their team.
 * Callers compare `ownerId` to the viewer to gate edit controls.
 */
export async function getCompetitorSetForReader(
  supabase: SupabaseClient<Database>,
  setId: string
): Promise<CompetitorSetDetail | null> {
  const { data: setRow, error: setError } = await supabase
    .from("competitor_sets")
    .select("id, name, user_id, shared_with_team, created_at, updated_at")
    .eq("id", setId)
    .maybeSingle();

  if (setError) throw setError;
  if (!setRow) return null;

  const brands = await loadSetBrands(supabase, setId);

  return {
    id: setRow.id,
    name: setRow.name,
    ownerId: setRow.user_id,
    sharedWithTeam: setRow.shared_with_team,
    createdAt: setRow.created_at,
    updatedAt: setRow.updated_at,
    brands
  };
}

/** Set/clear the team-share flag. Owner-only (RLS + explicit user filter). */
export async function setCompetitorSetShared(
  supabase: SupabaseClient<Database>,
  userId: string,
  setId: string,
  shared: boolean
): Promise<boolean> {
  const { data, error } = await supabase
    .from("competitor_sets")
    .update({ shared_with_team: shared })
    .eq("id", setId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

/**
 * Deep-copy a team-shared comparison into another user's account. Uses the
 * admin client (the recipient may be a lapsed member without archive
 * access). The source MUST be shared_with_team — the route also checks the
 * recipient is on the owner's team. The copy is private and clones the
 * brand membership (with per-brand inbox scopes).
 */
export async function copySharedSet(
  admin: SupabaseClient<Database>,
  sourceSetId: string,
  targetUserId: string
): Promise<{ id: string; name: string } | null> {
  const { data: source, error } = await admin
    .from("competitor_sets")
    .select("name, shared_with_team")
    .eq("id", sourceSetId)
    .maybeSingle();

  if (error) throw error;
  if (!source || !source.shared_with_team) return null;

  const copyName = `${source.name} (copy)`.slice(0, 120);

  const { data: created, error: insertError } = await admin
    .from("competitor_sets")
    .insert({ user_id: targetUserId, name: copyName, shared_with_team: false })
    .select("id, name")
    .single();
  if (insertError || !created) {
    throw insertError ?? new Error("Failed to create comparison copy");
  }

  const { data: members, error: membersError } = await admin
    .from("competitor_set_members")
    .select("company_id, inbox_ids")
    .eq("set_id", sourceSetId);
  if (membersError) throw membersError;

  const rows = (members ?? []).map((m) => ({
    set_id: created.id,
    company_id: m.company_id,
    inbox_ids: m.inbox_ids
  }));
  if (rows.length > 0) {
    const { error: copyError } = await admin
      .from("competitor_set_members")
      .insert(rows);
    if (copyError) throw copyError;
  }

  return { id: created.id, name: created.name };
}

/** A comparison a teammate has shared with the viewer's team. */
export type TeamSharedSet = {
  id: string;
  name: string;
  brandCount: number;
  updatedAt: string;
  ownerId: string;
  ownerName: string | null;
};

/**
 * Comparisons shared with the viewer's team by OTHER members. RLS returns
 * only same-team shared rows; owner names resolved via the admin client.
 */
export async function listTeamSharedSets(
  supabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  userId: string
): Promise<TeamSharedSet[]> {
  const { data, error } = await supabase
    .from("competitor_sets")
    .select("id, name, user_id, updated_at")
    .eq("shared_with_team", true)
    .neq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const setIds = rows.map((r) => r.id);
  const { data: memberRows } = await supabase
    .from("competitor_set_members")
    .select("set_id")
    .in("set_id", setIds);
  const counts = new Map<string, number>();
  for (const m of memberRows ?? []) {
    counts.set(m.set_id, (counts.get(m.set_id) ?? 0) + 1);
  }

  const ownerIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name, email")
    .in("user_id", ownerIds);
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.user_id, p.full_name || p.email])
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    brandCount: counts.get(r.id) ?? 0,
    updatedAt: r.updated_at,
    ownerId: r.user_id,
    ownerName: nameById.get(r.user_id) ?? null
  }));
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
  args: { name: string; members: ComparisonMemberInput[] }
): Promise<CompetitorSetDetail> {
  const name = sanitizeName(args.name);
  const members = dedupeMembers(args.members).slice(
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

  if (members.length > 0) {
    const rows = members.map((member) => ({
      set_id: inserted.id,
      company_id: member.companyId,
      inbox_ids: member.inboxIds && member.inboxIds.length > 0 ? member.inboxIds : null
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
    sharedWithTeam: false,
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
  members: ComparisonMemberInput[]
): Promise<
  | { status: "missing" }
  | { status: "ok"; brands: CompetitorSetBrand[]; addedCount: number }
  | { status: "full" }
> {
  const owned = await assertSetOwnership(supabase, userId, setId);
  if (!owned) return { status: "missing" };

  const cleaned = dedupeMembers(members);
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

  const rows = cleaned.map((member) => ({
    set_id: setId,
    company_id: member.companyId,
    inbox_ids: member.inboxIds && member.inboxIds.length > 0 ? member.inboxIds : null
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

/**
 * Re-scope an existing member to a subset of its mailing lists (or back to
 * "All lists" with an empty list). Owner-checked; returns `missing` for
 * sets the caller doesn't own.
 */
export async function setMemberInboxes(
  supabase: SupabaseClient<Database>,
  userId: string,
  setId: string,
  companyId: string,
  inboxIds: string[]
): Promise<"updated" | "missing"> {
  const owned = await assertSetOwnership(supabase, userId, setId);
  if (!owned) return "missing";

  const { error } = await supabase
    .from("competitor_set_members")
    .update({ inbox_ids: inboxIds.length > 0 ? inboxIds : null })
    .eq("set_id", setId)
    .eq("company_id", companyId);

  if (error) throw error;
  return "updated";
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

export type ComparisonActivity = {
  /** Non-duplicate emails received across the set's brands, last 7 days. */
  sends7d: number;
  /** Distinct member brands that sent at least one discount email. */
  saleBrands: number;
};

/**
 * Cheap freshness signal for the landing's comparison cards: one
 * members lookup + one 7-day email scan across the union of every
 * set's brands. Deliberately *not* the per-brand analytics fan-out the
 * detail page runs — the landing lists many sets and this keeps it to
 * two indexed queries total. Sets without recent activity simply map
 * to zeros.
 */
export async function getComparisonActivity(
  supabase: SupabaseClient<Database>,
  setIds: string[]
): Promise<Record<string, ComparisonActivity>> {
  const result: Record<string, ComparisonActivity> = {};
  if (setIds.length === 0) return result;

  const { data: memberRows, error: memberError } = await supabase
    .from("competitor_set_members")
    .select("set_id, company_id")
    .in("set_id", setIds);
  if (memberError) throw memberError;

  const setsByCompany = new Map<string, string[]>();
  for (const row of memberRows ?? []) {
    const list = setsByCompany.get(row.company_id) ?? [];
    list.push(row.set_id);
    setsByCompany.set(row.company_id, list);
  }
  const companyIds = [...setsByCompany.keys()];
  if (companyIds.length === 0) return result;

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: emailRows, error: emailError } = await supabase
    .from("captured_emails")
    .select("company_id, discount_percent")
    .in("company_id", companyIds)
    .gte("received_at", since)
    .is("duplicate_of", null);
  if (emailError) throw emailError;

  const sends = new Map<string, number>();
  const saleBrandsBySet = new Map<string, Set<string>>();
  for (const row of emailRows ?? []) {
    if (!row.company_id) continue;
    const sets = setsByCompany.get(row.company_id);
    if (!sets) continue;
    for (const setId of sets) {
      sends.set(setId, (sends.get(setId) ?? 0) + 1);
      if (row.discount_percent !== null && Number(row.discount_percent) > 0) {
        const brands = saleBrandsBySet.get(setId) ?? new Set<string>();
        brands.add(row.company_id);
        saleBrandsBySet.set(setId, brands);
      }
    }
  }

  for (const setId of setIds) {
    result[setId] = {
      sends7d: sends.get(setId) ?? 0,
      saleBrands: saleBrandsBySet.get(setId)?.size ?? 0
    };
  }
  return result;
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
  members: Array<string | ComparisonMemberInput>
): Promise<CompetitorComparison> {
  // Accept either bare company ids (ad-hoc `?brands=` deep links, which
  // always compare a brand's full output) or `{ companyId, inboxIds }`
  // members (saved sets, where each brand can be pinned to a subset of lists).
  const normalized = members.map((m) =>
    typeof m === "string" ? { companyId: m, inboxIds: null } : m
  );

  // Dedupe by companyId, keeping the first occurrence's list scope.
  const seen = new Set<string>();
  const cleaned: ComparisonMemberInput[] = [];
  for (const member of normalized) {
    if (!member.companyId || seen.has(member.companyId)) continue;
    seen.add(member.companyId);
    cleaned.push(member);
    if (cleaned.length >= MAX_BRANDS_PER_COMPARISON) break;
  }
  if (cleaned.length === 0) {
    return { brands: [], missing: [] };
  }

  const results = await Promise.all(
    cleaned.map((member) =>
      getBrandPageData(supabase, member.companyId, {
        segmentInboxIds: member.inboxIds ?? null
      })
    )
  );

  const brands: BrandPageData[] = [];
  const missing: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const result = results[i];
    if (result) {
      brands.push(result);
    } else {
      missing.push(cleaned[i].companyId);
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
       inbox_ids,
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
    logoPaths.size > 0
      ? await getSignedAssets(Array.from(logoPaths), {
          transform: BRAND_LOGO_TRANSFORM
        })
      : {};

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
      logoUrl: logoPath ? signed[logoPath] ?? null : null,
      inboxIds: Array.isArray(row.inbox_ids)
        ? row.inbox_ids.filter(
            (value): value is string => typeof value === "string"
          )
        : []
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

/**
 * Validate + dedupe a member list by companyId (first occurrence wins, so
 * its list scope is the one kept). Inbox ids that aren't UUIDs are dropped
 * from the scope rather than rejecting the whole member; an empty result
 * means "All lists".
 */
export function dedupeMembers(
  input: ComparisonMemberInput[]
): ComparisonMemberInput[] {
  const seen = new Set<string>();
  const out: ComparisonMemberInput[] = [];
  for (const member of input) {
    const companyId =
      typeof member?.companyId === "string" ? member.companyId.trim() : "";
    if (!UUID_PATTERN.test(companyId)) continue;
    if (seen.has(companyId)) continue;
    seen.add(companyId);
    out.push({ companyId, inboxIds: sanitizeInboxIds(member.inboxIds) });
  }
  return out;
}

/** Keep only well-formed, unique inbox UUIDs; anything else is dropped. */
function sanitizeInboxIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (UUID_PATTERN.test(trimmed)) seen.add(trimmed);
  }
  return Array.from(seen);
}

/**
 * Pull a member list out of a request body, accepting both the new
 * `{ members: [{ companyId, inboxIds }] }` shape and the legacy
 * `{ brandIds: string[] }` (which always means "all lists"). Validation
 * and dedupe happen later in {@link dedupeMembers}.
 */
export function parseMemberInputs(body: unknown): ComparisonMemberInput[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  if (Array.isArray(obj.members)) {
    return obj.members
      .filter(
        (m): m is Record<string, unknown> =>
          Boolean(m) && typeof m === "object"
      )
      .map((m) => ({
        companyId: typeof m.companyId === "string" ? m.companyId : "",
        inboxIds: Array.isArray(m.inboxIds)
          ? m.inboxIds.filter((v): v is string => typeof v === "string")
          : null
      }));
  }
  if (Array.isArray(obj.brandIds)) {
    return obj.brandIds
      .filter((v): v is string => typeof v === "string")
      .map((companyId) => ({ companyId, inboxIds: null }));
  }
  return [];
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
