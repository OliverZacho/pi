import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { searchBrands } from "@/lib/brands-explore-db";
import { logoDevUrl } from "@/lib/logo-dev";
import {
  mergeBrandSearchResults,
  searchLogoDevBrands
} from "@/lib/logo-dev-search";
import { clientRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Requestable Logo.dev brands offered as the visitor types. */
export type BrandRequestSuggestion = {
  name: string;
  domain: string;
  logoUrl: string | null;
};

/** Catalogue brands matching the query, shown so nobody requests a brand we already track. */
export type BrandRequestTrackedMatch = {
  name: string;
  slug: string;
  logoUrl: string | null;
};

const MIN_QUERY = 2;
const MAX_QUERY = 80;
const MAX_TRACKED = 3;
const MAX_SUGGESTIONS = 5;

// Coarse per-instance throttle so an anonymous visitor can't burn through
// the Logo.dev search quota. Keyed on the hashed client IP; the typeahead
// already debounces, so a human never gets near this.
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { count: number; expiresAt: number }>();

function underRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.expiresAt < now) {
    rateBuckets.set(key, { count: 1, expiresAt: now + RATE_WINDOW_MS });
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (v.expiresAt < now) rateBuckets.delete(k);
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT;
}

/**
 * `GET /api/brand-requests/search?q=` — typeahead source for the public
 * "Request a brand" form, which logged-out visitors can use too, so there
 * is no session gate. Returns Logo.dev Brand Search hits for brands we
 * don't track yet (the Logo.dev secret stays server-side) plus tracked
 * catalogue matches, so the form can point at an existing brand page
 * instead of taking a duplicate request. Catalogue metadata only, nothing
 * paywalled. Any upstream failure degrades to empty lists.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY);
  if (q.length < MIN_QUERY) {
    return NextResponse.json({ suggestions: [], tracked: [] });
  }
  if (!underRateLimit(clientRateKey(request))) {
    return NextResponse.json(
      { error: "Too many searches. Please slow down." },
      { status: 429 }
    );
  }

  const admin = getSupabaseAdmin();
  try {
    const [logoDevItems, trackedResult, domainsResult] = await Promise.all([
      searchLogoDevBrands(q),
      searchBrands(admin, { query: q, sort: "name_asc", pageSize: MAX_TRACKED }),
      admin.from("companies").select("domain").is("deleted_at", null)
    ]);
    if (domainsResult.error) throw domainsResult.error;

    const suggestions: BrandRequestSuggestion[] = mergeBrandSearchResults(
      (domainsResult.data ?? []).map((row) => row.domain),
      logoDevItems,
      { query: q, limit: MAX_SUGGESTIONS }
    ).map((item) => ({
      name: item.name,
      domain: item.domain,
      logoUrl: logoDevUrl(item.domain)
    }));

    const tracked: BrandRequestTrackedMatch[] = trackedResult.items.map((item) => ({
      name: item.name,
      slug: item.slug,
      logoUrl: item.logoUrl
    }));

    return NextResponse.json({ suggestions, tracked });
  } catch (error) {
    console.error("Brand request search failed", error);
    return NextResponse.json({ suggestions: [], tracked: [] });
  }
}
