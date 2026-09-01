import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { searchBrands } from "@/lib/brands-explore-db";
import { logoDevUrl, normalizeHost } from "@/lib/logo-dev";
import {
  mergeBrandSearchResults,
  searchLogoDevBrands
} from "@/lib/logo-dev-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/onboarding/brand-search` — the onboarding modal's brand source.
 *
 * Gated by `requireSession()` only: brand-new signups are free-tier and
 * cannot pass `requireArchiveAccess`, so `/api/brands/list` is unusable
 * here. Reads run on the service-role client, mirroring how the /brands
 * page serves unentitled viewers. The response is catalogue metadata (name,
 * category, logo) — no email content, so nothing paywalled leaks.
 *
 * Without `q`: popular suggestions (most active brands), optionally scoped
 * to the step-2 category picks via `markets` (comma-separated slugs).
 * With `q`: tracked-brand matches plus — when `untracked=1` — Logo.dev
 * Brand Search results for brands we don't track yet, which the modal
 * renders as requestable picks. Logo.dev rows that duplicate a tracked
 * domain are dropped so a tracked brand always surfaces as followable.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const includeUntracked = url.searchParams.get("untracked") === "1";
  const markets = (url.searchParams.get("markets") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);

  const admin = getSupabaseAdmin();

  try {
    const trackedPromise = q
      ? searchBrands(admin, { query: q, sort: "name_asc", pageSize: 20 })
      : searchBrands(admin, {
          markets: markets.length > 0 ? markets : undefined,
          sort: "most_active",
          pageSize: 24
        });

    const logoDevPromise =
      q && includeUntracked ? searchLogoDevBrands(q) : Promise.resolve([]);

    const [tracked, logoDevItems] = await Promise.all([
      trackedPromise,
      logoDevPromise
    ]);

    let untracked: { name: string; domain: string; logoUrl: string | null }[] =
      [];
    if (logoDevItems.length > 0) {
      // Dedupe against every tracked domain, not just this query's matches —
      // Logo.dev may know a brand under a name our text matcher missed.
      const { data: domains, error } = await admin
        .from("companies")
        .select("domain")
        .is("deleted_at", null);
      if (error) throw error;
      untracked = mergeBrandSearchResults(
        (domains ?? []).map((row) => row.domain),
        logoDevItems,
        { query: q }
      ).map((item) => ({
        name: item.name,
        domain: item.domain,
        logoUrl: logoDevUrl(item.domain)
      }));
    }

    // The card shape doesn't carry domains, but the own-brand answer on
    // step 1 stores one — fetch them for this result page in one query.
    const trackedIds = tracked.items.map((item) => item.id);
    const domainById = new Map<string, string | null>();
    if (trackedIds.length > 0) {
      const { data: rows, error } = await admin
        .from("companies")
        .select("id, domain")
        .in("id", trackedIds);
      if (error) throw error;
      for (const row of rows ?? []) {
        domainById.set(row.id, normalizeHost(row.domain ?? "") ?? null);
      }
    }

    return NextResponse.json({
      tracked: tracked.items.map((item) => ({
        id: item.id,
        name: item.name,
        markets: item.markets,
        domain: domainById.get(item.id) ?? null,
        logoUrl: item.logoUrl
      })),
      untracked
    });
  } catch (error) {
    console.error("Onboarding brand search failed", error);
    return NextResponse.json(
      { error: "Brand search failed" },
      { status: 500 }
    );
  }
}
